import fs from 'node:fs'
import path from 'node:path'
import { getDb } from './db/connection.js'
import { getConfig } from './config.js'

/** 作品卡片尺寸：小 / 中 / 大 / 自定义宽度。 */
export type CardSize = 'small' | 'medium' | 'large' | 'custom'

export interface AppSettings {
  source_paths: string[]
  scan_depth: number
  scan_concurrency: number
  page_size: number
  seek_seconds: number
  proxy: string
  dlsite_base: string
  dlsite_path: string
  dlsite_locale: string
  cover_dir: string
  hvdb_base: string
  // ---- 相关推荐（独立推荐模块配置，v2.0 相似度模型）----
  recommendation_enabled: boolean
  recommendation_auto_calc: boolean
  recommendation_top_n: number
  recommendation_api_limit: number
  recommendation_mmr_lambda: number
  // 相似度权重：Tag > Voice > Title > Circle
  recommendation_weight_voice: number
  recommendation_weight_tag: number
  recommendation_weight_title: number
  recommendation_weight_circle: number
  // 质量分构成：QualityScore = salesWeight×SalesScore + (1-salesWeight)×PlayScore
  recommendation_quality_sales_weight: number
  // 低于该相似度的作品不进入推荐（宁可少推，不强凑）
  recommendation_min_score: number
  // 候选召回上限（倒排索引召回，避免全量两两比较）
  recommendation_candidate_limit: number
  // 标签分 = (1-coreTagWeight)×加权Jaccard + coreTagWeight×核心标签Jaccard
  recommendation_core_tag_weight: number
  recommendation_core_tag_count: number
  // 排序质量微调幅度：RecommendationScore = Similarity × (1-impact + 2×impact×QualityScore)
  recommendation_quality_impact: number
  // 系列强关系（v2.1）：同系列是最强关联，优先推荐
  recommendation_series_priority_enabled: boolean
  // 一个系列最多进入推荐列表几部
  recommendation_series_max_count: number
  // 同系列允许绕过 MIN_SIMILARITY（独立强关联通道）
  recommendation_series_bypass_min_score: boolean
  // ---- 外观 / 壁纸 / 主题配色（全局共享，所有用户一致）----
  // 各表面的模糊强度（0-100，映射为 backdrop-filter 的 px）
  wallpaper_blur: number
  card_blur: number
  filelist_blur: number
  control_blur: number
  // 作品卡片尺寸；custom 时使用 card_width（px）
  card_size: CardSize
  card_width: number
  // 主题配色（hex，'' 表示使用内置默认色）：
  // theme_color_nav 是全站主题色（导航栏 / 强调色 / 面板底色…），另两个是标签专用色
  theme_color_nav: string
  theme_color_actor: string
  theme_color_tag: string
  // 声优 / 类型标签的不透明度（1-100，越小越透）
  tag_opacity: number
}

const DEFAULTS: AppSettings = {
  source_paths: [],
  scan_depth: 2,
  scan_concurrency: 5,
  page_size: 20,
  seek_seconds: 15,
  proxy: '',
  dlsite_base: 'https://www.dlsite.com',
  dlsite_path: '/maniax/work/=/product_id/{rj}.html',
  dlsite_locale: 'zh-cn',
  cover_dir: '',
  hvdb_base: 'https://hvdb.me',
  recommendation_enabled: true,
  recommendation_auto_calc: true,
  recommendation_top_n: 50,
  recommendation_api_limit: 10,
  recommendation_mmr_lambda: 0.8,
  recommendation_weight_voice: 0.25,
  recommendation_weight_tag: 0.45,
  recommendation_weight_title: 0.2,
  recommendation_weight_circle: 0.1,
  recommendation_quality_sales_weight: 0.7,
  recommendation_min_score: 0.2,
  recommendation_candidate_limit: 1000,
  recommendation_core_tag_weight: 0.3,
  recommendation_core_tag_count: 5,
  recommendation_quality_impact: 0.05,
  recommendation_series_priority_enabled: true,
  recommendation_series_max_count: 3,
  recommendation_series_bypass_min_score: true,
  wallpaper_blur: 20,
  card_blur: 12,
  filelist_blur: 12,
  control_blur: 8,
  card_size: 'medium',
  card_width: 180,
  theme_color_nav: '',
  // 默认配色参考图：声优标签绿、类型标签橙（浅底深字）
  theme_color_actor: '#7BC86C',
  theme_color_tag: '#F2A65A',
  tag_opacity: 62,
}

/** 把任意输入收敛到 [0,1]，非法则返回默认值。 */
function clamp01(v: unknown, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(1, n))
}

/** 把任意输入收敛到 [0,100] 的整数（模糊强度用）。 */
function clampPercent(v: unknown, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** 校验 hex 颜色（#rgb / #rrggbb）。空串合法（表示用内置默认色），非法则回退 fallback。 */
function normalizeColor(v: unknown, fallback: string): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s.toLowerCase() : fallback
}

