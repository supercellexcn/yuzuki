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
  errors: [],
  startedAt: null,
  finishedAt: null,
}

export function getScanJob(): ScanJob {
  return { ...job, errors: [...job.errors], workers: job.workers.map((w) => ({ ...w })) }
}

export function pauseScan(): void {
  if (job.status === 'running') job.paused = true
}

export function resumeScan(): void {
  job.paused = false
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
  job.errors = []
  job.startedAt = new Date().toISOString()
  job.finishedAt = null
  // 扫描放入后台执行，不阻塞 HTTP 响应（否则前端 30s 超时会导致「第一次点失败、第二次才成功」）
  void runScan()
  return true
}

async function runScan(): Promise<void> {
  try {
    const result = await scanAll(
      (current, done, total) => {
        job.current = current
        job.done = done
        job.total = total
      },
      (workers) => {
        job.workers = workers
      },
      { isPaused: () => job.paused }
    )
    job.errors.push(...result.errors)
    job.removed = result.removed
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
}

// ---- 封面重新下载任务 ----

export interface CoverJob {
  status: 'idle' | 'running' | 'done' | 'error'
  total: number
  done: number
  current: string
  downloaded: number
  skipped: number
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
  errors: [],
  startedAt: null,
  finishedAt: null,
}

export function getCoverJob(): CoverJob {
  return { ...coverJob, errors: [...coverJob.errors] }
}

export async function startCoverRedownload(): Promise<boolean> {
  if (coverJob.status === 'running') return false
  coverJob.status = 'running'
  coverJob.total = 0
  coverJob.done = 0
  coverJob.current = ''
  coverJob.downloaded = 0
  coverJob.skipped = 0
  coverJob.errors = []
  coverJob.startedAt = new Date().toISOString()
  coverJob.finishedAt = null
  // 与扫描一致：后台执行，立即返回
  void runCoverRedownload()
  return true
}

async function runCoverRedownload(): Promise<void> {
  try {
    const settings = getSettings()
    const r = await redownloadCovers(
      (current, done, total) => {
        coverJob.current = current
        coverJob.done = done
        coverJob.total = total
      },
      settings.scan_concurrency || 5
    )
    coverJob.downloaded = r.downloaded
    coverJob.skipped = r.skipped
    coverJob.errors.push(...r.errors)
    coverJob.status = 'done'
  } catch (e) {
    coverJob.errors.push(String((e as Error).message || e))
    coverJob.status = 'error'
  }
  coverJob.finishedAt = new Date().toISOString()
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
}
