import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useIsMobile } from '../composables/useIsMobile'
import LibraryView from '../views/LibraryView.vue'

/** 最近一次导航来源的路由名（供 keep-alive 页面判断是否需要刷新数据）。 */
let lastFromRoute: string | null = null
export function getLastFromRoute(): string | null {
  return lastFromRoute
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
    {
      path: '/change-password',
      name: 'change-password',
      component: () => import('../views/ChangePasswordView.vue'),
    },
    { path: '/', name: 'library', component: LibraryView, meta: { keepAlive: true } },
    {
      path: '/work/:rj',
      name: 'player',
      component: () => import('../views/PlayerView.vue'),
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('../views/HistoryView.vue'),
    },
    {
      path: '/favorites',
      name: 'favorites',
      component: () => import('../views/FavoritesView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
    },
    {
      path: '/admin',
      name: 'admin',
      component: () => import('../views/admin/AdminView.vue'),
    },
  ],
})

router.beforeEach(async (to, from) => {
  lastFromRoute = typeof from.name === 'string' ? from.name : null
  const auth = useAuthStore()
  if (!auth.initialized) await auth.init()
  // 未登录 → 登录页
  if (!auth.token) {
    return to.name === 'login' ? true : { name: 'login' }
  }
  // 已登录访问登录页 → 回媒体库
  if (to.name === 'login') return { name: 'library' }
  // 首次登录强制改密；登录后也可随时访问改密页
  if (auth.user?.must_change_password && to.name !== 'change-password') {
    return { name: 'change-password' }
  }
  // 移动端不提供管理功能：直接输入 /admin 也跳回媒体库
  if (to.name === 'admin' && useIsMobile().value) {
    return { name: 'library' }
  }
  return true
})
