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
          <SiteIcon :size="30" :radius="8" />
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
            <!-- 升降序：图标按钮，点击在升序 / 降序之间切换 -->
            <button
              class="order-toggle"
              type="button"
              :title="library.order === 'desc' ? '当前降序，点击切换为升序' : '当前升序，点击切换为降序'"
              :aria-label="library.order === 'desc' ? '降序' : '升序'"
              @click="library.toggleOrder()"
            >
              <svg
                v-if="library.order === 'desc'"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m3 16 4 4 4-4" />
                <path d="M7 20V4" />
                <path d="M11 4h10" />
                <path d="M11 8h7" />
                <path d="M11 12h4" />
              </svg>
              <svg
                v-else
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m3 8 4-4 4 4" />
                <path d="M7 4v16" />
                <path d="M11 12h4" />
                <path d="M11 16h7" />
                <path d="M11 20h10" />
              </svg>
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
import SearchBar from './components/SearchBar.vue'
import SidebarIcon from './components/SidebarIcon.vue'
import MobileDock from './components/MobileDock.vue'
import SiteIcon from './components/SiteIcon.vue'

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

/** 作品数量直接写进搜索框占位符，顶栏不再单独显示数量。 */
const searchPlaceholder = computed(() => {
  const text = library.randomMode
    ? `在 ${library.randomItems.length} 个随机推荐中搜索`
    : `在 ${library.total} 个作品中搜索`
  // 移动端搜索框很窄，去掉空格，保证占位文字能完整显示
  return isMobile.value ? text.replace(/\s/g, '') : text
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

/**
 * 一次交互周期只关闭一次弹层：原实现每个 scroll 事件都派发 3 个合成鼠标事件，
 * 会反复唤醒全站 click-outside 监听器。这里只在「用户点击之后的第一段滚动」派发一次，
 * 复位交给真实 pointerdown，避免一下一下滚轮时每下都触发一波事件造成顿挫。
 * 卡片的毛玻璃不再随滚动开关：改由 WorkCard 按视口距离分配合成层（card-near）。
 */
let poppersClosed = false
function onPageScroll() {
  if (!poppersClosed) {
    poppersClosed = true
    closePoppersOnPageScroll()
  }
}
/** 真实点击复位闸门：用户新打开弹层后，下一段滚动才会再次关闭它 */
function onUserPointerDown(e: PointerEvent) {
  if (e.isTrusted) poppersClosed = false
}
onMounted(() => {
  // 页面滚动关闭 element-plus 弹层
  window.addEventListener('scroll', onPageScroll, { passive: true })
  document.addEventListener('pointerdown', onUserPointerDown, true)
})
onUnmounted(() => {
  window.removeEventListener('scroll', onPageScroll)
  document.removeEventListener('pointerdown', onUserPointerDown, true)
  document.documentElement.classList.remove('drawer-open')
})

// 登录就绪后加载收藏状态（供全站星标 / 加减号判定 isFav）；登出时清空，防止下个用户复用
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
  /* 页面本身已是深色，声明 color-scheme 避免手机浏览器夜间模式再次反色 */
  color-scheme: dark;
  --bg: #121417;
  /* 面板/页面底色拆成 rgb + alpha：接入壁纸时 alpha < 1，壁纸才能透出来 */
  --bg-rgb: 18, 20, 23;
  --panel-rgb: 27, 30, 36;
  --panel-alpha: 1;
  --panel: rgba(var(--panel-rgb), var(--panel-alpha));
  /* 面板上的文字色：由 useAppearance 按实际面板色取对比度更高的黑/白 */
  --panel-fg: #e8ebf0;
  --border: #2a2e37;
  --text: #e8ebf0;
  --muted: #9aa3b0;
  --accent: #6ea8fe;

  /* ---- 外观变量（由 composables/useAppearance.ts 按设置覆盖）---- */
  --wallpaper-image: none;
  --wallpaper-blur: 6px;
  /* 面板 / 标签的亚克力模糊：由 useAppearance 按设置覆盖；0 时不会启用 backdrop-filter */
  --panel-blur: 0px;
  --tag-blur: 0px;
  /* 实际的 backdrop-filter 只在有壁纸时由 useAppearance 下发；none 表示不加合成层 */
  --acrylic-filter: none;
  --tag-acrylic-filter: none;
  --card-min-width: 180px;
  /*
   * 各表面底色的不透明度。模糊由三层独立控制：壁纸（--wallpaper-blur）、
   * 面板（--panel-blur）、标签（--tag-blur）。有壁纸时由 useAppearance 按设置覆盖；
   * 没有壁纸时面板保持不透明、且不启用 backdrop-filter，否则半透明面板盖在纯色
   * 背景上会糊成一片、失去层次，还要白付合成层代价。
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
/* ---- 亚克力毛玻璃 ---- */
/*
 * 面板：作品卡片、导航栏、侧栏、底部播放栏、移动圆盘、全屏播放器、详情信息区、
 * 设置卡片、登录卡、文件列表等大色块。面板模糊 > 0 时由 useAppearance 给 <html>
 * 加 .has-acrylic（0 强度不启用，省合成层）。没有壁纸时，滚动到面板后面的内容
 * 同样会被 backdrop-filter 模糊。高光渐变让玻璃有厚度，而不是一片均色。
 */
html.has-acrylic .topbar,
html.has-acrylic .sidebar,
html.has-acrylic .sidebar-user-menu,
html.has-acrylic .bottom-player,
html.has-acrylic .mobile-dock,
html.has-acrylic .pl-panel,
html.has-acrylic .header,
/* 系统设置里的子卡片是透明分隔行，叠加 backdrop-filter 会在壁纸上透出一块色斑 */
html.has-acrylic .card:not(.sub-card),
html.has-acrylic .login-card,
html.has-acrylic .file-list,
html.has-acrylic .save-toast,
html.has-acrylic .back-btn,
/* 管理页表格：底色/模糊由表格根节点统一给出，才能整块形成毛玻璃 */
html.has-acrylic .el-table {
  -webkit-backdrop-filter: var(--acrylic-filter);
  backdrop-filter: var(--acrylic-filter);
  background-image: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.07),
    rgba(255, 255, 255, 0) 45%,
    rgba(255, 255, 255, 0.03)
  );
}
/*
 * 管理页表格：圆角与全局控件一致；行/表头背景置为透明，底色统一由根节点
 * 用面板色给出（固定列、表头是独立的单元格副本，各自设底色会在毛玻璃上透出色块）。
 */
