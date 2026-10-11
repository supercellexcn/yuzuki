<template>
  <div class="app">
    <header class="topbar">
      <router-link to="/" class="brand">Yuzuki</router-link>
      <nav class="nav">
        <router-link to="/" class="nav-link">媒体库</router-link>
      </nav>
      <div class="spacer" />
      <!-- 图片模式：隐藏作品卡片下半部分信息，只保留封面 / RJ 角标 / 标签 -->
      <button
        class="top-btn"
        :class="{ active: imageOnly }"
        :title="imageOnly ? '退出图片模式' : '图片模式（只显示图片）'"
        @click="toggleImageOnly"
      >
        M
      </button>
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
import { useViewMode } from './composables/useViewMode'
import { useAppearance } from './composables/useAppearance'
import BottomPlayer from './components/BottomPlayer.vue'
import FullscreenPlayer from './components/FullscreenPlayer.vue'
import FavPicker from './components/FavPicker.vue'

const router = useRouter()
const auth = useAuthStore()
const player = usePlayerStore()
const favorites = useFavoritesStore()
const isMobile = useIsMobile()
const { imageOnly, toggleImageOnly } = useViewMode()
// 启动时应用外观（壁纸 / 模糊 / 主题配色 / 卡片尺寸），并在设置或视口变化时自动重算
useAppearance()

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
  /* 面板/页面底色拆成 rgb + alpha：接入壁纸时 alpha < 1，壁纸才能透出来 */
  --bg-rgb: 18, 20, 23;
  --panel-rgb: 27, 30, 36;
  --panel-alpha: 1;
  --panel: rgba(var(--panel-rgb), var(--panel-alpha));
  --border: #2a2e37;
  --text: #e8ebf0;
  --muted: #9aa3b0;
  --accent: #6ea8fe;

  /* ---- 外观变量（由 composables/useAppearance.ts 按设置覆盖）---- */
  --wallpaper-image: none;
  --wallpaper-blur: 6px;
  --card-blur: 2px;
  --filelist-blur: 2px;
  --control-blur: 1px;
  --card-min-width: 180px;
  /*
   * 默认配色：声优标签绿、类型标签橙；文字统一白色。
   * 底色这里必须也是半透明 —— 纯色会让标签完全没有透明/磨砂效果。
   */
  --tag-actor-bg: rgba(123, 200, 108, 0.62);
  --tag-actor-fg: #ffffff;
  --tag-genre-bg: rgba(242, 166, 90, 0.62);
  --tag-genre-fg: #ffffff;
  --card-meta-bg: transparent;
  /* 以下均由 useAppearance 按主题色算好（未设主题色时用这里的默认值） */
  --accent-fg: #0b0e12;
  --accent-soft: rgba(110, 168, 254, 0.2);
  --topbar-hover: rgba(232, 235, 240, 0.18);
  --topbar-line: rgba(232, 235, 240, 0.35);
  --topbar-chip: rgba(232, 235, 240, 0.22);
}
/* 控件圆角：由 Element Plus 默认的 4px 放大（提高特异性以覆盖其 :root 定义） */
:root:root {
  --el-border-radius-base: 12px;
}
* {
  box-sizing: border-box;
}
/* 壁纸层：铺满视口、位于所有内容之下；外扩一圈避免模糊后边缘露出底色 */
body::before {
  content: '';
  position: fixed;
  /*
   * 尺寸由 JS 算成像素（见 composables/useAppearance.ts 的 syncWallpaperSize）。
   * 移动端弹软键盘会让视口高度变小；若这里用 vh / inset 推导高度，壁纸就会跟着变矮，
   * background-size: cover 重新取景 —— 看起来就像「壁纸往上跳」。
   * 兜底用 vh / 百分比，保证 JS 跑到之前也有背景。
   */
  top: -48px;
  left: -48px;
  width: var(--wallpaper-w, calc(100% + 96px));
  height: var(--wallpaper-h, calc(100vh + 96px));
  z-index: -1;
  background-image: var(--wallpaper-image);
  background-size: cover;
  background-position: center;
  filter: blur(var(--wallpaper-blur));
  pointer-events: none;
}
/* 全屏播放器打开时锁住底层页面滚动（否则触摸滑动会穿透去滚动背后的列表） */
html.fs-open,
html.fs-open body {
  overflow: hidden;
}
/*
 * 图片模式：收起作品卡片下半部分信息区（保留封面 / RJ 角标 / 标签）。
 * 用 max-height + opacity 过渡，切换时是 0.5s 的收放动画而不是直接消失。
 */
