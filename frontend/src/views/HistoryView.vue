<template>
  <div class="history">
    <div class="back">
      <el-button @click="router.back()" text>← 返回</el-button>
    </div>
    <h2>播放历史 <span class="count">共 {{ total }} 次</span></h2>

    <div v-if="loading && !items.length" class="empty">加载中…</div>
    <div v-else-if="!items.length" class="empty">暂无播放记录</div>

    <div v-else class="list">
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
          </div>
        </div>
        <div class="time">{{ fmtTime(p.played_at) }}</div>
      </div>
    </div>

    <div v-if="items.length" class="end-tip">
      <span v-if="loading && hasMore" class="loading">加载中…</span>
      <span v-else-if="loaded && !hasMore">—— 已经加载所有 ——</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { getPlays, authedUrl } from '../api'
import type { PlayRecord } from '../api/types'

const router = useRouter()
const items = ref<PlayRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const loaded = ref(false)

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
</script>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 900px;
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
