<template>
  <div
    ref="rootEl"
    class="work-card"
    :class="{ 'history-card': isHistory, 'card-near': near }"
    :id="'wc-' + work.id"
    @click="go"
  >
    <div class="cover">
      <img v-if="coverSrc" :src="coverSrc" :alt="work.title" loading="lazy" decoding="async" />
      <div v-else class="cover-placeholder">{{ work.rj_code }}</div>
      <!-- 封面左上角：星标收藏 -->
      <FavoriteStar :rj="work.rj_code" />
      <!-- 类型标签叠加在封面上 -->
      <div v-if="work.tags.length" class="cover-tags">
        <span
          v-for="t in work.tags"
          :key="'t' + t.name + t.category"
          class="cover-tag"
          :class="{ 'tag-custom': t.category === CUSTOM_TAG }"
          @click.stop="emit('select-tag', t.name)"
          >{{ t.name }}</span
        >
      </div>
    </div>
    <!-- 销量火焰：贴在卡片右上角边框上（仅图片模式） -->
    <div
      v-if="flames && imageOnly && !isHistory"
      class="sales-flames"
      title="销量热度"
      aria-label="销量热度"
    >
      <template v-if="flames.kind === 'rainbow'">
        <svg class="flame flame-big" viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <linearGradient :id="gradientId" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stop-color="#f05a4b" />
              <stop offset="28%" stop-color="#f2c14e" />
              <stop offset="52%" stop-color="#7bd88f" />
              <stop offset="76%" stop-color="#6ea8fe" />
              <stop offset="100%" stop-color="#a78bfa" />
            </linearGradient>
          </defs>
          <path :fill="`url(#${gradientId})`" :d="FLAME_PATH" />
          <path
            class="flame-inner"
            fill="#ffffff"
            :transform="FLAME_INNER_TRANSFORM"
            :d="FLAME_PATH"
          />
        </svg>
      </template>
      <template v-else>
        <svg
          v-for="i in flames.count"
          :key="i"
          class="flame"
          :class="`flame-${flames.kind}`"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path fill="currentColor" :d="FLAME_PATH" />
          <path
            class="flame-inner"
            fill="#ffffff"
            :transform="FLAME_INNER_TRANSFORM"
            :d="FLAME_PATH"
          />
        </svg>
      </template>
    </div>
    <div class="meta">
      <!-- 图片模式下的历史卡片：只留一行「播放时间 播放时长」，不显示任何字段名 -->
      <div v-if="isHistory && imageOnly" class="history-compact">
        {{ history?.shortTimeLabel }} {{ history?.durationLabel }}
      </div>
      <template v-else>
        <div class="title" :title="work.title">{{ work.title || work.rj_code }}</div>
        <div
          class="row"
          :class="{ 'row-click': !isHistory }"
          v-if="work.series"
          @click="onSeriesClick"
        >
          <span class="label">系列</span>
          <span class="value">{{ work.series }}</span>
        </div>
        <template v-if="isHistory">
          <div class="row">
            <span class="label">播放时间</span>
            <span class="value">{{ history?.timeLabel }}</span>
          </div>
          <div class="row">
            <span class="label">播放时长</span>
            <span class="value">{{ history?.durationLabel }}</span>
          </div>
        </template>
        <template v-else>
          <div
            class="row row-click"
            v-if="work.circle"
            @click.stop="emit('select-circle', work.circle)"
          >
            <span class="label">社团</span>
            <span class="value">{{ work.circle }}</span>
          </div>
          <div class="row" v-if="work.sales_count != null">
            <span class="label">销量</span>
            <span class="value">{{ work.sales_count.toLocaleString() }}</span>
          </div>
          <div class="row" v-if="work.play_count > 0">
            <span class="label">播放</span>
            <span class="value">{{ work.play_count }}</span>
          </div>
        </template>
        <div class="chips" v-if="work.actors.length">
          <span
            v-for="a in work.actors.slice(0, 4)"
            :key="'a' + a"
            class="chip chip-actor"
            @click.stop="emit('select-actor', a)"
            >{{ a }}</span
          >
        </div>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
/*
 * 所有 WorkCard 共用一个 IntersectionObserver（卡片越多越不能每张卡一个实例）：
 * 只有视口 ±1000px 内的卡片才挂 card-near、持有 backdrop-filter 合成层；
 * 离屏卡片不参与合成，合成层数量不再随分页累积增长。
 * 缓冲设在一屏以上，卡片进入视野前就已恢复模糊，不会出现「清晰一瞬」，
 * 也不再有「滚动时关掉、停下 2 秒再恢复」的跳变。
 */
