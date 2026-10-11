import { computed, ref, watch } from 'vue'
import { checkWallpaper, getToken, wallpaperUrl } from '../api'
import type { AppSettings, CardSize, WallpaperKind } from '../api/types'
import { useSettingsStore } from '../stores/settings'
import { useIsMobile } from './useIsMobile'

/**
 * 外观系统：把「设置」里的壁纸 / 模糊 / 主题配色 / 卡片尺寸落到 document.documentElement
 * 的 CSS 变量上，供全局样式（App.vue）与各组件消费。
 *
 * 这些设置是全局共享的（存服务端 settings 表）；移动端与桌面端各有一张壁纸，
 * 按当前视口宽度（useIsMobile）自动取对应那张。
 *
 * 两个要点：
 * 1) 主题色一律以「带 alpha 的 rgba」下发（在 JS 里算好），不用 CSS 的 color-mix ——
 *    兼容性更好，且半透明才能让 backdrop-filter 的磨砂效果看得出来。
 * 2) 主题色除了导航栏，还统一驱动 hover 框线、播放条、面板底色（含设置界面、
 *    卡片下半部分、文件列表）等；只有「声优标签」和「作品类型标签」是独立配色。
 */

type RGB = [number, number, number]

/** 卡片尺寸 → 网格最小列宽（px）。custom 走 card_width，这里的值仅作类型占位。 */
const CARD_MIN_WIDTH: Record<CardSize, number> = { small: 140, medium: 180, large: 240, custom: 180 }

/** 面板基色（未设主题色时的深灰蓝），主题色会按 PANEL_TINT 比例混进来。 */
const PANEL_BASE: RGB = [27, 30, 36]
const PANEL_TINT = 0.22

/** 标签的内置默认色（设置里留空时用）。 */
const DEFAULT_ACTOR_COLOR = '#7bc86c'
const DEFAULT_TAG_COLOR = '#f2a65a'

/** 各类颜色的不透明度：导航栏留一点透，标签透得更明显。 */
const NAV_ALPHA = 0.75
/** 标签不透明度在设置里的默认值（1-100），与样式表兜底值保持一致。 */
const DEFAULT_TAG_OPACITY = 62
const CARD_META_ALPHA = 0.26

// ---- 模块级共享状态（多个组件调用 useAppearance 时共用同一份）----
const hasWallpaperDesktop = ref(false)
const hasWallpaperMobile = ref(false)
/** 上传 / 删除壁纸后自增，用于给图片 URL 破缓存 */
const wallpaperVersion = ref(0)

let wired = false

