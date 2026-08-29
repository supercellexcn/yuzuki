<template>
  <Teleport to="body">
    <div v-if="player.fullscreenVisible" class="fs-player" :class="{ closing }" :style="dragStyle">
      <!-- 顶部下拉把手 + 封面都可按住下滑退出 -->
      <div class="fs-handle" @pointerdown="(e) => startDrag(e, 'handle')">
        <span class="fs-grabber" />
      </div>

      <!-- 大封面：正常摆放、背景统一无黑边；按住下滑退出，轻触切换播放/暂停 -->
      <div class="fs-cover" @pointerdown="(e) => startDrag(e, 'cover')" @click="onCoverClick">
        <img v-if="coverUrl" :src="coverUrl" :alt="player.fullscreenWork?.title || ''" class="fs-main" />
        <div v-else class="fs-no-cover">{{ player.fullscreenRj }}</div>
        <div v-if="!inThisWork" class="tap-hint">▶ 轻触封面开始播放</div>
      </div>

      <!-- 作品信息：社团 / 声优 / 类型标签（点击跳转到媒体库并套用筛选） -->
      <div class="fs-info" v-if="workTitle || circle || actors.length || tags.length">
        <div class="fs-title">{{ workTitle }}</div>
        <div class="fs-meta-row clickable" v-if="circle" @click="goFilter('circle', circle)">
          <span class="fs-label">社团</span><span class="fs-value">{{ circle }}</span>
        </div>
        <div class="fs-chips" v-if="actors.length">
          <span
            v-for="a in actors.slice(0, 6)"
            :key="'a' + a"
            class="fs-chip chip-actor clickable"
            @click="goFilter('actor', a)"
            >{{ a }}</span
          >
        </div>
        <div class="fs-chips" v-if="tags.length">
          <span
            v-for="t in tags.slice(0, 8)"
            :key="'t' + t.name + t.category"
            class="fs-chip clickable"
            @click="goFilter('tag', t.name)"
            >{{ t.name }}</span
          >
        </div>
      </div>

      <!-- 控件（靠下） -->
      <div class="fs-controls">
        <div class="fs-row">
          <el-button size="small" @click="playlistVisible = true">☰ 播放列表</el-button>
          <el-button size="small" :type="isWorkFav ? 'danger' : 'default'" @click="onToggleFav">
            {{ isWorkFav ? '♥ 已收藏' : '♡ 收藏' }}
          </el-button>
          <el-button size="small" @click="goDetail">⛶ 跳转详情</el-button>
        </div>

        <div class="fs-progress">
          <el-slider
            :model-value="player.currentTime"
            :max="player.duration || 1"
            :step="0.1"
            :show-tooltip="false"
            @input="onSeek"
          />
          <div class="fs-times">
            <span>{{ fmt(player.currentTime) }}</span>
            <span>{{ fmt(player.duration) }}</span>
          </div>
        </div>

        <div class="fs-filename" :title="player.current?.file.filename || ''">
          {{ player.current?.file.filename || '未开始播放' }}
        </div>

        <!-- 与桌面端一致的播放/暂停/上/下/快进/快退/重复播放（重复在最左） -->
        <div class="fs-ctrl-row">
          <button
            class="fbtn"
            :class="{ active: player.loop }"
            :title="player.loop ? '重复播放（开）' : '重复播放（关）'"
            @click="player.toggleLoop()"
          >
            🔁
          </button>
          <button class="fbtn" title="上一曲" @click="player.prev()">⏮</button>
          <button class="fbtn" :title="`快退 ${seekSecs} 秒`" @click="player.seekBy(-seekSecs)">-{{ seekSecs }}</button>
          <button class="fbtn main" :title="player.playing ? '暂停' : '播放'" @click="player.toggle()">
            <PlayPauseIcon :playing="player.playing" />
          </button>
          <button class="fbtn" :title="`快进 ${seekSecs} 秒`" @click="player.seekBy(seekSecs)">+{{ seekSecs }}</button>
          <button class="fbtn" title="下一曲" @click="player.next()">⏭</button>
        </div>

        <div class="fs-volume">
          <span class="vol-icon">🔊</span>
          <el-slider :model-value="player.volume * 100" :max="100" @input="onVolume" />
        </div>
      </div>

      <!-- 播放列表：只含当前播放文件同目录的可播放文件 -->
      <div v-if="playlistVisible" class="pl-panel">
        <div class="pl-head">
          <span class="pl-title">播放列表</span>
          <button class="pl-close" @click="playlistVisible = false">✕</button>
        </div>
        <div class="pl-list">
          <div
            v-for="f in playableFiles"
            :key="f.id"
            class="pl-item"
            :class="{ playing: isCurrent(f) }"
            @click="playFromList(f)"
          >
            <span class="pl-kind">{{ icon(f.kind) }}</span>
            <span class="pl-name">{{ f.filename }}</span>
          </div>
          <div v-if="!playableFiles.length" class="pl-empty">当前目录没有可播放文件</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePlayerStore } from '../stores/player'
