<template>
  <div class="player-view">
    <div class="back">
      <button class="back-btn" title="返回" @click="goBack">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
      </button>
    </div>

    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="!work" class="empty">未找到作品</div>

    <template v-else>
      <div class="header">
        <div class="cover" v-longpress="() => fav('work', work!.rj_code)">
          <img v-if="work.cover_url" :src="authedUrl(work.cover_url)" :alt="work.title" />
          <div v-else class="cover-placeholder">{{ work.rj_code }}</div>
        </div>
        <div class="info">
          <h1 class="title">{{ work.title || work.rj_code }}</h1>
          <div
            class="meta-row clickable"
            v-if="work.circle"
            @click="goCircle(work.circle)"
            v-longpress="() => fav('circle', work!.circle)"
          >
            <span class="label">社团</span><span class="value">{{ work.circle }}</span>
          </div>
          <div class="meta-row" v-if="work.release_date">
            <span class="label">发售日</span>{{ work.release_date }}
          </div>
          <div class="meta-row clickable" v-if="work.series" @click="goSeries(work.series)">
            <span class="label">系列</span><span class="value">{{ work.series }}</span>
          </div>
          <div class="meta-row" v-if="work.sales_count != null">
            <span class="label">销量</span>{{ work.sales_count.toLocaleString() }}
          </div>
          <div class="meta-row" v-if="work.actors.length">
            <span class="label">声优</span>
            <el-tag
              v-for="a in work.actors"
              :key="a"
              size="small"
              class="clickable tag-actor"
              @click="goActor(a)"
              v-longpress="() => fav('actor', a)"
              >{{ a }}</el-tag
            >
          </div>
          <div class="meta-row" v-if="work.tags.length">
            <span class="label">类型</span>
            <el-tag
              v-for="t in work.tags"
              :key="t.name + t.category"
              size="small"
              class="clickable"
              :class="{ 'tag-custom': t.category === CUSTOM_TAG, 'tag-genre': t.category !== CUSTOM_TAG }"
              @click="goTag(t.name)"
              v-longpress="() => fav('tag', t.name, t.category)"
              >{{ t.name }}</el-tag
            >
          </div>
        </div>
      </div>

      <div class="section-title">文件（{{ work.files.length }}）</div>
      <FileList
        :files="work.files"
        :rj="work.rj_code"
        :work="work"
        @open-image="openImage"
        @image-longpress="openImageActions"
      />

      <template v-if="recommendationEnabled">
        <div class="section-title">相关推荐</div>
        <div class="rec-block">
          <div v-if="recommendationsLoading" class="rec-empty">加载中…</div>
          <div v-else-if="!recommendations.length" class="rec-empty">
            暂无相关推荐，可在「设置」中开启或立即计算推荐。
          </div>
          <div
            v-else
            ref="recRef"
            class="rec"
            :class="{ dragging: recDragging }"
            @pointerdown="onRecPointerDown"
            @click.capture="onRecClickCapture"
          >
            <!-- 复用作品卡片，展示完整信息（不再展示推荐理由） -->
            <WorkCard v-for="r in recommendations" :key="r.rj_code" :work="r" class="rec-card" />
          </div>
        </div>
      </template>
    </template>

    <!-- 长按文件列表里的图片 → 在按下的位置就地弹出动作菜单（与筛选弹框同形态） -->
    <el-popover
      v-model:visible="actionVisible"
      :virtual-ref="actionVirtualRef"
      virtual-triggering
      placement="bottom-start"
      :width="170"
    >
      <ImageActions menu @pick="runImageAction" />
    </el-popover>

    <ImageViewer
      :rj="rj"
      :files="imageFiles"
      :index="imageIndex"
      @update:index="(v) => (imageIndex = v)"
      @close="imageFiles = []"
      @changed="refreshCover"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getWork, authedUrl, getRecommendations } from '../api'
import { CUSTOM_TAG } from '../api/types'
import type { WorkDetail, MediaFile, RecommendationItem } from '../api/types'
import { useLibraryStore } from '../stores/library'
import { usePlayerStore } from '../stores/player'
import { useSettingsStore } from '../stores/settings'
import { useFavorite } from '../composables/useFavorite'
import { useImageActions, type ImageActionKind } from '../composables/useImageActions'
import FileList from '../components/FileList.vue'
import ImageViewer from '../components/ImageViewer.vue'
import ImageActions from '../components/ImageActions.vue'
import WorkCard from '../components/WorkCard.vue'

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()
const player = usePlayerStore()
const settingsStore = useSettingsStore()
const { fav } = useFavorite()
const { run: runImageActionRaw } = useImageActions()