/** hex(#rgb/#rrggbb) → 0-255 的 RGB 分量；非法返回 null。 */
function hexToRgb(hex: string): RGB | null {
  const s = hex.trim().replace('#', '')
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

/** 按比例把 a 向 b 混合。 */
function mixRgb(a: RGB, b: RGB, k: number): RGB {
  return [
    Math.round(a[0] * (1 - k) + b[0] * k),
    Math.round(a[1] * (1 - k) + b[1] * k),
    Math.round(a[2] * (1 - k) + b[2] * k),
  ]
}

function rgbVars(c: RGB): string {
  return `${c[0]}, ${c[1]}, ${c[2]}`
}

function rgba(hex: string, alpha: number): string {
  const c = hexToRgb(hex)
  return c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})` : ''
}

function rgb(hex: string, toward: RGB, k: number): string {
  const c = hexToRgb(hex)
  if (!c) return ''
  const m = mixRgb(c, toward, k)
  return `rgb(${m[0]}, ${m[1]}, ${m[2]})`
}

/** 依据背景亮度选择可读的对比色：浅底用深字、深底用浅字。 */
function readableFg(hex: string): string {
  const c = hexToRgb(hex)
  if (!c) return ''
  const luminance = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255
  return luminance > 0.6 ? '#1b1f26' : '#ffffff'
}

/** 设置 / 移除一个 CSS 变量；空值表示回落到样式表里的内置默认。 */
function setVar(name: string, value: string): void {
  const root = document.documentElement
  if (value) root.style.setProperty(name, value)
  else root.style.removeProperty(name)
}

// 上一次算出的壁纸尺寸（像素）与见过的最大高度。见 syncWallpaperSize 的说明。
let lastWallpaperW = 0
let maxWallpaperH = 0

/**
 * 用像素给壁纸层定尺寸，而不是用 vh / inset 推导。
 *
 * 移动端弹出软键盘时视口高度会变小：若壁纸高度跟着变，background-size: cover 会重新
 * 取景，看起来就像「壁纸往上跳」。所以这里只在「宽度变了」或「高度变大」时才更新
 * —— 键盘只会让高度变小，这类变化被忽略；旋转屏幕（宽度变化）与地址栏收起（高度变大）
 * 仍会正常更新。用像素也绕开了部分移动浏览器把 vh 当作动态视口的差异。
 */
function syncWallpaperSize(): void {
  if (typeof window === 'undefined') return
  const w = document.documentElement.clientWidth // 不含滚动条，避免把页面撑出横向滚动
  const h = window.innerHeight
  if (w === lastWallpaperW && h <= maxWallpaperH) return
  lastWallpaperW = w
  maxWallpaperH = Math.max(maxWallpaperH, h)
  const root = document.documentElement
  root.style.setProperty('--wallpaper-w', `${lastWallpaperW + 96}px`) // +96 = 外扩一圈的余量
  root.style.setProperty('--wallpaper-h', `${maxWallpaperH + 96}px`)
}

export function useAppearance() {
  const settings = useSettingsStore()
  const isMobile = useIsMobile()

  const currentKind = computed<WallpaperKind>(() => (isMobile.value ? 'mobile' : 'desktop'))
  const hasCurrentWallpaper = computed(() =>
    currentKind.value === 'mobile' ? hasWallpaperMobile.value : hasWallpaperDesktop.value
  )

  /** 把当前设置应用为 CSS 变量。settings 未加载时为空操作。 */
  function apply(): void {
    const s = settings.settings
    const root = document.documentElement
    if (!s) return

    // 模糊：百分比 → px。不同表面用不同系数，100% 时效果明显但不至于糊成一片。
    root.style.setProperty('--wallpaper-blur', `${Math.round(s.wallpaper_blur * 0.3)}px`)
    root.style.setProperty('--card-blur', `${Math.round(s.card_blur * 0.2)}px`)
    root.style.setProperty('--filelist-blur', `${Math.round(s.filelist_blur * 0.2)}px`)
    root.style.setProperty('--control-blur', `${Math.round(s.control_blur * 0.15)}px`)

    const width = s.card_size === 'custom' ? s.card_width : CARD_MIN_WIDTH[s.card_size]
    root.style.setProperty('--card-min-width', `${width}px`)

    // ---- 主题色：导航栏 + 全站强调色（hover 框线 / 播放条 / 选中态…）----
    const nav = s.theme_color_nav
    const navRgb = nav ? hexToRgb(nav) : null
    const navFg = navRgb ? readableFg(nav) : ''
    setVar('--accent', nav)
    setVar('--topbar-color', navRgb ? rgba(nav, NAV_ALPHA) : '')
    setVar('--topbar-fg', navFg)
    // 强调色块（播放键等）上的前景色：深色主题色时自动转白，避免看不清
    setVar('--accent-fg', navFg)
    // 强调色的淡色叠加（选中态 / 正在播放等底色）
    setVar('--accent-soft', navRgb ? rgba(nav, 0.2) : '')
    // 顶栏上的半透明叠加（hover / 选中 / 头像底 / 描边）
    setVar('--topbar-hover', navFg ? rgba(navFg, 0.18) : '')
    setVar('--topbar-line', navFg ? rgba(navFg, 0.35) : '')
    setVar('--topbar-chip', navFg ? rgba(navFg, 0.22) : '')
    root.classList.toggle('has-nav-color', Boolean(navRgb))

    // 面板底色混入主题色 → 设置界面 / 卡片 / 播放条 / 历史列表不再是纯黑灰
    root.style.setProperty('--panel-rgb', rgbVars(navRgb ? mixRgb(PANEL_BASE, navRgb, PANEL_TINT) : PANEL_BASE))
    // 作品卡片下半部分也由主题色决定
    setVar('--card-meta-bg', navRgb ? rgba(nav, CARD_META_ALPHA) : '')

    // Element Plus 控件的 hover / focus 框线也跟着主题色走
    setVar('--el-color-primary', nav)
    setVar('--el-color-primary-light-3', navRgb ? rgb(nav, [255, 255, 255], 0.3) : '')
    setVar('--el-color-primary-light-5', navRgb ? rgb(nav, [255, 255, 255], 0.5) : '')
    setVar('--el-color-primary-light-7', navRgb ? rgb(nav, [255, 255, 255], 0.7) : '')
    setVar('--el-color-primary-light-8', navRgb ? rgb(nav, [255, 255, 255], 0.8) : '')
    setVar('--el-color-primary-light-9', navRgb ? rgb(nav, [255, 255, 255], 0.9) : '')
    setVar('--el-color-primary-dark-2', navRgb ? rgb(nav, [0, 0, 0], 0.2) : '')

    // ---- 声优 / 类型标签：独立配色 + 可调不透明度（设置里的「标签透明度」）----
    // 设置留空时也要下发内置默认色（且必须是带 alpha 的 rgba），
    // 否则会回落到样式表里的纯色默认值，标签就完全没有透明/磨砂了。
    const actorColor = s.theme_color_actor || DEFAULT_ACTOR_COLOR
    const tagColor = s.theme_color_tag || DEFAULT_TAG_COLOR
    const tagAlpha =
      Math.max(1, Math.min(100, Number(s.tag_opacity) || DEFAULT_TAG_OPACITY)) / 100
    setVar('--tag-actor-bg', rgba(actorColor, tagAlpha))
    setVar('--tag-actor-fg', readableFg(actorColor))
    setVar('--tag-genre-bg', rgba(tagColor, tagAlpha))
    setVar('--tag-genre-fg', readableFg(tagColor))

    // ---- 壁纸 ----
    const url =
      hasCurrentWallpaper.value && getToken()
        ? wallpaperUrl(currentKind.value, wallpaperVersion.value || undefined)
        : ''
    root.style.setProperty('--wallpaper-image', url ? `url("${url}")` : 'none')
    root.style.setProperty('--panel-alpha', url ? '0.62' : '1')
    // 控件底色改成半透明白（Element Plus 统一读这个变量），磨砂才看得出来；
    // 没壁纸时移除覆盖，保持原本不透明的观感。
    setVar('--el-fill-color-blank', url ? 'rgba(255, 255, 255, 0.72)' : '')
  }

  /**
   * 探测两端壁纸是否存在（HEAD，不下载内容）。
   * 不修改版本号 —— 否则每次进设置页都会换 URL 触发重新下载，页面会闪一下。
   */
  async function refreshWallpapers(): Promise<void> {
    if (!getToken()) return
    const [desktop, mobile] = await Promise.all([
      checkWallpaper('desktop').catch(() => false),
      checkWallpaper('mobile').catch(() => false),
    ])
    hasWallpaperDesktop.value = desktop
    hasWallpaperMobile.value = mobile
    apply()
  }

  /** 上传 / 删除壁纸后调用：换版本号破缓存，并重新探测。 */
  async function bumpWallpaperVersion(): Promise<void> {
    wallpaperVersion.value = Date.now()
    await refreshWallpapers()
  }

  if (!wired) {
    wired = true
    let wallpapersChecked = false
    // 壁纸层尺寸：初始化一次，之后只在宽度变化 / 高度变大时更新（键盘导致的变矮会被忽略）
    syncWallpaperSize()
    window.addEventListener('resize', syncWallpaperSize)
    /**
     * 首次拿到设置（且已登录）时探测壁纸。启动时可能还没登录，
     * 这里不早退，等登录后设置加载完成、watcher 再次触发时再补探测。
     */
    const ensureWallpapers = async () => {
      if (wallpapersChecked || !settings.settings || !getToken()) return
      wallpapersChecked = true
      await refreshWallpapers()
    }

    watch([() => settings.settings, isMobile, hasWallpaperDesktop, hasWallpaperMobile], () => {
      apply()
      void ensureWallpapers()
    })
    void (async () => {
      // 已有 token（上次登录记住）时才拉设置，避免启动时无谓的 401 跳登录
      if (!settings.settings && getToken()) await settings.load().catch(() => {})
      apply()
      await ensureWallpapers()
    })()
  }

  return {
    hasCurrentWallpaper,
    currentKind,
    hasWallpaperDesktop,
    hasWallpaperMobile,
    apply,
    refreshWallpapers,
    bumpWallpaperVersion,
  }
}
