<template>
  <div class="player-view">
    <div class="back">
      <el-button @click="goBack" text>← 返回</el-button>
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
          <div class="meta-row" v-if="work.series">
            <span class="label">系列</span>{{ work.series }}
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
              class="clickable"
              type="warning"
              @click="goActor(a)"
              v-longpress="() => fav('actor', a)"
              >{{ a }}</el-tag
            >
          </div>
          <div class="tags" v-if="work.tags.length">
            <el-tag
              v-for="t in work.tags"
              :key="t.name + t.category"
              size="small"
              class="clickable"
              :class="{ 'tag-custom': t.category === CUSTOM_TAG }"
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
        @set-cover="onSetCover"
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
          >
            <div v-for="r in recommendations" :key="r.rj_code" class="rec-item" @click="onRecItemClick(r.rj_code)">
              <div class="rec-cover">
                <img v-if="r.cover_url" :src="authedUrl(r.cover_url)" :alt="r.title" draggable="false" />
                <div v-else class="no-cover">{{ r.rj_code }}</div>
              </div>
              <div class="rec-name" :title="r.title || r.rj_code">{{ r.title || r.rj_code }}</div>
              <div class="rec-reason" :title="recReasonText(r)">{{ recReasonText(r) }}</div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <ImageViewer :url="imageUrl" @close="imageUrl = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getWork, mediaUrl, authedUrl, setWorkCover, getRecommendations } from '../api'
import { CUSTOM_TAG } from '../api/types'
import type { WorkDetail, MediaFile, RecommendationItem } from '../api/types'
import { useLibraryStore } from '../stores/library'
import { usePlayerStore } from '../stores/player'
import { useSettingsStore } from '../stores/settings'
import { useFavorite } from '../composables/useFavorite'
import FileList from '../components/FileList.vue'
import ImageViewer from '../components/ImageViewer.vue'

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()
const player = usePlayerStore()
const settingsStore = useSettingsStore()
const { fav } = useFavorite()

const work = ref<WorkDetail | null>(null)
const loading = ref(true)
const imageUrl = ref<string | null>(null)
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
function goActor(name: string) {
  library.addCondition('actor', name)
  router.push({ name: 'library' })
}
function goTag(name: string) {
  library.addCondition('tag', name)
  router.push({ name: 'library' })
}
function openImage(f: MediaFile) {
  imageUrl.value = mediaUrl(rj.value, f.id)
}

/** 长按图片文件 → 设为该作品封面 */
async function onSetCover(f: MediaFile) {
  try {
    await ElMessageBox.confirm(
      `将「${f.filename}」设为当前作品的封面？`,
      '设为封面',
      { type: 'warning', confirmButtonText: '设为封面', cancelButtonText: '取消' }
    )
  } catch {
    return // 用户取消
  }
  try {
    await setWorkCover(rj.value, f.id)
    // 缓存击穿：给封面 URL 加时间戳，让页面上的封面立即刷新
    if (work.value) work.value.cover_url = `/api/cover/${rj.value}?v=${Date.now()}`
    ElMessage.success('已设为封面')
  } catch (e) {
    ElMessage.error('设置封面失败: ' + (e as Error).message)
  }
}

function goWork(rjCode: string) {
  router.push({ name: 'player', params: { rj: rjCode } })
}

const REASON_META: Record<string, { icon: string; label: string }> = {
  series: { icon: '📚', label: '同系列' },
  voice: { icon: '🎙', label: '声优相似' },
  tag: { icon: '🏷', label: '标签相似' },
  title: { icon: '✏️', label: '标题相似' },
  circle: { icon: '🏢', label: '同社团' },
}

/** 推荐原因的简短展示：由后端算出的「主因维度」决定（系列 > 标签/声优/标题/社团）。 */
function recReasonText(r: RecommendationItem): string {
  const dims = r.reason.mainReasons?.filter((d) => REASON_META[d]) ?? []
  if (dims.length) return dims.map((d) => `${REASON_META[d].icon} ${REASON_META[d].label}`).join(' · ')
  // 兜底（旧数据）：按同声优 / 同标签 / 同社团依次回退
  if (r.reason.sameSeries) return '📚 同系列'
  if (r.reason.sharedVoiceActors.length) return `🎙 同声优：${r.reason.sharedVoiceActors.join('、')}`
  if (r.reason.sharedTags.length) return `🏷 同标签：${r.reason.sharedTags.join('、')}`
  if (r.reason.sameCircle) return `🏢 同社团：${r.circle}`
  return ''
}

function onRecItemClick(rjCode: string) {
  if (recDragging.value) return
  goWork(rjCode)
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
.header {
  display: flex;
  gap: 24px;
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
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.clickable {
  cursor: pointer;
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
.rec-item {
  width: 140px;
  flex-shrink: 0;
  cursor: pointer;
}
.rec-cover {
  width: 140px;
  height: 140px;
  border-radius: 8px;
  overflow: hidden;
  background: #0d0f12;
  margin-bottom: 6px;
}
.rec-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.no-cover {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 11px;
}
.rec-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rec-reason {
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
