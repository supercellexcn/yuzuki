import { getDb } from './db/connection.js'

export interface FilterCond {
  type: 'circle' | 'actor' | 'tag'
  value: string
}

export interface Prefs {
  conditions: FilterCond[]
  q: string
  sort: string
  order: 'asc' | 'desc'
  lastWorkId: number | null
  lastScrollTop: number
  /** 管理功能各板块每页数量（works/series/circles/actors/tags），每个板块独立记住 */
  adminPageSizes: Record<string, number>
}

const ADMIN_PAGE_SIZES = [10, 20, 40, 100]
const ADMIN_SECTIONS = ['works', 'series', 'circles', 'actors', 'tags']

export function defaultPrefs(): Prefs {
  return {
    conditions: [],
    q: '',
    sort: 'added',
    order: 'desc',
    lastWorkId: null,
    lastScrollTop: 0,
    adminPageSizes: {},
  }
}

export function getPrefs(userId: number): Prefs {
  const row = getDb().prepare('SELECT prefs FROM user_prefs WHERE user_id = ?').get(userId) as
    | { prefs: string }
    | undefined
  if (!row || !row.prefs) return defaultPrefs()
  try {
    return { ...defaultPrefs(), ...(JSON.parse(row.prefs) as Partial<Prefs>) }
  } catch {
    return defaultPrefs()
  }
}

const SORTS = ['added', 'release', 'sales', 'title', 'updated']

export function savePrefs(userId: number, patch: Partial<Prefs>): Prefs {
  const cur = getPrefs(userId)
  const next: Prefs = { ...cur, ...patch }
  // 规整条件：最多 5 个
  next.conditions = (Array.isArray(patch.conditions) ? patch.conditions : cur.conditions)
    .map((c) => ({ type: c.type, value: String(c.value).trim() }))
    .filter((c) => c.value && (c.type === 'circle' || c.type === 'actor' || c.type === 'tag'))
    .slice(0, 5)
  next.q = String(patch.q ?? cur.q ?? '').trim()
  next.sort = SORTS.includes(String(next.sort)) ? next.sort : 'added'
  next.order = next.order === 'asc' ? 'asc' : 'desc'
  next.lastWorkId = next.lastWorkId == null ? null : Number(next.lastWorkId)
  next.lastScrollTop = Number(next.lastScrollTop) || 0
  // 每个板块独立的每页数量：缺失或非法值回退默认 20
  const sizes: Record<string, number> = {}
  for (const key of ADMIN_SECTIONS) {
    const v = Number((next.adminPageSizes || {})[key])
    sizes[key] = ADMIN_PAGE_SIZES.includes(v) ? v : 20
  }
  next.adminPageSizes = sizes
  getDb()
    .prepare(
      'INSERT INTO user_prefs (user_id, prefs, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at'
    )
    .run(userId, JSON.stringify(next), new Date().toISOString())
  return next
}
