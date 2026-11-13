import fs from 'node:fs'
import path from 'node:path'
import { getDb, transaction } from '../db/connection.js'
import { getSettings } from '../settings.js'
import { upsertWorkFolder, prefetchDynamic } from '../services/workService.js'

export interface ScanResult {
  total: number
  added: number
  updated: number
  removed: number
  /** 本轮真正请求了 DLsite 的作品数（含抓取失败） */
  fetched: number
  /** 本轮判定为「无须抓取」而跳过的作品数 —— 一个请求都没发 */
  skipped: number
  /** 处置结果分布：已处理 / 跳过 / 禁售 / 下架 / 失败 */
  outcomes: Record<string, number>
  errors: string[]
}

/** 单个扫描线程的实时状态。 */
export interface ScanWorkerStatus {
  id: number
  rj: string
  stage: string
  /** 当前（或刚处理完的）这部作品的处置结果：'' | 跳过 | 已处理 | 禁售 | 下架 | 失败 */
  result: string
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
  const result: ScanResult = {
    total: 0,
    added: 0,
    updated: 0,
    removed: 0,
    fetched: 0,
    skipped: 0,
    outcomes: {},
    errors: [],
  }

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
  const workers: ScanWorkerStatus[] = Array.from({ length: concurrency }, (_, id) => ({
    id,
    rj: '',
    stage: '空闲',
    result: '',
  }))
  const emitWorkers = () => onWorker?.(workers.map((w) => ({ ...w })))

  // 批量预取：按 50 个一批把动态数据拉回缓存，逐部流程用同一份数据就不再单独请求。
  // 只预取「确实要抓」的作品（新作品 / 信息不全 / 上次被地区禁售），完整作品本来就会被跳过。
  // 预取失败不影响扫描：逐部流程会退回单独请求。
  for (const w of workers) w.stage = '预取动态数据'
  emitWorkers()
  try {
    const pf = await prefetchDynamic(unique.map((f) => f.rj), 'missing', (done, total) => {
      // 预取阶段没有单部进度，必须显示批进度，否则界面上看起来像卡死
      for (const w of workers) w.stage = `预取动态数据 ${done}/${total} 批`
      emitWorkers()
    })
    if (pf.candidates) {
      console.log(
        `[yuzuki] 批量预取动态数据：${pf.candidates} 个候选 / ${pf.batches} 次请求，返回 ${pf.entries} 条`
      )
    }
    console.log(
      `[yuzuki] 扫描 ${unique.length} 部：需抓取 ${pf.candidates} 部，直接跳过 ${unique.length - pf.candidates} 部`
    )
  } catch (e) {
    console.warn(`[yuzuki] 批量预取动态数据失败，退回逐个抓取: ${(e as Error).message}`)
  }
  for (const w of workers) w.stage = '空闲'
  emitWorkers()

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
      workers[id] = { id, rj: f.rj, stage: '开始', result: '' }
      emitWorkers()
      onProgress(f.rj, done, unique.length)
      try {
        const r = await upsertWorkFolder(f.rj, f.dir, f.source, (stage) => {
          workers[id] = { id, rj: f.rj, stage, result: '' }
          emitWorkers()
        })
        if (r.created) result.added++
        else result.updated++
        countOutcome(result, r.outcome)
        // 处置结果保留在线程状态里，前端一眼看出这部是「跳过」还是「已处理」
        workers[id] = { id, rj: f.rj, stage: r.outcome, result: r.outcome }
      } catch (e) {
        result.errors.push(`${f.rj}: ${(e as Error).message}`)
        countOutcome(result, '失败')
        workers[id] = { id, rj: f.rj, stage: '失败', result: '失败' }
      }
      done++
      workers[id] = { ...workers[id], stage: '完成' }
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

  const summary = Object.entries(result.outcomes)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ')
  console.log(`[yuzuki] 扫描完成：${summary || '无'}（共 ${unique.length} 部）`)

  onProgress('', unique.length, unique.length)
  return result
}

/** 累计处置结果（同时维护 fetched / skipped 两个汇总数字）。 */
function countOutcome(result: ScanResult, outcome: string): void {
  result.outcomes[outcome] = (result.outcomes[outcome] || 0) + 1
  if (outcome === '跳过') result.skipped++
  else result.fetched++
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
