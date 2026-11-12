<template>
  <el-popover
    v-model:visible="visible"
    trigger="click"
    :placement="placement"
    :width="popoverWidth"
    :popper-class="popoverClass"
  >
    <template #reference>
      <!-- 顶栏旧样式（未使用）与侧边栏样式共用同一套弹层内容 -->
      <button
        v-if="variant === 'nav'"
        type="button"
        class="sidebar-item filter-nav"
        :class="{ 'is-active': hasActive }"
        :title="collapsed ? label : undefined"
      >
        <SidebarIcon v-if="icon" :name="icon" />
        <span class="sidebar-label">{{ label }}</span>
        <span v-if="hasActive" class="sidebar-badge">{{ activeValues.length }}</span>
        <span class="sidebar-caret" :class="{ open: visible }">▸</span>
      </button>
      <el-button v-else :type="hasActive ? 'primary' : 'default'" plain size="default">
        {{ label }}<span class="caret">▾</span>
      </el-button>
    </template>

    <div class="chip-menu" @wheel="onPopoverWheel">
      <el-input v-model="kw" placeholder="搜索…" clearable size="small" class="search" />
      <div class="chips" @scroll.passive="onChipsScroll">
        <span
          v-for="it in filtered"
          :key="it.name + '|' + (it.category || '')"
          class="chip"
          :class="{ active: activeValues.includes(it.name), 'chip-custom': it.category === CUSTOM_TAG }"
          @click="pick(it.name)"
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
import { ref, computed, watch, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { CUSTOM_TAG } from '../api/types'
import { useIsMobile } from '../composables/useIsMobile'
import SidebarIcon from './SidebarIcon.vue'

const props = withDefaults(
  defineProps<{
    label: string
    items: { name: string; count: number; category?: string }[]
    activeValues: string[]
    /** nav = 侧边栏条目；button = 旧的筛选项按钮 */
    variant?: 'nav' | 'button'
    icon?: string
    /** 侧边栏收起时只显示图标 */
    collapsed?: boolean
  }>(),
  { variant: 'button', collapsed: false }
)
const emit = defineEmits<{ (e: 'select', name: string): void }>()

const isMobile = useIsMobile()
const route = useRoute()
const visible = ref(false)
const kw = ref('')

// 在筛选弹层里选中条件后可能跳转到媒体库；页面变了就收起弹层
watch(
  () => route.name,
  () => {
    visible.value = false
  }
)

const hasActive = computed(() => props.activeValues.length > 0)
/*
 * 侧边栏在左侧：弹层默认从右边弹出（左 → 右）。
 * 移动端侧边栏是抽屉，宽度放不下右侧 380px 的弹层，改为向下弹出。
 */
const placement = computed(() => (isMobile.value ? 'bottom-start' : 'right-start'))
const popoverWidth = computed(() => (isMobile.value ? 300 : 380))

const filtered = computed(() => {
  const q = kw.value.trim().toLowerCase()
  const list = q ? props.items.filter((i) => i.name.toLowerCase().includes(q)) : props.items
  return list.slice(0, 300)
})

function pick(name: string) {
  emit('select', name)
}

/*
 * 弹层内滚动是元素滚动（scroll 事件不冒泡到 window），App.vue 的页面滚动降级
 * 对这里无效。这里只维护 is-scrolling 抑制 chip 的过渡与 hover 变化（不可见），
 * 不去动弹层的毛玻璃：滚动中临时去掉 backdrop-filter 会让整块玻璃忽清忽糊，
 * 视觉跳变很明显。列表滚动改由 .chips 的独立合成层承担，毛玻璃始终生效。
 */
const scrolling = ref(false)
let scrollIdleTimer: ReturnType<typeof setTimeout> | undefined
function onChipsScroll() {
  scrolling.value = true
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
  scrollIdleTimer = setTimeout(() => {
    scrollIdleTimer = undefined
    scrolling.value = false
  }, 2000)
}
const popoverClass = computed(() =>
  scrolling.value ? 'filter-popover is-scrolling' : 'filter-popover'
)
/** 关闭弹层时立即复位，避免下次打开时残留降级状态 */
watch(visible, (v) => {
  if (v) return
  scrolling.value = false
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
  scrollIdleTimer = undefined
})
onUnmounted(() => {
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer)
})

/*
 * 搜索框 / 底部提示不是滚动容器：在这些位置滚鼠标，wheel 会冒泡到 document，
 * 带动库页面一起滚动。弹层内只有 .chips 需要滚动，其余区域直接吞掉 wheel；
 * .chips 自身用 overscroll-behavior 阻断滚到边界后的滚动链。
 */
function onPopoverWheel(e: WheelEvent) {
  if (!(e.target instanceof Element) || !e.target.closest('.chips')) e.preventDefault()
}
</script>

<style scoped>
/* 右侧三角形：默认指向左边，弹层展开后指向右边 */
.sidebar-caret {
  font-size: 25px;
  line-height: 1;
  transform: rotate(180deg);
  transition: transform calc(var(--anim-duration) * 0.8) ease,
    opacity calc(var(--anim-duration) * 0.65) ease;
}
.sidebar-caret.open {
  transform: rotate(0deg);
}
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
  /* 滚到顶 / 底后不要把滚动交给页面（会触发全站滚动降级甚至关掉弹层） */
  overscroll-behavior: contain;
  /*
   * 列表滚动走合成线程、重绘范围只限列表内：带 backdrop-filter 的弹层滚动时，
   * 内容若不是独立合成层，整块玻璃会逐帧重绘。这两条不改变静态 / 滚动中的视觉。
   */
  will-change: scroll-position;
  contain: paint;
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
  transition: background-color var(--anim-duration), border-color var(--anim-duration),
    color var(--anim-duration);
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
/* 滚动中：滚过的 chip 会连续进出 hover，关掉过渡与边框变化避免逐帧重绘 */
.filter-popover.is-scrolling .chip {
  transition: none;
}
.filter-popover.is-scrolling .chip:not(.active):hover {
  border-color: transparent;
}
</style>
