import { defineStore } from 'pinia'
import { getFavorites, addFavorite, removeFavorite } from '../api'
import type { FavoriteType, Work, FavoriteTag } from '../api/types'

const TAG_SEP = String.fromCharCode(0)

/** tag 的唯一键：category 与 name 复合（同名不同分类的标签不互相覆盖）。 */
const tagKey = (name: string, category: string) => category + TAG_SEP + name

/**
 * 收藏状态：四类收藏各自维护视图数组 + 派生 Set。
 * isFav 依赖派生 Set，因此 work 类型在添加后（缺完整 Work 对象）通过 refresh 补齐视图数据。
 */
export const useFavoritesStore = defineStore('favorites', {
  state: () => ({
    loaded: false,
    loading: false,
    works: [] as Work[],
    tags: [] as FavoriteTag[],
    circles: [] as string[],
    actors: [] as string[],
    // 移动端收藏选择器：当前正在展示的作品
    pickerWork: null as Work | null,
  }),
  getters: {
    workKeys(state): Set<string> {
      return new Set(state.works.map((w) => w.rj_code.toUpperCase()))
    },
    tagKeys(state): Set<string> {
      return new Set(state.tags.map((t) => tagKey(t.name, t.category)))
    },
    circleKeys(state): Set<string> {
      return new Set(state.circles)
    },
    actorKeys(state): Set<string> {
      return new Set(state.actors)
    },
  },
  actions: {
    /** 登录态就绪后调用一次；已加载则跳过。 */
    async init() {
      if (this.loaded || this.loading) return
      await this.refresh()
    },
    /** 打开移动端收藏选择器（展示某作品的 RJ/声优/标签/社团供点选收藏）。 */
    openPicker(work: Work) {
      this.pickerWork = work
    },
    closePicker() {
      this.pickerWork = null
    },
    /** 登出时清空本地收藏，避免下个用户复用旧数据。 */
    reset() {
      this.loaded = false
      this.loading = false
      this.works = []
      this.tags = []
      this.circles = []
      this.actors = []
    },
    /** 全量重新拉取（收藏页激活时用于跨端同步）。 */
    async refresh() {
      this.loading = true
      try {
        const data = await getFavorites()
        this.works = data.works
        this.tags = data.tags
        this.circles = data.circles
        this.actors = data.actors
        this.loaded = true
      } catch {
        /* 忽略：未登录 / 网络错误由请求层处理 */
      } finally {
        this.loading = false
      }
    },
    isFav(type: FavoriteType, value: string, extra = ''): boolean {
      switch (type) {
        case 'work':
          return this.workKeys.has(String(value).toUpperCase())
        case 'tag':
          return this.tagKeys.has(tagKey(String(value), String(extra)))
        case 'circle':
          return this.circleKeys.has(String(value))
        case 'actor':
          return this.actorKeys.has(String(value))
      }
    },
    /** 切换收藏，返回操作后是否处于收藏状态（供组件弹"已收藏/已取消收藏"提示）。 */
    async toggle(type: FavoriteType, value: string, extra = ''): Promise<boolean> {
      const already = this.isFav(type, value, extra)
      try {
        if (already) {
          await removeFavorite(type, value)
          this.removeLocal(type, value, extra)
        } else {
          await addFavorite(type, value, extra)
          this.addLocal(type, value, extra)
        }
      } catch {
        // 网络/权限失败：保持原状态，静默
        return already
      }
      return !already
    },
    addLocal(type: FavoriteType, value: string, extra = '') {
      if (type === 'work') {
        const rj = String(value).toUpperCase()
        if (!this.works.some((w) => w.rj_code === rj)) {
          // 缺少完整 Work 对象，交由 refresh 补齐视图数据（isFav 依赖的 workKeys 即时反映）
          void this.refresh()
        }
      } else if (type === 'tag') {
        const name = String(value)
        const category = String(extra)
        if (!this.tags.some((t) => t.name === name && t.category === category)) {
          this.tags.unshift({ name, category })
        }
      } else if (type === 'circle') {
        const v = String(value)
        if (!this.circles.includes(v)) this.circles.unshift(v)
      } else {
        const v = String(value)
        if (!this.actors.includes(v)) this.actors.unshift(v)
      }
    },
    removeLocal(type: FavoriteType, value: string, extra = '') {
      if (type === 'work') {
        const rj = String(value).toUpperCase()
        this.works = this.works.filter((w) => w.rj_code !== rj)
      } else if (type === 'tag') {
        const name = String(value)
        const category = String(extra)
        this.tags = this.tags.filter((t) => !(t.name === name && t.category === category))
      } else if (type === 'circle') {
        this.circles = this.circles.filter((c) => c !== String(value))
      } else {
        this.actors = this.actors.filter((a) => a !== String(value))
      }
    },
  },
})
