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

async function onActivate() {
  window.addEventListener('scroll', onScroll, { passive: true })
  // 从播放器返回：保留已加载列表与滚动位置（播放器不会改动库内容）。
  // 其他来源（管理功能、历史、收藏、设置等）返回：始终重新拉取，
  // 保证隐藏/取消隐藏等管理操作立即生效，不再显示旧数据。
  if (getLastFromRoute() === 'player' && store.loaded) {
    // 返回媒体库：先恢复滚动，等列表渲染后校准一次
    window.scrollTo(0, store.scrollTop)
    await nextTick()
    window.scrollTo(0, store.scrollTop)
  } else {
    if (!store.loaded) store.applyPrefs(auth.user?.prefs)
    await store.fetch('replace')
  }
}
function onDeactivate() {
  store.rememberScroll(window.scrollY)
  store.flushPrefs()
  window.removeEventListener('scroll', onScroll)
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
