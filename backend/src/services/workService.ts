import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getDb, transaction } from '../db/connection.js'
import { getCoverDir } from '../settings.js'
import { fetchWorkMeta, toNumber } from '../dlsite/index.js'
import { BATCH_SIZE, fetchApi1Batch } from '../dlsite/fallback.js'
import { clearDynamicCache, dropCachedEntry, getCachedEntry } from '../dlsite/dynamicCache.js'
import { downloadToFile } from '../dlsite/client.js'
import type { DlsiteMeta, DlsiteTag, DlsiteTranslation } from '../dlsite/types.js'
import { ALL_AGES_TAG, CUSTOM_TAG } from './hidden.js'

const AUDIO_EXTS = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'wma', 'aiff'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'ts'])
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'])

/** 一次扫描对单个作品的处置结果，同时写入 works.last_scan_result。 */
export type ScanOutcome = '跳过' | '已处理' | '禁售' | '下架' | '失败'

export interface UpsertResult {
  created: boolean
  outcome: ScanOutcome
}

export interface CoverRedownloadResult {
  total: number
  downloaded: number
  skipped: number
  /** 本次更新了价格 / 评分 / 评论数 / 销量的作品数 */
  statsUpdated: number
  errors: string[]
}

interface WorkRow {
  id: number
  rj_code: string
  title: string
  circle: string
  release_date: string
  series: string
  sales_count: number | null
  price: number | null
  rating: number | null
  rating_count: number | null
  cover_path: string
  folder_path: string
  source_path: string
  file_count: number
  /** 上次抓取时 DLsite 的返回状态：'' / ok / region_blocked / not_found / error */
  fetch_status: string
  /** 当前封面文件来源：'' / dlsite / hvdb */
  cover_source: string
  /** 1 = 声优字段已被权威数据源确认（此时「无声优」代表该作品真的没有） */
  actors_confirmed?: number
  /** 1 = 类型标签已被权威数据源确认（此时「无原生标签」代表该作品真的没有分类） */
  tags_confirmed?: number
  /** 目录树签名（各子目录 mtimeMs 的哈希），没变就跳过文件遍历 */
  folder_sig?: string
  /** 上次扫描的处置结果：'' / 跳过 / 已处理 / 禁售 / 下架 / 失败 */
  last_scan_result?: string
  last_scan_at?: string
  /** 1 = 用户手动设置过封面，抓取时不得覆盖 */
  cover_modified?: number
  updated_at: string
}

interface FileRow {
  filename: string
  rel_path: string
  ext: string
  kind: string
  is_dir: number
  size: number
}

/**
 * 扫描上下文：把「每部作品都要查一遍」的 DB 查询与文件 stat 一次性预读到内存。
 *
 * 之前每部作品要查 2 次 works、2 次 COUNT（标签/声优）、1 次封面文件存在性，
 * 7685 部就是三万多条 SQL + 上万次网络盘 stat，且全是同步调用 —— 这是「跳过也要跑一两分钟」的主因之一。
 */
export interface ScanContext {
  /** rj → works 行 */
  works: Map<string, WorkRow>
  /** work_id → 原生标签数（不含自定义标签） */
  tagCount: Map<number, number>
  /** work_id → 声优数 */
  actorCount: Map<number, number>
  /** 封面目录里的文件名集合 */
  coverFiles: Set<string>
}

export function buildScanContext(db: DatabaseSync): ScanContext {
  const works = new Map<string, WorkRow>()
  for (const row of db.prepare('SELECT * FROM works').all() as unknown as WorkRow[]) {
    works.set(row.rj_code, row)
  }
  const tagCount = new Map<number, number>()
  const tagRows = db
    .prepare(
      `SELECT wt.work_id AS id, COUNT(*) AS c FROM work_tags wt JOIN tags t ON t.id = wt.tag_id
       WHERE t.category != ? GROUP BY wt.work_id`
    )
    .all(CUSTOM_TAG) as Array<{ id: number; c: number }>
  for (const r of tagRows) tagCount.set(Number(r.id), Number(r.c))
  const actorCount = new Map<number, number>()
  const actorRows = db
    .prepare('SELECT work_id AS id, COUNT(*) AS c FROM work_actors GROUP BY work_id')
    .all() as Array<{ id: number; c: number }>
  for (const r of actorRows) actorCount.set(Number(r.id), Number(r.c))
  const coverFiles = new Set<string>()
  try {
    for (const f of fs.readdirSync(getCoverDir())) coverFiles.add(f)
  } catch {
    /* 封面目录不存在时视为空 */
  }
  return { works, tagCount, actorCount, coverFiles }
}

/** 抓取 / 新建后刷新上下文里这一部作品的字段与计数，供后续判定复用。 */
function refreshContext(ctx: ScanContext, db: DatabaseSync, rj: string): void {
  const row = db.prepare('SELECT * FROM works WHERE rj_code = ?').get(rj) as unknown as WorkRow | undefined
  if (!row) return
  ctx.works.set(rj, row)
  const tc = db
    .prepare(
      `SELECT COUNT(*) AS c FROM work_tags wt JOIN tags t ON t.id = wt.tag_id
       WHERE wt.work_id = ? AND t.category != ?`
    )
    .get(row.id, CUSTOM_TAG) as { c: number }
  ctx.tagCount.set(row.id, Number(tc.c))
  const ac = db.prepare('SELECT COUNT(*) AS c FROM work_actors WHERE work_id = ?').get(row.id) as { c: number }
  ctx.actorCount.set(row.id, Number(ac.c))
  const base = path.basename(String(row.cover_path || ''))
  if (base) ctx.coverFiles.add(base)
}

