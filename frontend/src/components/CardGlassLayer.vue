<template>
  <div ref="layerEl" class="card-glass" aria-hidden="true">
    <!--
      模糊与裁剪故意分在两层：外层只改 clip-path，内层负责 filter。
      两者放在同一个元素上时，改裁剪会让整个元素的绘制失效、每帧重算一次全屏模糊；
      分开后内层内容是静态的（固定壁纸 + 固定半径），模糊结果可以作为纹理复用，
      滚动时只有外层的裁剪几何在变。
    -->
    <div class="card-glass__blur"></div>
  </div>
</template>

<script setup lang="ts">
import { onActivated, onMounted, onBeforeUnmount, nextTick, ref } from 'vue'

/*
 * 卡片毛玻璃统一层。
 *
 * 为什么不能每张卡片一个 backdrop-filter：
 * 卡片随滚动移动，带 backdrop-filter 的层每帧都要重新采样背后内容，成本 ∝ 同屏
 * 卡片数（图片模式下卡片变矮、同屏数量翻倍，问题更明显）。任何「滚动时关掉模糊」
 * 的方案都会造成可见跳变，不可接受。
 *
 * 这里利用一个几何事实：媒体库 / 收藏 / 历史页里，卡片背后就是 body::before 那层
 * 位置固定的壁纸。所以「每张卡片各模糊一次」等价于「把同一张壁纸按卡片所在矩形
 * 裁剪出来、统一模糊一次」：
 *   · 全屏只有一个固定层，模糊只算一次（层内容不随滚动移动，可以整体缓存）；
 *   · 用 clip-path 的多段路径把这一层裁成「所有可见卡片的矩形」，滚动时只更新
 *     裁剪矩形的坐标，不再重采样模糊；
 *   · 卡片自身不再持有 backdrop-filter，只保留半透明底色与高光渐变。
 *
 * 模糊半径取壁纸模糊与面板模糊的平方和开方（两次高斯近似合并为一次），
 * 与「先壁纸模糊、再卡片模糊」的观感一致。
 */

const layerEl = ref<HTMLDivElement | null>(null)

/** 与 App.vue 里 body::before 的外扩一致：模糊需要出血，否则边缘会露底 */
const BLEED = 48
/** 卡片圆角，与 .work-card 一致 */
const RADIUS = 10
/** 视口外多远之内的卡片也纳入裁剪（滚动时边缘卡片不会突然「长出」模糊） */
const MARGIN = 240

type Rect = { l: number; t: number; w: number; h: number }

let host: HTMLElement | null = null
/** 卡片的文档坐标缓存（按 top 升序），滚动过程中不再读 DOM */
let rects: Rect[] = []
let lastPath = ''
let lastSy = -1
let lastSx = -1
let enabled = false
let observer: ResizeObserver | null = null
let styleObserver: MutationObserver | null = null

/** 面板模糊是否开启 + 壁纸是否存在：都不满足时这一层没有意义，直接隐藏 */
function syncEnabled() {
  const root = document.documentElement
  const cs = getComputedStyle(root)
  const wp = cs.getPropertyValue('--wallpaper-image').trim()
  const wb = parseFloat(cs.getPropertyValue('--wallpaper-blur')) || 0
  const pb = parseFloat(cs.getPropertyValue('--panel-blur')) || 0
  const el = layerEl.value
  if (el) {
    // 两次高斯模糊等效一次：sqrt(a² + b²)
    const blur = Math.round(Math.sqrt(wb * wb + pb * pb) * 10) / 10
    el.style.setProperty('--card-glass-blur', `${blur || 0}px`)
  }
  enabled = root.classList.contains('has-acrylic') && !!wp && wp !== 'none' && pb > 0
  if (!enabled) hide()
  else update()
}

function hide() {
  const el = layerEl.value
  if (el) el.style.visibility = 'hidden'
  lastPath = ''
}

/** 读取所有卡片的文档坐标。只在挂载 / 尺寸变化时执行，滚动过程中不读 DOM */
function measure() {
  if (!host) return
  const sx = window.scrollX
  const sy = window.scrollY
  const next: Rect[] = []
  for (const el of host.querySelectorAll<HTMLElement>('.work-card')) {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    next.push({ l: r.left + sx, t: r.top + sy, w: r.width, h: r.height })
  }
  next.sort((a, b) => a.t - b.t)
  rects = next
  lastPath = ''
  update()
}

/** 一个圆角矩形（相对路径，坐标取整以缩短路径字符串） */
function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const rx = Math.min(r, w / 2)
  const ry = Math.min(r, h / 2)
  return (
    `M${x + rx} ${y}` +
    `h${w - rx * 2}` +
    `a${rx} ${ry} 0 0 1 ${rx} ${ry}` +
    `v${h - ry * 2}` +
    `a${rx} ${ry} 0 0 1 ${-rx} ${ry}` +
    `h${rx * 2 - w}` +
    `a${rx} ${ry} 0 0 1 ${-rx} ${-ry}` +
    `v${ry * 2 - h}` +
    `a${rx} ${ry} 0 0 1 ${rx} ${-ry}z`
  )
}

