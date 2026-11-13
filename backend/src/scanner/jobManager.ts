import { scanAll, type ScanWorkerStatus } from './scanner.js'
import { getSettings } from '../settings.js'
import { redownloadCovers } from '../services/workService.js'
import { calculateRecommendations } from '../recommendation/calculator.js'

export interface ScanJob {
  status: 'idle' | 'running' | 'done' | 'error'
  total: number
  done: number
  current: string
  removed: number
  paused: boolean
  workers: ScanWorkerStatus[]
  /** 本轮真正请求了 DLsite 的作品数 */
  fetched: number
  /** 本轮判定「无须抓取」而跳过的作品数 */
  skipped: number
  /** 处置结果分布：已处理 / 跳过 / 禁售 / 下架 / 失败 */
  outcomes: Record<string, number>
  errors: string[]
  startedAt: string | null
  finishedAt: string | null
}

const job: ScanJob = {
  status: 'idle',
  total: 0,
  done: 0,
  current: '',
  removed: 0,
  paused: false,
  workers: [],
  fetched: 0,
  skipped: 0,
  outcomes: {},
  errors: [],
  startedAt: null,
  finishedAt: null,
}

export function getScanJob(): ScanJob {
  return { ...job, errors: [...job.errors], workers: job.workers.map((w) => ({ ...w })) }
}

export function pauseScan(): void {
  if (job.status === 'running') job.paused = true
  publishJobNow()
}

export function resumeScan(): void {
  job.paused = false
  publishJobNow()
}

export async function startScan(): Promise<boolean> {
  if (job.status === 'running') return false
  job.status = 'running'
  job.total = 0
  job.done = 0
  job.current = ''
  job.removed = 0
  job.paused = false
  job.workers = []
  job.fetched = 0
  job.skipped = 0
  job.outcomes = {}
  job.errors = []
  job.startedAt = new Date().toISOString()
  job.finishedAt = null
  // 扫描放入后台执行，不阻塞 HTTP 响应（否则前端 30s 超时会导致「第一次点失败、第二次才成功」）
  void runScan()
  return true
}

async function runScan(): Promise<void> {
  publishJobNow()
  try {
    const result = await scanAll(
      (current, done, total) => {
        job.current = current
        job.done = done
        job.total = total
        publishJob('scan')
      },
      (workers) => {
        job.workers = workers
        publishJob('scan')
      },
      { isPaused: () => job.paused }
    )
    job.errors.push(...result.errors)
    job.removed = result.removed
    job.fetched = result.fetched
    job.skipped = result.skipped
    job.outcomes = { ...result.outcomes }
    job.status = 'done'
    // 扫描完成 → 若开启相关推荐且允许自动计算，则后台更新推荐关系
    const settings = getSettings()
    if (settings.recommendation_enabled && settings.recommendation_auto_calc) {
      await startRecommendationCalc()
    }
  } catch (e) {
    job.errors.push(String((e as Error).message || e))
    job.status = 'error'
  }
  job.finishedAt = new Date().toISOString()
  publishJobNow()
}

// ---- 封面重新下载任务 ----

export interface CoverJob {
  status: 'idle' | 'running' | 'done' | 'error'
  total: number
  done: number
  current: string
  downloaded: number
  skipped: number
  /** 本次更新了价格 / 评分 / 评论数 / 销量的作品数（勾选「更新评论、评分、销量数据」时才有值） */
  statsUpdated: number
  errors: string[]
  startedAt: string | null
  finishedAt: string | null
}

const coverJob: CoverJob = {
  status: 'idle',
  total: 0,
  done: 0,
  current: '',
  downloaded: 0,
  skipped: 0,
  statsUpdated: 0,
  errors: [],
  startedAt: null,
  finishedAt: null,
}

export function getCoverJob(): CoverJob {
  return { ...coverJob, errors: [...coverJob.errors] }
}

export async function startCoverRedownload(refreshStats = false): Promise<boolean> {
  if (coverJob.status === 'running') return false
  coverJob.status = 'running'
  coverJob.total = 0
  coverJob.done = 0
  coverJob.current = ''
  coverJob.downloaded = 0
  coverJob.skipped = 0
  coverJob.statsUpdated = 0
  coverJob.errors = []
  coverJob.startedAt = new Date().toISOString()
  coverJob.finishedAt = null
  // 与扫描一致：后台执行，立即返回
  void runCoverRedownload(refreshStats)
  return true
}