/**
 * 将本地一个 RJ 文件夹同步进数据库：
 * - 若作品不存在，则从 DLsite 抓取元数据并入库；
 * - 若已存在且信息不完整（或上次禁售），补抓一次；
 * - 信息完整且未要求刷新时**一个请求都不发**，直接跳过；
 * - 文件夹结构没变（目录签名一致）时连文件遍历都跳过。
 *
 * 传入 ctx 时，判定所需的 works / 计数 / 封面文件集合都从内存取，不再逐部查库。
 * 返回值里的 outcome 是本轮对这部作品的处置结果，同时写入 works.last_scan_result。
 */
export async function upsertWorkFolder(
  rj: string,
  folder: string,
  source: string,
  onStage?: (stage: string) => void,
  ctx?: ScanContext
): Promise<UpsertResult> {
  const db = getDb()
  const existing = ctx
    ? ctx.works.get(rj)
    : (db.prepare('SELECT * FROM works WHERE rj_code = ?').get(rj) as unknown as WorkRow | undefined)

  let created = false
  let outcome: ScanOutcome
  if (!existing) {
    created = true
    onStage?.('抓取元数据')
    await createWork(db, rj, folder, source, onStage)
    if (ctx) refreshContext(ctx, db, rj)
    outcome = fetchedOutcome(db, rj)
  } else if (needsMetadataRefresh(db, existing, ctx)) {
    // 信息缺失（无标题 / 无声优 / 无封面文件）→ 补抓，最多重试 2 次
    onStage?.('补抓元数据')
    await retryRefreshMetadata(db, existing.id, rj)
    if (ctx) refreshContext(ctx, db, rj)
    outcome = fetchedOutcome(db, rj)
  } else {
    // 数据完整、未勾选刷新动态数据：不请求任何网站接口，直接跳过
    outcome = '跳过'
  }

  const work = ctx
    ? (ctx.works.get(rj) as WorkRow)
    : (db.prepare('SELECT * FROM works WHERE rj_code = ?').get(rj) as unknown as WorkRow)

  // 目录签名一致 → 文件夹结构没动过，连 readdir / stat 都省掉。
  // 签名第一次为空（老数据）时必定走一次全量扫描，此后才生效。
  const sig = folderSignature(folder)
  if (!sig || sig !== String(work.folder_sig || '')) {
    onStage?.('扫描文件')
    scanWorkFiles(db, work.id, folder)
    db.prepare('UPDATE works SET folder_sig = ? WHERE id = ?').run(sig, work.id)
  }
  markScanResult(db, work.id, outcome)
  if (ctx) ctx.works.set(rj, { ...work, last_scan_result: outcome })
  return { created, outcome }
}

/** fetch_status → 本轮处置结果。 */
function outcomeOfStatus(status: string): ScanOutcome {
  if (status === 'ok') return '已处理'
  if (status === 'region_blocked') return '禁售'
  if (status === 'not_found') return '下架'
  return '失败'
}

/** 抓取完成后按库里的最新状态给出处置结果。 */
function fetchedOutcome(db: DatabaseSync, rj: string): ScanOutcome {
  const row = db.prepare('SELECT fetch_status FROM works WHERE rj_code = ?').get(rj) as
    | { fetch_status?: string }
    | undefined
  return outcomeOfStatus(String(row?.fetch_status || ''))
}

/** 记录「上次扫描的处置结果 + 时间」，跳过的作品也写，便于后台区分。 */
function markScanResult(db: DatabaseSync, workId: number, outcome: ScanOutcome): void {
  db.prepare('UPDATE works SET last_scan_result = ?, last_scan_at = ? WHERE id = ?').run(
    outcome,
    new Date().toISOString(),
    workId
  )
}

/** 「信息是否完整」的判定项：只有这些缺了才算不完整。 */
export const MISSING_FIELDS = {
  title: '标题',
  circle: '社团',
  actors: '声优',
  cover: '封面',
  release_date: '发售日',
  price: '价格',
  tags: '类型标签',
} as const

export type MissingField = keyof typeof MISSING_FIELDS

interface MissingCheckRow {
  id: number
  title?: unknown
  circle?: unknown
  release_date?: unknown
  price?: unknown
  cover_path?: unknown
  actors_confirmed?: unknown
  tags_confirmed?: unknown
}

function coverFileExists(coverPath: string): boolean {
  if (!coverPath) return false
  return fs.existsSync(path.join(getCoverDir(), path.basename(coverPath)))
}

/** 原生标签（DLsite 类型标签）数量；「全年龄」等自定义标签不算。 */
function nativeTagCount(db: DatabaseSync, workId: number): number {
  const { c } = db
    .prepare(
      `SELECT COUNT(*) AS c FROM work_tags wt JOIN tags t ON t.id = wt.tag_id
       WHERE wt.work_id = ? AND t.category != ?`
    )
    .get(workId, CUSTOM_TAG) as { c: number }
  return c
}