.el-table {
  border-radius: var(--el-border-radius-base);
  overflow: hidden;
  background-color: var(--panel);
  /* EP 处于浅色主题，文字是深灰；换深色面板后按面板色取反，否则深底深字看不清 */
  --el-table-text-color: var(--panel-fg);
  --el-table-header-text-color: var(--panel-fg);
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: transparent;
  /* 悬停态改半透明叠加，避免一块不透明色盖住毛玻璃 */
  --el-table-row-hover-bg-color: rgba(255, 255, 255, 0.06);
}
/*
 * 全屏播放器的整屏蒙版：底色不透明度跟随面板透明度，模糊跟随面板模糊 */
html.has-acrylic .fs-scrim {
  -webkit-backdrop-filter: var(--acrylic-filter);
  backdrop-filter: var(--acrylic-filter);
}
/* 标签：与面板分开控制强度，模糊更轻、饱和度更高，保持小尺寸文字的清晰度 */
html.has-tag-acrylic .chip-actor,
html.has-tag-acrylic .fs-chip,
html.has-tag-acrylic .el-tag.tag-actor,
html.has-tag-acrylic .el-tag.tag-genre {
  -webkit-backdrop-filter: var(--tag-acrylic-filter);
  backdrop-filter: var(--tag-acrylic-filter);
}
/* 作品卡片上的声优 / 类型标签不参与标签级模糊：卡片数量多，逐个加 backdrop-filter 也会多出大量合成层 */
html.has-tag-acrylic .work-card .cover-tag,
html.has-tag-acrylic .work-card .chip-actor {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
/*
 * 作品卡片数量随分页持续增长，每张带 backdrop-filter 都会成为独立合成层。
 * 只让「视口附近」的卡片持有毛玻璃：card-near 由 WorkCard 的共享
 * IntersectionObserver 在卡片进入视口前（缓冲一屏）挂上、离开后摘下，
 * 可见卡片的模糊始终生效，不会随滚动开关，合成层数量也不随列表长度增长。
 */
html.has-acrylic .work-card.card-near {
  -webkit-backdrop-filter: var(--acrylic-filter);
  backdrop-filter: var(--acrylic-filter);
  background-image: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.07),
    rgba(255, 255, 255, 0) 45%,
    rgba(255, 255, 255, 0.03)
  );
}
/*
 * ---- 液态玻璃：Element Plus 控件与弹出层 ----
 * 按 Apple Liquid Glass 的三层结构实现：
 *   ① 半透明底色 + backdrop-filter 模糊/提饱和，让后景透出并折射；
 *   ② 多段白色高光渐变，形成玻璃厚度与左上受光；
 *   ③ 1px 内侧高光描边 + 底部暗边 + 柔和外投影，模拟边缘折射与悬浮。
 * 控件体量小，用标签级模糊（更轻）；弹出层体量大，用面板级模糊（更强）。
 * 面板或标签任一模糊开启即生效；顶栏搜索胶囊已自带底色与圆角，内层输入框不重复叠加。
 */
