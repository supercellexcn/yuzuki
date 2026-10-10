<template>
  <div class="searchbar">
    <el-input
      v-model="query"
      placeholder="搜索标题 / RJ号 / 声优 / 类型标签…"
      clearable
      size="large"
      @input="onInput"
      @keyup.enter="onEnter"
      @clear="commit"
      @change="onBlur"
      @blur="onBlur"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
    >
      <template #prefix>
        <span class="icon">⌕</span>
      </template>
    </el-input>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void; (e: 'search', v: string): void }>()

const query = ref(props.modelValue)
/** 最近一次由本组件提交出去的值，用于区分「自己的回写」与「外部变更」。 */
let lastCommitted = props.modelValue
watch(
  () => props.modelValue,
  (v) => {
    // 自己 commit 触发的回写不动输入框，避免覆盖用户正在输入的内容；
    // 只有外部变更（清空「搜索」标签、登录后恢复偏好等）才同步到输入框。
    if (v === lastCommitted) return
    lastCommitted = v
    query.value = v
  }
)

let debounceTimer: ReturnType<typeof setTimeout> | undefined
let composing = false

/** 输入后自动搜索（防抖，避免每个字符都请求一次）。 */
function debouncedCommit() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined
    commit()
  }, 350)
}

function commit() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = undefined
  }
  const v = query.value.trim()
  // 值没变就不重复提交（Enter 会同时触发 keyup.enter 与 change，blur 又会触发 change）
  if (v === lastCommitted) return
  lastCommitted = v
  emit('update:modelValue', v)
  emit('search', v)
}

function onInput() {
  // 输入法组词过程中的 input 事件不触发搜索，等 compositionend 后再搜
  if (composing) return
  debouncedCommit()
}
function onCompositionStart() {
  composing = true
}
function onCompositionEnd() {
  composing = false
  debouncedCommit()
}
function onEnter() {
  // 输入法用回车选词时不要触发搜索
  if (composing) return
  commit()
}
/**
 * 失焦 / 值确定时立即提交。
 * 一方面保证「搜索: …」标签与输入框始终一致（否则防抖未落地时二者会脱节），
 * 另一方面兜底复位 composing —— 输入法被中断时 compositionend 可能不触发，
 * 卡住的标志会吞掉后续所有 input 事件导致搜索框永久不同步。
 */
function onBlur() {
  composing = false
  commit()
}

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})
</script>

<style scoped>
.searchbar {
  max-width: 560px;
  width: 100%;
}
.icon {
  color: var(--muted);
}
</style>