/**
 * 列出作品缺失的信息项。
 *
 * 判定只依赖库里的字段，不关心数据来自 DLsite 页面还是兜底接口 —— 这样
 * 「DLsite 上没有这个作品」与「作品在当前离线地区不卖」在库里表现一致（都缺），
 * 下次扫描只要还是缺就会继续抓，换到可用线路后自然补齐。
 *
 * 声优比较特殊：CG 集 / 漫画这类作品确实没有声优，不能一律算缺失。
 * 靠 actors_confirmed 区分 —— 只有「没抓到声优且从未被权威数据源确认过」才算缺，
 * 抓过一次（api2 的 creaters / 作品页信息区）后为空即视为该作品真的没有。
 *
 * 类型标签同理：有些作品在 DLsite 上只有「作品形式」没有「分類」（全年龄 ASMR 企划、
 * 素材集），api2 明确返回过 genres 字段却为空，靠 tags_confirmed 记住这个结论。
 *
 * 系列、评分、评论数、销量、其它语言版本都不算必需项：
 * 前两者可能真的没有，后两者是 0 也合理（NULL 才代表没抓到）。
 */
export function missingFieldsOf(
  db: DatabaseSync,
  row: MissingCheckRow,
  ctx?: ScanContext
): MissingField[] {
  const id = Number(row.id)
  const coverPath = String(row.cover_path || '')
  // 传了 ctx 时全部走内存（扫描路径），否则按需查库（后台接口等单部调用）
  const tags = ctx ? ctx.tagCount.get(id) || 0 : nativeTagCount(db, id)
  const actors = ctx ? ctx.actorCount.get(id) || 0 : actorCount(db, id)
  const hasCover = ctx
    ? Boolean(coverPath) && ctx.coverFiles.has(path.basename(coverPath))
    : coverFileExists(coverPath)

  const out: MissingField[] = []
  if (!String(row.title || '').trim()) out.push('title')
  if (!String(row.circle || '').trim()) out.push('circle')
  if (Number(row.actors_confirmed) !== 1 && !actors) out.push('actors')
  if (!hasCover) out.push('cover')
  if (!String(row.release_date || '').trim()) out.push('release_date')
  if (row.price == null) out.push('price')
  if (Number(row.tags_confirmed) !== 1 && !tags) out.push('tags')
  return out
}

function actorCount(db: DatabaseSync, workId: number): number {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM work_actors WHERE work_id = ?').get(workId) as {
    c: number
  }
  return c
}

/**
 * 判断现有作品是否需要补抓 DLsite。
 *
 * 先看上次抓取的 DL 状态（fetch_status），它记录了「这个作品该去哪找信息」：
 * - region_blocked：当前线路所在区域不卖。字段可能是 HVDB 兜底补的「假完整」，
 *   只要换到可用线路就必须无条件重抓，不看字段缺不缺。
 * - not_found：DLsite 上确实没有（下架/未发售），兜底也已拿到基本信息 →
 *   再抓也不会有新东西，跳过，避免每次扫描都白发请求。
 * - '' / ok / error：按必需项是否缺失判定（老库数据也走这条）。
 */
function needsMetadataRefresh(db: DatabaseSync, existing: WorkRow, ctx?: ScanContext): boolean {
  const status = String(existing.fetch_status || '')
  if (status === 'region_blocked') return true
  const missing = missingFieldsOf(db, existing, ctx)
  if (missing.length === 0) return false
  if (status === 'not_found' && String(existing.title || '').trim()) {
    // DLsite 上确实没有这部作品，标题 / 声优 / 标签再抓也补不到。
    // 唯一值得再抓的是**封面**：DLsite 没有，但兜底站点可能有（见 fallbackPlan 的 cover 档）。
    return missing.includes('cover')
  }
  return true
}

/**
 * 「干净作品」：上次是 DLsite 正常返回、封面也来自 DLsite、字段齐全。
 * 这类作品这次刷新只剩价格 / 评分 / 评论数 / 销量会变，用批量接口的数字写一遍即可，
 * 不需要再请求 api2 / 作品页；其余作品（含升级前的老数据，fetch_status 为空）仍走完整对齐，
 * 这样既省请求，又能把早前被兜底站点污染的数据修回来。
 */
export function isCleanWork(db: DatabaseSync, w: WorkRow): boolean {
  if (String(w.fetch_status || '') !== 'ok') return false
  if (String(w.cover_source || '') !== 'dlsite') return false
  if (Number(w.cover_modified) === 1) return false
  return missingFieldsOf(db, w).length === 0
}

export interface PrefetchResult {
  /** 进入批量请求的候选作品数 */
  candidates: number
  /** 批量接口实际返回的条目数（不存在 / 地区禁售的作品不会返回） */
  entries: number
  /** 发出的批量请求次数 */
  batches: number
}

/**
 * 批量预取动态数据到缓存。
 *
 * mode='missing'（扫描用）：只预取本次确实要抓的作品 —— 库里没有的、信息不全的、
 * 上次被地区禁售的。已经完整的作品本来就会被跳过，没必要替它们发请求。
 * mode='all'（全库刷新用）：候选全部预取。
 *
 * 批量接口返回的条目会被逐部流程（touch 动态数据、api1 兜底）直接命中，
 * 于是 N 部作品的动态数据只花 N/50 次请求。
 */
export async function prefetchDynamic(
  rjs: string[],
  mode: 'missing' | 'all' = 'missing',
  onProgress?: (done: number, total: number) => void
): Promise<PrefetchResult> {
  const targets = pickRefreshTargets(rjs, mode)
  if (!targets.length) return { candidates: 0, entries: 0, batches: 0 }

  // 新一轮预取：先清掉上一轮的残留，避免旧数据混进来
  clearDynamicCache()
  const entries = await fetchApi1Batch(targets, BATCH_SIZE, onProgress)
  return {
    candidates: targets.length,
    entries: Object.keys(entries).length,
    batches: Math.ceil(targets.length / BATCH_SIZE),
  }
}

