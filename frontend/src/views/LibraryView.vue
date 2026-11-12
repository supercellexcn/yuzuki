<template>
  <div class="library">
    <!-- 已选条件：搜索 / 排序控件已搬到顶栏，作品数量放进搜索框占位符 -->
    <div v-if="store.hasFilter" class="status-row">
      <div class="active-conds">
        <el-tag v-if="store.q" ref="searchTagRef" closable @close="store.setQuery('')">搜索: {{ store.q }}</el-tag>
        <el-tag
          v-for="(c, i) in store.conditions"
          :key="i"
          closable
          :type="tagType(c.type)"
          @close="store.removeConditionAt(i)"
        >
          {{ typeLabel(c.type) }}: {{ c.value }}
        </el-tag>
      </div>
      <div class="status-right">
        <el-button size="small" plain @click="store.clearFilter()">清除筛选</el-button>
      </div>
    </div>

    <!-- 列表主体 -->
    <div v-if="store.loading && !displayItems.length && !store.randomMode" class="empty">加载中…</div>
    <div v-else-if="!displayItems.length" class="empty">
      <template v-if="store.hasFilter">没有匹配的作品</template>
      <template v-else>暂无作品，请先在「设置」中配置 ASMR 源路径并扫描。</template>
    </div>

    <div v-else class="grid">
      <WorkCard
        v-for="w in displayItems"
        :key="w.id"
        :work="w"
        @select-circle="(v) => addCond('circle', v)"
        @select-series="(v) => addCond('series', v)"
        @select-actor="(v) => addCond('actor', v)"
        @select-tag="(v) => addCond('tag', v)"
      />
    </div>

    <div v-if="displayItems.length && !store.randomMode" class="end-tip">
      <span v-if="store.loading && store.hasMore" class="loading">加载中…</span>
      <span v-else-if="store.loaded && !store.hasMore">—— 已经加载所有 ——</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onActivated, onDeactivated } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { ElMessage } from 'element-plus'
import { getLastFromRoute } from '../router'
import { useLibraryStore } from '../stores/library'
import { useAuthStore } from '../stores/auth'
import type { FilterCondType } from '../api/types'
import WorkCard from '../components/WorkCard.vue'

const store = useLibraryStore()
const auth = useAuthStore()

/**
 * 「搜索:」标签只应该包含 Vue 渲染的那一段文本。
 *
 * Vue 更新插值时只改自己那个文本节点，不会清理别人（例如用户脚本/扩展）追加到标签里的
 * 节点，看起来就像标签把旧内容留下了。这里在搜索词变化后做一次就地清理：
 * 把标签里非 Vue 渲染的元素/文本节点 remove 掉 —— 只动多余的节点，不重建标签本身。
 */