const CARD_SIZES: readonly CardSize[] = ['small', 'medium', 'large', 'custom']

interface SettingRow {
  key: string
  value: string
}

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as unknown as SettingRow[]
  const out: AppSettings = { ...DEFAULTS }
  for (const r of rows) {
    try {
      ;(out as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value)
    } catch {
      // keep default
    }
  }
  return out
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const cur = getSettings()
  const next: AppSettings = { ...cur, ...patch }
  next.source_paths = (Array.isArray(patch.source_paths) ? patch.source_paths : cur.source_paths)
    .map((s) => String(s).trim())
    .filter(Boolean)
  next.scan_depth = Math.max(0, Math.min(20, Number(patch.scan_depth ?? cur.scan_depth) || 0))
  next.scan_concurrency = Math.max(1, Math.min(20, Number(patch.scan_concurrency ?? cur.scan_concurrency) || DEFAULTS.scan_concurrency))
  next.page_size = Math.max(1, Math.min(200, Number(patch.page_size ?? cur.page_size) || DEFAULTS.page_size))
  next.seek_seconds = Math.max(1, Math.min(300, Number(patch.seek_seconds ?? cur.seek_seconds) || DEFAULTS.seek_seconds))
  next.proxy = String(patch.proxy ?? cur.proxy ?? '').trim()
  next.dlsite_base = String(patch.dlsite_base ?? cur.dlsite_base ?? '').trim() || DEFAULTS.dlsite_base
  next.dlsite_path = String(patch.dlsite_path ?? cur.dlsite_path ?? '').trim() || DEFAULTS.dlsite_path
  next.dlsite_locale = String(patch.dlsite_locale ?? cur.dlsite_locale ?? '').trim() || DEFAULTS.dlsite_locale
  next.cover_dir = String(patch.cover_dir ?? cur.cover_dir ?? '').trim()
  next.hvdb_base = String(patch.hvdb_base ?? cur.hvdb_base ?? '').trim() || DEFAULTS.hvdb_base
  next.recommendation_enabled = Boolean(patch.recommendation_enabled ?? cur.recommendation_enabled)
  next.recommendation_auto_calc = Boolean(patch.recommendation_auto_calc ?? cur.recommendation_auto_calc)
  next.recommendation_top_n = Math.max(10, Math.min(200, Number(patch.recommendation_top_n ?? cur.recommendation_top_n) || DEFAULTS.recommendation_top_n))
  next.recommendation_api_limit = Math.max(1, Math.min(50, Number(patch.recommendation_api_limit ?? cur.recommendation_api_limit) || DEFAULTS.recommendation_api_limit))
  next.recommendation_mmr_lambda = clamp01(patch.recommendation_mmr_lambda ?? cur.recommendation_mmr_lambda, DEFAULTS.recommendation_mmr_lambda)
  next.recommendation_weight_voice = clamp01(patch.recommendation_weight_voice ?? cur.recommendation_weight_voice, DEFAULTS.recommendation_weight_voice)
  next.recommendation_weight_tag = clamp01(patch.recommendation_weight_tag ?? cur.recommendation_weight_tag, DEFAULTS.recommendation_weight_tag)
  next.recommendation_weight_title = clamp01(patch.recommendation_weight_title ?? cur.recommendation_weight_title, DEFAULTS.recommendation_weight_title)
  next.recommendation_weight_circle = clamp01(patch.recommendation_weight_circle ?? cur.recommendation_weight_circle, DEFAULTS.recommendation_weight_circle)
  next.recommendation_quality_sales_weight = clamp01(patch.recommendation_quality_sales_weight ?? cur.recommendation_quality_sales_weight, DEFAULTS.recommendation_quality_sales_weight)
  next.recommendation_min_score = clamp01(patch.recommendation_min_score ?? cur.recommendation_min_score, DEFAULTS.recommendation_min_score)
  next.recommendation_candidate_limit = Math.max(50, Math.min(5000, Number(patch.recommendation_candidate_limit ?? cur.recommendation_candidate_limit) || DEFAULTS.recommendation_candidate_limit))
  next.recommendation_core_tag_weight = clamp01(patch.recommendation_core_tag_weight ?? cur.recommendation_core_tag_weight, DEFAULTS.recommendation_core_tag_weight)
  next.recommendation_core_tag_count = Math.max(1, Math.min(20, Number(patch.recommendation_core_tag_count ?? cur.recommendation_core_tag_count) || DEFAULTS.recommendation_core_tag_count))
  next.recommendation_quality_impact = clamp01(patch.recommendation_quality_impact ?? cur.recommendation_quality_impact, DEFAULTS.recommendation_quality_impact)
  next.recommendation_series_priority_enabled = Boolean(patch.recommendation_series_priority_enabled ?? cur.recommendation_series_priority_enabled)
  next.recommendation_series_max_count = Math.max(1, Math.min(20, Number(patch.recommendation_series_max_count ?? cur.recommendation_series_max_count) || DEFAULTS.recommendation_series_max_count))
  next.recommendation_series_bypass_min_score = Boolean(patch.recommendation_series_bypass_min_score ?? cur.recommendation_series_bypass_min_score)
  next.wallpaper_blur = clampPercent(patch.wallpaper_blur ?? cur.wallpaper_blur, DEFAULTS.wallpaper_blur)
  next.card_blur = clampPercent(patch.card_blur ?? cur.card_blur, DEFAULTS.card_blur)
  next.filelist_blur = clampPercent(patch.filelist_blur ?? cur.filelist_blur, DEFAULTS.filelist_blur)
  next.control_blur = clampPercent(patch.control_blur ?? cur.control_blur, DEFAULTS.control_blur)
  const cardSize = String(patch.card_size ?? cur.card_size) as CardSize
  next.card_size = CARD_SIZES.includes(cardSize) ? cardSize : DEFAULTS.card_size
  next.card_width = Math.max(80, Math.min(480, Number(patch.card_width ?? cur.card_width) || DEFAULTS.card_width))
  next.theme_color_nav = normalizeColor(patch.theme_color_nav ?? cur.theme_color_nav, DEFAULTS.theme_color_nav)
  next.theme_color_actor = normalizeColor(patch.theme_color_actor ?? cur.theme_color_actor, DEFAULTS.theme_color_actor)
  next.theme_color_tag = normalizeColor(patch.theme_color_tag ?? cur.theme_color_tag, DEFAULTS.theme_color_tag)
  // 标签不透明度：1-100（不允许 0，完全透明会让标签文字也跟着看不见）
  next.tag_opacity = Math.max(1, clampPercent(patch.tag_opacity ?? cur.tag_opacity, DEFAULTS.tag_opacity))

  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  for (const [k, v] of Object.entries(next)) {
    stmt.run(k, JSON.stringify(v))
  }
  return next
}