/** 选出要进批量预取的作品（去重、去空），供 prefetchDynamic 与测试断言共用。 */
export function pickRefreshTargets(rjs: string[], mode: 'missing' | 'all' = 'missing'): string[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM works WHERE rj_code = ?')
  const targets: string[] = []
  const seen = new Set<string>()
  for (const rj of rjs) {
    const key = rj.trim().toUpperCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    if (mode === 'all') {
      targets.push(key)
      continue
    }
    const row = stmt.get(key) as unknown as WorkRow | undefined
    if (!row || needsMetadataRefresh(db, row)) targets.push(key)
  }
  return targets
}

/** 补抓元数据，最多重试 2 次，失败记录日志。 */
async function retryRefreshMetadata(db: DatabaseSync, workId: number, rj: string): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await refreshMetadata(db, workId, rj)
      return
    } catch (e) {
      console.warn(`[dlsite] ${rj} 补抓元数据失败(第${attempt}/2 次): ${(e as Error).message}`)
      await sleep(500)
    }
  }
  // 两次都失败（网络 / 风控）：记下 error 状态便于后台排查，字段保持原样，下次扫描还会重抓
  db.prepare("UPDATE works SET fetch_status = 'error', updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    workId
  )
  console.warn(`[dlsite] ${rj} 补抓元数据 2 次均失败，保留旧数据`)
}

async function createWork(
  db: DatabaseSync,
  rj: string,
  folder: string,
  source: string,
  onStage?: (stage: string) => void
): Promise<void> {
  let meta: Partial<DlsiteMeta> = { rj_code: rj }
  try {
    // 新作品没有确认记录、也没有封面：标签为空时核实「分類」，没封面时抓页面拿 og:image
    meta = { ...meta, ...(await fetchWorkMeta(rj, { verifyTags: true, verifyCover: true })) }
  } catch (e) {
    console.warn(`[dlsite] ${rj} fetch failed: ${(e as Error).message}`)
    // 所有来源都没拿到（网络 / 风控）：先建成空记录，标 error 便于后台识别，下次扫描会重抓
    meta.fetch_status = 'error'
  }

  let coverPath = ''
  if (meta.cover_url) {
    onStage?.('下载封面')
    try {
      coverPath = await saveCover(rj, meta.cover_url)
    } catch (e) {
      console.warn(`[dlsite] ${rj} cover download failed: ${(e as Error).message}`)
    }
  }

  const now = new Date().toISOString()
  const info = db
    .prepare(
      `INSERT INTO works (rj_code, title, circle, release_date, series, sales_count, price, rating, rating_count,
         cover_path, cover_source, folder_path, source_path, actors_confirmed, tags_confirmed, fetch_status, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      rj,
      meta.title || '',
      meta.circle || '',
      meta.release_date || '',
      meta.series || '',
      meta.sales_count ?? null,
      meta.price ?? null,
      meta.rating ?? null,
      meta.rating_count ?? null,
      coverPath,
      coverPath ? meta.cover_source || '' : '',
      folder,
      source,
      meta.actors_confirmed ? 1 : 0,
      meta.tags_confirmed ? 1 : 0,
      meta.fetch_status || '',
      now,
      now
    )
  const workId = Number(info.lastInsertRowid)
  // 作品被删除后重新入库：把该 RJ 的播放历史与计数重新关联到新作品 id（老 id 已不存在）
  db.prepare('UPDATE play_history SET work_id = ? WHERE rj_code = ?').run(workId, rj)
  db.prepare('UPDATE play_counts SET work_id = ? WHERE rj_code = ?').run(workId, rj)
  setActors(db, workId, meta.actors || [])
  setTags(db, workId, meta.tags || [])
  syncAllAgesTag(db, workId, meta.age_rating)
  setTranslations(db, workId, meta.translations)
}

interface CoverState {
  cover_path: string
  cover_source: string
  cover_modified: number
}

/**
 * 决定本次抓到封面后要不要下载 / 替换现有封面，返回最终的封面文件名与来源。
 *
 * - 手动封面（cover_modified=1）默认不动，只有显式「同步」才覆盖；
 * - 封面文件缺失 → 下载；
 * - 本次拿到 DLsite 正式封面、而库里存的是兜底（HVDB）封面 → 重下一次把它纠正回来，
 *   这是「换到可用线路后修复此前被兜底数据污染的作品」的关键一步。
 */
async function resolveCover(
  rj: string,
  meta: Partial<DlsiteMeta>,
  cur: CoverState,
  force: boolean
): Promise<{ path: string; source: string }> {
  const keep = { path: cur.cover_path || '', source: cur.cover_source || '' }
  if (cur.cover_modified && !force) return keep
  if (!meta.cover_url) return keep

  const exists = Boolean(cur.cover_path) && fs.existsSync(path.join(getCoverDir(), path.basename(cur.cover_path)))
  const source = meta.cover_source || ''
  const shouldDownload = force || !exists || (source === 'dlsite' && cur.cover_source !== 'dlsite')
  if (!shouldDownload) return keep

  try {
    return { path: await saveCover(rj, meta.cover_url), source }
  } catch (e) {
    console.warn(`[dlsite] ${rj} cover download failed: ${(e as Error).message}`)
    return keep
  }
}

/**
 * 写入元数据。标量字段用「非空才覆盖」（NULLIF + COALESCE）：
 * 地区禁售页只有标题/社团，缺的字段必须保留旧值，不能因为这次没抓到就清空。
 */
function applyMeta(db: DatabaseSync, workId: number, meta: Partial<DlsiteMeta>, cover: { path: string; source: string }): void {
  db.prepare(
    `UPDATE works SET
       title = COALESCE(NULLIF(?, ''), title),
       circle = COALESCE(NULLIF(?, ''), circle),
       release_date = COALESCE(NULLIF(?, ''), release_date),
       series = COALESCE(NULLIF(?, ''), series),
       cover_path = ?, cover_source = ?,
       sales_count = COALESCE(?, sales_count), price = COALESCE(?, price),
       rating = COALESCE(?, rating), rating_count = COALESCE(?, rating_count),
       actors_confirmed = CASE WHEN ? = 1 THEN 1 ELSE actors_confirmed END,
       tags_confirmed = CASE WHEN ? = 1 THEN 1 ELSE tags_confirmed END,
       fetch_status = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    meta.title || '',
    meta.circle || '',
    meta.release_date || '',
    meta.series || '',
    cover.path,
    cover.source,
    meta.sales_count ?? null,
    meta.price ?? null,
    meta.rating ?? null,
    meta.rating_count ?? null,
    // 只有本次确实由权威数据源确认过时才置 1，从不主动清 0
    meta.actors_confirmed ? 1 : 0,
    meta.tags_confirmed ? 1 : 0,
    meta.fetch_status || '',
    new Date().toISOString(),
    workId
  )
}

