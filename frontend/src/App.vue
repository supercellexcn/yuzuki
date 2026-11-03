<template>
  <div
    class="app"
    :class="{
      'sidebar-collapsed': sidebarCollapsed && !isMobile,
      'mobile-sidebar-open': mobileSidebarOpen,
      'has-player': !!player.current,
    }"
    :style="{ '--sidebar-w': sidebarWidth }"
  >
    <!-- 移动端侧边栏抽屉的遮罩 -->
    <div
      v-if="isMobile && mobileSidebarOpen"
      class="sidebar-backdrop"
      @click="mobileSidebarOpen = false"
    />

    <AppSidebar
      v-if="showChrome"
      :collapsed="sidebarCollapsed && !isMobile"
      @navigate="mobileSidebarOpen = false"
    />

    <div class="app-main">
      <header class="topbar" :class="{ 'has-controls': isLibrary }">
        <button
          v-if="showChrome"
          class="top-btn side-toggle"
          :title="toggleTitle"
          @click="toggleSidebar"
        >
          <SidebarIcon name="menu" />
        </button>
        <router-link v-if="!showChrome" to="/" class="topbar-logo" title="Yuzuki">
          <img src="/favicon.jpg" alt="Yuzuki" />
        </router-link>

        <!-- 媒体库的搜索 / 排序控件搬到顶栏，合并成一条紧凑控件 -->
        <div v-if="isLibrary" class="topbar-controls">
          <SearchBar
            :model-value="library.q"
            size="default"
            :placeholder="searchPlaceholder"
            @update:model-value="library.setQueryDraft"
            @search="library.setQuery"
          />
          <div class="sort-ctrl">
            <div class="sort-tabs" role="radiogroup" aria-label="排序指标">
              <button
                v-for="o in SORT_OPTIONS"
                :key="o.value"
                type="button"
                class="sort-tab"
                :class="{ active: library.sort === o.value }"
                role="radio"
                :aria-checked="library.sort === o.value"
                @click="library.setSort(o.value)"
              >
                {{ o.label }}
              </button>
            </div>
            <!-- 升降序：一个文字按钮，点击在「升 / 降」之间切换 -->
            <button
              class="order-toggle"
              type="button"
              :title="library.order === 'desc' ? '当前降序，点击切换为升序' : '当前升序，点击切换为降序'"
              @click="library.toggleOrder()"
            >
              {{ library.order === 'desc' ? '降' : '升' }}
            </button>
          </div>
        </div>

        <div class="spacer" />
        <!-- 桌面端保留 R / M / T；移动端改为可拖动的悬浮按钮组 -->
        <div v-if="!isMobile" class="topbar-actions">
          <!-- 随机推荐，与 M / T 一样作为顶栏圆形按钮 -->
          <button
            v-if="isLibrary"
            class="top-btn"
            :class="{ active: library.randomMode }"
            :disabled="library.randomLoading"
            :title="library.randomMode ? '换一批随机推荐' : '随机推荐'"
            @click="library.toggleRandom()"
          >
            R
          </button>
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
    </div>

    <BottomPlayer />
    <FullscreenPlayer />
    <FavPicker />
    <MobileDock v-if="isMobile && showChrome" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { usePlayerStore } from './stores/player'
import { useFavoritesStore } from './stores/favorites'
import { useLibraryStore, SORT_OPTIONS } from './stores/library'
import { useIsMobile } from './composables/useIsMobile'
import { resetAdminPageSize } from './composables/useAdminPageSize'
import { useViewMode } from './composables/useViewMode'
import { useAppearance } from './composables/useAppearance'
import AppSidebar from './components/AppSidebar.vue'
import BottomPlayer from './components/BottomPlayer.vue'
import FullscreenPlayer from './components/FullscreenPlayer.vue'
import FavPicker from './components/FavPicker.vue'
import SearchBar from './components/SearchBar.vue'
import SidebarIcon from './components/SidebarIcon.vue'
import MobileDock from './components/MobileDock.vue'

const route = useRoute()
const auth = useAuthStore()
const player = usePlayerStore()
const favorites = useFavoritesStore()
const library = useLibraryStore()
const isMobile = useIsMobile()
const { imageOnly, toggleImageOnly } = useViewMode()
// 启动时应用外观（壁纸 / 模糊 / 主题配色 / 卡片尺寸），并在设置或视口变化时自动重算
useAppearance()

const isLibrary = computed(() => route.name === 'library')
// 登录 / 首次改密页不显示侧边栏（这些页面没有可操作的后台数据）
const showChrome = computed(() => route.name !== 'login' && route.name !== 'change-password')

// ---- 侧边栏：桌面端展开 / 收起，移动端作为左侧抽屉 ----
const SIDEBAR_KEY = 'yuzuki_sidebar_collapsed'
function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}
const sidebarCollapsed = ref(readSidebarCollapsed())
const mobileSidebarOpen = ref(false)

