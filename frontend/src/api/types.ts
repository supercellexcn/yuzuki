export interface WorkTag {
  name: string
  category: string
}

/** 作品的其它语言版本（DLsite 翻译版为独立 RJ 号）。 */
export interface WorkTranslation {
  rj_code: string
  language: string
  language_label: string
}

export interface Work {
  id: number
  rj_code: string
  title: string
  circle: string
  release_date: string
  series: string
  sales_count: number | null
  /** 发售价格（日元）；null = 没抓到，0 = 免费 */
  price: number | null
  /** 平均评分；null = 没抓到，0 = 无评分 */
  rating: number | null
  /** 评论数量；null = 没抓到，0 = 无评论 */
  rating_count: number | null
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
  translations?: WorkTranslation[]
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
  /** 当前（或刚处理完的）作品的处置结果：'' / 跳过 / 已处理 / 禁售 / 下架 / 失败 */
  result?: string
}

export interface ScanJob {
  status: 'idle' | 'running' | 'done' | 'error'
  total: number
  done: number
  current: string
  removed: number
  paused: boolean
  workers: ScanWorker[]
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

export interface CoverJob {
  status: 'idle' | 'running' | 'done' | 'error'
  total: number
  done: number
  current: string
  downloaded: number
  skipped: number
  /** 本次更新了价格 / 评分 / 评论数 / 销量的作品数 */
  statsUpdated: number
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
  /** 桌面端 / 移动端壁纸是否启用；停用后文件保留但不应用。 */
  wallpaper_desktop_enabled: boolean
  wallpaper_mobile_enabled: boolean
  /** 壁纸本身的模糊强度（0-100）。 */
  wallpaper_blur: number
  /** 面板（卡片 / 导航栏 / 侧栏 / 播放栏 / 设置卡片）亚克力模糊强度（0-100）。有壁纸时才生效 */
  panel_blur: number
  /** 声优 / 类型标签的亚克力模糊强度（0-100）。有壁纸时才生效 */
  tag_blur: number
  /** 面板（顶部栏 / 详情页信息区 / 播放器 / 设置卡片）底色不透明度（0-100）。有壁纸时才生效 */
  panel_opacity: number
  /** 作品详情页文件列表底色不透明度（0-100）。有壁纸时才生效 */
  filelist_opacity: number
  /** 输入框 / 按钮 / 各类标签底色等控件的不透明度（0-100） */
  control_opacity: number
  card_size: CardSize
  card_width: number
  /** 移动端锁定每行两列：勾选后移动端无视卡片尺寸，固定两列展示 */
  card_mobile_two_col: boolean
  theme_color_nav: string
  theme_color_actor: string
  theme_color_tag: string
  /** 声优标签的不透明度（1-100，越大越不透明） */
  actor_tag_opacity: number
  /** 作品类型标签的不透明度（1-100，越大越不透明） */
  genre_tag_opacity: number
  /** 全局动画时长（秒，0-1）。0 表示关闭动画。 */
  animation_duration: number
  /** 只读派生字段：后端当前是否存有默认封面（GET /settings 返回，不参与保存）。 */
  has_default_cover?: boolean
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
  /** 这一组内所有文件的实际播放秒数之和 */
  duration_seconds: number
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
/** 内置「全年龄」标签：启动时播种，标签管理里不可删除。 */
export const ALL_AGES_TAG = '全年龄'

export interface AdminWork extends Work {
  hidden: boolean
  cover_modified: boolean
  /** 缺失的信息项（评分 / 评论数 / 销量为 0 属正常，不计入缺失） */
  missing: MissingField[]
  /** 上次抓取时 DLsite 的返回状态，决定这个作品该去哪找信息 */
  fetch_status?: DlFetchStatus
  /** 上次扫描的处置结果：'' / 跳过 / 已处理 / 禁售 / 下架 / 失败 */
  last_scan_result?: ScanOutcome | ''
  /** 上次扫描处置的时间（ISO 字符串） */
  last_scan_at?: string
}

/** 单次扫描对一部作品的处置结果（与后端 ScanOutcome 对应）。 */
export type ScanOutcome = '跳过' | '已处理' | '禁售' | '下架' | '失败'

/** 与后端 works.fetch_status 对应：'' = 未记录（旧数据 / 从未抓取） */
export type DlFetchStatus = '' | 'ok' | 'region_blocked' | 'not_found' | 'error' | 'unknown'

export const DL_STATUS_LABELS: Record<string, string> = {
  '': '未记录',
  ok: 'DL 正常',
  region_blocked: '地区禁售',
  not_found: 'DL 无此作品',
  error: '抓取失败',
  unknown: '未记录',
}

/** 作品信息缺失项，与后端 workService.MISSING_FIELDS 一一对应。 */
export type MissingField = 'title' | 'circle' | 'actors' | 'cover' | 'release_date' | 'price' | 'tags'

export const MISSING_FIELD_LABELS: Record<MissingField, string> = {
  title: '标题',
  circle: '社团',
  actors: '声优',
  cover: '封面',
  release_date: '发售日',
  price: '价格',
  tags: '类型标签',
}

/** 筛选下拉用的选项顺序 */
export const MISSING_FIELD_OPTIONS: MissingField[] = [
  'title',
  'circle',
  'actors',
  'cover',
  'release_date',
  'price',
  'tags',
]

export interface AdminWorkDetail extends AdminWork {
  files: MediaFile[]
  translations?: WorkTranslation[]
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
