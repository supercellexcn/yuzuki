<template>
  <div class="library">
    <!-- 工具栏 -->
    <div class="toolbar">
      <SearchBar :model-value="store.q" @search="store.setQuery" />
      <el-select v-model="sort" size="large" style="width: 150px" @change="onSortChange">
        <el-option v-for="o in SORT_OPTIONS" :key="o.value" :value="o.value" :label="o.label" />
      </el-select>
      <el-select v-model="order" size="large" style="width: 92px" @change="store.setOrder">
        <el-option value="desc" label="降序" />
        <el-option value="asc" label="升序" />
      </el-select>
      <el-button
        size="large"
        :loading="store.randomLoading"
        @click="store.toggleRandom()"
      >
        🎲 随机
      </el-button>
      <span class="count">
        {{ store.randomMode ? `随机推荐 ${store.randomItems.length} 个` : `共 ${store.total} 个作品` }}
      </span>
    </div>

    <!-- 筛选条件入口（标签墙） -->
    <div class="menus">
      <FilterMenu
        label="全部社团"
        :items="circles"
        :active-values="activeOf('circle')"
        fav-type="circle"
        @select="(v) => addCond('circle', v)"
      />
      <FilterMenu
        label="全部系列"
        :items="series"
        :active-values="activeOf('series')"
        @select="(v) => addCond('series', v)"
      />
      <FilterMenu
        label="全部声优"
        :items="actors"
        :active-values="activeOf('actor')"
        fav-type="actor"
        @select="(v) => addCond('actor', v)"
      />
      <FilterMenu
        label="全部标签"
        :items="tags"
        :active-values="activeOf('tag')"
        fav-type="tag"
        @select="(v) => addCond('tag', v)"
      />
      <el-button plain @click="goFavorites">⭐ 我的收藏</el-button>
      <el-button v-if="store.hasFilter" size="small" @click="store.clearFilter()">清除筛选</el-button>
    </div>

    <!-- 已选条件 -->
    <div v-if="store.conditions.length || store.q" class="active-conds">
      <el-tag v-if="store.q" closable @close="store.setQuery('')">搜索: {{ store.q }}</el-tag>
      <el-tag
        v-for="(c, i) in store.conditions"
        :key="i"
        closable
        :type="tagType(c.type)"
        @close="store.removeConditionAt(i)"
      >
        {{ typeLabel(c.type) }}: {{ c.value }}
      </el-tag>
    </div>

    <!-- 最近播放 -->
    <div v-if="recentPlays.length" class="recent-block">
      <div class="recent-head">
        <span class="recent-title">最近播放</span>
        <span class="recent-all" @click="goHistory">全部历史 ›</span>
      </div>
      <div ref="recentRef" class="recent" @scroll="onRecentScroll" @pointerdown="onRecentPointerDown">
        <div v-for="p in recentPlays" :key="p.id" class="recent-item" @click="onRecentItemClick(p.rj_code)">
          <div class="recent-cover">
            <img v-if="p.cover_url" :src="authedUrl(p.cover_url)" :alt="p.title" draggable="false" />
            <div v-else class="no-cover">{{ p.rj_code }}</div>
          </div>
          <div class="recent-name" :title="p.title || p.rj_code">{{ p.title || p.rj_code }}</div>
        </div>
      </div>
    </div>

    <!-- 列表主体 -->
    <div v-if="store.loading && !displayItems.length && !store.randomMode" class="empty">加载中…</div>
    <div v-else-if="!displayItems.length" class="empty">
      <template v-if="store.hasFilter">没有匹配的作品</template>
      <template v-else>暂无作品，请先在「设置」中配置 ASMR 源路径并扫描。</template>
    </div>

    <div v-else ref="gridRef" class="grid">
      <WorkCard
        v-for="w in displayItems"
        :key="w.id"
        :work="w"
        @select-circle="(v) => addCond('circle', v)"
        @select-series="(v) => addCond('series', v)"
        @select-actor="(v) => addCond('actor', v)"
        @select-tag="(v) => addCond('tag', v)"
      />
    </div>

    <div v-if="displayItems.length && !store.randomMode" class="end-tip">
      <span v-if="store.loading && store.hasMore" class="loading">加载中…</span>
      <span v-else-if="store.loaded && !store.hasMore">—— 已经加载所有 ——</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onActivated, onDeactivated } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getLastFromRoute } from '../router'