/**
 * 封面缓存目录：优先使用设置里的 cover_dir，留空则回退到默认 <dataDir>/covers。
 */
export function getCoverDir(): string {
  const dir = String(getSettings().cover_dir || '').trim()
  const abs = dir ? path.resolve(dir) : getConfig().coversDir
  fs.mkdirSync(abs, { recursive: true })
  return abs
}

const DEFAULT_COVER_EXTS = ['jpg', 'jpeg', 'png'] as const
const DEFAULT_COVER_CACHE_MS = 5000

// enrichWork 每行都会调用 findDefaultCover，缓存避免为每个作品重复查 DB
let defaultCoverCache: { file: string | null; at: number } | null = null

/** 找到用户上传的默认封面文件（作品没有封面时兜底使用），不存在返回 null。 */
export function findDefaultCover(): string | null {
  const now = Date.now()
  if (defaultCoverCache && now - defaultCoverCache.at < DEFAULT_COVER_CACHE_MS) {
    return defaultCoverCache.file
  }
  const dir = getCoverDir()
  let found: string | null = null
  for (const ext of DEFAULT_COVER_EXTS) {
    const p = path.join(dir, `common-cover.${ext}`)
    if (fs.existsSync(p)) {
      found = p
      break
    }
  }
  defaultCoverCache = { file: found, at: now }
  return found
}

/** 使默认封面缓存立即失效（上传/删除后调用）。 */
export function invalidateDefaultCoverCache(): void {
  defaultCoverCache = null
}

/** 删除现有默认封面（任意扩展名），并让缓存立即失效。 */
export function removeDefaultCover(): void {
  for (const ext of DEFAULT_COVER_EXTS) {
    const p = path.join(getCoverDir(), `common-cover.${ext}`)
    try {
      fs.rmSync(p, { force: true })
    } catch {
      /* ignore */
    }
  }
  invalidateDefaultCoverCache()
}

// ---- 壁纸（桌面端 / 移动端各一张，存 <dataDir>/wallpapers）----

export type WallpaperKind = 'desktop' | 'mobile'

/** 允许的壁纸图片扩展名（移动端常用 webp，故比默认封面多支持一种）。 */
export const WALLPAPER_EXTS = ['jpg', 'jpeg', 'png', 'webp'] as const

/** 壁纸存放目录（位于 dataDir 下，随数据卷持久化）。 */
export function getWallpaperDir(): string {
  const dir = path.join(getConfig().dataDir, 'wallpapers')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 找到指定端已上传的壁纸文件，不存在返回 null。 */
export function findWallpaper(kind: WallpaperKind): string | null {
  const dir = getWallpaperDir()
  for (const ext of WALLPAPER_EXTS) {
    const p = path.join(dir, `wallpaper-${kind}.${ext}`)
    if (fs.existsSync(p)) return p
  }
  return null
}

/** 删除指定端壁纸（任意扩展名）。 */
export function removeWallpaper(kind: WallpaperKind): void {
  const dir = getWallpaperDir()
  for (const ext of WALLPAPER_EXTS) {
    try {
      fs.rmSync(path.join(dir, `wallpaper-${kind}.${ext}`), { force: true })
    } catch {
      /* ignore */
    }
  }
}