/** 侧边栏实际宽度：播放条用它让出左侧空间（移动端抽屉不占位）。 */
const sidebarWidth = computed(() => {
  if (!showChrome.value || isMobile.value) return '0px'
  return sidebarCollapsed.value ? '64px' : '220px'
})
const toggleTitle = computed(() => {
  if (isMobile.value) return mobileSidebarOpen.value ? '关闭侧边栏' : '打开侧边栏'
  return sidebarCollapsed.value ? '展开侧边栏' : '收起侧边栏'
})
function toggleSidebar() {
  if (isMobile.value) {
    mobileSidebarOpen.value = !mobileSidebarOpen.value
  } else {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }
}
watch(sidebarCollapsed, (v) => {
  try {
    localStorage.setItem(SIDEBAR_KEY, v ? '1' : '0')
  } catch {
    /* 隐私模式下写入失败，忽略 */
  }
})
watch(isMobile, (m) => {
  if (!m) mobileSidebarOpen.value = false
})
watch(
  () => route.name,
  () => {
    mobileSidebarOpen.value = false
  }
)
// 抽屉打开时锁住底层页面滚动
watch(mobileSidebarOpen, (v) => {
  document.documentElement.classList.toggle('drawer-open', v && isMobile.value)
})

/** 作品数量放进搜索框占位符，顶栏不再单独占一行显示数量。 */
const searchPlaceholder = computed(() => {
  const count = library.randomMode
    ? `随机推荐 ${library.randomItems.length} 个`
    : `共 ${library.total} 个作品`
  // 移动端搜索框很窄，去掉空格并缩小字号，保证数量能完整显示
  if (isMobile.value) return count.replace(/\s/g, '')
  return `${count} · 搜索标题 / RJ号 / 声优 / 标签…`
})

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
  // 页面滚动关闭 element-plus 弹层
  window.addEventListener('scroll', closePoppersOnPageScroll, { passive: true })
})
onUnmounted(() => {
  window.removeEventListener('scroll', closePoppersOnPageScroll)
  document.documentElement.classList.remove('drawer-open')
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
  --card-min-width: 180px;
  /*
   * 各表面底色的不透明度。全站只有「壁纸」做模糊（--wallpaper-blur）：
   * 壁纸已经整层糊过，面板/标签再叠一层 backdrop-filter 几乎看不出差别，
   * 却要给每个元素建一个合成层（媒体库几千张卡片时就是几万个），代价远大于收益。
   * 所以这些表面只调「底色透多少」。
   * 有壁纸时由 useAppearance 按设置覆盖；没有壁纸时面板保持不透明，
   * 否则半透明面板盖在纯色背景上会糊成一片、失去层次。
   */
  --filelist-alpha: 1;
  --control-rgb: 38, 43, 51;
  --control-alpha: 0.7;
  --control-bg: rgba(var(--control-rgb), var(--control-alpha));
  --filelist-panel: rgba(var(--panel-rgb), var(--filelist-alpha));
  /* 全局动画时长：所有 transition/animation 都读它（由 useAppearance 按设置覆盖）。
     0s 即关闭动画。 */
  --anim-duration: 0.25s;
  /*
   * 默认配色：声优标签绿、类型标签橙；文字统一白色。
   * 底色这里必须也是半透明 —— 纯色会让标签完全没有透明效果。
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
/* 移动端侧边栏抽屉打开时同样锁住底层滚动 */
html.drawer-open,
html.drawer-open body {
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
 * 控件（输入框 / 按钮 / 下拉）的底色由 useAppearance 覆盖 Element Plus 的
 * --el-fill-color-blank 统一给出（带壁纸时才覆盖），这里不再额外加模糊。
 */
/*
 * 设了主题色时，顶栏文字统一换成与背景对比的颜色，
 * 避免出现「蓝底蓝字」看不清；hover / 选中态用半透明叠加。
 */
html.has-nav-color .topbar .brand,
html.has-nav-color .topbar .top-btn {
  color: var(--topbar-fg);
}
html.has-nav-color .topbar .top-btn:hover {
  border-color: var(--topbar-fg);
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
}
/* 顶栏 + 内容区：侧边栏占据左侧后，右侧自适应 */
.app-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
/* 移动端侧边栏抽屉的遮罩 */
.sidebar-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 240;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  min-height: 60px;
  /* 顶部导航栏颜色可设置；未设置时沿用面板色（接壁纸时半透明） */
  background: var(--topbar-color, var(--panel));
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
  flex-shrink: 0;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
/* 顶栏左侧的侧边栏开关 */
.side-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
/* 搜索栏 + 排序控件合并成一条紧凑控件（参考图：一整条，内部分段） */
.topbar-controls {
  display: flex;
  align-items: stretch;
  flex: 1 1 520px;
  max-width: 640px;
  min-width: 0;
  height: 38px;
  background: var(--control-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}
.topbar .topbar-controls .searchbar {
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
  max-width: none;
  height: 100%;
  display: flex;
}
.topbar-controls .el-input {
  height: 100%;
}
.topbar-controls .el-input__wrapper {
  height: 100%;
  padding: 0 12px;
  background: transparent;
  border-radius: 0;
  box-shadow: none !important;
}
.topbar-controls .el-input__inner {
  height: 100%;
}
/* 搜索与排序之间的分界线：明显一些 */
.sort-ctrl {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  border-left: 1px solid rgba(232, 235, 240, 0.5);
}
.sort-ctrl .sort-tabs {
  display: flex;
  align-items: stretch;
  height: 100%;
}
.sort-tab {
  height: 100%;
  padding: 0 12px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background var(--anim-duration), color var(--anim-duration);
}
/* 入库 / 发售 / 销量之间的分隔线：浅一些 */
.sort-tab + .sort-tab {
  border-left: 1px solid rgba(232, 235, 240, 0.12);
}
.sort-tab:hover {
  background: rgba(255, 255, 255, 0.08);
}
.sort-tab.active {
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
}
/* 升降序：文字按钮，点击在「升 / 降」之间切换 */
.order-toggle {
  flex-shrink: 0;
  height: 100%;
  padding: 0 14px;
  border: none;
  border-left: 1px solid rgba(232, 235, 240, 0.12);
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--anim-duration), color var(--anim-duration);
}
.order-toggle:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
.topbar-logo {
  display: inline-flex;
  flex-shrink: 0;
}
.topbar-logo img {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  object-fit: contain;
  background: #fff;
  display: block;
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
  transition: all var(--anim-duration);
  outline: none;
  /* 不被 flex 压缩，避免圆形按钮被挤成椭圆 */
  flex-shrink: 0;
}
.top-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(34, 38, 45, 0.65);
}
.top-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.top-btn:disabled:hover {
  border-color: var(--border);
  color: var(--text);
  background: transparent;
}
/* 图片模式 / 随机模式开启态 */
.top-btn.active {
  border-color: var(--accent);
  color: var(--accent-fg);
  background: var(--accent);
}
/*
 * 侧边栏条目：筛选菜单（FilterMenu）与普通导航链接共用。
 * 收起时只渲染图标，因此这里不需要再隐藏标签。
 */
.sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 0 12px;
  /* 收起时靠容器宽度从右往左裁掉文字，图标保持原位 */
  overflow: hidden;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background var(--anim-duration), color var(--anim-duration);
}
.sidebar-item:hover {
  background: rgba(35, 39, 47, 0.65);
  color: var(--accent);
}
.sidebar-item.is-active,
.sidebar-item.router-link-active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.sidebar-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.sidebar-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: opacity calc(var(--anim-duration) * 0.65) ease;
}
.sidebar.collapsed .sidebar-label,
.sidebar.collapsed .sidebar-caret,
.sidebar.collapsed .sidebar-badge {
  opacity: 0;
}
.sidebar-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--accent);
  color: var(--accent-fg);
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity calc(var(--anim-duration) * 0.65) ease;
}
.sidebar-caret {
  font-size: 10px;
  color: var(--muted);
  flex-shrink: 0;
  transition: opacity calc(var(--anim-duration) * 0.65) ease;
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
  transition: all var(--anim-duration);
}
.user-menu-item:hover {
  background: rgba(35, 39, 47, 0.65);
  color: var(--accent);
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
  flex-shrink: 0;
}
/* 自定义标签（category === 'custom'）：与 DLsite/hvdb 原生标签做颜色区分 */
.tag-custom {
  color: #8ee0c0 !important;
  border-color: #2a5a4d !important;
}
.tag-custom.el-tag {
  background: rgba(29, 58, 51, 0.78) !important;
}
.content {
  flex: 1;
  padding: 14px 20px 24px;
  width: 100%;
  margin: 0 auto;
}
/* 有播放条时预留底部空间，避免遮挡内容 */
.content.has-player {
  padding-bottom: 150px;
}
/*
 * 中等宽度（侧边栏仍展开）：一行放不下整条控件，
 * 让控件整体换到第二行，避免把开关 / 圆形按钮挤变形。
 */