html:is(.has-acrylic, .has-tag-acrylic) .el-input__wrapper,
html:is(.has-acrylic, .has-tag-acrylic) .el-select__wrapper,
html:is(.has-acrylic, .has-tag-acrylic) .el-button {
  -webkit-backdrop-filter: var(--tag-acrylic-filter);
  backdrop-filter: var(--tag-acrylic-filter);
  background-image: linear-gradient(
    145deg,
    rgba(255, 255, 255, 0.26) 0%,
    rgba(255, 255, 255, 0.07) 30%,
    rgba(255, 255, 255, 0.02) 62%,
    rgba(255, 255, 255, 0.12) 100%
  );
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.45),
    inset 0 -1px 0 rgba(255, 255, 255, 0.07),
    0 1px 1px rgba(0, 0, 0, 0.1),
    0 6px 16px rgba(0, 0, 0, 0.16);
}
/* 悬停 / 聚焦：保留 EP 的主题色焦点描边，否则上面的 box-shadow 会盖掉焦点提示 */
html:is(.has-acrylic, .has-tag-acrylic) .el-input__wrapper:hover {
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    0 6px 16px rgba(0, 0, 0, 0.16);
}
html:is(.has-acrylic, .has-tag-acrylic) .el-input__wrapper.is-focus,
html:is(.has-acrylic, .has-tag-acrylic) .el-select__wrapper.is-focused {
  box-shadow:
    inset 0 0 0 1px var(--el-color-primary),
    inset 0 1px 0 rgba(255, 255, 255, 0.45),
    0 6px 16px rgba(0, 0, 0, 0.16);
}
html:is(.has-acrylic, .has-tag-acrylic) .topbar-controls .el-input__wrapper {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  background-image: none;
  box-shadow: none;
}
/*
 * 弹出层（下拉列表 / 对话框 / 消息框 / 通知 / 抽屉 / 各类 popper）teleport 到 body 下，
 * 只能用全局选择器覆盖；底色与 EP 弹层变量一起换成半透明面板色，内层才能透出毛玻璃。
 * 深色 tooltip 保持原样，避免小气泡也付合成层代价。
 */
html.has-acrylic .el-popper:not(.is-dark),
html.has-acrylic .el-dialog,
html.has-acrylic .el-drawer,
html.has-acrylic .el-message-box,
html.has-acrylic .el-message,
html.has-acrylic .el-notification {
  -webkit-backdrop-filter: var(--acrylic-filter);
  backdrop-filter: var(--acrylic-filter);
  background-color: var(--panel);
  background-image: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.14) 0%,
    rgba(255, 255, 255, 0.03) 38%,
    rgba(255, 255, 255, 0) 62%,
    rgba(255, 255, 255, 0.06) 100%
  );
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.32),
    inset 0 -1px 0 rgba(255, 255, 255, 0.05),
    0 2px 8px rgba(0, 0, 0, 0.25),
    0 18px 48px rgba(0, 0, 0, 0.45);
  /* 弹层内部的下拉 / 面板底色跟随玻璃，避免露出一块不透明浅色 */
  --el-bg-color-overlay: var(--panel);
  --el-fill-color-light: rgba(255, 255, 255, 0.08);
  --el-fill-color-hover: rgba(255, 255, 255, 0.12);
}
/* 对话框 / 消息框用更大的圆角，接近苹果面板的形态 */
html.has-acrylic .el-dialog,
html.has-acrylic .el-message-box {
  border-radius: 20px;
}
html.has-acrylic .el-drawer {
  border-radius: 20px 0 0 20px;
}
/* popper 箭头跟随玻璃面板色，避免露出一块不透明浅色三角 */
html.has-acrylic .el-popper:not(.is-dark) .el-popper__arrow::before {
  background-color: var(--panel);
  border-color: rgba(255, 255, 255, 0.16);
}
/*
 * 弹出层文字按面板色自动取反色（同管理页表格的做法）：EP 默认是浅色主题的深灰
 * 文字，压在深色玻璃上看不清。只改文字节点本身 —— 弹出层里的输入框 / 按钮仍是
 * 半透明白底玻璃，EP 默认深色文字在它们上面才是可读的，不能跟着反转。
 */
