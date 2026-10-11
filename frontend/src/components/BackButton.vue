<template>
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
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

/**
 * 圆形图标返回按钮（作品详情页 / 播放历史共用）。
 * 有历史记录就回退；没有（例如从外部直接打开子页面）则落到 fallback 路由，
 * 否则点返回会毫无反应。
 */
const props = withDefaults(defineProps<{ fallback?: string }>(), { fallback: 'library' })
const router = useRouter()

function goBack() {
  if (window.history.state?.back) router.back()
  else router.push({ name: props.fallback })
}
</script>

<style scoped>
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
  transition: all var(--anim-duration);
}
.back-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(34, 38, 45, 0.65);
}
</style>
