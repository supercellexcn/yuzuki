import { defineStore } from 'pinia'
import { login as apiLogin, getMe, changePassword as apiChangePassword, getToken, setToken, clearToken } from '../api'
import type { AuthUser, LoginResponse } from '../api/types'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: getToken(),
    user: null as AuthUser | null,
    initialized: false,
  }),
  actions: {
    /** 应用启动时用本地 token 恢复登录态 */
    async init() {
      if (this.initialized) return
      if (!this.token) {
        this.initialized = true
        return
      }
      try {
        this.user = await getMe()
      } catch {
        this.logout()
      } finally {
        this.initialized = true
      }
    },
    async login(username: string, password: string): Promise<LoginResponse> {
      const res = await apiLogin(username, password)
      this.token = res.token
      setToken(res.token)
      this.user = {
        id: 0,
        username: res.username,
        must_change_password: res.must_change_password,
        created_at: '',
        prefs: res.prefs,
      }
      this.initialized = true
      return res
    },
    async changePassword(old_password: string, new_password: string) {
      await apiChangePassword(old_password, new_password)
      if (this.user) this.user.must_change_password = false
    },
    logout() {
      this.token = ''
      this.user = null
      clearToken()
    },
  },
})