import { useSettingsStore } from '../stores/settings'
import { useFavoritesStore } from '../stores/favorites'
import { useLibraryStore } from '../stores/library'
import { useFavorite } from '../composables/useFavorite'
import { authedUrl } from '../api'
import PlayPauseIcon from './PlayPauseIcon.vue'
import type { MediaFile, FilterCondType } from '../api/types'

const player = usePlayerStore()
const settings = useSettingsStore()
const router = useRouter()
const favorites = useFavoritesStore()
const library = useLibraryStore()
const { fav } = useFavorite()

const playlistVisible = ref(false)
const seekSecs = computed(() => settings.settings?.seek_seconds || 15)
const coverUrl = computed(() =>
  authedUrl(player.fullscreenWork?.cover_url || player.current?.work?.cover_url || '')
)
const workTitle = computed(() => player.fullscreenWork?.title || player.fullscreenRj)
const circle = computed(() => player.fullscreenWork?.circle || '')
const actors = computed(() => player.fullscreenWork?.actors || [])
const tags = computed(() => player.fullscreenWork?.tags || [])
const isWorkFav = computed(() => favorites.isFav('work', player.fullscreenRj))
const inThisWork = computed(() => player.current?.rj === player.fullscreenRj)

// 播放列表 = 当前播放文件同目录的可播放文件
const currentDir = computed(() => {
  const cur = player.current
  if (!cur || cur.rj !== player.fullscreenRj) return null
  const i = cur.file.rel_path.lastIndexOf('/')
  return i >= 0 ? cur.file.rel_path.slice(0, i) : ''
})
const playableFiles = computed(() =>
  player.fullscreenFiles.filter((f) => {
    if (f.is_dir === 1 || (f.kind !== 'audio' && f.kind !== 'video')) return false
    const d = currentDir.value
    if (d === null) return true
    const i = f.rel_path.lastIndexOf('/')
    return (i >= 0 ? f.rel_path.slice(0, i) : '') === d
  })
)

// ---- 下拉关闭：顶部把手 + 封面区域都可按住下滑 ----
const DRAG_CLOSE_THRESHOLD = 100
const dragDy = ref(0)
const dragging = ref(false)
const closing = ref(false)
const swallowClick = ref(false)
const dragStyle = computed(() =>
  dragging.value ? { transform: `translateY(${dragDy.value}px)`, transition: 'none' } : {}
)

