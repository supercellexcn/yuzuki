export interface WorkTag {
  name: string
  category: string
}

export interface Work {
  id: number
  rj_code: string
  title: string
  circle: string
  release_date: string
  series: string
  sales_count: number | null
  play_count: number
  file_count: number
  folder_path: string
  added_at: string
  updated_at: string
  cover_url: string
  actors: string[]
  tags: WorkTag[]
}

export interface MediaFile {
  id: number
  filename: string
  rel_path: string
  ext: string
  kind: 'audio' | 'video' | 'image' | 'other' | ''
  is_dir: number
  size: number
  sort_order: number
}

export interface WorkDetail extends Work {
  files: MediaFile[]
}

export interface WorksResponse {
  items: Work[]
  total: number
  page: number
  pageSize: number
}

export interface ScanWorker {
  id: number
  rj: string
  stage: string
}

export interface ScanJob {
  status: 'idle' | 'running' | 'done' | 'error'
  total: number
  done: number
  current: string
  removed: number
  paused: boolean
  workers: ScanWorker[]
  errors: string[]
  startedAt: string | null
  finishedAt: string | null
}

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

/** 作品卡片尺寸：小 / 中 / 大 / 自定义宽度。 */
export type CardSize = 'small' | 'medium' | 'large' | 'custom'

/** 壁纸类型：桌面端 / 移动端各一张。 */
export type WallpaperKind = 'desktop' | 'mobile'

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
  recommendation_enabled: boolean
  recommendation_auto_calc: boolean
  recommendation_top_n: number
  recommendation_api_limit: number
  recommendation_mmr_lambda: number
  recommendation_weight_voice: number
  recommendation_weight_tag: number
  recommendation_weight_title: number
  recommendation_weight_circle: number
  recommendation_quality_sales_weight: number
  recommendation_min_score: number
  recommendation_candidate_limit: number
  recommendation_core_tag_weight: number
  recommendation_core_tag_count: number
  recommendation_quality_impact: number
  recommendation_series_priority_enabled: boolean
  recommendation_series_max_count: number
  recommendation_series_bypass_min_score: boolean
  // ---- 外观 / 壁纸 / 主题配色（全局共享）----
  /** 壁纸本身的模糊强度（0-100）。全站只有壁纸做模糊，其余表面只调不透明度。 */
  wallpaper_blur: number
  /** 面板（顶部栏 / 详情页信息区 / 播放器 / 设置卡片）底色不透明度（0-100）。有壁纸时才生效 */
  panel_opacity: number
  /** 作品详情页文件列表底色不透明度（0-100）。有壁纸时才生效 */
  filelist_opacity: number
  /** 输入框 / 按钮 / 各类标签底色等控件的不透明度（0-100） */
  control_opacity: number
  card_size: CardSize
  card_width: number
  theme_color_nav: string
  theme_color_actor: string
  theme_color_tag: string
  /** 声优标签的不透明度（1-100，越大越不透明） */
  actor_tag_opacity: number
  /** 作品类型标签的不透明度（1-100，越大越不透明） */
  genre_tag_opacity: number
  /** 全局动画时长（秒，0-1）。0 表示关闭动画。 */
  animation_duration: number
}

export interface TagCount {
  name: string
  category: string
  count: number
}

export interface ActorCount {
  name: string
  count: number
}

export interface CircleCount {
  name: string
  count: number
}

export interface SeriesCount {
  name: string
  count: number
}

export type FilterCondType = 'circle' | 'series' | 'actor' | 'tag'

export interface FilterCond {
  type: FilterCondType
  value: string
}

export interface LibraryPrefs {
  conditions: FilterCond[]
  q: string
  sort: string
  order: 'asc' | 'desc'
  /** 管理功能各板块每页数量（works/series/circles/actors/tags），每板块独立记住 */
  adminPageSizes: Record<string, number>
}

export interface AuthUser {
  id: number
  username: string
  must_change_password: boolean
  created_at: string
  prefs: LibraryPrefs
}

export interface LoginResponse {
  token: string
  username: string
  must_change_password: boolean
  prefs: LibraryPrefs
}

export interface PlayRecord extends Work {
  /** 分组 ID —— 取该「一次连听」里第一条记录的 id，可安全用作列表 key */
  play_id: number
  /** 这一组里最后一次播放的时间 */
  played_at: string
  /** 这一组里第一次播放的时间 */
  started_at: string
  /** 这一组合并了几条播放记录（同一时间段内连听的文件数） */
  group_count: number
}

export interface PlaysResponse {
  items: PlayRecord[]
  total: number
  page: number
  pageSize: number
}

// ---- 相关推荐 ----
export interface RecommendationReason {
  similarity: number
  voice: number
  tag: number
  title: number
  circle: number
  mainReasons: Array<'series' | 'voice' | 'tag' | 'title' | 'circle'>
  sameSeries: boolean
  sharedVoiceActors: string[]
  sharedTags: string[]
  sameCircle: boolean
}

export interface RecommendationItem extends Work {
  score: number
  reason: RecommendationReason
}

export interface RecommendationResponse {
  workId: string
  recommendations: RecommendationItem[]
}

export interface RecommendationJob {
  status: 'idle' | 'running' | 'done' | 'error'
  done: number
  total: number
  rows: number
  errors: string[]
  startedAt: string | null
  finishedAt: string | null
}

export type FavoriteType = 'work' | 'tag' | 'circle' | 'actor'

export interface FavoriteTag {
  name: string
  category: string
}

export interface FavoritesGrouped {
  works: Work[]
  tags: FavoriteTag[]
  circles: string[]
  actors: string[]
}

// ---- 管理功能 ----
/** 自定义标签的统一 category 值（与 DLsite/hvdb 的原生标签区分）。 */
export const CUSTOM_TAG = 'custom'

export interface AdminWork extends Work {
  hidden: boolean
  cover_modified: boolean
}

export interface AdminWorkDetail extends AdminWork {
  files: MediaFile[]
}

export interface AdminWorksResponse {
  items: AdminWork[]
  total: number
  page: number
  pageSize: number
}

export interface AdminTag extends TagCount {
  hidden: boolean
}

export interface AdminActor extends ActorCount {
  hidden: boolean
}

export interface AdminCircle extends CircleCount {
  hidden: boolean
}

export interface AdminSeries {
  name: string
  count: number
  hidden: boolean
}

export type AdminTagFilter = 'all' | 'custom' | 'native'
export type HiddenType = 'work' | 'series' | 'circle' | 'actor' | 'tag'
