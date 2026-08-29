<template>
  <!-- 用 CSS 绘制播放/暂停图标，不依赖字体字形（避免移动端缺字形导致图标消失） -->
  <span v-if="playing" class="pp-pause" aria-label="暂停"><i /><i /></span>
  <span v-else class="pp-play" aria-label="播放" />
</template>

<script setup lang="ts">
defineProps<{ playing: boolean }>()
</script>

<style scoped>
.pp-play {
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 13px solid currentColor;
  border-top: 8px solid transparent;
  border-bottom: 8px solid transparent;
  margin-left: 3px;
}
.pp-pause {
  display: inline-flex;
  gap: 3px;
  align-items: center;
}
.pp-pause i {
  width: 5px;
  height: 15px;
  background: currentColor;
  border-radius: 1px;
}
</style>
