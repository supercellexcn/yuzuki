<template>
  <div class="admin">
    <div class="head">
      <h2 class="page-title">管理功能</h2>
      <span class="hint">隐藏的作品 / 系列 / 社团 / 声优 / 标签，不会再在媒体库、搜索、播放历史中出现。</span>
    </div>

    <el-tabs v-model="tab" class="tabs">
      <el-tab-pane label="作品管理" name="works">
        <WorksAdmin v-if="tab === 'works'" />
      </el-tab-pane>
      <el-tab-pane label="系列管理" name="series">
        <SeriesAdmin v-if="tab === 'series'" />
      </el-tab-pane>
      <el-tab-pane label="社团管理" name="circles">
        <CirclesAdmin v-if="tab === 'circles'" />
      </el-tab-pane>
      <el-tab-pane label="声优管理" name="actors">
        <ActorsAdmin v-if="tab === 'actors'" />
      </el-tab-pane>
      <el-tab-pane label="标签管理" name="tags">
        <TagsAdmin v-if="tab === 'tags'" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useIsMobile } from '../../composables/useIsMobile'
import WorksAdmin from './WorksAdmin.vue'
import SeriesAdmin from './SeriesAdmin.vue'
import CirclesAdmin from './CirclesAdmin.vue'
import ActorsAdmin from './ActorsAdmin.vue'
import TagsAdmin from './TagsAdmin.vue'

const router = useRouter()
const isMobile = useIsMobile()
const tab = ref('works')

// 管理功能仅桌面端：进入后若窗口变为移动端宽度，立即跳回媒体库
watch(isMobile, (m) => {
  if (m) router.replace({ name: 'library' })
})
</script>

<style scoped>
.admin {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.head {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
}
.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
.hint {
  font-size: 13px;
  color: var(--muted);
}
.tabs {
  min-height: 400px;
}
/* 让未选中的管理板块清晰可辨，选中项用底色胶囊高亮 */
.tabs :deep(.el-tabs__header) {
  margin-bottom: 18px;
}
.tabs :deep(.el-tabs__nav-wrap::after) {
  background-color: var(--border);
  height: 1px;
}
.tabs :deep(.el-tabs__item) {
  height: 40px;
  line-height: 40px;
  padding: 0 22px;
  margin-right: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #b9c2cf;
  border-radius: 8px 8px 0 0;
  transition: color var(--anim-duration), background var(--anim-duration);
}
.tabs :deep(.el-tabs__item:hover) {
  color: var(--text);
  background: rgba(34, 38, 45, 0.65);
}
.tabs :deep(.el-tabs__item.is-active) {
  color: var(--accent);
  font-weight: 700;
  background: var(--accent-soft);
}
.tabs :deep(.el-tabs__active-bar) {
  display: none;
}
</style>
