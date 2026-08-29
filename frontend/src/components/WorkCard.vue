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
          v-for="t in work.tags.slice(0, 4)"
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
  transition: transform 0.12s, border-color 0.12s;
  display: flex;
  flex-direction: column;
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
  background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.6));
}
.cover-tag {
  font-size: 11px;
  line-height: 1;
  padding: 3px 7px;
  border-radius: 9px;
  background: rgba(10, 12, 16, 0.6);
  color: #f0f4fa;
  cursor: pointer;
  transition: all 0.12s;
}
.cover-tag:hover {
  background: var(--accent);
  color: #0b0e12;
}
/* 自定义标签（category === 'custom'）：与原生标签颜色区分 */
.cover-tag.tag-custom {
  background: rgba(29, 58, 51, 0.9);
  color: #8ee0c0;
  border: 1px solid #2a5a4d;
}
.cover-tag.tag-custom:hover {
  background: var(--accent);
  color: #0b0e12;
}
.meta {
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
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
  padding: 3px 9px;
  border-radius: 10px;
  background: #262b33;
  color: #c3cbd7;
  cursor: pointer;
  transition: background 0.12s;
}
.chip:hover {
  background: var(--accent);
  color: #0b0e12;
}
.chip-actor {
  background: #2a3040;
  color: #9db8e6;
}
</style>
