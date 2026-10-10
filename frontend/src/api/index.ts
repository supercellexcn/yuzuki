import axios from 'axios'
import type {
  AppSettings,
  ScanJob,
  CoverJob,
  WorksResponse,
  WorkDetail,
  TagCount,
  ActorCount,
  CircleCount,
  SeriesCount,
  LoginResponse,
  AuthUser,
  LibraryPrefs,
  PlayRecord,
  PlaysResponse,
  FavoriteType,
  FavoritesGrouped,
  RecommendationResponse,
  RecommendationJob,
  AdminWork,
  AdminWorkDetail,
  AdminWorksResponse,
  AdminTag,
  AdminActor,
  AdminCircle,
  AdminSeries,
  AdminTagFilter,
  HiddenType,
  WallpaperKind,
} from './types'

const TOKEN_KEY = 'yuzuki_token'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

const http = axios.create({ baseURL: '/api', timeout: 30000 })

http.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(
  (r) => r,
  (error) => {
    // 登录接口的 401 不处理（由页面提示）
    const url = String(error.config?.url || '')
    if (error.response?.status === 401 && !url.includes('/auth/login')) {
      clearToken()
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export async function getWorks(params: {
  q?: string
  cond?: string[]
  sort?: string
  order?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}): Promise<WorksResponse> {
  const { data } = await http.get('/works', { params })
  return data
}

export async function getRandomWorks(params: {
  q?: string
  cond?: string[]
  count?: number
}): Promise<{ items: WorksResponse['items']; count: number }> {
  const { data } = await http.get('/works/random', { params })
  return data
}

export async function getWork(rj: string): Promise<WorkDetail> {
  const { data } = await http.get(`/works/${rj}`)
  return data
}

/** 把作品文件夹内的某张图片设为该作品的封面。 */
export async function setWorkCover(rj: string, fileId: number): Promise<{ ok: boolean }> {
  const { data } = await http.post(`/works/${rj}/cover`, { file_id: fileId })
  return data
}

export async function getTags(): Promise<TagCount[]> {
  const { data } = await http.get('/tags')
  return data
}

export async function getActors(): Promise<ActorCount[]> {
  const { data } = await http.get('/actors')
  return data
}

export async function getCircles(): Promise<CircleCount[]> {
  const { data } = await http.get('/circles')
  return data
}

export async function getSeries(): Promise<SeriesCount[]> {
  const { data } = await http.get('/series')
  return data
}

export async function getSettings(): Promise<AppSettings> {
  const { data } = await http.get('/settings')
  return data
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const { data } = await http.put('/settings', patch)
  return data
}

// ---- 默认封面（作品无封面时兜底） ----
/** 上传默认封面（base64 图片数据 + 扩展名，≤10MB）。 */
export async function uploadDefaultCover(data: string, ext: string): Promise<{ ok: boolean; ext: string }> {
  const { data: res } = await http.post('/settings/default-cover', { data, ext })
  return res
}

export async function removeDefaultCover(): Promise<{ ok: boolean }> {
  const { data } = await http.delete('/settings/default-cover')
  return data
}

/** 默认封面是否已上传（HEAD 探测，不下载图片内容）。 */
export async function checkDefaultCover(): Promise<boolean> {
  try {
    await http.head('/settings/default-cover')
    return true
  } catch {
    return false
  }
}

/** 默认封面预览 URL（带 token）。 */
export function defaultCoverUrl(): string {
  return authedUrl('/api/settings/default-cover')
}

// ---- 壁纸（桌面端 / 移动端分别上传）----
/** 上传壁纸（base64 图片数据 + 扩展名，≤10MB）。 */
export async function uploadWallpaper(
  kind: WallpaperKind,
  data: string,
  ext: string
): Promise<{ ok: boolean; ext: string }> {
  const { data: res } = await http.post(`/settings/wallpaper/${kind}`, { data, ext })
  return res
}

export async function removeWallpaper(kind: WallpaperKind): Promise<{ ok: boolean }> {
  const { data } = await http.delete(`/settings/wallpaper/${kind}`)
  return data
}

/** 指定端是否已上传壁纸（HEAD 探测，不下载图片内容）。 */
export async function checkWallpaper(kind: WallpaperKind): Promise<boolean> {
  try {
    await http.head(`/settings/wallpaper/${kind}`)
    return true
  } catch {
    return false
  }
}

/** 壁纸图片 URL（带 token）；v 为破缓存的时间戳。 */
export function wallpaperUrl(kind: WallpaperKind, v?: number): string {
  const base = authedUrl(`/api/settings/wallpaper/${kind}`)
  if (!v) return base
  return `${base}${base.includes('?') ? '&' : '?'}v=${v}`
}

export async function startScan(): Promise<{ ok: boolean }> {
  const { data } = await http.post('/scan')
  return data
}

export async function getScanStatus(): Promise<ScanJob> {
  const { data } = await http.get('/scan/status')
  return data
}

export async function pauseScan(): Promise<{ ok: boolean }> {
  const { data } = await http.post('/scan/pause')
  return data
}

export async function resumeScan(): Promise<{ ok: boolean }> {
  const { data } = await http.post('/scan/resume')
  return data
}

export async function startCoverRedownload(): Promise<{ ok: boolean }> {
  const { data } = await http.post('/scan/redownload-covers')
  return data
}

export async function getCoverStatus(): Promise<CoverJob> {
  const { data } = await http.get('/scan/cover-status')
  return data
}

export async function resetLibrary(): Promise<{ ok: boolean; worksDeleted: number; coversDeleted: number }> {
  const { data } = await http.post('/scan/reset')
  return data
}

// ---- 登录 / 账户 ----
export async function login(username: string, password: string): Promise<LoginResponse> {
  const { data } = await http.post('/auth/login', { username, password })
  return data
}

export async function changePassword(old_password: string, new_password: string): Promise<{ ok: boolean }> {
  const { data } = await http.post('/auth/change-password', { old_password, new_password })
  return data
}

export async function getMe(): Promise<AuthUser> {
  const { data } = await http.get('/auth/me')
  return data
}

// ---- 播放历史 ----
export async function recordPlay(rj: string, fileId?: number | null): Promise<{ ok: boolean }> {
  const { data } = await http.post('/plays', { rj, file_id: fileId ?? null })
  return data
}

export async function getRecentPlays(limit = 10, offset = 0): Promise<PlayRecord[]> {
  const { data } = await http.get('/plays/recent', { params: { limit, offset } })
  return data
}

export async function getPlays(page: number, pageSize: number): Promise<PlaysResponse> {
  const { data } = await http.get('/plays', { params: { page, pageSize } })
  return data
}

// ---- 相关推荐 ----
export async function getRecommendations(rj: string, limit?: number): Promise<RecommendationResponse> {
  const { data } = await http.get(`/works/${rj}/recommendations`, { params: { limit } })
  return data
}

export async function startRecommendationCalc(): Promise<{ ok: boolean }> {
  const { data } = await http.post('/recommendations/calc')
  return data
}

export async function getRecommendationStatus(): Promise<RecommendationJob> {
  const { data } = await http.get('/recommendations/status')
  return data
}

// ---- 收藏 ----
export async function getFavorites(): Promise<FavoritesGrouped> {
  const { data } = await http.get('/favorites')
  return data
}

export async function addFavorite(type: FavoriteType, value: string, extra?: string): Promise<{ ok: boolean; created: boolean }> {
  const { data } = await http.post('/favorites', { type, value, extra: extra ?? '' })
  return data
}

export async function removeFavorite(type: FavoriteType, value: string): Promise<{ ok: boolean; removed: number }> {
  const { data } = await http.delete('/favorites', { params: { type, value } })
  return data
}

// ---- 界面记忆 ----
export async function getPrefs(): Promise<LibraryPrefs> {
  const { data } = await http.get('/prefs')
  return data
}

export async function savePrefs(patch: Partial<LibraryPrefs>): Promise<LibraryPrefs> {
  const { data } = await http.put('/prefs', patch)
  return data
}

/**
 * 给封面 / 媒体这类由 <img>/<audio> 直接加载的 URL 追加 token。
 * 浏览器标签元素无法携带 Authorization 头，故用 query 参数鉴权。
 */
export function authedUrl(url: string): string {
  if (!url) return ''
  const token = getToken()
  if (!token) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(token)}`
}

export function mediaUrl(rj: string, fileId: number): string {
  return authedUrl(`/api/media/${rj}/${fileId}`)
}

// ---- 管理功能 ----
export async function getAdminWorks(params: {
  q?: string
  circle?: string
  actor?: string
  series?: string
  tag?: string
  hasCover?: '1' | '0' | ''
  page?: number
  pageSize?: number
}): Promise<AdminWorksResponse> {
  const { data } = await http.get('/admin/works', { params })
  return data
}

export async function getAdminWork(rj: string): Promise<AdminWorkDetail> {
  const { data } = await http.get(`/admin/works/${rj}`)
  return data
}

export async function setAdminCover(rj: string, fileId: number): Promise<{ ok: boolean }> {
  const { data } = await http.post(`/admin/works/${rj}/cover`, { file_id: fileId })
  return data
}

export async function restoreAdminCover(rj: string): Promise<{ ok: boolean }> {
  const { data } = await http.post(`/admin/works/${rj}/cover/restore`)
  return data
}

/** 重新同步单个作品的元数据与封面（DLsite 优先，缺失时 HVDB 补；封面 DLsite 有就用 DLsite，否则用 HVDB）。 */
export async function syncAdminWork(rj: string): Promise<{ ok: boolean }> {
  const { data } = await http.post(`/admin/works/${rj}/sync`)
  return data
}

export async function setWorkHidden(rj: string, hidden: boolean): Promise<{ ok: boolean; hidden: boolean }> {
  const { data } = await http.post(`/admin/works/${rj}/hidden`, { hidden })
  return data
}

export async function addWorkTag(rj: string, name: string): Promise<{ ok: boolean; name: string; category: string }> {
  const { data } = await http.post(`/admin/works/${rj}/tags`, { name })
  return data
}

export async function removeWorkTag(rj: string, name: string, category: string): Promise<{ ok: boolean }> {
  const { data } = await http.delete(`/admin/works/${rj}/tags`, { params: { name, category } })
  return data
}

export async function getAdminSeries(): Promise<AdminSeries[]> {
  const { data } = await http.get('/admin/series')
  return data
}

export async function getAdminCircles(): Promise<AdminCircle[]> {
  const { data } = await http.get('/admin/circles')
  return data
}

export async function getAdminActors(): Promise<AdminActor[]> {
  const { data } = await http.get('/admin/actors')
  return data
}

export async function getAdminTags(filter: AdminTagFilter = 'all'): Promise<AdminTag[]> {
  const { data } = await http.get('/admin/tags', { params: { filter } })
  return data
}

export async function addCustomTag(name: string): Promise<{ ok: boolean; name: string; category: string }> {
  const { data } = await http.post('/admin/tags', { name })
  return data
}

export async function deleteCustomTag(name: string, category: string): Promise<{ ok: boolean }> {
  const { data } = await http.delete('/admin/tags', { params: { name, category } })
  return data
}

/** 通用隐藏 / 取消隐藏（series / circle / actor / tag）。 */
export async function setHidden(
  type: HiddenType,
  value: string,
  extra: string,
  hidden: boolean
): Promise<{ ok: boolean; hidden: boolean }> {
  const { data } = await http.post('/admin/hidden', { type, value, extra, hidden })
  return data
}