let sharedObserver: IntersectionObserver | null = null
const nearCallbacks = new WeakMap<Element, (near: boolean) => void>()
function getObserver() {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) nearCallbacks.get(e.target)?.(e.isIntersecting)
      },
      { rootMargin: '1000px' }
    )
  }
  return sharedObserver
}
</script>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { authedUrl } from '../api'
import { CUSTOM_TAG } from '../api/types'
import type { Work } from '../api/types'
import { useViewMode } from '../composables/useViewMode'
import { useAuthStore } from '../stores/auth'
import FavoriteStar from './FavoriteStar.vue'

const props = defineProps<{
  work: Work
  /** 播放历史卡片：用「播放时间 / 播放时长」替换社团 / 销量等作品字段 */
  history?: { timeLabel: string; shortTimeLabel: string; durationLabel: string }
}>()
const emit = defineEmits<{
  (e: 'select-circle', name: string): void
  (e: 'select-series', name: string): void
  (e: 'select-actor', name: string): void
  (e: 'select-tag', name: string): void
}>()

const router = useRouter()
const { imageOnly } = useViewMode()
const auth = useAuthStore()
const isHistory = computed(() => !!props.history)

/*
 * 是否在视口附近：首屏已在视野内的卡片挂载即置 true（避免第一帧无模糊），
 * 其余交给共享 observer 更新；卸载时注销，避免 observer / WeakMap 残留。
 */
const rootEl = ref<HTMLElement | null>(null)
const near = ref(false)
onMounted(() => {
  const el = rootEl.value
  if (!el) return
  // 容器已接入 CardGlassLayer（媒体库 / 收藏 / 历史）：模糊由容器内唯一的固定层承担，
  // 卡片自身不再需要 backdrop-filter 合成层，也就没有必要观察视口距离。
  if (el.closest('.card-glass-host')) return
  const r = el.getBoundingClientRect()
  if (r.bottom > -1000 && r.top < window.innerHeight + 1000) near.value = true
  nearCallbacks.set(el, (v) => { near.value = v })
  getObserver().observe(el)
})
onUnmounted(() => {
  const el = rootEl.value
  if (!el) return
  getObserver().unobserve(el)
  nearCallbacks.delete(el)
})
/**
 * 封面 URL 只在作品数据 / 登录态变化时计算一次，避免每次渲染都读 localStorage 并拼串。
 * 依赖 auth.token：重新登录后自动换用新 token，不会留下旧 token 的失效图片地址。
 */
const coverSrc = computed(() => {
  void auth.token
  return authedUrl(props.work.cover_url)
})

const FLAME_PATH =
  'M12 2c1.2 4.2-2.8 5.4-2.8 9.2a2.8 2.8 0 0 0 5.6 0c0-1.6-1-2.7-1-4.2 2.2 1.1 4.2 3.7 4.2 7a6 6 0 0 1-12 0C6 9.4 9 6.4 12 2Z'
const FLAME_INNER_TRANSFORM = 'translate(12 19) scale(0.45) translate(-12 -19)'

/**
 * 销量火焰：
 * ≤1000 一朵灰色；1000-2999 一朵黄色；
 * 3000-5999 两朵黄色；6000-9999 三朵黄色；
 * 10000-12999 一朵红色；之后每 3000 追加一朵，最多 3 朵；
 * ≥19999 一朵大的彩色火焰。
 */
const gradientId = computed(() => `flame-grad-${props.work.id}`)
const flames = computed(() => {
  const n = props.work.sales_count
  if (n == null) return null
  if (n <= 1000) return { kind: 'gray', count: 1 }
  if (n < 3000) return { kind: 'yellow', count: 1 }
  if (n < 6000) return { kind: 'yellow', count: 2 }
  if (n < 10000) return { kind: 'yellow', count: 3 }
  if (n >= 19999) return { kind: 'rainbow', count: 1 }
  return { kind: 'red', count: Math.min(3, 1 + Math.floor((n - 10000) / 3000)) }
})

function go() {
  router.push({ name: 'player', params: { rj: props.work.rj_code } })
}
/** 历史卡片里系列不承担筛选：不拦截点击，让事件冒泡到卡片直接打开作品 */
function onSeriesClick(e: MouseEvent) {
  if (isHistory.value) return
  e.stopPropagation()
  emit('select-series', props.work.series)
}
</script>

