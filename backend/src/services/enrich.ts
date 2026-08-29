import { getDb } from '../db/connection.js'
import { findDefaultCover } from '../settings.js'
import { CUSTOM_TAG } from './hidden.js'

export interface EnrichedTag {
  name: string
  category: string
}

export interface EnrichedWork {
  id: number
  rj_code: string
  title: string
  circle: string
  release_date: string
  series: string
  sales_count: number | null
  play_count: number
  file_count: number
  folder_path: string
  added_at: string
  updated_at: string
  cover_url: string
  actors: string[]
  tags: EnrichedTag[]
}

/** 把 works 行增强为带声优/标签/封面/播放次数的完整对象。userId 传入则统计该用户播放次数。 */
export function enrichWork(row: Record<string, unknown>, userId?: number): EnrichedWork {
  const db = getDb()
  const id = Number(row.id)
  const rj = String(row.rj_code)
  const actors = (
    db
      .prepare(
        `SELECT a.name FROM work_actors wa JOIN actors a ON a.id = wa.actor_id WHERE wa.work_id = ? ORDER BY a.name`
      )
      .all(id) as Array<{ name: string }>
  ).map((r) => r.name)
  const tags = db
    .prepare(
      `SELECT t.name, t.category FROM work_tags wt JOIN tags t ON t.id = wt.tag_id
       WHERE wt.work_id = ?
       ORDER BY (t.category = '${CUSTOM_TAG}') ASC, t.category, t.name`
    )
    .all(id) as unknown as EnrichedTag[]

  let playCount = 0
  if (userId != null) {
    const pc = db.prepare('SELECT count FROM play_counts WHERE user_id = ? AND work_id = ?').get(userId, id) as
      | { count: number }
      | undefined
    playCount = pc ? pc.count : 0
  }

  return {
    id,
    rj_code: rj,
    title: String(row.title || ''),
    circle: String(row.circle || ''),
    release_date: String(row.release_date || ''),
    series: String(row.series || ''),
    sales_count: row.sales_count == null ? null : Number(row.sales_count),
    play_count: playCount,
    file_count: Number(row.file_count || 0),
    folder_path: String(row.folder_path || ''),
    added_at: String(row.added_at || ''),
    updated_at: String(row.updated_at || ''),
    // 有作品封面或用默认封面兜底时都返回封面 URL（路由层负责回退）
    cover_url: row.cover_path || findDefaultCover() ? `/api/cover/${rj}` : '',
    actors,
    tags,
  }
}
