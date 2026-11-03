<template>
  <aside class="sidebar" :class="{ collapsed }">
    <!-- 网站图标 + 站名：点击回媒体库首页 -->
    <router-link to="/" class="sidebar-brand" title="返回首页" @click="onNavigate">
      <img src="/favicon.jpg" alt="Yuzuki" />
      <span class="sidebar-brand-name">Yuzuki</span>
    </router-link>

    <div class="sidebar-scroll">
      <FilterMenu
        variant="nav"
        icon="group"
        label="全部社团"
        :collapsed="collapsed"
        :items="circles"
        :active-values="activeOf('circle')"
        fav-type="circle"
        @select="(v) => addCond('circle', v)"
      />
      <FilterMenu
        variant="nav"
        icon="series"
        label="全部系列"
        :collapsed="collapsed"
        :items="series"
        :active-values="activeOf('series')"
        @select="(v) => addCond('series', v)"
      />
      <FilterMenu
        variant="nav"
        icon="actor"
        label="全部声优"
        :collapsed="collapsed"
        :items="actors"
        :active-values="activeOf('actor')"
        fav-type="actor"
        @select="(v) => addCond('actor', v)"
      />
      <FilterMenu
        variant="nav"
        icon="tag"
        label="全部标签"
        :collapsed="collapsed"
        :items="tags"
        :active-values="activeOf('tag')"
        fav-type="tag"
        @select="(v) => addCond('tag', v)"
      />

      <div class="sidebar-sep" />

      <router-link
        to="/favorites"
        class="sidebar-item"
        :title="collapsed ? '我的收藏' : undefined"
        @click="onNavigate"
      >
        <SidebarIcon name="star" />
        <span class="sidebar-label">我的收藏</span>
      </router-link>
      <!-- 管理功能仅桌面端提供（移动端由路由守卫拦截 /admin） -->
      <router-link
        to="/history"
        class="sidebar-item"
        :title="collapsed ? '最近播放' : undefined"
        @click="onNavigate"
      >
        <SidebarIcon name="history" />
        <span class="sidebar-label">最近播放</span>
      </router-link>
    </div>

    <div class="sidebar-bottom">
      <div ref="userWrapRef" class="sidebar-user-wrap">
        <button
          type="button"
          class="sidebar-item sidebar-user-btn"
          :class="{ open: menuOpen }"
          :title="collapsed ? auth.user?.username : undefined"
          @click="menuOpen = !menuOpen"
        >
          <span class="avatar">{{ initial }}</span>
          <span class="sidebar-label user-name">{{ auth.user?.username }}</span>
          <span class="caret">▾</span>
        </button>
        <!-- 用户菜单：从侧边栏右侧弹出；点击外部区域关闭 -->
        <div v-if="menuOpen" class="sidebar-user-menu">
          <button class="user-menu-item" @click="onCommand('change-password')">修改密码</button>
          <div class="user-menu-divider" />
          <button class="user-menu-item danger" @click="onCommand('logout')">退出登录</button>
        </div>
      </div>

      <!-- 管理功能仅桌面端提供（移动端由路由守卫拦截 /admin） -->
      <router-link
        v-if="!isMobile"
        to="/admin"
        class="sidebar-item"
        :title="collapsed ? '管理功能' : undefined"
        @click="onNavigate"
      >
        <SidebarIcon name="admin" />
        <span class="sidebar-label">管理功能</span>
      </router-link>

      <router-link
        to="/settings"
        class="sidebar-item"
        :title="collapsed ? '设置' : undefined"
        @click="onNavigate"
      >
        <SidebarIcon name="settings" />
        <span class="sidebar-label">设置</span>
      </router-link>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getCircles, getSeries, getActors, getTags } from '../api'
import type { CircleCount, SeriesCount, ActorCount, TagCount, FilterCondType } from '../api/types'
import { useLibraryStore } from '../stores/library'
import { useAuthStore } from '../stores/auth'
import { useIsMobile } from '../composables/useIsMobile'
import FilterMenu from './FilterMenu.vue'
import SidebarIcon from './SidebarIcon.vue'

defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ (e: 'navigate'): void }>()

const route = useRoute()
const router = useRouter()
const store = useLibraryStore()
const auth = useAuthStore()
const isMobile = useIsMobile()

const circles = ref<CircleCount[]>([])
const series = ref<SeriesCount[]>([])
const actors = ref<ActorCount[]>([])
const tags = ref<TagCount[]>([])

const initial = computed(() => (auth.user?.username || 'U').slice(0, 1).toUpperCase())

function activeOf(type: FilterCondType): string[] {
  return store.conditions.filter((c) => c.type === type).map((c) => c.value)
}