/** 生成「所有可见卡片」的裁剪路径：滚动时唯一的逐帧工作 */
function buildPath(sy: number, sx: number, vh: number): string {
  if (!rects.length) return ''
  const top = sy - MARGIN
  const bottom = sy + vh + MARGIN
  // 二分定位第一张可能可见的卡片（rects 按 top 升序）
  let lo = 0
  let hi = rects.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rects[mid].t + rects[mid].h < top) lo = mid + 1
    else hi = mid
  }
  const parts: string[] = []
  for (let i = lo; i < rects.length; i++) {
    const r = rects[i]
    if (r.t > bottom) break
    const w = Math.round(r.w + 2)
    const h = Math.round(r.h + 2)
    if (w < 4 || h < 4) continue
    // 缓存的是文档坐标，要换算成视口坐标（层固定于视口，且比视口外扩 BLEED）
    parts.push(
      roundRect(
        Math.round(r.l - sx - 1 + BLEED),
        Math.round(r.t - sy - 1 + BLEED),
        w,
        h,
        RADIUS + 1
      )
    )
  }
  return parts.join('')
}

function update() {
  const el = layerEl.value
  if (!el || !enabled) return
  const sy = window.scrollY
  const sx = window.scrollX
  lastSy = sy
  lastSx = sx
  const path = buildPath(sy, sx, window.innerHeight)
  if (!path) {
    hide()
    return
  }
  if (path !== lastPath) {
    lastPath = path
    el.style.clipPath = `path("${path}")`
  }
  el.style.visibility = 'visible'
}

/*
 * 必须在 scroll 事件的同一帧内同步更新裁剪：滚动事件在浏览器绘制前派发，
 * 这里改完 clip-path 当帧就能用上，卡片与模糊区不会错位。
 * 如果包一层 requestAnimationFrame，更新会被推到下一帧，快速滚动时模糊区
 * 明显「追不上」卡片（卡片边缘露出一条清晰带）——所以这里刻意不用 rAF。
 */
function onScroll() {
  if (window.scrollY === lastSy && window.scrollX === lastSx) return
  update()
}

function onResize() {
  measure()
}

onMounted(async () => {
  const el = layerEl.value
  if (!el) return
  host = el.parentElement
  if (!host) return
  host.classList.add('card-glass-host')
  syncEnabled()
  // 卡片是兄弟组件，此刻可能还没挂载完；等本轮渲染结束再测量，避免首屏无模糊
  await nextTick()
  measure()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize, { passive: true })
  /*
   * 容器尺寸变化 = 追加分页 / 切换图片模式（高度过渡）/ 字体加载。
   * 直接重测而不是防抖：过渡期间每帧跟随真实高度，裁剪区不会错位（防抖会让
   * 模糊区域滞后 0.2s，视觉上就是模糊「追不上」卡片）。测量只读已完成的布局，
   * 成本约 1ms，仅在布局真的变化时发生。
   */
  observer = new ResizeObserver(() => measure())
  observer.observe(host)
  // 设置里的模糊强度 / 壁纸切换会改 <html> 的变量与 class
  styleObserver = new MutationObserver(() => syncEnabled())
  styleObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  })
})

/* keep-alive 页面切回来时列表可能已经变化（例如取消收藏后返回媒体库） */
onActivated(() => {
  if (host) measure()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onResize)
  observer?.disconnect()
  observer = null
  styleObserver?.disconnect()
  styleObserver = null
  host?.classList.remove('card-glass-host')
  host = null
  rects = []
})
</script>

<style scoped>
.card-glass {
  position: fixed;
  top: -48px;
  left: -48px;
  /*
   * 尺寸与 body::before 完全一致（同一组变量、同样的 -48px 偏移）：
   * background-size: cover 的取景比例必须一模一样，否则卡片里的壁纸会与
   * 周围错位，卡片边缘会出现接缝。
   */
  width: var(--wallpaper-w, calc(100% + 96px));
  height: var(--wallpaper-h, calc(100vh + 96px));
  z-index: 0;
  pointer-events: none;
  /* 默认隐藏：只有成功算出裁剪路径后才显示。任何异常情况下都不能铺满整屏 */
  visibility: hidden;
  will-change: clip-path;
}
.card-glass__blur {
  position: absolute;
  inset: 0;
  background-image: var(--wallpaper-image);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  filter: blur(var(--card-glass-blur, 10px)) saturate(1.7);
  /* 提示独立合成：内容不变时模糊结果可整块复用，不随裁剪重算 */
  will-change: filter;
}
</style>