html.has-acrylic .el-dialog__title,
html.has-acrylic .el-dialog__body,
html.has-acrylic .el-message-box__title,
html.has-acrylic .el-message-box__message,
html.has-acrylic .el-message__content,
html.has-acrylic .el-notification__title,
html.has-acrylic .el-notification__content,
html.has-acrylic .el-select-dropdown__item,
html.has-acrylic .el-dropdown-menu__item {
  color: var(--panel-fg);
}
/* 选中 / 悬停项仍用强调色高亮（上面的规则特异性更高，会盖掉 EP 原有的强调色） */
html.has-acrylic .el-select-dropdown__item.selected,
html.has-acrylic .el-select-dropdown__item.is-selected,
html.has-acrylic .el-dropdown-menu__item:not(.is-disabled):hover,
html.has-acrylic .el-dropdown-menu__item:not(.is-disabled):focus {
  color: var(--el-color-primary);
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
 * 信息区收起后封面就是卡片最底部。封面原本只圆上面两个角（下面接信息区），
 * 而卡片为了容纳外溢的销量火焰不能整卡 overflow: hidden，
 * 于是封面的方角会从卡片底部圆角里伸出来。这里给封面补上底部圆角。
 */
html.image-only .work-card .cover {
  border-radius: 9px;
}
/*
 * 播放历史卡片是例外：图片模式下不收起信息区，而是只显示「播放时间 播放时长」一行
 * （由 WorkCard 的 history 模式渲染）。封面下面接着信息区，因此仍保留上方圆角。
 */
html.image-only .work-card.history-card .meta {
  max-height: 60px;
  opacity: 1;
  padding-top: 8px;
  padding-bottom: 10px;
}
html.image-only .work-card.history-card .cover {
  border-radius: 9px 9px 0 0;
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
/*
 * 开启态（R / M）是强调色底 + 自动算出的对比色，
 * 不能再被上面的顶栏前景色覆盖 —— 深色主题色时强调色会被提亮，
 * 若仍然用顶栏的白字就会出现「浅底白字」。
 */
html.has-nav-color .topbar .top-btn.active,
html.has-nav-color .topbar .top-btn.active:hover {
  color: var(--accent-fg);
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
/* 搜索与排序是两个独立胶囊（参考图：中间留缝） */
.topbar-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 520px;
  max-width: 640px;
  min-width: 0;
  height: 38px;
  background: transparent;
  border: none;
  overflow: visible;
}
/* 搜索胶囊 */
.topbar .topbar-controls .searchbar {
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
  max-width: none;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 16px;
  background: var(--control-bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  overflow: hidden;
}
.topbar-controls .el-input {
  width: 100%;
  height: 100%;
}
.topbar-controls .el-input__wrapper {
  height: 100%;
  padding: 0;
  background: transparent;
  border-radius: 0;
  box-shadow: none !important;
}
.topbar-controls .el-input__inner {
  height: 100%;
}
/* 排序胶囊：入库 / 发售 / 销量 + 升降序图标 */
.sort-ctrl {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  height: 100%;
  padding: 0 5px;
  background: var(--control-bg);
  border: 1px solid var(--border);
  border-radius: 999px;
}
.sort-ctrl .sort-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 100%;
}
.sort-tab {
  height: 30px;
  padding: 0 14px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background var(--anim-duration), color var(--anim-duration);
}
.sort-tab:hover {
  background: rgba(255, 255, 255, 0.08);
}
.sort-tab.active {
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
}
/* 升降序：图标按钮，与指标之间留出更大的间距 */
.order-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  margin-left: 8px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  transition: background var(--anim-duration), color var(--anim-duration);
}
.order-toggle svg {
  width: 18px;
  height: 18px;
}
.order-toggle:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
.topbar-logo {
  display: inline-flex;
  flex-shrink: 0;
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
    padding: 8px 10px;
    min-height: 56px;
  }
  .topbar.has-controls .spacer {
    display: none;
  }
  .topbar-controls {
    order: 0;
    flex: 1 1 auto;
    gap: 6px;
    height: 38px;
  }
  .topbar .topbar-controls .searchbar {
    padding: 0 10px;
  }
  .topbar-controls .el-input__inner {
    font-size: 12px;
  }
  .sort-tab {
    height: 28px;
    padding: 0 7px;
    font-size: 12px;
  }
  .order-toggle {
    width: 26px;
    height: 26px;
    margin-left: 4px;
  }
  .order-toggle svg {
    width: 16px;
    height: 16px;
  }
  .top-btn {
    width: 32px;
    height: 32px;
    font-size: 13px;
  }
  .app.mobile-sidebar-open .sidebar {
    transform: translateX(0);
  }
}
</style>
