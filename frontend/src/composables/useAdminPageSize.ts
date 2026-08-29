import { ref, computed } from 'vue'
import { getPrefs, savePrefs } from '../api'

export type AdminSection = 'works' | 'series' | 'circles' | 'actors' | 'tags'

const ALLOWED = [10, 20, 40, 100] as const
const DEFAULT = 20
const SECTIONS: AdminSection[] = ['works', 'series', 'circles', 'actors', 'tags']

const DEFAULT_SIZES: Record<AdminSection, number> = {
  works: DEFAULT,
  series: DEFAULT,
  circles: DEFAULT,
  actors: DEFAULT,
  tags: DEFAULT,
}

// 每个管理板块独立记住自己的每页数量（模块级共享，切换板块时保留各自的值）
const pageSizes = ref<Record<AdminSection, number>>({ ...DEFAULT_SIZES })
let loaded = false

export function useAdminPageSize(section: AdminSection) {
  /** 从服务端用户偏好加载各板块每页数量（仅首次，失败保持默认）。 */
  async function ensureLoaded(): Promise<void> {
    if (loaded) return
    loaded = true
    try {
      const prefs = await getPrefs()
      const saved = (prefs.adminPageSizes || {}) as Record<string, number>
      for (const key of SECTIONS) {
        const n = saved[key]
        if ((ALLOWED as readonly number[]).includes(n)) pageSizes.value[key] = n
      }
    } catch {
      /* 保持默认 20 */
    }
  }

  /** 设置当前板块的每页数量并持久化到服务端用户偏好。 */
  function setPageSize(n: number): void {
    pageSizes.value[section] = n
    savePrefs({ adminPageSizes: { ...pageSizes.value } }).catch(() => {})
  }

  const pageSize = computed(() => pageSizes.value[section])

  return { pageSize, setPageSize, ensureLoaded }
}

/** 退出登录时重置缓存，避免下个用户复用上一个用户的偏好。 */
export function resetAdminPageSize(): void {
  loaded = false
  pageSizes.value = { ...DEFAULT_SIZES }
}
