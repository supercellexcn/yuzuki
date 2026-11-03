<template>
  <div
    v-show="ready"
    ref="dockRef"
    class="mobile-dock"
    :class="{ dragging }"
    :style="{ left: x + 'px', top: y + 'px' }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @click.capture="onClickCapture"
  >
    <button class="dock-btn" title="返回首页" @click="goHome">
      <SidebarIcon name="home" />
    </button>
    <button class="dock-btn" title="回到顶部" @click="scrollTop">T</button>
    <button
      class="dock-btn"
      :class="{ active: imageOnly }"
      :title="imageOnly ? '退出图片模式' : '图片模式（只显示图片）'"
      @click="toggleImageOnly"
    >
      M
    </button>
    <button
      class="dock-btn"
      :class="{ active: library.randomMode }"
      :disabled="library.randomLoading"
      title="随机推荐"
      @click="onRandom"
    >
      R
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLibraryStore } from '../stores/library'
import { useViewMode } from '../composables/useViewMode'
import SidebarIcon from './SidebarIcon.vue'

/**
 * 移动端悬浮快捷按钮（返回首页 / T / M / R）。
 * 可拖动，松手后自动吸附到最近的一侧；纵向位置保留，记在 localStorage。
 */

const DOCK_W = 46
const DOCK_H = 166
const EDGE = 10
const STORAGE_KEY = 'yuzuki_mobile_dock'

const router = useRouter()
const route = useRoute()
const library = useLibraryStore()
const { imageOnly, toggleImageOnly } = useViewMode()

const dockRef = ref<HTMLElement | null>(null)
const ready = ref(false)
const dragging = ref(false)
const side = ref<'left' | 'right'>('right')
const x = ref(0)
const y = ref(0)

let pointerId = -1
let moved = false
let startX = 0
let startY = 0
let startLeft = 0
let startTop = 0
let suppressClickUntil = 0

function sideX(kind: 'left' | 'right'): number {
  return kind === 'left' ? EDGE : Math.max(EDGE, window.innerWidth - DOCK_W - EDGE)
}
function clampY(v: number): number {
  const max = Math.max(EDGE, window.innerHeight - DOCK_H - EDGE)
  return Math.min(Math.max(v, EDGE), max)
}
function syncPosition() {
  x.value = sideX(side.value)
  y.value = clampY(y.value)
}
function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const o = JSON.parse(raw) as { side?: string; top?: number }
    if (o.side === 'left' || o.side === 'right') side.value = o.side
    if (Number.isFinite(o.top)) y.value = Number(o.top)
  } catch {
    /* 忽略 */
  }
}
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ side: side.value, top: Math.round(y.value) }))
  } catch {
    /* 忽略 */
  }
}

onMounted(() => {
  readState()
  if (!y.value) y.value = Math.round(window.innerHeight * 0.5 - DOCK_H / 2)
  syncPosition()
  ready.value = true
  window.addEventListener('resize', syncPosition)
})
onUnmounted(() => window.removeEventListener('resize', syncPosition))

function onPointerDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const el = dockRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  x.value = r.left
  y.value = r.top
  startX = e.clientX
  startY = e.clientY
  startLeft = r.left
  startTop = r.top
  moved = false
  pointerId = e.pointerId
  try {
    el.setPointerCapture(e.pointerId)
  } catch {
    /* 忽略 */
  }
}

function onPointerMove(e: PointerEvent) {
  if (e.pointerId !== pointerId) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (!moved && Math.hypot(dx, dy) < 5) return
  moved = true
  dragging.value = true
  x.value = Math.min(Math.max(startLeft + dx, 6), window.innerWidth - DOCK_W - 6)
  y.value = clampY(startTop + dy)
}

function onPointerUp(e: PointerEvent) {
  if (e.pointerId !== pointerId) return
  dragEnd(e)
}
function dragEnd(e: PointerEvent) {
  if (moved) {
    side.value = x.value + DOCK_W / 2 < window.innerWidth / 2 ? 'left' : 'right'
    syncPosition()
    saveState()
    // 拖动结束后吞掉随之而来的 click，避免误触按钮
    suppressClickUntil = Date.now() + 350
  }
  dragging.value = false
  moved = false
  pointerId = -1
  try {
    dockRef.value?.releasePointerCapture(e.pointerId)
  } catch {
    /* 忽略 */
  }
}
function onClickCapture(e: MouseEvent) {
  if (Date.now() < suppressClickUntil) {
    e.preventDefault()
    e.stopPropagation()
  }
}

function goHome() {
  router.push({ name: 'library' })
}
function scrollTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
function onRandom() {
  void library.toggleRandom()
  if (route.name !== 'library') router.push({ name: 'library' })
}
</script>

<style scoped>
.mobile-dock {
  position: fixed;
  z-index: 210;
  width: 46px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 999px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  transition: left calc(var(--anim-duration) * 1.2) ease, top calc(var(--anim-duration) * 1.2) ease;
}
.mobile-dock.dragging {
  transition: none;
  cursor: grabbing;
}
.dock-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: none;
  transition: background var(--anim-duration), color var(--anim-duration);
}
.dock-btn:hover,
.dock-btn:active {
  background: var(--accent-soft);
  color: var(--accent);
}
.dock-btn.active {
  background: var(--accent);
  color: var(--accent-fg);
}
.dock-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
