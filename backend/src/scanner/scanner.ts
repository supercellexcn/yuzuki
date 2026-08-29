import fs from 'node:fs'
import path from 'node:path'
import { getDb, transaction } from '../db/connection.js'
import { getSettings } from '../settings.js'
import { upsertWorkFolder } from '../services/workService.js'

export interface ScanResult {
  total: number
  added: number
  updated: number
  removed: number
  errors: string[]
}

/** 单个扫描线程的实时状态。 */
export interface ScanWorkerStatus {
  id: number
  rj: string
  stage: string
}

/** 扫描控制（暂停/继续）。 */
export interface ScanControl {
  isPaused: () => boolean
}

const RJ_RE = /RJ\d{6,}/i

interface FoundDir {
  dir: string
  source: string
  rj: string
}

/**
 * 扫描所有源路径，找到 RJ 文件夹并入库。
 * 并发处理多个作品，并发数取设置 scan_concurrency（默认 5）。
 * @param onProgress (currentRj, doneCount, totalCount)  —— currentRj 为当前正在处理的 RJ 之一
 * @param onWorker   每次任一线程状态变化时回调所有线程状态（用于前端展示每条线程细节）
 * @param control    暂停/继续控制
 */
export async function scanAll(
  onProgress: (current: string, done: number, total: number) => void,
  onWorker?: (workers: ScanWorkerStatus[]) => void,
  control?: ScanControl
): Promise<ScanResult> {
  const settings = getSettings()
  const sources = settings.source_paths
  const concurrency = Math.max(1, Math.min(20, settings.scan_concurrency || 5))
  const result: ScanResult = { total: 0, added: 0, updated: 0, removed: 0, errors: [] }

  const found: FoundDir[] = []
  for (const source of sources) {
    if (!fs.existsSync(source)) {
      result.errors.push(`源路径不存在: ${source}`)
      continue
    }
    for (const d of findRjDirs(source, settings.scan_depth)) {
      const m = RJ_RE.exec(d.name)
      if (m) {
        found.push({ dir: path.join(d.parent, d.name), source, rj: m[0].toUpperCase() })
      }
    }
  }

  // 按 RJ 号去重（同名只处理第一个源里的）
  const seen = new Set<string>()
  const unique = found.filter((f) => {
    if (seen.has(f.rj)) return false
    seen.add(f.rj)
    return true
  })

  result.total = unique.length
  // 简单并发池：起 concurrency 个 worker，各自从任务队列取下一个作品处理。
  // 每个 worker 只有完整处理完当前作品（含封面下载）才会取下一条。
  let done = 0
  let nextIndex = 0
  const workers: ScanWorkerStatus[] = Array.from({ length: concurrency }, (_, id) => ({ id, rj: '', stage: '空闲' }))
  const emitWorkers = () => onWorker?.(workers.map((w) => ({ ...w })))

  const waitIfPaused = async () => {
    if (!control?.isPaused()) return
    for (const w of workers) w.stage = '已暂停'
    emitWorkers()
    while (control.isPaused()) await sleep(300)
  }

  const worker = async (id: number) => {
    while (true) {
      await waitIfPaused()
      const i = nextIndex++
      if (i >= unique.length) return
      const f = unique[i]
      workers[id] = { id, rj: f.rj, stage: '开始' }
      emitWorkers()
      onProgress(f.rj, done, unique.length)
      try {
        const r = await upsertWorkFolder(f.rj, f.dir, f.source, (stage) => {
          workers[id] = { id, rj: f.rj, stage }
          emitWorkers()
        })
        if (r.created) result.added++
        else result.updated++
      } catch (e) {
        result.errors.push(`${f.rj}: ${(e as Error).message}`)
      }
      done++
      workers[id] = { id, rj: f.rj, stage: '完成' }
      emitWorkers()
      onProgress('', done, unique.length)
      // 单个作品处理完稍作喘息，避免并发瞬间压力过大被 DLsite 封
      await sleep(120)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)))
  for (const w of workers) w.stage = '完成'
  emitWorkers()

  // 清理：源文件夹已不存在的作品（整夹被删除）自动从库中移除。
  // 文件/声优/标签等关联通过外键级联删除，播放历史与播放计数保留。
  const db = getDb()
  const works = db.prepare('SELECT id, rj_code, folder_path FROM works').all() as unknown as Array<{
    id: number
    rj_code: string
    folder_path: string
  }>
  const del = db.prepare('DELETE FROM works WHERE id = ?')
  transaction(db, () => {
    for (const w of works) {
      if (!w.folder_path || !fs.existsSync(w.folder_path)) {
        del.run(w.id)
        result.removed++
      }
    }
  })
  if (result.removed) {
    console.log(`[yuzuki] 已移除 ${result.removed} 个源文件夹不存在的工作`)
  }

  onProgress('', unique.length, unique.length)
  return result
}

interface RjDir {
  name: string
  parent: string
}

/**
 * 在 root 下按指定深度查找 RJ 文件夹。
 * depth=0 只查 root 直接子目录；每 +1 多往下看一层。
 */
export function findRjDirs(root: string, depth: number): RjDir[] {
  const out: RjDir[] = []
  const walk = (dir: string, level: number) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const full = path.join(dir, e.name)
      if (RJ_RE.test(e.name)) {
        out.push({ name: e.name, parent: dir })
        continue // 已是 RJ 文件夹，不再作为容器继续下钻
      }
      if (level < depth) walk(full, level + 1)
    }
  }
  walk(root, 0)
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