/**
 * 集合类字段（声优 / 标签 / 翻译 / 全年龄标记）重建。
 *
 * 只在这两种状态下重建：`ok`（DLsite 正常回应）与 `not_found`（下架，靠 api1 / HVDB 补全）。
 * 其余状态（禁售 / 网络异常 / 未知）本来就没抓到这些字段，重建会把库里已有的数据清空 ——
 * 一律跳过，宁可这次不更新。
 */
function applyCollections(db: DatabaseSync, workId: number, meta: Partial<DlsiteMeta>): void {
  const status = String(meta.fetch_status || '')
  if (status !== 'ok' && status !== 'not_found') return
  setActors(db, workId, meta.actors || [])
  setTags(db, workId, meta.tags || [])
  syncAllAgesTag(db, workId, meta.age_rating)
  setTranslations(db, workId, meta.translations)
}

async function refreshMetadata(db: DatabaseSync, workId: number, rj: string): Promise<void> {
  const cur = db
    .prepare('SELECT cover_path, cover_source, cover_modified, tags_confirmed FROM works WHERE id = ?')
    .get(workId) as unknown as CoverState & { tags_confirmed?: number }
  // 标签还没确认过 → 让抓取流程在 api2 标签为空时抓一次作品页核实「分類」区；
  // 库里没有封面文件 → 让抓取流程抓一次作品页拿 og:image（DLsite 原图优先，HVDB 兜底）
  const meta = await fetchWorkMeta(rj, {
    verifyTags: Number(cur.tags_confirmed) !== 1,
    verifyCover: !coverFileExists(String(cur.cover_path || '')),
  })
  const cover = await resolveCover(rj, meta, cur, false)
  applyMeta(db, workId, meta, cover)
  applyCollections(db, workId, meta)
}

/**
 * 手动同步单个作品：始终从 DLsite（缺失时 HVDB）重抓元数据与封面并覆盖当前信息。
 * 保留用户手动添加的自定义标签；作品为手动封面（cover_modified=1）时不覆盖封面。
 */
export async function syncWork(db: DatabaseSync, workId: number, rj: string): Promise<void> {
  // 手动同步要的是实时数据：先丢掉这个作品的批量缓存，避免拿到上一轮扫描的旧数字
  dropCachedEntry(rj)
  // 手动同步是「强制重抓」：标签为空、没封面时都去作品页核实 / 取原图
  const meta = await fetchWorkMeta(rj, { verifyTags: true, verifyCover: true })
  const cur = db
    .prepare('SELECT cover_path, cover_source, cover_modified FROM works WHERE id = ?')
    .get(workId) as unknown as CoverState
  const cover = await resolveCover(rj, meta, cur, true)
  applyMeta(db, workId, meta, cover)
  applyCollections(db, workId, meta)
}

function setActors(db: DatabaseSync, workId: number, names: string[]): void {
  db.prepare('DELETE FROM work_actors WHERE work_id = ?').run(workId)
  const insertActor = db.prepare('INSERT OR IGNORE INTO actors (name) VALUES (?)')
  const getActor = db.prepare('SELECT id FROM actors WHERE name = ?')
  const link = db.prepare('INSERT OR IGNORE INTO work_actors (work_id, actor_id) VALUES (?, ?)')
  transaction(db, () => {
    for (const raw of new Set(names)) {
      const name = raw.trim()
      if (!name) continue
      insertActor.run(name)
      const a = getActor.get(name) as { id: number } | undefined
      if (a) link.run(workId, a.id)
    }
  })
}

