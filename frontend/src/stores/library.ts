import { defineStore } from 'pinia'
import { getWorks, getRandomWorks, savePrefs } from '../api'
import type { Work, FilterCond, LibraryPrefs } from '../api/types'
import { useSettingsStore } from './settings'

export type SortKey = 'added' | 'release' | 'sales'
export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'added', label: '按入库时间' },
  { value: 'release', label: '按发售时间' },
  { value: 'sales', label: '按销量' },
]

let prefsTimer: ReturnType<typeof setTimeout> | undefined

export const useLibraryStore = defineStore('library', {
  state: () => ({
    items: [] as Work[],
    total: 0,
    page: 1,
    pageSize: 20,
    loading: false,
    loaded: false,
    conditions: [] as FilterCond[],
    q: '',
    sort: 'added' as SortKey,
    order: 'desc' as 'asc' | 'desc',
    randomMode: false,
    randomItems: [] as Work[],
    randomLoading: false,
    scrollTop: 0,
    lastWorkId: null as number | null,
    prefsApplied: false,
  }),
  getters: {
    hasFilter(state): boolean {
      return Boolean(state.q || state.conditions.length)
    },
    hasMore(state): boolean {
      return state.total > state.items.length
    },
    condParams(state): string[] {
      return state.conditions.map((c) => `${c.type}:${c.value}`)
    },
  },
  actions: {
    async ensurePageSize() {
      const settings = useSettingsStore()
      if (!settings.settings) {
        try {
          await settings.load()
        } catch {
          // 保持默认 20
        }
      }
      this.pageSize = settings.settings?.page_size || 20
    },
    async fetch(mode: 'replace' | 'append' = 'replace') {
      await this.ensurePageSize()
      this.loading = true
      try {
        const res = await getWorks({
          q: this.q || undefined,
          cond: this.condParams,
          sort: this.sort,
          order: this.order,
          page: this.page,
          pageSize: this.pageSize,
        })
        this.items = mode === 'append' ? [...this.items, ...res.items] : res.items
        this.total = res.total
        this.loaded = true
      } finally {
        this.loading = false
      }
    },
    async loadMore() {
      if (this.loading || !this.hasMore || this.randomMode) return
      this.page += 1
      await this.fetch('append')
    },
    // ---- 聚合条件（最多 5 个，可重复，点击切换） ----
    addCondition(type: FilterCond['type'], value: string): boolean {
      const v = value.trim()
      if (!v) return true
      const idx = this.conditions.findIndex((c) => c.type === type && c.value === v)
      if (idx >= 0) {
        this.conditions.splice(idx, 1)
      } else {
        if (this.conditions.length >= 5) return false
        this.conditions.push({ type, value: v })
      }
      this.page = 1
      this.randomMode = false
      this.savePrefsSoon()
      void this.fetch('replace')
      return true
    },
    removeConditionAt(i: number) {
      if (i < 0 || i >= this.conditions.length) return
      this.conditions.splice(i, 1)
      this.page = 1
      this.randomMode = false
      this.savePrefsSoon()
      void this.fetch('replace')
    },
    setQuery(q: string) {
      this.q = q
      this.page = 1
      this.randomMode = false
      this.savePrefsSoon()
      return this.fetch('replace')
    },
    setSort(sort: SortKey) {
      if (this.sort === sort) return
      this.sort = sort
      this.page = 1
      this.randomMode = false
      this.savePrefsSoon()
      return this.fetch('replace')
    },
    setOrder(order: 'asc' | 'desc') {
      this.order = order
      this.page = 1
      this.randomMode = false
      this.savePrefsSoon()
      return this.fetch('replace')
    },
    toggleOrder() {
      return this.setOrder(this.order === 'desc' ? 'asc' : 'desc')
    },
    clearFilter() {
      this.conditions = []
      this.q = ''
      this.page = 1
      this.randomMode = false
      this.savePrefsSoon()
      return this.fetch('replace')
    },
    // ---- 随机推荐：每次点击都基于当前条件重新推荐一页 ----
    async toggleRandom() {
      this.randomLoading = true
      try {
        const res = await getRandomWorks({ q: this.q || undefined, cond: this.condParams, count: 20 })
        this.randomItems = res.items
        this.randomMode = true
      } finally {
        this.randomLoading = false
      }
    },
    // ---- 界面记忆 ----
    applyPrefs(prefs?: LibraryPrefs | null) {
      this.conditions = prefs?.conditions?.slice(0, 5) || []
      this.q = prefs?.q || ''
      this.sort = (prefs?.sort as SortKey) || 'added'
      this.order = prefs?.order === 'asc' ? 'asc' : 'desc'
      this.lastWorkId = prefs?.lastWorkId ?? null
      this.scrollTop = prefs?.lastScrollTop || 0
      this.randomMode = false
      this.prefsApplied = true
    },
    savePrefsSoon() {
      if (prefsTimer) clearTimeout(prefsTimer)
      prefsTimer = setTimeout(() => {
        prefsTimer = undefined
        this.flushPrefs()
      }, 800)
    },
    /** 立即保存当前界面记忆（离开页面前调用，确保落库） */
    flushPrefs() {
      if (prefsTimer) {
        clearTimeout(prefsTimer)
        prefsTimer = undefined
      }
      const prefs = {
        conditions: this.conditions,
        q: this.q,
        sort: this.sort,
        order: this.order,
        lastWorkId: this.lastWorkId,
        lastScrollTop: this.scrollTop,
      }
      savePrefs(prefs).catch(() => {})
    },
    rememberScroll(top: number) {
      this.scrollTop = top
      this.savePrefsSoon()
    },
    rememberTopWork(wid: number | null) {
      if (wid === this.lastWorkId) return
      this.lastWorkId = wid
      this.savePrefsSoon()
    },
    /** 清空媒体库后重置本地列表，下次进入媒体库重新拉取（保留用户的筛选/排序条件）。 */
    resetLibraryData() {
      this.items = []
      this.total = 0
      this.page = 1
      this.loading = false
      this.loaded = false
      this.randomMode = false
      this.randomItems = []
      this.scrollTop = 0
      this.lastWorkId = null
    },
  },
})
