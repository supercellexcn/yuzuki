<template>
  <div class="image-actions" :class="{ vertical, menu }">
    <button
      v-for="a in IMAGE_ACTIONS"
      :key="a.kind"
      class="act"
      type="button"
      :disabled="busy"
      @click="emit('pick', a.kind)"
    >
      <span class="icon">{{ a.icon }}</span>
      <span class="text">{{ a.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { IMAGE_ACTIONS, type ImageActionKind } from '../composables/useImageActions'

defineProps<{ vertical?: boolean; busy?: boolean; menu?: boolean }>()
const emit = defineEmits<{ (e: 'pick', kind: ImageActionKind): void }>()
</script>

<style scoped>
.image-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.image-actions.vertical {
  flex-direction: column;
  justify-content: stretch;
}
.act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 14px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(38, 43, 51, 0.7);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.12s;
  backdrop-filter: blur(var(--control-blur));
  white-space: nowrap;
}
.image-actions.vertical .act {
  justify-content: flex-start;
}
.act:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.act:disabled {
  opacity: 0.5;
  cursor: default;
}
.icon {
  font-size: 15px;
  line-height: 1;
}

/* 作为弹层菜单使用：无边框行 + 悬停高亮，形态与筛选弹框一致 */
.image-actions.menu {
  flex-direction: column;
  gap: 2px;
  justify-content: stretch;
}
.image-actions.menu .act {
  width: 100%;
  justify-content: flex-start;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 14px;
  color: var(--text);
}
.image-actions.menu .act:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent);
}
</style>
