import { computed, ref, watch } from 'vue'
import { checkWallpaper, getToken, wallpaperUrl } from '../api'
import type { AppSettings, CardSize, WallpaperKind } from '../api/types'
import { useSettingsStore } from '../stores/settings'
import { useIsMobile } from './useIsMobile'

/**
 * 外观系统：把「设置」里的壁纸 / 模糊 / 底色透明度 / 主题配色 / 卡片尺寸落到
 * document.documentElement 的 CSS 变量上，供全局样式（App.vue）与各组件消费。
 *
 * 这些设置是全局共享的（存服务端 settings 表）；移动端与桌面端各有一张壁纸，
 * 按当前视口宽度（useIsMobile）自动取对应那张。
 *
 * 两个要点：
 * 1) 主题色一律以「带 alpha 的 rgba」下发（在 JS 里算好），不用 CSS 的 color-mix ——
 *    兼容性更好，且半透明才能让壁纸透出来。
 * 2) 模糊分三层：壁纸（filter: blur）、面板（backdrop-filter，作用于卡片 / 导航栏 /
 *    侧栏 / 播放栏 / 设置卡片等大色块）、标签（backdrop-filter，独立强度）。
 *    亚克力高光质感只要有强度就启用；backdrop-filter 只在有壁纸时才加，避免纯色
 *    背景上白付合成层代价。主题色统一驱动 hover 框线、播放条、面板底色等；
 *    声优标签与作品类型标签是独立配色 + 独立透明度。
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

/** 标签文字统一用白色（不再按底色亮度自动取深色）。 */
const TAG_FG = '#ffffff'

/** 全局动画时长默认值（秒），与样式表兜底值、后端默认值保持一致。 */
const DEFAULT_ANIM_SECONDS = 0.25

/** 不透明度设置项的默认值（百分比），与样式表兜底值、后端默认值保持一致。 */
const DEFAULT_TAG_OPACITY = 62
const DEFAULT_PANEL_OPACITY = 62
/** 面板 / 标签模糊强度默认值（百分比），与后端默认值保持一致。 */
const DEFAULT_PANEL_BLUR = 40
const DEFAULT_TAG_BLUR = 30
const DEFAULT_FILELIST_OPACITY = 62
const DEFAULT_CONTROL_OPACITY = 70
const CARD_META_ALPHA = 0.26

// ---- 模块级共享状态（多个组件调用 useAppearance 时共用同一份）----
const hasWallpaperDesktop = ref(false)
const hasWallpaperMobile = ref(false)
/** 设置页切换「启用 / 停用」时的即时预览（保存前也让界面立刻响应）。 */
const wallpaperEnabledPreview = ref<Partial<Record<WallpaperKind, boolean>>>({})
/** 上传 / 删除壁纸后自增，用于给图片 URL 破缓存 */
const wallpaperVersion = ref(0)
/** 设置页拖动「壁纸模糊」时的即时预览值（保存前就让页面响应） */
const wallpaperBlurPreview = ref<number | null>(null)

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

/** sRGB 分量按 WCAG 规则线性化。 */
function linearChannel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** 相对亮度（WCAG 2.x，0-1）。 */
function luminance(c: RGB): number {
  return 0.2126 * linearChannel(c[0]) + 0.7152 * linearChannel(c[1]) + 0.0722 * linearChannel(c[2])
}

/** 两色的对比度（1:1 ~ 21:1）。 */
function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 强调色作为前景时的最低对比度（WCAG AA 正文标准）。 */
const MIN_FG_CONTRAST = 4.5
/** 深色 UI 上选深色前景时用的颜色（与 :root 的 --accent-fg 兜底一致）。 */
const FG_DARK: RGB = [11, 14, 18]

/**
 * 在给定底色上选择黑 / 白里对比度更高的前景色。
 * 比「按亮度卡阈值」更可靠：中间调颜色不会两边都看不清。
 */
function foregroundOn(bg: RGB): string {
  return contrastRatio([255, 255, 255], bg) >= contrastRatio(FG_DARK, bg) ? '#ffffff' : '#0b0e12'
}

