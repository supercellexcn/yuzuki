<template>
  <div class="app">
    <header class="topbar">
      <router-link to="/" class="brand">Yuzuki</router-link>
      <nav class="nav">
        <router-link to="/" class="nav-link">媒体库</router-link>
      </nav>
      <div class="spacer" />
      <button class="top-btn" title="回到顶部" @click="scrollToTop">T</button>
      <div v-if="auth.user" ref="userWrapRef" class="user-wrap">
        <span class="user-btn" @click="menuOpen = !menuOpen">
          <span class="avatar">{{ (auth.user.username || 'U').slice(0, 1).toUpperCase() }}</span>
          <span class="user-name">{{ auth.user.username }}</span>
          <span class="caret">▾</span>
        </span>
        <!-- 自定义用户菜单：打开状态下点击/触摸外部任意元素或滚动屏幕即关闭 -->
        <div v-if="menuOpen" class="user-menu">
          <!-- 管理功能仅桌面端提供（移动端由路由守卫拦截 /admin） -->
          <button v-if="!isMobile" class="user-menu-item admin" @click="onUserCommand('admin')">⚙ 管理功能</button>
          <button class="user-menu-item" @click="onUserCommand('settings')">设置</button>
          <button class="user-menu-item" @click="onUserCommand('change-password')">修改密码</button>
          <div class="user-menu-divider" />
          <button class="user-menu-item danger" @click="onUserCommand('logout')">退出登录</button>
        </div>
      </div>
    </header>

    <main class="content" :class="{ 'has-player': !!player.current }">
      <router-view v-slot="{ Component, route }">
        <keep-alive>
          <component :is="Component" v-if="route.meta.keepAlive" :key="route.name" />
        </keep-alive>
        <component :is="Component" v-if="!route.meta.keepAlive" />
      </router-view>
    </main>

    <BottomPlayer />
    <FullscreenPlayer />
    <FavPicker />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { usePlayerStore } from './stores/player'
import { useFavoritesStore } from './stores/favorites'
import { useIsMobile } from './composables/useIsMobile'
import { resetAdminPageSize } from './composables/useAdminPageSize'
import BottomPlayer from './components/BottomPlayer.vue'
import FullscreenPlayer from './components/FullscreenPlayer.vue'
import FavPicker from './components/FavPicker.vue'

const router = useRouter()
const auth = useAuthStore()
const player = usePlayerStore()
const favorites = useFavoritesStore()
const isMobile = useIsMobile()

// 用户菜单：打开状态下，点击/触摸外部任意元素或页面滚动即关闭（不依赖 element-plus 内部状态）
const userWrapRef = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
function onGlobalPointerDown(e: PointerEvent) {
  if (!menuOpen.value) return
  const wrap = userWrapRef.value
  if (wrap && e.target instanceof Node && wrap.contains(e.target)) return
  menuOpen.value = false
}
function onGlobalScroll() {
  if (menuOpen.value) menuOpen.value = false
}

/**
 * 页面滚动时关闭所有 element-plus 弹层（排序下拉、筛选 popover 等）。
 * el-select 用 click-outside 指令（监听 mousedown+mouseup）；el-popover/el-tooltip
 * 用 @vueuse onClickOutside（监听 click）。合成派发三种事件即可统一关闭。
 * 仅监听页面滚动（非 capture 的 window scroll），不会因弹层内部列表滚动而误关。
 */
function closePoppersOnPageScroll() {
  document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1 }))
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, detail: 1 }))
  document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
}
onMounted(() => {
  window.addEventListener('pointerdown', onGlobalPointerDown, true)
  // 用户菜单：capture 阶段，任意滚动（含弹层内部）都收起
  window.addEventListener('scroll', onGlobalScroll, { capture: true, passive: true })
  // 其他 element-plus 弹层：页面滚动才关闭
  window.addEventListener('scroll', closePoppersOnPageScroll, { passive: true })
})
onUnmounted(() => {
  window.removeEventListener('pointerdown', onGlobalPointerDown, true)
  window.removeEventListener('scroll', onGlobalScroll, { capture: true })
  window.removeEventListener('scroll', closePoppersOnPageScroll)
})

// 登录就绪后加载收藏状态（供全站长按判定 isFav）；登出时清空，防止下个用户复用
watch(
  () => auth.user,
  (u) => {
    if (u) void favorites.init()
    else {
      favorites.reset()
      // 登出后重置管理分页缓存，避免下个用户复用上一个用户的偏好
      resetAdminPageSize()
    }
  },
  { immediate: true }
)

function onUserCommand(cmd: string) {
  menuOpen.value = false
  if (cmd === 'admin') {
    router.push({ name: 'admin' })
  } else if (cmd === 'settings') {
    router.push({ name: 'settings' })
  } else if (cmd === 'change-password') {
    router.push({ name: 'change-password' })
  } else if (cmd === 'logout') {
    auth.logout()
    router.push({ name: 'login' })
  }
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<style>
:root {
  --bg: #121417;
  --panel: #1b1e24;
  --border: #2a2e37;
  --text: #e8ebf0;
  --muted: #9aa3b0;
  --accent: #6ea8fe;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 15px;
  font-weight: 500;
  -webkit-font-smoothing: antialiased;
}
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 24px;
  height: 60px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
}
.brand {
  font-weight: 700;
  font-size: 20px;
  color: var(--accent);
  text-decoration: none;
  letter-spacing: 0.5px;
}
.nav {
  display: flex;
  gap: 6px;
}
.nav-link {
  color: var(--muted);
  text-decoration: none;
  font-size: 15px;
  padding: 7px 16px;
  border-radius: 999px;
  transition: all 0.15s;
}
.nav-link:hover {
  color: var(--text);
  background: #23272f;
}
.nav-link.router-link-active {
  color: var(--accent);
  background: #1d2a3d;
  font-weight: 600;
}
.spacer {
  flex: 1;
}
.top-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
  outline: none;
}
.top-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: #22262d;
}
.user-wrap {
  position: relative;
  display: inline-flex;
}
.user-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 140px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  z-index: 300;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.user-menu-item {
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 14px;
  text-align: left;
  padding: 9px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s;
}
.user-menu-item:hover {
  background: #23272f;
  color: var(--accent);
}
.user-menu-item.admin {
  color: var(--accent);
  font-weight: 600;
}
.user-menu-item.admin:hover {
  background: #1d2a3d;
}
.user-menu-item.danger {
  color: #e88;
}
.user-menu-item.danger:hover {
  background: rgba(238, 136, 136, 0.12);
  color: #e88;
}
.user-menu-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
.user-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-radius: 999px;
  cursor: pointer;
  color: var(--text);
  border: 1px solid var(--border);
  transition: all 0.15s;
  outline: none;
}
.user-btn:hover {
  border-color: var(--accent);
  background: #22262d;
}
.avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--accent);
  color: #0b0e12;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
}
.user-name {
  font-size: 14px;
}
/* 自定义标签（category === 'custom'）：与 DLsite/hvdb 原生标签做颜色区分 */
.tag-custom {
  color: #8ee0c0 !important;
  border-color: #2a5a4d !important;
}
.tag-custom.el-tag {
  background: #1d3a33 !important;
}
.caret {
  color: var(--muted);
  font-size: 10px;
}
.content {
  flex: 1;
  padding: 24px;
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
}
/* 有播放条时预留底部空间，避免遮挡内容 */
.content.has-player {
  padding-bottom: 150px;
}
@media (max-width: 760px) {
  .content.has-player {
    padding-bottom: 170px;
  }
}
</style>