function setTags(db: DatabaseSync, workId: number, tags: DlsiteTag[]): void {
  // 只重建原生标签（DLsite/HVDB），保留用户手动添加的自定义标签
  db.prepare(
    `DELETE FROM work_tags WHERE work_id = ? AND tag_id IN (
       SELECT wt.tag_id FROM work_tags wt JOIN tags t ON t.id = wt.tag_id
       WHERE wt.work_id = ? AND t.category != ?
     )`
  ).run(workId, workId, CUSTOM_TAG)
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name, category) VALUES (?, ?)')
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ? AND category = ?')
  const link = db.prepare('INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)')
  transaction(db, () => {
    const seen = new Set<string>()
    for (const t of tags) {
      const name = (t.name || '').trim()
      if (!name) continue
      const category = (t.category || '').trim()
      const key = `${name}|${category}`
      if (seen.has(key)) continue
      seen.add(key)
      insertTag.run(name, category)
      const row = getTag.get(name, category) as { id: number } | undefined
      if (row) link.run(workId, row.id)
    }
  })
}

/** 「年龄指定」是否代表全年龄；null = 没抓到（缺字段），不据此改标签。 */
function allAgesStatus(ageRating: string | undefined): boolean | null {
  const v = (ageRating || '').trim()
  if (!v) return null
  return !/R18|成人|18禁|adult/i.test(v)
}

/** 取下（不存在则创建）某个自定义标签的 id。 */
function customTagId(db: DatabaseSync, name: string): number {
  db.prepare('INSERT OR IGNORE INTO tags (name, category) VALUES (?, ?)').run(name, CUSTOM_TAG)
  return (db.prepare('SELECT id FROM tags WHERE name = ? AND category = ?').get(name, CUSTOM_TAG) as { id: number }).id
}

/**
 * 维护作品上的内置「全年龄」标签：年龄指定非 R18 就关联，R18 就摘掉，
 * 抓不到年龄时保持原状（不误标 R18 作品）。
 */
function syncAllAgesTag(db: DatabaseSync, workId: number, ageRating: string | undefined): void {
  const status = allAgesStatus(ageRating)
  if (status === null) return
  const tagId = customTagId(db, ALL_AGES_TAG)
  if (status) {
    db.prepare('INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)').run(workId, tagId)
  } else {
    db.prepare('DELETE FROM work_tags WHERE work_id = ? AND tag_id = ?').run(workId, tagId)
  }
}

/** 重建作品的其它语言版本列表（RJ 号 + 语言）。 */
function setTranslations(db: DatabaseSync, workId: number, list: DlsiteTranslation[] | undefined): void {
  const del = db.prepare('DELETE FROM work_translations WHERE work_id = ?')
  const ins = db.prepare(
    'INSERT OR IGNORE INTO work_translations (work_id, rj_code, language, language_label) VALUES (?, ?, ?, ?)'
  )
  transaction(db, () => {
    del.run(workId)
    for (const t of list || []) {
      const rj = (t.rj_code || '').trim().toUpperCase()
      if (!/^RJ\d{6,10}$/.test(rj)) continue
      ins.run(workId, rj, t.language || '', t.language_label || '')
    }
  })
}

/**
 * 封面来源页判定：DLsite 图片域名沿用默认的 dlsite.com referer（行为不变）；
 * 其他域名（HVDB 及其代理）用其自身源作为 referer，避免防盗链拦截。
 */
function coverReferer(url: string): string | undefined {
  try {
    const u = new URL(url)
    if (u.hostname.endsWith('dlsite.com') || u.hostname.endsWith('dlsite.jp')) return undefined
    return `${u.protocol}//${u.host}/`
  } catch {
    return undefined
  }
}

async function saveCover(rj: string, url: string): Promise<string> {
  const coversDir = getCoverDir()
  const clean = url.split('?')[0]
  const extMatch = clean.match(/\.(jpg|jpeg|png|webp|gif)(?:$|\.)/i)
  const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg'
  const dest = path.join(coversDir, `${rj}.${ext}`)
  await downloadToFile(url, dest, coverReferer(url))
  // 只存相对文件名，封面目录由 cover_dir 决定 → 库可跨机器/容器迁移
  return path.basename(dest)
}

const MANUAL_COVER_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const

interface CoverStateRow {
  cover_path: string
  cover_modified: number
  original_cover_path: string
}

/**
 * 把作品文件夹内的某张图片设为封面（手动封面）：
 * - 首次修改时把当前封面路径记入 original_cover_path，原始 DLsite 封面文件保留不覆盖；
 * - 新图另存为 ${rj}_manual.{ext}，cover_modified=1 → 管理端据此显示「还原封面」。
 */
export function setManualCover(db: DatabaseSync, rj: string, workId: number, srcAbs: string): string {
  const row = db.prepare('SELECT cover_path, cover_modified, original_cover_path FROM works WHERE id = ?').get(workId) as
    | CoverStateRow
    | undefined
  if (!row) throw new Error('work not found')

  const ext = path.extname(srcAbs).toLowerCase().replace('.', '') || 'jpg'
  if (!(MANUAL_COVER_EXTS as readonly string[]).includes(ext)) throw new Error('不是图片文件')
  const safeExt = ext === 'jpeg' ? 'jpg' : ext

  if (!row.cover_modified && !row.original_cover_path && row.cover_path) {
    db.prepare('UPDATE works SET original_cover_path = ? WHERE id = ?').run(row.cover_path, workId)
  }
  const dest = path.join(getCoverDir(), `${rj}_manual.${safeExt}`)
  fs.copyFileSync(srcAbs, dest)
  // 手动封面不属于任何自动来源，来源清空（cover_modified 已足够标记「不要自动覆盖」）
  db.prepare('UPDATE works SET cover_path = ?, cover_source = \'\', cover_modified = 1, updated_at = ? WHERE id = ?').run(
    path.basename(dest),
    new Date().toISOString(),
    workId
  )
  return path.basename(dest)
}