import { useLibraryStore, SORT_OPTIONS, type SortKey } from '../stores/library'
import { useAuthStore } from '../stores/auth'
import { getTags, getActors, getCircles, getSeries, getRecentPlays, authedUrl } from '../api'
import type { TagCount, ActorCount, CircleCount, SeriesCount, PlayRecord, FilterCondType } from '../api/types'
import SearchBar from '../components/SearchBar.vue'
import WorkCard from '../components/WorkCard.vue'
import FilterMenu from '../components/FilterMenu.vue'

const store = useLibraryStore()
const auth = useAuthStore()
const router = useRouter()

const sort = ref<SortKey>(store.sort)
const order = ref<'asc' | 'desc'>(store.order)
const circles = ref<CircleCount[]>([])
const series = ref<SeriesCount[]>([])
const actors = ref<ActorCount[]>([])
const tags = ref<TagCount[]>([])
const recentPlays = ref<PlayRecord[]>([])
const gridRef = ref<HTMLElement | null>(null)
const recentRef = ref<HTMLElement | null>(null)

const displayItems = computed(() => (store.randomMode ? store.randomItems : store.items))

function activeOf(type: FilterCondType): string[] {
  return store.conditions.filter((c) => c.type === type).map((c) => c.value)
}
function addCond(type: FilterCondType, v: string) {
  const ok = store.addCondition(type, v)
  if (!ok) ElMessage.warning('最多 5 个筛选条件')
}
function typeLabel(t: FilterCondType): string {
  return { circle: '社团', series: '系列', actor: '声优', tag: '标签' }[t]
}
function tagType(t: FilterCondType): 'success' | 'primary' | 'warning' | 'info' {
  return t === 'circle' ? 'success' : t === 'series' ? 'primary' : t === 'actor' ? 'warning' : 'info'
}
function onSortChange(v: SortKey) {
  store.setSort(v)
}
function goWork(rj: string) {
  router.push({ name: 'player', params: { rj } })
}
function goHistory() {
  router.push({ name: 'history' })
}
function goFavorites() {
  router.push({ name: 'favorites' })
}

async function loadLists() {
  try {
    const [c, s, a, t] = await Promise.all([getCircles(), getSeries(), getActors(), getTags()])
    circles.value = c
    series.value = s
    actors.value = a
    tags.value = t
  } catch {
    /* 忽略 */
  }
}
const recentLoading = ref(false)
let recentOffset = 0

async function loadRecent() {
  try {
    recentPlays.value = await getRecentPlays(10, 0)
    recentOffset = recentPlays.value.length
  } catch {
    /* 忽略 */
  }
}

/** 最近播放滑到最右侧时再往后加载 10 个（不跳转历史页）。 */
async function loadMoreRecent() {
  if (recentLoading.value) return
  recentLoading.value = true
  try {
    const more = await getRecentPlays(10, recentOffset)
    if (!more.length) return
    recentOffset += more.length
    // 播放历史可能在翻页间隙新增，按 rj 去重防止重复条目
    const seen = new Set(recentPlays.value.map((p) => p.rj_code))
    const fresh = more.filter((p) => !seen.has(p.rj_code))
    if (fresh.length) recentPlays.value = [...recentPlays.value, ...fresh]
  } catch {
    /* 忽略 */
  } finally {
    recentLoading.value = false
  }
}

function onRecentScroll() {
  const el = recentRef.value
  if (!el) return
  if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 60) {
    loadMoreRecent()
  }
}

