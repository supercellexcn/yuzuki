<template>
  <div class="history" :class="{ cards: view === 'card' }">
    <div class="back">
      <BackButton />
    </div>
    <div class="head">
      <h2>播放历史 <span class="count">共 {{ total }} 段</span></h2>
      <el-radio-group v-model="view" size="small">
        <el-radio-button value="list">列表</el-radio-button>
        <el-radio-button value="card">卡片</el-radio-button>
      </el-radio-group>
    </div>

    <div v-if="loading && !items.length" class="empty">加载中…</div>
    <div v-else-if="!items.length" class="empty">暂无播放记录</div>

    <div v-else-if="view === 'list'" class="list">
      <div v-for="p in items" :key="p.play_id" class="row" @click="goWork(p.rj_code)">
        <div class="cover">
          <img v-if="p.cover_url" :src="authedUrl(p.cover_url)" :alt="p.title" />
          <div v-else class="no-cover">{{ p.rj_code }}</div>
        </div>
        <div class="info">
          <div class="title">{{ p.title || p.rj_code }}</div>
          <div class="sub">
            <span v-if="p.circle">{{ p.circle }}</span>
            <span v-if="p.sales_count != null"> · 销量 {{ p.sales_count.toLocaleString() }}</span>
            <span v-if="p.play_count > 0"> · 播放 {{ p.play_count }} 次</span>
            <span v-if="p.duration_seconds > 0"> · 时长 {{ fmtDuration(p.duration_seconds) }}</span>
          </div>
        </div>
        <div class="time">
          <!-- 同一时间段连听的多个文件已合并为一条，这里标出这一组合并了几个文件 -->
          <div v-if="p.group_count > 1" class="group-count">本次 {{ p.group_count }} 个文件</div>
          <div>{{ fmtTime(p.played_at) }}</div>
        </div>
      </div>
    </div>

    <div v-else class="grid">
      <WorkCard
        v-for="p in items"
        :key="p.play_id"
        :work="p"
        :history="historyMeta(p)"
      />
    </div>

    <div v-if="items.length" class="end-tip">
      <span v-if="loading && hasMore" class="loading">加载中…</span>
      <span v-else-if="loaded && !hasMore">—— 已经加载所有 ——</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getPlays, authedUrl } from '../api'
import type { PlayRecord } from '../api/types'
import BackButton from '../components/BackButton.vue'
import WorkCard from '../components/WorkCard.vue'

const router = useRouter()
const items = ref<PlayRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const loaded = ref(false)

/** 列表 / 卡片视图，按设备记住选择 */
type HistoryLayout = 'list' | 'card'
const VIEW_KEY = 'yuzuki_history_view'
function readLayout(): HistoryLayout {
  try {
    return localStorage.getItem(VIEW_KEY) === 'card' ? 'card' : 'list'
  } catch {
    return 'list'
  }
}
const view = ref<HistoryLayout>(readLayout())
watch(view, (v) => {
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    /* 隐私模式下写入失败，忽略 */
  }
})

const hasMore = computed(() => total.value > items.value.length)

async function load() {
  if (loading.value) return
  if (loaded.value && !hasMore.value) return
  loading.value = true
  try {
    const res = await getPlays(page.value, pageSize)
    // 按 play_id 去重：分页 ORDER BY 只有时间戳时，同时间戳会跨页重复，重复 key 会让列表 diff 错乱（一直跳）
    const seen = new Set(items.value.map((i) => i.play_id))
    const fresh = res.items.filter((i) => !seen.has(i.play_id))
    items.value = [...items.value, ...fresh]
    total.value = res.total
    page.value += 1
    loaded.value = true
  } catch {
    // 单次加载失败不卡住：保留已加载列表，下次滚动自动重试
  } finally {
    loading.value = false
  }
}

function onScroll() {
  const doc = document.documentElement
  if (window.innerHeight + window.scrollY >= doc.scrollHeight - 300) load()
}

onMounted(() => {
  load()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onUnmounted(() => window.removeEventListener('scroll', onScroll))

function goWork(rj: string) {
  router.push({ name: 'player', params: { rj } })
}

function fmtTime(t: string): string {
  if (!t) return ''
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 卡片用的短日期：26-12-01（两位年份）；withClock 时再带上时分 */
function fmtShortTime(t: string, withClock = false): string {
  if (!t) return ''
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${String(d.getFullYear()).slice(-2)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return withClock ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date
}

/** 播放时长：1h30m / 45m / 30s */
function fmtDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`
  if (m > 0) return `${m}m`
  return `${total}s`
}

function historyMeta(p: PlayRecord) {
  return {
    timeLabel: fmtShortTime(p.played_at, true),
    shortTimeLabel: fmtShortTime(p.played_at),
    durationLabel: fmtDuration(p.duration_seconds),
  }
}
</script>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 900px;
}
/* 卡片模式沿用媒体库的整行宽度 */
.history.cards {
  max-width: none;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.head h2 {
  margin: 0;
}
.count {
  font-size: 13px;
  color: var(--muted);
  font-weight: 400;
  margin-left: 6px;
}
.list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background var(--anim-duration);
}
.row:last-child {
  border-bottom: none;
}
.row:hover {
  background: rgba(34, 38, 45, 0.65);
}
.cover {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  background: #0d0f12;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.no-cover {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 9px;
}
.info {
  flex: 1;
  min-width: 0;
}
.title {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
  font-size: 12px;
  color: var(--muted);
}
.time {
  font-size: 12px;
  color: var(--muted);
  flex-shrink: 0;
  text-align: right;
}
/* 合并了多个文件时，在时间上方标一行「本次 N 个文件」 */
.group-count {
  color: var(--accent);
  margin-bottom: 2px;
}
.grid {
  display: grid;
  /* 与媒体库一致：卡片尺寸由设置决定 */
  grid-template-columns: repeat(auto-fill, minmax(var(--card-min-width), 1fr));
  gap: 16px;
}
.empty {
  padding: 60px 0;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
}
.end-tip {
  padding: 12px 0 4px;
  min-height: 40px; /* 预留高度，避免加载提示出现/消失导致底部跳动 */
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.end-tip .loading {
  color: var(--accent);
}
</style>