const work = ref<WorkDetail | null>(null)
const loading = ref(true)
// 图片查看器：当前作品「同一目录」的图片列表 + 正在看的下标（支持上一张/下一张）
const imageFiles = ref<MediaFile[]>([])
const imageIndex = ref(0)
const recommendations = ref<RecommendationItem[]>([])
const recommendationsLoading = ref(false)
const recommendationEnabled = ref(false)
const recRef = ref<HTMLElement | null>(null)
const recDragging = ref(false)

const rj = computed(() => String(route.params.rj))

/** 加载推荐功能开关（组件可能跨作品复用，只需加载一次）。 */
let settingsLoaded = false
async function ensureSettings(): Promise<void> {
  if (settingsLoaded) return
  try {
    const s = await settingsStore.load()
    recommendationEnabled.value = !!s?.recommendation_enabled
    settingsLoaded = true
  } catch {
    recommendationEnabled.value = false
  }
}

async function loadRecommendations() {
  recommendationsLoading.value = true
  recommendations.value = []
  try {
    const res = await getRecommendations(rj.value)
    recommendations.value = res.recommendations
  } catch {
    recommendations.value = []
  } finally {
    recommendationsLoading.value = false
  }
}

async function load() {
  loading.value = true
  work.value = null
  try {
    const [w] = await Promise.all([getWork(rj.value), ensureSettings()])
    work.value = w
    // 让底部播放条显示当前作品封面
    if (player.current && player.current.rj === rj.value) {
      player.current.work = work.value
    }
    if (recommendationEnabled.value) await loadRecommendations()
  } finally {
    loading.value = false
  }
}
load()
// 同组件内切换作品（如点击底部播放条跳转）时重新加载
watch(rj, () => load())

function goBack() {
  // 回到从媒体库点击过来的位置；无历史记录时兜底回媒体库
  if (window.history.state?.back) router.back()
  else router.push({ name: 'library' })
}
function goCircle(name: string) {
  library.addCondition('circle', name)
  router.push({ name: 'library' })
}
function goSeries(name: string) {
  library.addCondition('series', name)
  router.push({ name: 'library' })
}
function goActor(name: string) {
  library.addCondition('actor', name)
  router.push({ name: 'library' })
}
function goTag(name: string) {
  library.addCondition('tag', name)
  router.push({ name: 'library' })
}
/** 文件所在目录（rel_path 去掉文件名）。 */
function dirOf(f: MediaFile): string {
  const i = f.rel_path.lastIndexOf('/')
  return i >= 0 ? f.rel_path.slice(0, i) : ''
}

function openImage(f: MediaFile) {
  // 只在「被点图片的同一目录」内左右切换，不跨目录收集整个作品
  const dir = dirOf(f)
  const list = (work.value?.files || []).filter(
    (x) => x.is_dir !== 1 && x.kind === 'image' && dirOf(x) === dir
  )
  const idx = list.findIndex((x) => x.id === f.id)
  imageFiles.value = list
  imageIndex.value = idx >= 0 ? idx : 0
}

// ---- 图片动作：设为封面 / 桌面壁纸 / 移动壁纸 ----
/** 长按图片时待选的动作目标 */
const actionTarget = ref<MediaFile | null>(null)
/** 动作菜单是否显示 */
const actionVisible = ref(false)
/** 长按按下的位置（视口坐标），用作 popover 的虚拟触发点 */
const actionPos = ref({ x: 0, y: 0 })

/** el-popover 的虚拟触发点：一个零尺寸矩形，定位在长按处。 */
const actionVirtualRef = computed(() => ({
  getBoundingClientRect: () =>
    ({
      top: actionPos.value.y,
      left: actionPos.value.x,
      bottom: actionPos.value.y,
      right: actionPos.value.x,
      x: actionPos.value.x,
      y: actionPos.value.y,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    }) as DOMRect,
}))

function openImageActions(f: MediaFile, ev?: PointerEvent) {
  actionTarget.value = f
  if (ev) actionPos.value = { x: ev.clientX, y: ev.clientY }
  actionVisible.value = true
}

/** 动作改动后给封面 URL 加时间戳，让页面上的封面立即刷新（缓存击穿）。 */
function refreshCover() {
  if (work.value) work.value.cover_url = `/api/cover/${work.value.rj_code}?v=${Date.now()}`
}

