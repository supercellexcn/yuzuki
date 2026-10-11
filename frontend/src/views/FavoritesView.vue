<template>
  <div class="favorites">
    <div class="toolbar">
      <h2 class="page-title">我的收藏</h2>
      <el-tabs v-model="activeTab" class="tabs">
        <el-tab-pane label="作品" name="work" />
        <el-tab-pane label="标签" name="tag" />
        <el-tab-pane label="社团" name="circle" />
        <el-tab-pane label="声优" name="actor" />
      </el-tabs>
    </div>

    <div v-if="loading" class="empty">加载中…</div>

    <template v-else>
      <!-- 作品（默认 Tab）：复用 WorkCard，点击进播放器，长按取消收藏 -->
      <div v-if="activeTab === 'work'" class="grid">
        <WorkCard v-for="w in favorites.works" :key="w.id" :work="w" />
        <div v-if="!favorites.works.length" class="empty">
          暂无收藏作品<br /><span class="hint">在媒体库中长按作品封面即可收藏</span>
        </div>
      </div>

      <!-- 标签 -->
      <div v-else-if="activeTab === 'tag'" class="chips">
        <span
          v-for="t in favorites.tags"
          :key="t.name + t.category"
          class="chip"
          :class="{ 'chip-custom': t.category === CUSTOM_TAG }"
          @click="goFilter('tag', t.name)"
          v-longpress="() => fav('tag', t.name, t.category)"
        >
          <span class="chip-name">{{ t.name }}</span>
          <span class="chip-count" v-if="t.category">{{ t.category }}</span>
        </span>
        <div v-if="!favorites.tags.length" class="empty">
          暂无收藏标签<br /><span class="hint">在媒体库或作品页长按标签即可收藏</span>
        </div>
      </div>

      <!-- 社团 -->
      <div v-else-if="activeTab === 'circle'" class="chips">
        <span
          v-for="c in favorites.circles"
          :key="c"
          class="chip"
          @click="goFilter('circle', c)"
          v-longpress="() => fav('circle', c)"
        >
          <span class="chip-name">{{ c }}</span>
        </span>
        <div v-if="!favorites.circles.length" class="empty">
          暂无收藏社团<br /><span class="hint">在媒体库或作品页长按社团即可收藏</span>
        </div>
      </div>

      <!-- 声优 -->
      <div v-else class="chips">
        <span
          v-for="a in favorites.actors"
          :key="a"
          class="chip chip-actor"
          @click="goFilter('actor', a)"
          v-longpress="() => fav('actor', a)"
        >
          <span class="chip-name">{{ a }}</span>
        </span>
        <div v-if="!favorites.actors.length" class="empty">
          暂无收藏声优<br /><span class="hint">在媒体库或作品页长按声优即可收藏</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { CUSTOM_TAG } from '../api/types'
import { useFavoritesStore } from '../stores/favorites'
import { useLibraryStore } from '../stores/library'
import { useFavorite } from '../composables/useFavorite'
import type { FilterCondType } from '../api/types'
import WorkCard from '../components/WorkCard.vue'

const favorites = useFavoritesStore()
const library = useLibraryStore()
const router = useRouter()
const { fav } = useFavorite()

const activeTab = ref<'work' | 'tag' | 'circle' | 'actor'>('work')
const loading = ref(true)

/** 点击收藏的标签/社团/声优 → 回媒体库并按该条件筛选。 */
function goFilter(type: FilterCondType, value: string) {
  library.addCondition(type, value)
  router.push({ name: 'library' })
}

onMounted(async () => {
  try {
    await favorites.refresh()
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.favorites {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}
.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
.tabs {
  flex: 1;
}
.grid {
  display: grid;
  /* 与媒体库一致：卡片尺寸由设置决定 */
  grid-template-columns: repeat(auto-fill, minmax(var(--card-min-width), 1fr));
  gap: 16px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 16px;
  /* 控件底色（透明度可在设置里改），与全站一致 */
  background: var(--control-bg);
  color: #d3d9e3;
  font-size: 14px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all var(--anim-duration);
  user-select: none;
}
.chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}
/* 声优标签与详情页 / 卡片保持同一套配色 */
.chip-actor {
  background: var(--tag-actor-bg);
  color: var(--tag-actor-fg);
}
/* 自定义标签（category === 'custom'）：与原生标签颜色区分 */
.chip.chip-custom {
  background: #1d3a33;
  border-color: #2a5a4d;
  color: #8ee0c0;
}
.chip-count {
  color: var(--muted);
  font-size: 12px;
}
.empty {
  padding: 60px 0;
  text-align: center;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.9;
}
.hint {
  font-size: 13px;
  opacity: 0.75;
}
</style>
