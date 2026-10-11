<template>
  <el-popover v-model:visible="visible" trigger="click" placement="bottom-start" :width="380">
    <template #reference>
      <el-button :type="hasActive ? 'primary' : 'default'" plain size="default">
        {{ label }}<span class="caret">▾</span>
      </el-button>
    </template>

    <div class="chip-menu">
      <el-input v-model="kw" placeholder="搜索…" clearable size="small" class="search" />
      <div class="chips">
        <span
          v-for="it in filtered"
          :key="it.name + '|' + (it.category || '')"
          class="chip"
          :class="{ active: activeValues.includes(it.name), 'chip-custom': it.category === CUSTOM_TAG }"
          @click="pick(it.name)"
          v-longpress="() => onFav(it)"
        >
          <span class="chip-name">{{ it.name }}</span>
          <span class="chip-count">{{ it.count }}</span>
        </span>
        <div v-if="!filtered.length" class="empty">无匹配项</div>
      </div>
      <div class="foot" v-if="!hasActive">
        点击标签加入筛选条件（最多 5 个，可叠加）
      </div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { FavoriteType } from '../api/types'
import { CUSTOM_TAG } from '../api/types'
import { useFavorite } from '../composables/useFavorite'

const props = defineProps<{
  label: string
  items: { name: string; count: number; category?: string }[]
  activeValues: string[]
  favType?: FavoriteType
}>()
const emit = defineEmits<{ (e: 'select', name: string): void }>()

const visible = ref(false)
const kw = ref('')
const { fav } = useFavorite()

const hasActive = computed(() => props.activeValues.length > 0)

const filtered = computed(() => {
  const q = kw.value.trim().toLowerCase()
  const list = q ? props.items.filter((i) => i.name.toLowerCase().includes(q)) : props.items
  return list.slice(0, 300)
})

function pick(name: string) {
  emit('select', name)
}

/** 长按 chip 收藏对应类型；未配置 favType 时（无收藏语义的菜单）静默忽略。 */
function onFav(it: { name: string; category?: string }) {
  if (!props.favType) return
  void fav(props.favType, it.name, it.category || '')
}
</script>

<style scoped>
.caret {
  color: var(--muted);
  font-size: 10px;
  margin-left: 2px;
}
.chip-menu {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.search {
  flex-shrink: 0;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 11px;
  border-radius: 14px;
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
}
.chip.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
/* 自定义标签：与 DLsite/hvdb 原生标签颜色区分 */
.chip.chip-custom:not(.active) {
  background: rgba(29, 58, 51, 0.78);
  border-color: #2a5a4d;
  color: #8ee0c0;
}
.chip-count {
  color: var(--muted);
  font-size: 13px;
}
.chip.active .chip-count {
  color: #7fa6e0;
}
.foot {
  font-size: 12px;
  color: var(--muted);
}
.empty {
  padding: 20px 0;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
</style>