/**
 * 把主题色变成「可读的强调色」。
 *
 * 主题色不只用来铺底色，还会被当作文字 / 图标 / 边框 / 选中态（--accent）。
 * 用户把它设成黑色、深蓝这类和深色面板几乎一样暗的颜色时，这些地方就会糊成一片。
 * 这里不做固定配色，而是沿原色相逐步向白色混合（相当于把过暗的颜色往反方向提亮），
 * 直到与该颜色自己的选中底色（面板 + 20% 强调色，即 --accent-soft）的对比度
 * 达到 AA 正文标准；原本就够亮的颜色保持不变。
 * 以选中底色为基准是因为侧边栏 / 管理页的选中项正是「强调色文字压在强调色淡底上」，
 * 只对纯面板达标的话，那一层淡底还会再吃掉一点对比度。
 */
function readableAccent(hex: string): RGB | null {
  const c = hexToRgb(hex)
  if (!c) return null
  const onSoft = (color: RGB) => contrastRatio(color, mixRgb(PANEL_BASE, color, 0.2))
  if (onSoft(c) >= MIN_FG_CONTRAST) return c
  for (let k = 0.05; k < 1; k += 0.05) {
    const candidate = mixRgb(c, [255, 255, 255], k)
    if (onSoft(candidate) >= MIN_FG_CONTRAST) return candidate
  }
  return [255, 255, 255]
}