/** 还原封面：删除手动封面文件，指回原始封面（无则置空，回退默认封面）。 */
export function restoreWorkCover(db: DatabaseSync, rj: string, workId: number): void {
  const coversDir = getCoverDir()
  for (const ext of MANUAL_COVER_EXTS) {
    try {
      fs.rmSync(path.join(coversDir, `${rj}_manual.${ext}`), { force: true })
    } catch {
      /* 忽略 */
    }
  }
  const row = db.prepare('SELECT original_cover_path FROM works WHERE id = ?').get(workId) as
    | { original_cover_path: string }
    | undefined
  db.prepare(
    "UPDATE works SET cover_path = ?, cover_source = '', cover_modified = 0, original_cover_path = '', updated_at = ? WHERE id = ?"
  ).run(row?.original_cover_path || '', new Date().toISOString(), workId)
}

function scanWorkFiles(db: DatabaseSync, workId: number, folder: string): void {
  const files = collectTree(folder)
  const old = db
    .prepare('SELECT rel_path, is_dir, size FROM files WHERE work_id = ? ORDER BY sort_order')
    .all(workId) as Array<{ rel_path: string; is_dir: number; size: number }>

  // 增量判定：结构完全一致就一个字节都不写。媒体库 7685 部、30 万个文件条目，
  // 之前每轮都是「全删 + 全插」，光这一项就要写 60 万行；现在未变动作品零写入。
  if (sameTree(old, files)) return

  const del = db.prepare('DELETE FROM files WHERE work_id = ?')
  const ins = db.prepare(
    'INSERT INTO files (work_id, filename, rel_path, ext, kind, is_dir, size, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  transaction(db, () => {
    del.run(workId)
    files.forEach((f, i) => ins.run(workId, f.filename, f.rel_path, f.ext, f.kind, f.is_dir, f.size, i))
  })
  const fileCount = files.filter((f) => !f.is_dir).length
  db.prepare('UPDATE works SET file_count = ?, updated_at = ? WHERE id = ?').run(fileCount, new Date().toISOString(), workId)
}

/** 新旧文件树是否完全一致（顺序、路径、目录标记、文件大小）。 */
export function sameTree(
  old: Array<{ rel_path: string; is_dir: number; size: number }>,
  next: FileRow[]
): boolean {
  if (old.length !== next.length) return false
  for (let i = 0; i < old.length; i++) {
    const a = old[i]
    const b = next[i]
    if (a.rel_path !== b.rel_path) return false
    if (Number(a.is_dir) !== b.is_dir) return false
    if (!b.is_dir && Number(a.size) !== b.size) return false
  }
  return true
}

/**
 * 目录树签名：递归收集每个目录（含根）的 mtimeMs 做哈希。
 *
 * 只看**目录**的 mtime，不看文件内容 —— 目录 mtime 在「增删改名子项」时才会变，
 * 正好对应「文件列表可能需要更新」的场景。目录数量通常只有几个到几十个，
 * 比逐个文件 stat 便宜一个数量级。代价是「同名文件被覆盖」不会触发（只影响 size 显示）。
 */
export function folderSignature(root: string): string {
  const parts: string[] = []
  let rootMtime = 0
  try {
    rootMtime = fs.statSync(root).mtimeMs
  } catch {
    return '' // 目录读不到：交给调用方按「有变化」处理
  }
  parts.push(`.:${rootMtime}`)
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > 12) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const full = path.join(dir, e.name)
      const relPath = `${rel}/${e.name}`
      try {
        parts.push(`${relPath}:${fs.statSync(full).mtimeMs}`)
      } catch {
        parts.push(`${relPath}:0`)
      }
      walk(full, relPath, depth + 1)
    }
  }
  walk(root, '', 0)
  return crypto.createHash('sha1').update(parts.sort().join('|')).digest('hex').slice(0, 16)
}

function compareName(a: fs.Dirent, b: fs.Dirent): number {
  return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true })
}

/**
 * 收集 RJ 根目录下的完整目录树（含子目录与所有文件），
 * 用 "/" 作为路径分隔符（跨平台一致），目录条目 is_dir=1。
 * 按「目录在前、文件在后、名称自然排序」做深度优先遍历。
 */
function collectTree(root: string): FileRow[] {
  const out: FileRow[] = []
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    const dirs = entries.filter((e) => e.isDirectory()).sort(compareName)
    const files = entries.filter((e) => e.isFile()).sort(compareName)
    for (const e of [...dirs, ...files]) {
      const full = path.join(dir, e.name)
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        out.push({ filename: e.name, rel_path: relPath, ext: '', kind: '', is_dir: 1, size: 0 })
        walk(full, relPath)
      } else {
        const ext = path.extname(e.name).slice(1).toLowerCase()
        const kind = AUDIO_EXTS.has(ext)
          ? 'audio'
          : VIDEO_EXTS.has(ext)
            ? 'video'
            : IMAGE_EXTS.has(ext)
              ? 'image'
              : 'other'
        out.push({ filename: e.name, rel_path: relPath, ext, kind, is_dir: 0, size: fs.statSync(full).size })
      }
    }
  }
  walk(root, '')
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 用批量预取的缓存写动态四项（价格 / 评分 / 评论数 / 销量）。
 * 抓不到的项（null）保留旧值，不会把已有数字清空。
 */