html.image-only .work-card .meta {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}
/*
 * 控件磨砂：输入框 / 按钮 / 下拉等一律加上背景模糊。
 * 半透明底色由 useAppearance 通过覆盖 Element Plus 的 --el-fill-color-blank 统一给出
 * （带壁纸时才覆盖），这里只负责模糊本身。
 */
.el-input__wrapper,
.el-textarea__inner,
.el-select__wrapper,
.el-radio-button__inner,
.el-button:not(.is-text):not(.is-link) {
  backdrop-filter: blur(var(--control-blur));
}
/*
 * 设了主题色时，顶栏文字统一换成与背景对比的颜色，
 * 避免出现「蓝底蓝字」看不清；hover / 选中态用半透明叠加。
 */
html.has-nav-color .topbar .brand,
html.has-nav-color .topbar .nav-link,
html.has-nav-color .topbar .user-name,
html.has-nav-color .topbar .caret,
html.has-nav-color .topbar .top-btn {
  color: var(--topbar-fg);
}
html.has-nav-color .topbar .nav-link:hover,
html.has-nav-color .topbar .nav-link.router-link-active {
  color: var(--topbar-fg);
  background: var(--topbar-hover);
}
html.has-nav-color .topbar .top-btn:hover {
  border-color: var(--topbar-fg);
  color: var(--topbar-fg);
}
html.has-nav-color .topbar .user-btn {
  border-color: var(--topbar-line);
}
html.has-nav-color .topbar .user-btn:hover {
  border-color: var(--topbar-fg);
  background: var(--topbar-hover);
}
html.has-nav-color .topbar .avatar {
  background: var(--topbar-chip);
  color: var(--topbar-fg);
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
  /* 顶部导航栏颜色可设置；未设置时沿用面板色（接壁纸时半透明） */
  background: var(--topbar-color, var(--panel));
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
  /*
   * 这里刻意不加 backdrop-filter：
   * 1) 顶栏背后只有壁纸，而壁纸已被「壁纸模糊」整层模糊过，再叠一层看不出差别；
   * 2) 更关键 —— 顶栏一旦有 backdrop-filter，就会给后代建立 backdrop root，
   *    使「点 admin 弹出的用户菜单」的 backdrop-filter 只能在该 root 内取样（那里什么都没有），
   *    于是菜单的磨砂完全失效（实测：去掉这里，菜单立刻正常变模糊）。
   * 需要磨砂的顶栏内弹层自己带 backdrop-filter 即可。
   */
}
.brand {
  font-weight: 700;
  font-size: 20px;
  color: var(--accent);
  text-decoration: none;
  letter-spacing: 0.5px;
  flex-shrink: 0;
  white-space: nowrap;
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
  /* 窄屏时不允许换行/压缩，否则「媒体库」会竖排且背景溢出导航栏 */
  white-space: nowrap;
  flex-shrink: 0;
}
.nav-link:hover {
  color: var(--text);
  background: rgba(35, 39, 47, 0.65);
}
.nav-link.router-link-active {
  color: var(--accent);
  background: var(--accent-soft);
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
  /* 不被 flex 压缩，避免圆形按钮被挤成椭圆 */
  flex-shrink: 0;
}
.top-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(34, 38, 45, 0.65);
}
/* 图片模式开启态 */
.top-btn.active {
  border-color: var(--accent);
  color: var(--accent-fg);
  background: var(--accent);
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
  backdrop-filter: blur(var(--card-blur));
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
  background: rgba(35, 39, 47, 0.65);
  color: var(--accent);
}
.user-menu-item.admin {
  color: var(--accent);
  font-weight: 600;
}
.user-menu-item.admin:hover {
  background: var(--accent-soft);
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
  flex-shrink: 0;
  white-space: nowrap;
}
.user-btn:hover {
  border-color: var(--accent);
  background: rgba(34, 38, 45, 0.65);
}
.avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-fg);
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
  background: rgba(29, 58, 51, 0.78) !important;
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
  /* 窄屏：整体收紧，保证「媒体库」不换行、圆形按钮不变形、内容不溢出导航栏 */
  .topbar {
    gap: 8px;
    padding: 0 10px;
    height: 54px;
  }
  .brand {
    font-size: 16px;
    letter-spacing: 0;
  }
  .nav-link {
    font-size: 13px;
    padding: 5px 10px;
  }
  .top-btn {
    width: 30px;
    height: 30px;
    font-size: 13px;
  }
  .user-btn {
    padding: 3px 7px;
    gap: 5px;
  }
  /* 用户名在窄屏收起，只留头像，避免挤爆导航栏 */
  .user-name {
    display: none;
  }
  .avatar {
    width: 22px;
    height: 22px;
    font-size: 12px;
  }
}
</style>