function startDrag(e: PointerEvent, source: 'handle' | 'cover') {
  if (e.button !== 0) return
  dragging.value = true
  const startY = e.clientY
  let dragged = false
  const onMove = (ev: PointerEvent) => {
    const dy = ev.clientY - startY
    if (dy > 8) dragged = true
    if (dy > 0) {
      dragDy.value = dy
      dragging.value = true
    }
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    if (dragged) {
      // 仅封面拖动才吞 click（封面有 @click 播放切换）；把手没有 click 处理器不需要吞
      if (source === 'cover') {
        swallowClick.value = true
        // 触屏拖动后浏览器通常不派发 click，标志会残留 → 定时复位
        setTimeout(() => {
          swallowClick.value = false
        }, 300)
      }
      if (dragDy.value > DRAG_CLOSE_THRESHOLD) closeWithAnimation()
      else {
        dragging.value = false
        dragDy.value = 0
      }
    } else {
      dragging.value = false
      dragDy.value = 0
    }
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

/** 轻触封面：切换播放/暂停（若被拖动判定则忽略）。 */
function onCoverClick() {
  if (swallowClick.value) {
    swallowClick.value = false
    return
  }
  player.playFirstOrToggle(playableFiles.value)
}

/** 先移除内联 transform（让出过渡动画），再套 closing 类从当前位置滑出屏幕。 */
function closeWithAnimation() {
  dragging.value = false
  closing.value = true
  setTimeout(() => {
    player.closeFullscreen()
    closing.value = false
    dragDy.value = 0
  }, 180)
}

function onToggleFav() {
  void fav('work', player.fullscreenRj)
}

onMounted(() => {
  if (!settings.settings) settings.load().catch(() => {})
})

function onSeek(v: number | number[]) {
  player.seek(Array.isArray(v) ? v[0] : v)
}
function onVolume(v: number | number[]) {
  player.setVolume((Array.isArray(v) ? v[0] : v) / 100)
}
function playFromList(f: MediaFile) {
  player.play(player.fullscreenRj, f, player.fullscreenWork, playableFiles.value)
}
function isCurrent(f: MediaFile): boolean {
  return player.current?.file.id === f.id
}
function goDetail() {
  player.closeFullscreen()
  router.push({ name: 'player', params: { rj: player.fullscreenRj } })
}

/** 点击社团/声优/标签 → 关闭全屏播放器并回媒体库套用筛选条件。 */
function goFilter(type: FilterCondType, value: string) {
  library.addCondition(type, value)
  player.closeFullscreen()
  router.push({ name: 'library' })
}
function icon(kind: string): string {
  return { audio: '♪', video: '▶' }[kind] || '·'
}
function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<style scoped>
.fs-player {
  position: fixed;
  inset: 0;
  background: var(--bg);
  z-index: 300;
  display: flex;
  flex-direction: column;
  transition: transform 0.18s ease;
}
.fs-player.closing {
  transform: translateY(100vh);
}
/* 顶部下拉把手：明显的小横条 */
.fs-handle {
  flex-shrink: 0;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  touch-action: none;
}
.fs-handle:active {
  cursor: grabbing;
}
.fs-grabber {
  width: 80px;
  height: 6px;
  border-radius: 3px;
  background: #f0f2f5; /* 与深色背景取反的近白色 */
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
/* 大封面：正常摆放，背景与整页一致，无黑边 */
.fs-cover {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
  touch-action: none;
}
.fs-main {
  max-width: 96%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}
.fs-no-cover {
  color: var(--muted);
  font-size: 16px;
  font-family: Consolas, monospace;
}
.tap-hint {
  position: absolute;
  bottom: 14px;
  left: 0;
  right: 0;
  text-align: center;
  color: var(--accent);
  font-size: 13px;
  padding: 6px;
  background: rgba(0, 0, 0, 0.4);
}
/* 作品信息区：填充封面与控件之间的空隙 */
.fs-info {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 20px 10px;
}
.fs-title {
  font-size: 16px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fs-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.fs-label {
  color: var(--muted);
  flex-shrink: 0;
}
.fs-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fs-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.fs-chip {
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 10px;
  background: #262b33;
  color: #c3cbd7;
}
.fs-chip.chip-actor {
  background: #2a3040;
  color: #9db8e6;
}
.clickable {
  cursor: pointer;
}
.fs-meta-row.clickable:hover .fs-value {
  color: var(--accent);
}
.fs-chip.clickable:hover {
  background: var(--accent);
  color: #0b0e12;
}
/* 控件：整体靠下 */
.fs-controls {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 20px 26px;
}
.fs-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.fs-progress {
  min-width: 0;
}
.fs-times {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted);
  margin-top: -4px;
}
.fs-filename {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fs-ctrl-row {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}
.fbtn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 50%;
  width: 44px;
  height: 44px;
  cursor: pointer;
  font-size: 14px;
  flex-shrink: 0;
  transition: all 0.12s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.fbtn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.fbtn.active {
  border-color: var(--accent);
  background: #22314a;
  color: var(--accent);
}
.fbtn.main {
  background: var(--accent);
  border-color: var(--accent);
  color: #0b0e12;
  width: 46px;
  height: 46px;
}
.fs-volume {
  display: flex;
  align-items: center;
  gap: 10px;
}
.vol-icon {
  flex-shrink: 0;
}
.fs-volume :deep(.el-slider) {
  flex: 1;
}
/* 播放列表弹层 */
.pl-panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 55%;
  background: #1b1e24;
  border-top: 1px solid var(--border);
  border-radius: 12px 12px 0 0;
  display: flex;
  flex-direction: column;
  z-index: 6;
}
.pl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.pl-title {
  font-weight: 600;
  font-size: 15px;
}
.pl-close {
  background: transparent;
  border: none;
  color: var(--muted);
  font-size: 15px;
  cursor: pointer;
}
.pl-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
}
.pl-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}
.pl-item:hover {
  background: #22262d;
}
.pl-item.playing {
  background: #1e2b3d;
  color: var(--accent);
}
.pl-kind {
  color: var(--muted);
  width: 18px;
  text-align: center;
  flex-shrink: 0;
}
.pl-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pl-empty {
  padding: 30px 0;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
</style>
