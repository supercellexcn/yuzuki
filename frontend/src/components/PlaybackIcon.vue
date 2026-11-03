<template>
  <svg
    class="playback-icon"
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'repeat'">
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </template>
    <template v-else-if="name === 'prev'">
      <path d="M19 20 9 12l10-8v16Z" fill="currentColor" stroke="none" />
      <rect x="5" y="5" width="2.5" height="14" rx="1" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'next'">
      <path d="M5 4v16l10-8L5 4Z" fill="currentColor" stroke="none" />
      <rect x="16.5" y="5" width="2.5" height="14" rx="1" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'expand'">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </template>
    <template v-else-if="name === 'volume'">
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </template>
    <template v-else-if="name === 'volume-off'">
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="m22 9-6 6" />
      <path d="m16 9 6 6" />
    </template>
    <template v-else-if="name === 'close'">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </template>
    <template v-else-if="name === 'list'">
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </template>
    <template v-else-if="name === 'external'">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </template>
  </svg>
</template>

<script setup lang="ts">
/** 播放器控件图标（重复 / 上一首 / 下一首 / 全屏 / 音量 / 关闭）。 */
defineProps<{ name: string }>()
</script>