function writeDynamicFromCache(db: DatabaseSync, workId: number, rj: string): void {
  const item = getCachedEntry(rj)
  if (!item) return
  db.prepare(
    `UPDATE works SET price = COALESCE(?, price), rating = COALESCE(?, rating),
       rating_count = COALESCE(?, rating_count), sales_count = COALESCE(?, sales_count),
       updated_at = ? WHERE id = ?`
  ).run(
    toNumber(item.official_price) ?? toNumber(item.price),
    toNumber(item.rate_average_2dp),
    toNumber(item.rate_count) ?? toNumber(item.review_count),
    toNumber(item.dl_count),
    new Date().toISOString(),
    workId
  )
}

/**
 * 重新下载缺失的封面：遍历所有作品，若封面文件在当前封面目录里不存在，
 * 则抓取 DLsite 元数据并下载。已有封面文件的作品跳过。支持并发。
 *
 * refreshStats = true 时遍历**所有**作品，按当前线路的 DLsite 结果对齐：
 * - 干净作品（上次 DL 正常、封面来自 DLsite、字段齐全）：只有价格 / 评分 / 评论数 / 销量会变，
 *   直接用批量预取的缓存写这四项，一次网络请求都不发；
 * - 其余作品（含升级前的老数据）：完整抓取一次，元数据 + 声优 + 标签 + 封面来源整体覆盖。
 *   这同时是「修复被兜底站点污染的数据」的入口 —— 换到可用线路后跑一次即可修回来。
 */
export async function redownloadCovers(
  onProgress: (current: string, done: number, total: number) => void,
  concurrency = 5,
  refreshStats = false
): Promise<CoverRedownloadResult> {
  const db = getDb()
  const works = db.prepare('SELECT * FROM works').all() as unknown as WorkRow[]
  const coversDir = getCoverDir()
  const result: CoverRedownloadResult = {
    total: works.length,
    downloaded: 0,
    skipped: 0,
    statsUpdated: 0,
    errors: [],
  }

  // 逐部流程要抓元数据的作品：封面文件缺失（本次要补封面）或勾选了刷新动态数据（全库）。
  // 先按 50 个一批把动态数据预取进缓存，逐部流程（touch / api1）命中缓存就不再单独请求。
  const needFetch = works.filter(
    (w) => refreshStats || !w.cover_path || !fs.existsSync(path.join(coversDir, path.basename(w.cover_path)))
  )
  if (needFetch.length) {
    onProgress('预取动态数据', 0, works.length)
    try {
      const pf = await prefetchDynamic(needFetch.map((w) => w.rj_code), 'all')
      console.log(
        `[yuzuki] 批量预取动态数据：${pf.candidates} 个候选 / ${pf.batches} 次请求，返回 ${pf.entries} 条`
      )
    } catch (e) {
      // 预取失败不影响主流程：逐部流程会退回单独请求
      console.warn(`[yuzuki] 批量预取动态数据失败，退回逐个抓取: ${(e as Error).message}`)
    }
  }

  let done = 0
  let nextIndex = 0
  const worker = async () => {
    while (true) {
      const i = nextIndex++
      if (i >= works.length) return
      const w = works[i]
      onProgress(w.rj_code, done, works.length)
      try {
        const existing = w.cover_path ? path.join(coversDir, path.basename(w.cover_path)) : ''
        const hasCover = Boolean(existing) && fs.existsSync(existing)

        if (hasCover && !refreshStats) {
          result.skipped++
        } else if (refreshStats && isCleanWork(db, w) && getCachedEntry(w.rj_code)) {
          // 干净作品：批量缓存里已有这次的价格 / 评分 / 评论数 / 销量，直接写，不请求 api2 / 作品页
          writeDynamicFromCache(db, w.id, w.rj_code)
          result.statsUpdated++
          result.skipped++
        } else {
          // 标签未确认 / 缺封面时，本次抓取会额外抓一次作品页（核实「分類」、取 og:image）
          const meta = await fetchWorkMeta(w.rj_code, {
            verifyTags: Number(w.tags_confirmed) !== 1,
            verifyCover: !hasCover,
          })

          if (refreshStats) {
            // 全库对齐：元数据 + 集合字段 + 封面来源一次写全，不留下兜底时期的残留
            const cover = await resolveCover(
              w.rj_code,
              meta,
              { cover_path: w.cover_path, cover_source: w.cover_source, cover_modified: Number(w.cover_modified) || 0 },
              false
            )
            applyMeta(db, w.id, meta, cover)
            applyCollections(db, w.id, meta)
            result.statsUpdated++
            if (cover.path && cover.path !== w.cover_path) result.downloaded++
            else result.skipped++
          } else if (hasCover) {
            result.skipped++
          } else if (meta.cover_url) {
            const p = await saveCover(w.rj_code, meta.cover_url)
            // 封面文件缺失时重新下载的是原始封面：复位手动封面标记，回到「未修改」语义
            db.prepare(
              `UPDATE works SET cover_path = ?, cover_source = ?, cover_modified = 0,
                 original_cover_path = '', updated_at = ? WHERE id = ?`
            ).run(p, meta.cover_source || '', new Date().toISOString(), w.id)
            result.downloaded++
          } else {
            result.skipped++
          }
        }
      } catch (e) {
        result.errors.push(`${w.rj_code}: ${(e as Error).message}`)
      }
      done++
      onProgress('', done, works.length)
      await sleep(120)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  onProgress('', works.length, works.length)
  return result
}