/** 菜单里选中动作后执行，随后刷新封面。 */
async function runImageAction(kind: ImageActionKind) {
  const f = actionTarget.value
  actionVisible.value = false // 先收起菜单，再弹二次确认
  if (!f || !work.value) return
  if (await runImageActionRaw(kind, work.value.rj_code, f)) refreshCover()
}

/**
 * 推荐卡片用 WorkCard 渲染（点击即跳转），拖拽滑动时需吞掉随之而来的 click。
 * 用捕获阶段拦截：拖拽结束的 pointerup 与 click 在同一帧内先后触发，
 * 而 recDragging 要等 setTimeout(0) 才复位，因此这里读到的仍是 true。
 */
function onRecClickCapture(e: MouseEvent) {
  if (!recDragging.value) return
  e.stopPropagation()
  e.preventDefault()
}

/** 推荐条鼠标拖拽滑动（触屏走原生滚动），与媒体库「最近播放」一致。 */
function onRecPointerDown(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || e.button !== 0) return
  const el = recRef.value
  if (!el) return
  const pointerId = e.pointerId
  const startX = e.clientX
  const startScroll = el.scrollLeft
  let moved = false
  let captured = false

  const cleanup = () => {
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onCancel)
    if (captured) {
      try {
        el.releasePointerCapture(pointerId)
      } catch {
        /* 忽略 */
      }
    }
    if (moved) {
      // 拖拽结束后的 click 应被吞掉；等本次 click 派发完再复位标志
      setTimeout(() => {
        recDragging.value = false
      }, 0)
    }
  }
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    const dx = ev.clientX - startX
    if (!moved && Math.abs(dx) > 5) {
      moved = true
      recDragging.value = true
      // 超过阈值后再捕获，保证拖出容器/窗口也能收到 pointerup，且不影响普通点击
      try {
        el.setPointerCapture(pointerId)
        captured = true
      } catch {
        /* 忽略 */
      }
    }
    if (moved) el.scrollLeft = startScroll - dx
  }
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    cleanup()
  }
  const onCancel = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    cleanup()
  }

  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onCancel)
}
</script>

<style scoped>
.player-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.back {
  margin-bottom: 4px;
}
/* 返回：圆形图标按钮 + 底色（无文字） */
.back-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
  backdrop-filter: blur(var(--control-blur));
}
.back-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(34, 38, 45, 0.65);
}
.header {
  display: flex;
  gap: 24px;
  /* 作品信息区加一层主题底色，避免文字直接压在壁纸上看不清 */
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px;
  backdrop-filter: blur(var(--card-blur));
}
.cover {
  width: 220px;
  aspect-ratio: 1 / 1;
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
  background: #0d0f12;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
}
.info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.title {
  margin: 0 0 6px;
  font-size: 24px;
  font-weight: 700;
}
.meta-row {
  font-size: 15px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.label {
  color: var(--muted);
}
.clickable {
  cursor: pointer;
}
/*
 * 声优 / 类型标签配色：与作品卡片保持一致（可在设置里改）。
 * 通过覆盖 Element Plus 的标签 CSS 变量实现，其余（尺寸/圆角）沿用组件样式。
 */
.tag-actor {
  --el-tag-bg-color: var(--tag-actor-bg);
  --el-tag-text-color: var(--tag-actor-fg);
  --el-tag-border-color: transparent;
}
.tag-genre {
  --el-tag-bg-color: var(--tag-genre-bg);
  --el-tag-text-color: var(--tag-genre-fg);
  --el-tag-border-color: transparent;
}
/* 标签同享控件磨砂：底色已是半透明，这里补上背景模糊 */
.tag-actor,
.tag-genre {
  backdrop-filter: blur(var(--control-blur));
}
.meta-row.clickable:hover {
  color: var(--accent);
}
.section-title {
  font-size: 16px;
  font-weight: 600;
  margin-top: 8px;
}
.empty {
  padding: 60px 0;
  text-align: center;
  color: var(--muted);
}
.rec-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rec {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.rec.dragging {
  cursor: grabbing;
  user-select: none;
  scroll-behavior: auto;
}
/* 推荐卡片：固定宽度（跟随卡片尺寸设置），横向滚动 */
.rec-card {
  flex: 0 0 var(--card-min-width);
}
.rec-empty {
  padding: 20px 0;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
}
@media (max-width: 640px) {
  .header {
    flex-direction: column;
  }
  .cover {
    width: 160px;
  }
}
</style>