function addCond(type: FilterCondType, v: string) {
  const ok = store.addCondition(type, v)
  if (!ok) {
    ElMessage.warning('最多 5 个筛选条件')
    return
  }
  // 在其他页面选筛选条件 → 直接回媒体库看结果
  if (route.name !== 'library') router.push({ name: 'library' })
}

// ---- 筛选数据：进媒体库时刷新，保证管理端改名 / 扫描后这里跟着更新 ----
let loading = false
async function loadTaxonomy() {
  if (loading) return
  loading = true
  try {
    const [c, s, a, t] = await Promise.all([getCircles(), getSeries(), getActors(), getTags()])
    circles.value = c
    series.value = s
    actors.value = a
    tags.value = t
  } catch {
    /* 忽略 */
  } finally {
    loading = false
  }
}
onMounted(loadTaxonomy)
watch(
  () => route.name,
  (name) => {
    menuOpen.value = false
    if (name === 'library') void loadTaxonomy()
  }
)

// ---- 用户菜单 ----
const userWrapRef = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
function onGlobalPointerDown(e: PointerEvent) {
  if (!menuOpen.value) return
  const wrap = userWrapRef.value
  if (wrap && e.target instanceof Node && wrap.contains(e.target)) return
  menuOpen.value = false
}
onMounted(() => window.addEventListener('pointerdown', onGlobalPointerDown, true))
onUnmounted(() => window.removeEventListener('pointerdown', onGlobalPointerDown, true))

function onNavigate() {
  menuOpen.value = false
  emit('navigate')
}

function onCommand(cmd: string) {
  menuOpen.value = false
  emit('navigate')
  if (cmd === 'change-password') {
    router.push({ name: 'change-password' })
  } else if (cmd === 'logout') {
    auth.logout()
    router.push({ name: 'login' })
  }
}
</script>

<style scoped>
.sidebar {
  width: 220px;
  flex-shrink: 0;
  height: 100vh;
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-right: 1px solid var(--border);
  /* 收起比展开更干脆一点；仍跟随全局「动画时长」设置 */
  transition: width calc(var(--anim-duration) * 0.65) ease, transform var(--anim-duration);
  z-index: 250;
}
.sidebar.collapsed {
  width: 64px;
}
.sidebar-brand {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 15px 6px;
  overflow: hidden;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
}
.sidebar-brand:hover,
.sidebar-brand:focus,
.sidebar-brand:active,
.sidebar-brand:visited {
  text-decoration: none;
  outline: none;
}
.sidebar-brand img {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  object-fit: contain;
  background: #fff;
  display: block;
  flex-shrink: 0;
}
.sidebar-brand-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 0.5px;
  white-space: nowrap;
  transition: opacity calc(var(--anim-duration) * 0.65) ease;
}
.sidebar.collapsed .sidebar-brand-name {
  opacity: 0;
}
.sidebar-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* 滚动条在深色侧栏里太重，细一点 */
.sidebar-scroll::-webkit-scrollbar {
  width: 6px;
}
.sidebar-scroll::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}
.sidebar-sep {
  height: 1px;
  margin: 8px 6px;
  background: var(--border);
  flex-shrink: 0;
}
.sidebar.collapsed .sidebar-sep {
  margin: 8px 4px;
}
.sidebar-bottom {
  flex-shrink: 0;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sidebar-user-wrap {
  position: relative;
}
.sidebar-user-btn .avatar {
  width: 24px;
  height: 24px;
  font-size: 13px;
}
.caret {
  margin-left: auto;
  color: var(--muted);
  font-size: 25px;
  line-height: 1;
  flex-shrink: 0;
  transition: opacity calc(var(--anim-duration) * 0.65) ease;
}
.sidebar.collapsed .caret {
  opacity: 0;
}
.user-name {
  flex: initial;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 用户菜单从侧边栏右侧弹出（左 → 右），底边与按钮对齐 */
.sidebar-user-menu {
  position: absolute;
  left: calc(100% + 8px);
  bottom: 0;
  min-width: 140px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  z-index: 320;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
/* 移动端抽屉旁放不下右侧菜单，改为在按钮上方展开 */
@media (max-width: 760px) {
  .sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    height: 100vh;
    width: 260px;
    transform: translateX(-100%);
    /* 抽屉盖在页面上，半透明会把背后内容透出来，这里改用不透明面板色 */
    background: rgb(var(--panel-rgb));
  }
  .sidebar-user-menu {
    left: 0;
    right: 0;
    bottom: calc(100% + 6px);
    min-width: 0;
  }
}
</style>