async function runCoverRedownload(refreshStats: boolean): Promise<void> {
  publishJobNow()
  try {
    const settings = getSettings()
    const r = await redownloadCovers(
      (current, done, total) => {
        coverJob.current = current
        coverJob.done = done
        coverJob.total = total
        publishJob('cover')
      },
      settings.scan_concurrency || 5,
      refreshStats
    )
    coverJob.downloaded = r.downloaded
    coverJob.skipped = r.skipped
    coverJob.statsUpdated = r.statsUpdated
    coverJob.errors.push(...r.errors)
    coverJob.status = 'done'
  } catch (e) {
    coverJob.errors.push(String((e as Error).message || e))
    coverJob.status = 'error'
  }
  coverJob.finishedAt = new Date().toISOString()
  publishJobNow()
}

// ---- 相关推荐计算任务 ----

export interface RecommendationJob {
  status: 'idle' | 'running' | 'done' | 'error'
  done: number
  total: number
  rows: number
  errors: string[]
  startedAt: string | null
  finishedAt: string | null
}

const recommendationJob: RecommendationJob = {
  status: 'idle',
  done: 0,
  total: 0,
  rows: 0,
  errors: [],
  startedAt: null,
  finishedAt: null,
}

export function getRecommendationJob(): RecommendationJob {
  return { ...recommendationJob, errors: [...recommendationJob.errors] }
}

export async function startRecommendationCalc(): Promise<boolean> {
  if (recommendationJob.status === 'running') return false
  recommendationJob.status = 'running'
  recommendationJob.done = 0
  recommendationJob.total = 0
  recommendationJob.rows = 0
  recommendationJob.errors = []
  recommendationJob.startedAt = new Date().toISOString()
  recommendationJob.finishedAt = null
  // 与扫描/封面重下一致：后台执行，立即返回
  void runRecommendationCalc()
  return true
}

async function runRecommendationCalc(): Promise<void> {
  // 先让出一轮事件循环再开始计算：保证「启动推荐计算」的 HTTP 响应（以及服务启动
  // 阶段的 app.listen）先于计算执行，否则计算会同步占死事件循环，接口全部超时。
  await new Promise<void>((resolve) => setImmediate(resolve))
  try {
    const r = await calculateRecommendations((done, total) => {
      recommendationJob.done = done
      recommendationJob.total = total
      publishJob('recommendation')
    })
    recommendationJob.done = r.works
    recommendationJob.total = r.works
    recommendationJob.rows = r.rows
    recommendationJob.errors.push(...r.errors)
    recommendationJob.status = 'done'
  } catch (e) {
    recommendationJob.errors.push(String((e as Error).message || e))
    recommendationJob.status = 'error'
  }
  recommendationJob.finishedAt = new Date().toISOString()
  publishJobNow()
}

// ---- 任务状态推送（SSE） ----

/** 一次推送的完整快照：三类任务各一份。 */
export type JobSnapshot = {
  scan: ScanJob
  cover: CoverJob
  recommendation: RecommendationJob
}

/** 哪一类任务发生了变化 —— 连接端只推变化的那几条，避免每 100ms 重发三份 JSON。 */
export type JobKind = 'scan' | 'cover' | 'recommendation'

type JobListener = (snapshot: JobSnapshot, kinds: Set<JobKind>) => void
const listeners = new Set<JobListener>()
let publishTimer: NodeJS.Timeout | null = null
const dirty = new Set<JobKind>()

/**
 * 订阅任务状态变化（SSE 连接用）；返回退订函数。
 *
 * 扫描进度回调非常密集（每部作品至少两次：开始 + 结束，并发 5 时一秒钟十几条），
 * 因此这里做 100ms 合并：期间的所有变化只触发一次广播，连接上看到的是最新快照。
 * 任务开始 / 结束时走 publishJobNow()，保证终态一定被推出去。
 */
export function subscribeJob(fn: JobListener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function publishJob(kind: JobKind): void {
  dirty.add(kind)
  if (!listeners.size || publishTimer) return
  publishTimer = setTimeout(() => {
    publishTimer = null
    const kinds = new Set(dirty)
    dirty.clear()
    emitSnapshot(kinds)
  }, 100)
}

function publishJobNow(): void {
  if (publishTimer) {
    clearTimeout(publishTimer)
    publishTimer = null
  }
  dirty.clear()
  emitSnapshot(new Set<JobKind>(['scan', 'cover', 'recommendation']))
}

function emitSnapshot(kinds: Set<JobKind>): void {
  if (!listeners.size) return
  const snapshot = getJobSnapshot()
  for (const fn of listeners) {
    try {
      fn(snapshot, kinds)
    } catch {
      /* 单个连接写失败（客户端已断开）不影响其它连接 */
    }
  }
}

/** 三类任务的当前快照（SSE 首帧与每次推送共用）。 */
export function getJobSnapshot(): JobSnapshot {
  return { scan: getScanJob(), cover: getCoverJob(), recommendation: getRecommendationJob() }
}