@media (max-width: 1000px) {
  .topbar {
    flex-wrap: wrap;
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .topbar-controls {
    order: 4;
    flex: 1 1 100%;
    max-width: none;
  }
}
@media (max-width: 760px) {
  .content.has-player {
    padding-bottom: 170px;
  }
  /*
   * 窄屏：压缩控件尺寸，让侧边栏开关 + 搜索/排序 + 右上角按钮
   * 全部留在同一行，不再换行。
   */
  .topbar {
    flex-wrap: nowrap;
    gap: 6px;
    padding: 6px 8px;
    min-height: 48px;
  }
  .topbar.has-controls .spacer {
    display: none;
  }
  .topbar-controls {
    order: 0;
    flex: 1 1 auto;
    height: 34px;
    border-radius: 9px;
  }
  .topbar-controls .el-input__wrapper {
    padding: 0 8px;
  }
  .topbar-controls .el-input__inner {
    font-size: 12px;
  }
  .topbar-controls .el-input__prefix {
    display: none;
  }
  .sort-tab {
    padding: 0 6px;
    font-size: 12px;
  }
  .order-toggle {
    padding: 0 7px;
    font-size: 12px;
  }
  .top-btn {
    width: 28px;
    height: 28px;
    font-size: 13px;
  }
  .app.mobile-sidebar-open .sidebar {
    transform: translateX(0);
  }
}
</style>