/** RGB → #rrggbb。 */
function toHex(c: RGB): string {
  return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

/** 设置里的百分比 → alpha（0-1）。 */
function pct(v: unknown, fallback: number): number {
  const n = Number(v)
  const p = Number.isFinite(n) ? n : fallback
  return Math.max(0, Math.min(100, p)) / 100
}

/** 标签底色的 alpha：下限 1%（=0 会让标签整个看不见，与后端归一化保持一致）。 */
function tagPct(v: unknown): number {
  return Math.max(0.01, pct(v, DEFAULT_TAG_OPACITY))
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
  // 取景尺寸变了：旧的预渲染图比例不对，先回退实时模糊，再按新尺寸重新烘焙
  resetWallpaperPrefilter()
  scheduleWallpaperPrefilter()
}

/*
 * ---- 壁纸模糊预渲染 ----
 *
 * body::before 是一个铺满视口（+96px）的固定层，原来靠 `filter: blur()` 实时模糊。
 * 它是页面上唯一「全屏 + 滤镜」的元素：滚动时只要被判定需要重绘，就要对整屏重算
 * 一次高斯（DPR 2 的 2K 屏约 900 万像素），成本极高且与视口面积成正比 —— 表现为
 * 窗口越宽越卡、缩窄就变顺。
 *
 * 这里改成「只烘焙一次」：把原图按 cover 取景画进 canvas（大图用 1/2 分辨率，
 * 模糊本身是低频，看不出差别），用 canvas 的 blur 滤镜把模糊一起烘进像素，
 * 再作为该层的背景图。视觉与实时模糊一致，但滚动时这层只是一张静态位图，
 * 零滤镜计算。
 *
 * 任何一步失败（解码失败 / 跨域污染 canvas / 浏览器不支持 canvas filter）都
 * 静默回退到原来的 CSS blur，功能与观感不受影响。
 */
let wallpaperPrefilterKey = ''
let wallpaperPrefilterTimer = 0
let wallpaperPrefilterSeq = 0
/** 上一份「已烘焙」对应的壁纸地址与模糊半径，用来判断是否需要重做 */
let lastWallpaperImage = ''
let lastWallpaperBlurPx = -1

/** canvas 的 filter 是否存在且真正生效（老版 Safari 会忽略它，不能拿它烘焙） */
let canvasFilterSupported: boolean | null = null
function supportsCanvasFilter(): boolean {
  if (canvasFilterSupported !== null) return canvasFilterSupported
  canvasFilterSupported = false
  const ctx = document.createElement('canvas').getContext('2d')
  if (ctx && 'filter' in ctx) {
    ctx.filter = 'blur(2px)'
    canvasFilterSupported = ctx.filter === 'blur(2px)'
  }
  return canvasFilterSupported
}

/** 撤掉预渲染结果 → body::before 回退到「原图 + 实时 blur」 */
function resetWallpaperPrefilter(): void {
  wallpaperPrefilterKey = ''
  setVar('--wallpaper-image-blurred', '')
  setVar('--wallpaper-extra-filter', '')
}

function scheduleWallpaperPrefilter(): void {
  if (typeof window === 'undefined') return
  if (wallpaperPrefilterTimer) clearTimeout(wallpaperPrefilterTimer)
  // 防抖：拖动模糊滑块 / 连续改设置时只在停手后烘焙一次
  wallpaperPrefilterTimer = window.setTimeout(() => {
    wallpaperPrefilterTimer = 0
    void buildWallpaperPrefilter()
  }, 160)
}

async function buildWallpaperPrefilter(): Promise<void> {
  const root = document.documentElement
  const raw = root.style.getPropertyValue('--wallpaper-image').trim()
  const radius = Math.round(parseFloat(root.style.getPropertyValue('--wallpaper-blur')) || 0)
  if (!raw || raw === 'none' || radius <= 0 || !lastWallpaperW || !maxWallpaperH) {
    resetWallpaperPrefilter()
    return
  }
  if (!supportsCanvasFilter()) {
    resetWallpaperPrefilter()
    return
  }

  const w = lastWallpaperW + 96
  const h = maxWallpaperH + 96
  const key = `${raw}|${radius}|${w}x${h}`
  if (key === wallpaperPrefilterKey) return

  const seq = ++wallpaperPrefilterSeq
  const img = new Image()
  img.decoding = 'async'
  img.src = raw.replace(/^url\(["']?/, '').replace(/["']?\)$/, '')
  try {
    await img.decode()
  } catch {
    if (seq === wallpaperPrefilterSeq) resetWallpaperPrefilter()
    return
  }
  if (seq !== wallpaperPrefilterSeq) return
  if (!img.naturalWidth || !img.naturalHeight) {
    resetWallpaperPrefilter()
    return
  }

  // 大面积（高分屏）用 1/2 分辨率烘焙：体积和显存都小一个数量级，模糊看不出差别
  const scale = w * h > 900_000 ? 0.5 : 1
  const cw = Math.max(1, Math.round(w * scale))
  const ch = Math.max(1, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    resetWallpaperPrefilter()
    return
  }
  // 与 background-size: cover 完全一致的取景（canvas 宽高比 = 壁纸层宽高比）
  const k = Math.max(cw / img.naturalWidth, ch / img.naturalHeight)
  const dw = img.naturalWidth * k
  const dh = img.naturalHeight * k
  ctx.filter = `blur(${Math.max(0.5, radius * scale)}px)`
  ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh)
  ctx.filter = 'none'

  let data: string
  try {
    data = canvas.toDataURL('image/jpeg', 0.9)
  } catch {
    // 图片跨域且未带 CORS 头时 canvas 会被污染，读不出来 —— 回退实时模糊
    if (seq === wallpaperPrefilterSeq) resetWallpaperPrefilter()
    return
  }
  if (seq !== wallpaperPrefilterSeq) return

  wallpaperPrefilterKey = key
  setVar('--wallpaper-image-blurred', `url("${data}")`)
  setVar('--wallpaper-extra-filter', 'none')
}

export function useAppearance() {
  const settings = useSettingsStore()
  const isMobile = useIsMobile()

  const currentKind = computed<WallpaperKind>(() => (isMobile.value ? 'mobile' : 'desktop'))
  const hasCurrentWallpaper = computed(() =>
    currentKind.value === 'mobile' ? hasWallpaperMobile.value : hasWallpaperDesktop.value
  )
  /** 当前端壁纸是否启用（文件存在但被停用时，不应用到页面）。 */
  const currentWallpaperEnabled = computed(() => {
    const preview = wallpaperEnabledPreview.value[currentKind.value]
    if (preview !== undefined) return preview
    const s = settings.settings
    if (!s) return false
    return currentKind.value === 'mobile'
      ? s.wallpaper_mobile_enabled !== false
      : s.wallpaper_desktop_enabled !== false
  })

  /** 把当前设置应用为 CSS 变量。settings 未加载时为空操作。 */
  function apply(): void {
    const s = settings.settings
    const root = document.documentElement
    if (!s) return

    // ---- 壁纸 ----
    // 先算出壁纸 URL：没有壁纸时面板透出的是页面底色。
    const wallUrl =
      hasCurrentWallpaper.value && currentWallpaperEnabled.value && getToken()
        ? wallpaperUrl(currentKind.value, wallpaperVersion.value || undefined)
        : ''
    const wallImage = wallUrl ? `url("${wallUrl}")` : 'none'
    root.style.setProperty('--wallpaper-image', wallImage)

    // ---- 模糊：壁纸 / 面板 / 标签三层独立 ----
    const wallpaperBlur =
      wallpaperBlurPreview.value !== null ? wallpaperBlurPreview.value : s.wallpaper_blur
    const wallpaperBlurPx = Math.round(wallpaperBlur * 0.3)
    root.style.setProperty('--wallpaper-blur', `${wallpaperBlurPx}px`)

    /*
     * 换壁纸 / 改模糊半径时，旧的烘焙图已经不对了：先撤掉它、回退到实时 blur
     * （这一刻视觉本来就是「新图 + 正确半径」），再防抖烘焙新的。
     * 其他设置变化不动它 —— 否则改个主题色都要重新烘焙、白闪一下。
     */
    if (wallImage !== lastWallpaperImage || wallpaperBlurPx !== lastWallpaperBlurPx) {
      lastWallpaperImage = wallImage
      lastWallpaperBlurPx = wallpaperBlurPx
      resetWallpaperPrefilter()
    }
    scheduleWallpaperPrefilter()

    // ---- 底色不透明度：面板 / 文件列表 / 控件 ----
    // 不透明度始终生效：有壁纸时透出壁纸，没有壁纸时透出页面底色。
    // 亚克力毛玻璃同样不依赖壁纸：没有壁纸时，滚动到面板后面的内容也会被模糊。
    const panelBlur = Math.round(
      Math.max(0, Math.min(100, Number.isFinite(Number(s.panel_blur)) ? Number(s.panel_blur) : DEFAULT_PANEL_BLUR)) * 0.2
    )
    const tagBlur = Math.round(
      Math.max(0, Math.min(100, Number.isFinite(Number(s.tag_blur)) ? Number(s.tag_blur) : DEFAULT_TAG_BLUR)) * 0.2
    )
    root.style.setProperty('--panel-blur', `${panelBlur}px`)
    root.style.setProperty('--tag-blur', `${tagBlur}px`)
    root.classList.toggle('has-acrylic', panelBlur > 0)
    root.classList.toggle('has-tag-acrylic', tagBlur > 0)
    setVar('--acrylic-filter', `blur(${panelBlur}px) saturate(1.7)`)
    setVar('--tag-acrylic-filter', `blur(${tagBlur}px) saturate(1.8)`)
    // 不透明度始终生效：有壁纸时透出壁纸，没壁纸时透出页面底色，不能因为没壁纸就把效果整个拿掉
    root.style.setProperty('--panel-alpha', String(pct(s.panel_opacity, DEFAULT_PANEL_OPACITY)))
    root.style.setProperty(
      '--filelist-alpha',
      String(pct(s.filelist_opacity, DEFAULT_FILELIST_OPACITY))
    )
    const controlAlpha = pct(s.control_opacity, DEFAULT_CONTROL_OPACITY)
    root.style.setProperty('--control-alpha', String(controlAlpha))
    // 输入框等控件的底色走 Element Plus 的统一变量（半透明白）
    setVar('--el-fill-color-blank', `rgba(255, 255, 255, ${controlAlpha})`)

    const width = s.card_size === 'custom' ? s.card_width : CARD_MIN_WIDTH[s.card_size]
    root.style.setProperty('--card-min-width', `${width}px`)

    // 全局动画时长：所有界面动画/过渡都读这个变量（0 就是关闭动画）。
    // 校验一次，避免设置里存了非法值时整个界面失去过渡。
    const anim = Number(s.animation_duration)
    const animSec = Number.isFinite(anim) ? Math.max(0, Math.min(1, anim)) : DEFAULT_ANIM_SECONDS
    root.style.setProperty('--anim-duration', `${animSec}s`)

    // ---- 主题色：导航栏 + 全站强调色（hover 框线 / 播放条 / 选中态…）----
    const nav = s.theme_color_nav
    const navRgb = nav ? hexToRgb(nav) : null
    const navFg = navRgb ? foregroundOn(navRgb) : ''
    // 顶栏底色仍用用户挑的原始颜色（那是它本身的职责）。
    // 前景色 / 边框 / 选中态用「按对比度处理过」的强调色：
    // 主题色过暗时沿原色相提亮，避免黑底黑字；原本就够亮的颜色不受影响。
    const accentRgb = nav ? readableAccent(nav) : null
    const accent = accentRgb ? toHex(accentRgb) : ''
    const accentFg = accentRgb ? foregroundOn(accentRgb) : ''
    // 顶栏也是一块面板：设了主题色时用「主题色 + 面板透明度」，滑杆始终对顶栏生效
    // （没有壁纸时透出的是页面底色）。
    const topbarAlpha = pct(s.panel_opacity, DEFAULT_PANEL_OPACITY)
    setVar('--accent', accent)
    setVar('--topbar-color', navRgb ? rgba(nav, topbarAlpha) : '')
    setVar('--topbar-fg', navFg)
    // 强调色块（播放键等）上的前景色：按实际强调色的对比度自动取黑 / 白
    setVar('--accent-fg', accentFg)
    // 强调色的淡色叠加（选中态 / 正在播放等底色）也基于处理后的强调色，
    // 否则深色主题色做出来的选中底色在深色面板上几乎看不见。
    setVar('--accent-soft', accentRgb ? rgba(accent, 0.2) : '')
    // 顶栏上的半透明叠加（hover / 选中 / 头像底 / 描边）
    setVar('--topbar-hover', navFg ? rgba(navFg, 0.18) : '')
    setVar('--topbar-line', navFg ? rgba(navFg, 0.35) : '')
    setVar('--topbar-chip', navFg ? rgba(navFg, 0.22) : '')
    root.classList.toggle('has-nav-color', Boolean(navRgb))

    // 面板底色混入主题色 → 设置界面 / 卡片 / 播放条 / 历史列表不再是纯黑灰
    const panelMix = navRgb ? mixRgb(PANEL_BASE, navRgb, PANEL_TINT) : PANEL_BASE
    root.style.setProperty('--panel-rgb', rgbVars(panelMix))
    // 面板上的文字按实际面板色取对比度更高的黑/白（表格用 EP 浅色主题的深灰文字，
    // 深色面板上会糊成一片）；未加载设置时用 App.vue :root 里的兜底值
    setVar('--panel-fg', foregroundOn(panelMix))
    // 作品卡片下半部分也由主题色决定
    setVar('--card-meta-bg', navRgb ? rgba(nav, CARD_META_ALPHA) : '')

    // Element Plus 控件的 hover / focus 框线也跟着强调色走（同样用处理后的可读色）
    setVar('--el-color-primary', accent)
    setVar('--el-color-primary-light-3', accentRgb ? rgb(accent, [255, 255, 255], 0.3) : '')
    setVar('--el-color-primary-light-5', accentRgb ? rgb(accent, [255, 255, 255], 0.5) : '')
    setVar('--el-color-primary-light-7', accentRgb ? rgb(accent, [255, 255, 255], 0.7) : '')
    setVar('--el-color-primary-light-8', accentRgb ? rgb(accent, [255, 255, 255], 0.8) : '')
    setVar('--el-color-primary-light-9', accentRgb ? rgb(accent, [255, 255, 255], 0.9) : '')
    setVar('--el-color-primary-dark-2', accentRgb ? rgb(accent, [0, 0, 0], 0.2) : '')

    // ---- 声优 / 类型标签：独立配色 + 各自可调的不透明度 ----
    // 设置留空时也要下发内置默认色（且必须是带 alpha 的 rgba），
    // 否则会回落到样式表里的纯色默认值，标签就完全没有透明效果了。
    const actorColor = s.theme_color_actor || DEFAULT_ACTOR_COLOR
    const tagColor = s.theme_color_tag || DEFAULT_TAG_COLOR
    setVar('--tag-actor-bg', rgba(actorColor, tagPct(s.actor_tag_opacity)))
    setVar('--tag-actor-fg', TAG_FG)
    setVar('--tag-genre-bg', rgba(tagColor, tagPct(s.genre_tag_opacity)))
    setVar('--tag-genre-fg', TAG_FG)
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

  /** 设置页切换壁纸启停时的即时预览（无需等待自动保存）。 */
  function previewWallpaperEnabled(kind: WallpaperKind, enabled: boolean): void {
    wallpaperEnabledPreview.value = { ...wallpaperEnabledPreview.value, [kind]: enabled }
    apply()
  }

  /** 取消未保存的修改 / 离开设置页时，撤掉预览，回到已保存的设置。 */
  function clearWallpaperEnabledPreview(): void {
    wallpaperEnabledPreview.value = {}
    apply()
  }

  /** 设置页拖动「壁纸模糊」时的即时预览（壁纸相关设置要求立即生效）。 */
  function previewWallpaperBlur(value: number): void {
    wallpaperBlurPreview.value = value
    apply()
  }

  /** 撤掉壁纸模糊预览（保存 / 取消 / 离开设置页时调用）。 */
  function clearWallpaperBlurPreview(): void {
    wallpaperBlurPreview.value = null
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
    previewWallpaperEnabled,
    clearWallpaperEnabledPreview,
    previewWallpaperBlur,
    clearWallpaperBlurPreview,
  }
}
