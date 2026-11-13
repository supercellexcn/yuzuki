import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { getDb, transaction } from '../db/connection.js'
import { getCoverDir } from '../settings.js'
import { fetchWorkMeta } from '../dlsite/index.js'
import { downloadToFile } from '../dlsite/client.js'
import type { DlsiteMeta, DlsiteTag, DlsiteTranslation } from '../dlsite/types.js'
import { ALL_AGES_TAG, CUSTOM_TAG } from './hidden.js'

const AUDIO_EXTS = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'wma', 'aiff'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'ts'])
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'])

export interface UpsertResult {
  created: boolean
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
 * 将本地一个 RJ 文件夹同步进数据库：
 * - 若作品不存在，则从 DLsite 抓取元数据并入库；
 * - 若已存在但没有标题（上次抓取失败），尝试重新抓取；
 * - 始终重扫该文件夹下的文件列表。
 */
export async function upsertWorkFolder(
  rj: string,
  folder: string,
  source: string,
  onStage?: (stage: string) => void
): Promise<UpsertResult> {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM works WHERE rj_code = ?').get(rj) as unknown as WorkRow | undefined

  let created = false
  if (!existing) {
    created = true
    onStage?.('抓取元数据')
    await createWork(db, rj, folder, source, onStage)
  } else if (needsMetadataRefresh(db, existing)) {
    // 信息缺失（无标题 / 无声优 / 无封面文件）→ 补抓，最多重试 2 次
    onStage?.('补抓元数据')
    await retryRefreshMetadata(db, existing.id, rj)
  }

  const work = db.prepare('SELECT * FROM works WHERE rj_code = ?').get(rj) as unknown as WorkRow
  onStage?.('扫描文件')
  scanWorkFiles(db, work.id, folder)
  return { created }
}

/** 「信息是否完整」的判定项：只有这些缺了才算不完整。 */
export const MISSING_FIELDS = {
  title: '标题',
  circle: '社团',
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
 * 系列、评分、评论数、销量、其它语言版本都不算必需项：
 * 前两者可能真的没有，后两者是 0 也合理（NULL 才代表没抓到）。
 */
export function missingFieldsOf(db: DatabaseSync, row: MissingCheckRow): MissingField[] {
  const out: MissingField[] = []
  if (!String(row.title || '').trim()) out.push('title')
  if (!String(row.circle || '').trim()) out.push('circle')
  if (!coverFileExists(String(row.cover_path || ''))) out.push('cover')
  if (!String(row.release_date || '').trim()) out.push('release_date')
  if (row.price == null) out.push('price')
  if (!nativeTagCount(db, Number(row.id))) out.push('tags')
  return out
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
function needsMetadataRefresh(db: DatabaseSync, existing: WorkRow): boolean {
  const status = String(existing.fetch_status || '')
  if (status === 'region_blocked') return true
  const missing = missingFieldsOf(db, existing)
  if (missing.length === 0) return false
  if (status === 'not_found' && String(existing.title || '').trim()) return false
  return true
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
    meta = { ...meta, ...(await fetchWorkMeta(rj)) }
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
         cover_path, cover_source, folder_path, source_path, fetch_status, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    meta.fetch_status || '',
    new Date().toISOString(),
    workId
  )
}

/**
 * 集合类字段（声优 / 标签 / 翻译 / 全年龄标记）重建。
 * 地区禁售时这些字段本来就没有，重建会把库里已有的数据清空 —— 直接跳过。
 */
function applyCollections(db: DatabaseSync, workId: number, meta: Partial<DlsiteMeta>): void {
  if (meta.fetch_status === 'region_blocked') return
  setActors(db, workId, meta.actors || [])
  setTags(db, workId, meta.tags || [])
  syncAllAgesTag(db, workId, meta.age_rating)
  setTranslations(db, workId, meta.translations)
}

async function refreshMetadata(db: DatabaseSync, workId: number, rj: string): Promise<void> {
  const meta = await fetchWorkMeta(rj)
  const cur = db
    .prepare('SELECT cover_path, cover_source, cover_modified FROM works WHERE id = ?')
    .get(workId) as unknown as CoverState
  const cover = await resolveCover(rj, meta, cur, false)
  applyMeta(db, workId, meta, cover)
  applyCollections(db, workId, meta)
}

/**
 * 手动同步单个作品：始终从 DLsite（缺失时 HVDB）重抓元数据与封面并覆盖当前信息。
 * 保留用户手动添加的自定义标签；作品为手动封面（cover_modified=1）时不覆盖封面。
 */
export async function syncWork(db: DatabaseSync, workId: number, rj: string): Promise<void> {
  const meta = await fetchWorkMeta(rj)
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
 * 重新下载缺失的封面：遍历所有作品，若封面文件在当前封面目录里不存在，
 * 则抓取 DLsite 元数据并下载。已有封面文件的作品跳过。支持并发。
 *
 * refreshStats = true 时对**所有**作品都抓一次元数据，按当前线路的 DLsite 结果整体对齐：
 * 动态数据（价格 / 评分 / 评论数 / 销量）、声优、标签、封面来源一起刷新。
 * 这同时是「修复此前被兜底站点污染的数据」的入口 —— 换到可用线路后跑一次，
 * 地区禁售时期由 HVDB 补上的标题 / 社团 / 标签 / 封面都会被 DLsite 的真实数据覆盖。
 */
export async function redownloadCovers(
  onProgress: (current: string, done: number, total: number) => void,
  concurrency = 5,
  refreshStats = false
): Promise<CoverRedownloadResult> {
  const db = getDb()
  const works = db.prepare('SELECT id, rj_code, cover_path, cover_source, cover_modified FROM works').all() as unknown as Array<{
    id: number
    rj_code: string
    cover_path: string
    cover_source: string
    cover_modified: number
  }>
  const coversDir = getCoverDir()
  const result: CoverRedownloadResult = {
    total: works.length,
    downloaded: 0,
    skipped: 0,
    statsUpdated: 0,
    errors: [],
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
        } else {
          const meta = await fetchWorkMeta(w.rj_code)

          if (refreshStats) {
            // 全库对齐：元数据 + 集合字段 + 封面来源一次写全，不留下兜底时期的残留
            const cover = await resolveCover(
              w.rj_code,
              meta,
              { cover_path: w.cover_path, cover_source: w.cover_source, cover_modified: w.cover_modified },
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