const searchTagRef = ref<ComponentPublicInstance | null>(null)
function stripForeignNodes() {
  const root = searchTagRef.value?.$el as HTMLElement | undefined
  if (!root) return
  const expected = `搜索: ${store.q}`
  const content = root.querySelector('.el-tag__content')
  // 内容区：Vue 只放一个文本节点。去掉多余节点后文本仍正确时才动手，避免误删正文
  if (content && content.textContent !== expected) {
    for (const node of Array.from(content.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE) node.remove()
    }
    const texts = Array.from(content.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE)
    const mine = texts.filter((n) => n.nodeValue === expected)
    if (texts.length > 1 && mine.length === 1) {
      for (const t of texts) if (t !== mine[0]) t.remove()
    }
  }
  // 标签根节点：除内容区、关闭按钮外的元素，以及非空的直接文本节点，都是外来的
  if (root.textContent !== expected) {
    for (const node of Array.from(root.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        if ((node.nodeValue || '').trim() !== '') node.remove()
        continue
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue
      const el = node as HTMLElement
      if (el.classList.contains('el-tag__content') || el.classList.contains('el-tag__close')) continue
      el.remove()
    }
  }
}
watch(
  () => store.q,
  async () => {
    await nextTick()
    stripForeignNodes()
    // 外部脚本可能晚一点才注入，补两次
    setTimeout(stripForeignNodes, 300)
    setTimeout(stripForeignNodes, 1000)
  }
)

const displayItems = computed(() => (store.randomMode ? store.randomItems : store.items))

function addCond(type: FilterCondType, v: string) {
  const ok = store.addCondition(type, v)
  if (!ok) ElMessage.warning('最多 5 个筛选条件')
}
function typeLabel(t: FilterCondType): string {
  return { circle: '社团', series: '系列', actor: '声优', tag: '标签' }[t]
}
function tagType(t: FilterCondType): 'success' | 'primary' | 'warning' | 'info' {
  return t === 'circle' ? 'success' : t === 'series' ? 'primary' : t === 'actor' ? 'warning' : 'info'
}

function onScroll() {
  store.rememberScroll(window.scrollY)
  const doc = document.documentElement
  if (window.innerHeight + window.scrollY >= doc.scrollHeight - 300 && !store.randomMode) {
    store.loadMore()
  }
}

/** 页面当前是否处于激活（keep-alive）状态；失活期间不做自动填充。 */
const active = ref(false)

/**
 * 大屏幕上第一页可能整页都放得下：没有滚动条就永远不会派发 scroll 事件，
 * 「加载更多」看起来就失效了（即使滚动鼠标也没有可滚动的距离）。
 * 这里在每次渲染后主动检查：只要页面还撑不出滚动条、且还有更多数据，
 * 就继续加载下一页，直到页面可滚动或数据取完。
 *
 * 串行加载并设页数上限，接口异常 / 数据不增长时立即停止，避免空转。
 */
let filling = false
let refill = false
async function fillViewport() {
  if (!active.value) return
  // 正在补页时不能直接丢弃：这次检查可能对应刚落库的新列表
  if (filling) {
    refill = true
    return
  }
  filling = true
  try {
    for (let i = 0; i < 50; i++) {
      if (!active.value || store.randomMode || !store.loaded || !store.hasMore) return
      /*
       * 用 onScroll 的触发线作为判断：页面底部的滚动余量已经不足 300px 时，
       * 用户滚到顶部就已经满足「接近列表底部」的条件，再怎么滚也触发不了新的加载
       * （大屏幕上第一页常常整页放得下，滚动余量甚至是 0）。
       * 这时继续补页，直到余量足够或数据取完。
       * 把播放条预留的底部留白也算进去，避免几十像素的假滚动空间被当成「能滚」。
       */
      if (document.documentElement.scrollHeight - window.innerHeight > 300) return
      const before = store.items.length
      try {
        await store.loadMore()
      } catch {
        return
      }
      await nextTick()
      // 没拿到新数据（请求失败 / 并发保护提前返回）就停，避免死循环
      if (store.items.length === before) return
    }
  } finally {
    filling = false
    // 补页期间有新列表落库：再校准一次，避免这一轮检查被重入直接丢掉
    if (refill) {
      refill = false
      if (active.value) void fillViewport()
    }
  }
}

function onResize() {
  void fillViewport()
}

// 每次列表成功落库都校准一次是否需要补页。
// 不能挂在 loading 的 true→false 边沿：筛选 / 搜索 / 清空请求可能重叠，
// 最后完成的那个复位 loading 时是 false→false，watch 根本不会触发（清空搜索只剩一屏的根因）。
watch(
  () => store.loadSeq,
  () => void fillViewport(),
  // 必须等列表重新渲染后再检查滚动余量：默认的 pre 时机会读到上一份列表的旧布局，
  // 清空搜索等「替换列表」场景下会被旧布局误导而提前 return，导致只加载一屏。
  { flush: 'post' }
)

async function onActivate() {
  active.value = true
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize, { passive: true })
  // 从播放器返回：保留已加载列表与滚动位置（播放器不会改动库内容）。
  // 其他来源（管理功能、历史、收藏、设置等）返回：始终重新拉取，
  // 保证隐藏/取消隐藏等管理操作立即生效，不再显示旧数据。
  if (getLastFromRoute() === 'player' && store.loaded) {
    // 返回媒体库：先恢复滚动，等列表渲染后校准一次
    window.scrollTo(0, store.scrollTop)
    await nextTick()
    window.scrollTo(0, store.scrollTop)
    void fillViewport()
  } else {
    if (!store.loaded) store.applyPrefs(auth.user?.prefs)
    await store.fetch('replace')
    void fillViewport()
  }
}
function onDeactivate() {
  active.value = false
  store.rememberScroll(window.scrollY)
  store.flushPrefs()
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onResize)
}
onActivated(onActivate)
onDeactivated(onDeactivate)

// 条件/排序变化时回顶部
watch(
  () => [store.conditions.length, store.q, store.sort, store.order],
  () => {
    if (!store.randomMode) window.scrollTo(0, 0)
  }
)
</script>

<style scoped>
.library {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.status-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.status-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.active-conds {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.grid {
  display: grid;
  /* 卡片尺寸由设置决定（--card-min-width 由 useAppearance 写入） */
  grid-template-columns: repeat(auto-fill, minmax(var(--card-min-width), 1fr));
  gap: 16px;
}
.empty {
  padding: 60px 0;
  text-align: center;
  color: var(--muted);
  font-size: 15px;
}
.end-tip {
  padding: 12px 0 4px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
}
.end-tip .loading {
  color: var(--accent);
}
</style>