<style scoped>
.work-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  /* 火焰要压在卡片上边框外侧，所以不能整卡裁剪；圆角交给封面 / 信息区各自处理 */
  position: relative;
  overflow: visible;
  /* overflow 变成 visible 后，flex 项默认会按内容最小宽度撑开；这里强制以固定宽度为准 */
  min-width: 0;
  /*
   * 布局 / 样式隔离：卡片内部的变化（图片解码完成、hover、信息区收放）不会触发
   * 外层网格重排，也不会把样式失效传播到相邻卡片 —— 滚动时重绘范围更小。
   * 不用 paint 隔离：销量火焰要压在卡片边框外，必须允许溢出。
   */
  contain: layout style;
  cursor: pointer;
  transition: transform var(--anim-duration), border-color var(--anim-duration);
  display: flex;
  flex-direction: column;
  /*
   * 卡片的亚克力磨砂由 App.vue 的 .has-acrylic 统一开启（仅在有壁纸且面板模糊 > 0 时）。
   * 注意：backdrop-filter 会强制每张卡片单独成为一个合成层；与 overflow:hidden +
   * border-radius 的裁剪叠加后，离屏卡片在切换图片模式（整体布局变化）后滚动进视野时
   * 曾出现过「没有圆角 / 封面图不显示」的残影。因此该效果默认强度适中，
   * 用户把「面板模糊」调到 0 即可完全关闭。
   */
}
.work-card:hover {
  transform: translateY(-2px);
  border-color: var(--accent);
}
.cover {
  aspect-ratio: 1 / 1;
  background: #0d0f12;
  overflow: hidden;
  position: relative;
  border-radius: 9px 9px 0 0;
  /*
   * 绘制隔离：封面是独立的一块（图 + 渐变 + 标签），隔离后滚动时这块单独光栅化，
   * 不会因为相邻卡片重绘而被连带。overflow: hidden 已保证裁剪范围不变。
   */
  contain: paint;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 14px;
}
/*
 * 销量火焰：贴在卡片右上角边框上，仅图片模式显示。
 * 上半截在卡片外、下半截压住封面，不做任何动画。
 */
.sales-flames {
  position: absolute;
  /* 向上偏移 2/3：火焰 2/3 在卡片外、1/3 压在封面上，边框处更醒目 */
  top: 0;
  right: 10px;
  transform: translateY(-66.6667%);
  display: flex;
  align-items: center;
  gap: 2px;
  z-index: 2;
  pointer-events: none;
  user-select: none;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.55));
}
.flame {
  width: 15px;
  height: 15px;
  display: block;
  flex-shrink: 0;
  overflow: visible;
}
.flame-big {
  width: 24px;
  height: 24px;
}
.flame-gray {
  color: #9aa3b0;
}
.flame-yellow {
  color: #f2c14e;
}
.flame-red {
  color: #f05a4b;
}
.flame-inner {
  opacity: 0.5;
}
.cover-tags {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 14px 6px 6px;
  background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.72));
}
.cover-tag {
  font-size: 11px;
  line-height: 1;
  padding: 3px 9px;
  border-radius: 999px;
  /* 与详情页保持一致的「类型标签」配色（可在设置里改） */
  background: var(--tag-genre-bg);
  color: var(--tag-genre-fg);
  cursor: pointer;
  transition: all var(--anim-duration);
}
.cover-tag:hover {
  background: var(--accent);
  color: var(--accent-fg);
}
/* 自定义标签（category === 'custom'）：与原生标签颜色区分 */
.cover-tag.tag-custom {
  background: rgba(29, 58, 51, 0.9);
  color: #8ee0c0;
  border: 1px solid #2a5a4d;
}
.cover-tag.tag-custom:hover {
  background: var(--accent);
  color: var(--accent-fg);
}
.meta {
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-radius: 0 0 9px 9px;
  /* 卡片下半部分底色：由主题色决定 */
  background: var(--card-meta-bg);
  /*
   * 网格里同一行的卡片会被拉成等高，而内容少的卡片信息区本来会矮一截，
   * 导致卡片底部露出一条没有底色的区域（看起来「颜色没充满」）。
   * flex-grow 让信息区吃掉剩余高度，底色就铺满整张卡片了。
   */
  flex-grow: 1;
  /*
   * 图片模式切换时需要收起这一块，用 max-height + opacity 做过渡；
   * 600px 上限远大于实际内容高度（标题 2 行 + 数据行 + 4 个声优标签），不会截断。
   */
  max-height: 600px;
  overflow: hidden;
  transition: max-height var(--anim-duration) ease, opacity var(--anim-duration) ease, padding var(--anim-duration) ease;
}
.title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.row {
  display: flex;
  gap: 8px;
  font-size: 13px;
}
.label {
  color: var(--muted);
  flex-shrink: 0;
}
.value {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-click {
  cursor: pointer;
}
.row-click:hover .value {
  color: var(--accent);
}
/* 图片模式下的历史卡片：封面下只保留这一行 */
.history-compact {
  font-size: 13px;
  line-height: 1.3;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chip {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  /* 控件底色（透明度可在设置里改） */
  background: var(--control-bg);
  color: #c3cbd7;
  cursor: pointer;
  transition: background var(--anim-duration);
}
.chip:hover {
  background: var(--accent);
  color: var(--accent-fg);
}
/* 与详情页保持一致的「声优标签」配色（可在设置里改） */
.chip-actor {
  background: var(--tag-actor-bg);
  color: var(--tag-actor-fg);
}
</style>