// ---- 最近播放条拖拽滑动（仅鼠标；触屏走原生滚动） ----
const recentDragging = ref(false)
function onRecentPointerDown(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || e.button !== 0) return
  const el = recentRef.value
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
      el.classList.remove('dragging')
      // 拖拽结束后的 click 应被吞掉；等本次 click 派发完再复位标志
      setTimeout(() => {
        recentDragging.value = false
      }, 0)
    }
  }
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    const dx = ev.clientX - startX
    if (!moved && Math.abs(dx) > 5) {
      moved = true
      recentDragging.value = true
      el.classList.add('dragging')
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
function onRecentItemClick(rj: string) {
  if (recentDragging.value) return
  goWork(rj)
}

let raf = 0
function onScroll() {
  store.rememberScroll(window.scrollY)
  const doc = document.documentElement
  if (window.innerHeight + window.scrollY >= doc.scrollHeight - 300 && !store.randomMode) {
    store.loadMore()
  }
  if (!raf) {
    raf = requestAnimationFrame(() => {
      raf = 0
      rememberTopWork()
    })
  }
}

/** 记录视口内最靠上的卡片，用于下次登录定位 */
function rememberTopWork() {
  const grid = gridRef.value
  if (!grid || store.randomMode) return
  const cards = grid.querySelectorAll<HTMLElement>('.work-card')
  for (const el of cards) {
    if (el.getBoundingClientRect().bottom > 0) {
      const id = Number(el.id.replace('wc-', ''))
      store.rememberTopWork(id || null)
      return
    }
  }
}

async function onActivate() {
  window.addEventListener('scroll', onScroll, { passive: true })
  if (recentRef.value) recentRef.value.scrollLeft = 0
  loadLists()
  // 从播放器返回：保留已加载列表与滚动位置（播放器不会改动库内容）。
  // 其他来源（管理功能、历史、收藏、设置等）返回：始终重新拉取，
  // 保证隐藏/取消隐藏等管理操作立即生效，不再显示旧数据。
  if (getLastFromRoute() === 'player' && store.loaded) {
    // 返回媒体库：先恢复滚动，等最近播放行渲染后再校准一次
    window.scrollTo(0, store.scrollTop)
    await loadRecent()
    await nextTick()
    window.scrollTo(0, store.scrollTop)
  } else {
    if (!store.loaded) store.applyPrefs(auth.user?.prefs)
    await store.fetch('replace')
    await restorePosition()
    await loadRecent()
  }
}
function onDeactivate() {
  store.rememberScroll(window.scrollY)
  store.flushPrefs()
  window.removeEventListener('scroll', onScroll)
}
onActivated(onActivate)
onDeactivated(onDeactivate)

/** 定位到上一次浏览的作品（首次加载 / 登录后） */
async function restorePosition() {
  const lastId = store.lastWorkId
  if (!lastId) return
  let guard = 0
  while (!store.items.some((w) => w.id === lastId) && store.hasMore && guard < 300) {
    await store.loadMore()
    guard++
  }
  await nextTick()
  const el = document.getElementById(`wc-${lastId}`)
  if (el) {
    el.scrollIntoView({ block: 'start' })
    window.scrollBy(0, -16)
  }
}

// 条件/排序变化时回顶部
watch(
  () => [store.conditions.length, store.q, store.sort, store.order],
  () => {
    if (!store.randomMode) window.scrollTo(0, 0)
  }
)
watch(
  () => store.sort,
  (v) => (sort.value = v)
)
watch(
  () => store.order,
  (v) => (order.value = v)
)
</script>

<style scoped>
.library {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.count {
  color: var(--muted);
  font-size: 14px;
}
.menus {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.active-conds {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.recent-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.recent-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.recent-title {
  font-size: 16px;
  font-weight: 600;
}
.recent-all {
  font-size: 14px;
  color: var(--accent);
  cursor: pointer;
}
.recent {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.recent.dragging {
  cursor: grabbing;
  user-select: none;
  scroll-behavior: auto;
}
.recent-item {
  width: 140px;
  flex-shrink: 0;
  cursor: pointer;
}
.recent-cover {
  width: 140px;
  height: 140px;
  border-radius: 8px;
  overflow: hidden;
  background: #0d0f12;
  margin-bottom: 6px;
}
.recent-cover img {
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
.recent-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
.empty {
  padding: 60px 0;
  text-align: center;
  color: var(--muted);
  font-size: 15px;
}
.end-tip {
  padding: 12px 0 4px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
}
.end-tip .loading {
  color: var(--accent);
}
</style>
