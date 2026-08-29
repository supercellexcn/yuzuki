import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { getDb, transaction } from '../db/connection.js'
import { getCoverDir } from '../settings.js'
import { fetchWorkMeta } from '../dlsite/index.js'
import { downloadToFile } from '../dlsite/client.js'
import type { DlsiteMeta, DlsiteTag } from '../dlsite/types.js'

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
  cover_path: string
  folder_path: string
  source_path: string
  file_count: number
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

/** 判断现有作品是否需要补抓 DLsite：标题为空、无声优、或封面文件缺失。 */
function needsMetadataRefresh(db: DatabaseSync, existing: WorkRow): boolean {
  if (!existing.title) return true
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM work_actors WHERE work_id = ?').get(existing.id) as { c: number }
  if (!c) return true
  if (!existing.cover_path) return true
  const file = path.join(getCoverDir(), path.basename(existing.cover_path))
  return !fs.existsSync(file)
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
      `INSERT INTO works (rj_code, title, circle, release_date, series, sales_count, cover_path, folder_path, source_path, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      rj,
      meta.title || '',
      meta.circle || '',
      meta.release_date || '',
      meta.series || '',
      meta.sales_count ?? null,
      coverPath,
      folder,
      source,
      now,
      now
    )
  const workId = Number(info.lastInsertRowid)
  // 作品被删除后重新入库：把该 RJ 的播放历史与计数重新关联到新作品 id（老 id 已不存在）
  db.prepare('UPDATE play_history SET work_id = ? WHERE rj_code = ?').run(workId, rj)
  db.prepare('UPDATE play_counts SET work_id = ? WHERE rj_code = ?').run(workId, rj)
  setActors(db, workId, meta.actors || [])
  setTags(db, workId, meta.tags || [])
}

async function refreshMetadata(db: DatabaseSync, workId: number, rj: string): Promise<void> {
  const meta = await fetchWorkMeta(rj)
  let coverPath = (db.prepare('SELECT cover_path FROM works WHERE id = ?').get(workId) as unknown as WorkRow).cover_path
  if (meta.cover_url && (!coverPath || !fs.existsSync(path.join(getCoverDir(), path.basename(coverPath))))) {
    coverPath = await saveCover(rj, meta.cover_url)
  }
  db.prepare(
    `UPDATE works SET title = ?, circle = ?, release_date = ?, series = ?, sales_count = ?, cover_path = ?, updated_at = ? WHERE id = ?`
  ).run(
    meta.title || '',
    meta.circle || '',
    meta.release_date || '',
    meta.series || '',
    meta.sales_count ?? null,
    coverPath,
    new Date().toISOString(),
    workId
  )
  setActors(db, workId, meta.actors || [])
  setTags(db, workId, meta.tags || [])
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
  db.prepare('DELETE FROM work_tags WHERE work_id = ?').run(workId)
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
  db.prepare('UPDATE works SET cover_path = ?, cover_modified = 1, updated_at = ? WHERE id = ?').run(
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
    "UPDATE works SET cover_path = ?, cover_modified = 0, original_cover_path = '', updated_at = ? WHERE id = ?"
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
 */
export async function redownloadCovers(
  onProgress: (current: string, done: number, total: number) => void,
  concurrency = 5
): Promise<CoverRedownloadResult> {
  const db = getDb()
  const works = db.prepare('SELECT id, rj_code, cover_path FROM works').all() as unknown as Array<{
    id: number
    rj_code: string
    cover_path: string
  }>
  const coversDir = getCoverDir()
  const result: CoverRedownloadResult = { total: works.length, downloaded: 0, skipped: 0, errors: [] }

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
        if (existing && fs.existsSync(existing)) {
          result.skipped++
        } else {
          const meta = await fetchWorkMeta(w.rj_code)
          if (meta.cover_url) {
            const p = await saveCover(w.rj_code, meta.cover_url)
            // 封面文件缺失时重新下载的是原始封面：复位手动封面标记，回到「未修改」语义
            db.prepare(
              "UPDATE works SET cover_path = ?, cover_modified = 0, original_cover_path = '', updated_at = ? WHERE id = ?"
            ).run(p, new Date().toISOString(), w.id)
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
