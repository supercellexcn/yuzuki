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
watch(
  () => props.modelValue,
  (v) => (query.value = v)
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
  const v = query.value.trim()
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
