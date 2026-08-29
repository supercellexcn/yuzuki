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

export type FilterCondType = 'circle' | 'actor' | 'tag'

export interface FilterCond {
  type: FilterCondType
  value: string
}

export interface LibraryPrefs {
  conditions: FilterCond[]
  q: string
  sort: string
  order: 'asc' | 'desc'
  lastWorkId: number | null
  lastScrollTop: number
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
  play_id: number
  played_at: string
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
