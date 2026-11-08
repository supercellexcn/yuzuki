<template>
  <div class="searchbar">
    <el-input
      ref="inputRef"
      v-model="query"
      :placeholder="placeholder"
      clearable
      :size="size"
      @keyup.enter="onEnter"
      @clear="commit"
      @change="onBlur"
      @blur="onBlur"
      @compositionend="onCompositionEnd"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type { InputInstance } from 'element-plus'

const props = withDefaults(
  defineProps<{
    modelValue: string
    size?: 'large' | 'default' | 'small'
    placeholder?: string
  }>(),
  { size: 'large', placeholder: '搜索标题 / RJ号 / 声优 / 类型标签…' }
)
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void; (e: 'search', v: string): void }>()

const query = ref(props.modelValue)
watch(
  () => props.modelValue,
  (v) => {
    // 外部变更（清空「搜索」标签、登录后恢复偏好等）同步到输入框；
    // 组件自己 emit 出去的值与输入框内容相同，这里不会改动用户正在输入的内容。
    if (v !== query.value) query.value = v
  }
)

const inputRef = ref<InputInstance>()
let nativeInput: HTMLInputElement | null = null

/** el-input 内部的组词状态（组词期间它会吞掉所有 update:modelValue / input 事件）。 */
function isComposing(): boolean {
  return inputRef.value?.isComposing === true
}

/** 复位 el-input 的组词状态（暴露出来的 ref 已被 proxyRefs 解包，可直接赋值）。 */
function resetComposing() {
  const inst = inputRef.value as unknown as { isComposing: boolean } | undefined
  if (inst) inst.isComposing = false
}

/**
 * 以输入框 DOM 值为准同步给父组件 —— 「搜索:」标签绑定的就是这份值。
 * 无论本次输入是否已经被 el-input 正常写进 v-model，都要回传一次：
 * 只有标签始终等于 DOM 值，才能保证「输入框显示什么，标签就是什么」。
 */
function syncFromDom() {
  const v = nativeInput?.value ?? ''
  if (v !== query.value) query.value = v
  emit('update:modelValue', v)
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined
/** 最近一次真正触发搜索的值与时间，用来吞掉 Enter / change / blur 的重复提交。 */
let lastSearched = props.modelValue
let lastSearchedAt = 0

/**
 * 常驻对账：把输入框的 DOM 值和组件里的值比一下，不一致就以输入框为准。
 *
 * 光靠 input 事件不够 —— 有些改动不会触发它：浏览器在页面加载后恢复输入框旧值、
 * Ctrl+Z 撤销、输入法/扩展直接改 DOM 等。这些情况下输入框已经变了，标签却停在旧值。
 * 200ms 比一次字符串，开销可以忽略，但任何来源的变化都能被接住。
 */
function adoptDomIfChanged() {
  if (!nativeInput) return
  const v = nativeInput.value
  if (v === query.value) return
  query.value = v
  emit('update:modelValue', v)
  lastSearched = v
  lastSearchedAt = Date.now()
  emit('search', v)
}

/**
 * 原生 input 监听（挂在 el-input 内部的 <input> 上）。
 *
 * el-input 的 handleInput 在输入法组词中会直接 return，把 update:modelValue 和
 * input 事件一起吞掉；粘贴 / 全选替换恰好撞上组词状态时也会被吞，于是输入框已经
 * 显示新内容、v-model 还停在旧值。原生事件不受这层拦截，标签以 DOM 值为准。
 */
function onNativeInput(e: Event) {
  syncFromDom()
  // 浏览器明确说这次输入不在组词、el-input 却卡在组词状态：说明 compositionend 丢了
  // （切换输入法、系统弹窗打断等），复位它，否则 v-model 会被永久冻结。
  if (isComposing() && !(e as InputEvent).isComposing) resetComposing()
  if (!isComposing()) debouncedCommit()
}
let domWatchTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  nativeInput = inputRef.value?.input ?? null
  nativeInput?.addEventListener('input', onNativeInput)
  domWatchTimer = setInterval(adoptDomIfChanged, 200)
})

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
  // 这里不读 DOM：点输入框的「×」清空时，el-input 先改 modelValue、稍后才写回原生
  // input，此刻 DOM 里还是旧文本，读它会把手动清空的内容又搜回去。
  const v = query.value
  // 清空按钮等路径不会触发原生 input 事件，这里保证标签也能跟上当前值
  emit('update:modelValue', v)
  // Enter 会同时触发 keyup.enter 与 change，blur 又会触发 change：
  // 同一个值在短时间内的重复提交不再发请求（但仍允许过一会儿重搜同一个词）。
  const now = Date.now()
  if (v === lastSearched && now - lastSearchedAt < 300) return
  lastSearched = v
  lastSearchedAt = now
  emit('search', v)
}

/** 组词结束：DOM 里已是最终文本，同步标签并安排一次搜索。 */
function onCompositionEnd() {
  syncFromDom()
  debouncedCommit()
}
function onEnter() {
  // 输入法用回车选词时不要触发搜索
  if (isComposing()) return
  commit()
}
/** 失焦 / 值确定时立即提交（把防抖中未落地的搜索立刻发出去）。 */
function onBlur() {
  commit()
}

onBeforeUnmount(() => {
  if (domWatchTimer) clearInterval(domWatchTimer)
  nativeInput?.removeEventListener('input', onNativeInput)
  if (debounceTimer) clearTimeout(debounceTimer)
})
</script>

<style scoped>
.searchbar {
  max-width: 560px;
  width: 100%;
}
</style>
