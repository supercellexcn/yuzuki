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
  background: var(--control-bg);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  transition: all var(--anim-duration);
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

/*
 * 作为弹层菜单使用：整行铺满（配合把 popover 的 padding 归零）、行间画分隔线。
 * 注意文字必须是深色 —— 弹层面板用的是 Element Plus 的浅色默认（白底），
 * 之前沿用了深色主题的浅色文字，在白底上几乎看不见。
 */
.image-actions.menu {
  flex-direction: column;
  gap: 0;
  justify-content: stretch;
}
.image-actions.menu .act {
  width: 100%;
  justify-content: flex-start;
  padding: 11px 14px;
  border: none;
  border-radius: 0;
  background: transparent;
  font-size: 14px;
  color: #303133;
}
/* 分隔线画在行上沿，首行不加 */
.image-actions.menu .act + .act {
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}
/* 首尾行跟着面板的圆角裁一下，避免高亮时方角溢出 */
.image-actions.menu .act:first-child {
  border-radius: 12px 12px 0 0;
}
.image-actions.menu .act:last-child {
  border-radius: 0 0 12px 12px;
}
.image-actions.menu .act:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent);
}
</style>
