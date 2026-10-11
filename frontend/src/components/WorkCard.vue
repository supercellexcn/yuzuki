<template>
  <div
    class="work-card"
    :id="'wc-' + work.id"
    @click="go"
    v-longpress="isMobile ? undefined : () => fav('work', work.rj_code)"
  >
    <div class="cover">
      <img v-if="work.cover_url" :src="authedUrl(work.cover_url)" :alt="work.title" loading="lazy" />
      <div v-else class="cover-placeholder">{{ work.rj_code }}</div>
      <!-- RJ 号叠加在封面左上角 -->
      <div class="rj-badge">{{ work.rj_code }}</div>
      <!-- 类型标签叠加在封面上（桌面长按收藏标签） -->
      <div v-if="work.tags.length" class="cover-tags">
        <span
          v-for="t in work.tags"
          :key="'t' + t.name + t.category"
          class="cover-tag"
          :class="{ 'tag-custom': t.category === CUSTOM_TAG }"
          @click.stop="emit('select-tag', t.name)"
          v-longpress="isMobile ? undefined : () => fav('tag', t.name, t.category)"
          >{{ t.name }}</span
        >
      </div>
    </div>
    <!-- 移动端：长按非封面区域（信息区）打开收藏选择器 -->
    <div class="meta" v-longpress="isMobile ? openFavPicker : undefined">
      <div class="title" :title="work.title">{{ work.title || work.rj_code }}</div>
      <div
        class="row row-click"
        v-if="work.series"
        @click.stop="emit('select-series', work.series)"
      >
        <span class="label">系列</span>
        <span class="value">{{ work.series }}</span>
      </div>
      <div
        class="row row-click"
        v-if="work.circle"
        @click.stop="emit('select-circle', work.circle)"
        v-longpress="isMobile ? undefined : () => fav('circle', work.circle)"
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
      <div class="chips" v-if="work.actors.length">
        <span
          v-for="a in work.actors.slice(0, 4)"
          :key="'a' + a"
          class="chip chip-actor"
          @click.stop="emit('select-actor', a)"
          v-longpress="isMobile ? undefined : () => fav('actor', a)"
          >{{ a }}</span
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { authedUrl } from '../api'
import { CUSTOM_TAG } from '../api/types'
import type { Work } from '../api/types'
import { useFavorite } from '../composables/useFavorite'
import { useIsMobile } from '../composables/useIsMobile'
import { useFavoritesStore } from '../stores/favorites'

const props = defineProps<{ work: Work }>()
const emit = defineEmits<{
  (e: 'select-circle', name: string): void
  (e: 'select-series', name: string): void
  (e: 'select-actor', name: string): void
  (e: 'select-tag', name: string): void
}>()

const router = useRouter()
const isMobile = useIsMobile()
const favorites = useFavoritesStore()
const { fav } = useFavorite()
function go() {
  router.push({ name: 'player', params: { rj: props.work.rj_code } })
}
/** 移动端长按信息区 → 打开收藏选择器（展示 RJ/声优/标签/社团供点选） */
function openFavPicker() {
  favorites.openPicker(props.work)
}
</script>

<style scoped>
.work-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: transform var(--anim-duration), border-color var(--anim-duration);
  display: flex;
  flex-direction: column;
  /*
   * 卡片本身不做磨砂（全站尺度上都不做，见 App.vue 的 --filelist-alpha 注释）。
   * 除性能外还有一个具体原因：backdrop-filter 会强制每张卡片单独成为一个合成层，
   * 与 overflow:hidden + border-radius 的裁剪叠加后，离屏卡片在切换图片模式（整体布局变化）
   * 后滚动进视野时容易出现「没有圆角 / 封面图不显示」的残影，需要再点一下才重绘。
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
.rj-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(10, 12, 16, 0.88);
  color: #ffffff;
  letter-spacing: 0.3px;
  text-decoration: none;
  pointer-events: none;
  user-select: none;
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
