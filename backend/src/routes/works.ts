import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../db/connection.js'
import { getSettings } from '../settings.js'
import { authMiddleware, type AuthedRequest } from '../auth.js'
import { enrichWork } from '../services/enrich.js'
import { upsertWorkFolder, setManualCover } from '../services/workService.js'
import type { EnrichedWork } from '../services/enrich.js'
import { isSameSeries } from '../recommendation/similarity.js'
import { hiddenWorkExpr, isWorkHidden } from '../services/hidden.js'

export const worksRouter = Router()
worksRouter.use(authMiddleware)

export interface FilterCond {
  type: 'circle' | 'series' | 'actor' | 'tag'
  value: string
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m)
}

/** 解析重复的 ?cond=type:value 参数（最多 5 个） */
function parseConds(raw: unknown): FilterCond[] {
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  const out: FilterCond[] = []
  for (const item of arr) {
    const s = String(item)
    const idx = s.indexOf(':')
    if (idx <= 0) continue
    const type = s.slice(0, idx)
    const value = s.slice(idx + 1).trim()
    if (!value || (type !== 'circle' && type !== 'series' && type !== 'actor' && type !== 'tag')) continue
    out.push({ type, value })
  }
  return out.slice(0, 5)
}

interface WhereResult {
  whereSql: string
  params: Array<string | number | null>
}

/** 根据搜索词 q 与聚合条件构建 WHERE（全部 AND） */
function buildWhere(q: string, conds: FilterCond[]): WhereResult {
  const where: string[] = []
  const params: Array<string | number | null> = []
  if (q) {
    const like = `%${escapeLike(q)}%`
    where.push(
      `(w.rj_code LIKE ? ESCAPE '\\' OR
        w.title LIKE ? ESCAPE '\\' OR
        EXISTS(SELECT 1 FROM work_actors wa JOIN actors a ON a.id = wa.actor_id WHERE wa.work_id = w.id AND a.name LIKE ? ESCAPE '\\') OR
        EXISTS(SELECT 1 FROM work_tags wt JOIN tags t ON t.id = wt.tag_id WHERE wt.work_id = w.id AND t.name LIKE ? ESCAPE '\\'))`
    )
    params.push(like, like, like, like)
  }
  for (const c of conds) {
    if (c.type === 'circle') {
      where.push('w.circle = ?')
      params.push(c.value)
    } else if (c.type === 'series') {
      where.push('w.series = ?')
      params.push(c.value)
    } else if (c.type === 'actor') {
      where.push(
        'EXISTS(SELECT 1 FROM work_actors wa JOIN actors a ON a.id = wa.actor_id WHERE wa.work_id = w.id AND a.name = ?)'
      )
      params.push(c.value)
    } else {
      where.push(
        'EXISTS(SELECT 1 FROM work_tags wt JOIN tags t ON t.id = wt.tag_id WHERE wt.work_id = w.id AND t.name = ?)'
      )
      params.push(c.value)
    }
  }
  // 已隐藏的作品（作品自身被隐藏，或其系列/社团/声优/标签被隐藏）不在媒体库/搜索/随机中出现
  where.push(hiddenWorkExpr('w'))
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params }
}

// GET /api/works?q=&cond=type:value&sort=&order=&page=&pageSize=
worksRouter.get('/', (req, res) => {
  const db = getDb()
  const { userId } = req as unknown as AuthedRequest
  const q = String(req.query.q || '').trim()
  const conds = parseConds(req.query.cond)
  const sort = String(req.query.sort || 'added')
  const order = req.query.order === 'asc' ? 'ASC' : 'DESC'
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || getSettings().page_size || 20))
  const offset = (page - 1) * pageSize

  const { whereSql, params } = buildWhere(q, conds)
  const orderSql =
    sort === 'title'
      ? `w.title COLLATE NOCASE ${order}, w.id ${order}`
      : sort === 'release'
        ? `w.release_date ${order}, w.id ${order}`
        : sort === 'sales'
          ? `w.sales_count IS NULL, w.sales_count ${order}, w.id ${order}`
          : sort === 'updated'
            ? `w.updated_at ${order}, w.id ${order}`
            : `w.added_at ${order}, w.id ${order}`

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM works w ${whereSql}`).get(...params) as { c: number }).c
  const rows = db
    .prepare(`SELECT w.* FROM works w ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as Array<Record<string, unknown>>

  res.json({ items: rows.map((r) => enrichWork(r, userId)), total, page, pageSize })
})

// GET /api/works/random?count=&q=&cond= —— 随机推荐（遵循当前筛选条件）
worksRouter.get('/random', (req, res) => {
  const db = getDb()
  const { userId } = req as unknown as AuthedRequest
  const count = Math.min(50, Math.max(1, Number(req.query.count) || 20))
  const q = String(req.query.q || '').trim()
  const conds = parseConds(req.query.cond)
  const { whereSql, params } = buildWhere(q, conds)
  const rows = db
    .prepare(`SELECT w.* FROM works w ${whereSql} ORDER BY RANDOM() LIMIT ?`)
    .all(...params, count) as Array<Record<string, unknown>>
  res.json({ items: rows.map((r) => enrichWork(r, userId)), count })
})

// GET /api/works/:rj
worksRouter.get('/:rj', (req, res) => {
  const db = getDb()
  const { userId } = req as unknown as AuthedRequest
  const rj = String(req.params.rj).toUpperCase()
  const row = db.prepare('SELECT * FROM works WHERE rj_code = ?').get(rj) as Record<string, unknown> | undefined
  if (!row) return res.status(404).json({ error: 'work not found' })
  if (isWorkHidden(db, rj)) return res.status(404).json({ error: 'work not found' })
  const files = db
    .prepare('SELECT id, filename, rel_path, ext, kind, is_dir, size, sort_order FROM files WHERE work_id = ? ORDER BY sort_order')
    .all(Number(row.id))
  res.json({ ...enrichWork(row, userId), files })
})

// GET /api/works/:rj/recommendations?limit= —— 相关作品推荐（查询预计算结果，不做实时相似度计算）
worksRouter.get('/:rj/recommendations', (req, res) => {
  const db = getDb()
  const { userId } = req as unknown as AuthedRequest
  const rj = String(req.params.rj).toUpperCase()
  const currentRow = db.prepare('SELECT * FROM works WHERE rj_code = ?').get(rj) as Record<string, unknown> | undefined
  if (!currentRow) return res.status(404).json({ error: 'work not found' })
  if (isWorkHidden(db, rj)) return res.status(404).json({ error: 'work not found' })

  const settings = getSettings()
  if (!settings.recommendation_enabled) return res.json({ workId: rj, recommendations: [] })

  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || settings.recommendation_api_limit || 10))
  const rows = db
    .prepare(
      `SELECT related_rj_code, voice_score, tag_score, title_score, circle_score, content_score, quality_score, final_score
       FROM work_recommendations WHERE rj_code = ? ORDER BY rank_position LIMIT ?`
    )
    .all(rj, limit) as unknown as Array<{
    related_rj_code: string
    voice_score: number
    tag_score: number
    title_score: number
    circle_score: number
    content_score: number
    quality_score: number
    final_score: number
  }>
  if (!rows.length) return res.json({ workId: rj, recommendations: [] })

  const cur: EnrichedWork = enrichWork(currentRow, userId)
  const curActors = new Set(cur.actors)
  const curTags = new Set(cur.tags.map((t) => t.name))

  // 主因维度：按「权重 × 子分数」找出对该推荐贡献最大的 1~2 个维度（标签 > 声优 > 标题 > 社团）
  const simWeights = {
    voice: settings.recommendation_weight_voice,
    tag: settings.recommendation_weight_tag,
    title: settings.recommendation_weight_title,
    circle: settings.recommendation_weight_circle,
  }
  const contentReasonsOf = (r: (typeof rows)[number]): string[] =>
    (['voice', 'tag', 'title', 'circle'] as const)
      .map((k) => ({ k, contrib: simWeights[k] * Number(r[`${k}_score`] ?? 0) }))
      .filter((x) => x.contrib > 0)
      .sort((a, b) => b.contrib - a.contrib)
      .slice(0, 2)
      .map((x) => x.k)

  const recommendations = rows
    .map((r) => {
      const row = db
        .prepare(`SELECT w.* FROM works w WHERE w.rj_code = ? AND ${hiddenWorkExpr('w')}`)
        .get(r.related_rj_code) as Record<string, unknown> | undefined
      if (!row) return null // 作品已被删除或已隐藏，跳过
      const w = enrichWork(row, userId)
      const sameSeries = isSameSeries({ series: cur.series }, { series: w.series })
      // 系列是最高优先级强关系：同系列时 series 永远是第一主因
      const mainReasons = sameSeries ? ['series', ...contentReasonsOf(r)] : contentReasonsOf(r)
      return {
        ...w,
        score: Number(r.final_score),
        reason: {
          similarity: Number(r.content_score),
          voice: Number(r.voice_score),
          tag: Number(r.tag_score),
          title: Number(r.title_score),
          circle: Number(r.circle_score),
          mainReasons,
          sameSeries,
          sharedVoiceActors: w.actors.filter((a) => curActors.has(a)),
          sharedTags: w.tags.map((t) => t.name).filter((n) => curTags.has(n)),
          sameCircle: !!(cur.circle && w.circle && cur.circle === w.circle),
        },
      }
    })
    .filter((x): x is NonNullable<typeof x> => x != null)

  res.json({ workId: rj, recommendations })
})

// POST /api/works/:rj/cover —— 把作品文件夹里的某张图片设为封面 { file_id }
worksRouter.post('/:rj/cover', (req, res) => {
  const db = getDb()
  const rj = String(req.params.rj).toUpperCase()
  const row = db.prepare('SELECT id, folder_path FROM works WHERE rj_code = ?').get(rj) as
    | { id: number; folder_path: string }
    | undefined
  if (!row) return res.status(404).json({ error: 'work not found' })

  const fileId = Number(req.body?.file_id)
  if (!fileId) return res.status(400).json({ error: 'invalid file_id' })
  const file = db.prepare('SELECT rel_path FROM files WHERE id = ? AND work_id = ?').get(fileId, row.id) as
    | { rel_path: string }
    | undefined
  if (!file) return res.status(404).json({ error: 'file not found' })

  const src = path.join(row.folder_path, file.rel_path)
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return res.status(404).json({ error: 'file missing' })

  try {
    // 手动封面：保留原始封面，便于管理端「还原封面」
    setManualCover(db, rj, row.id, src)
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message })
  }
  res.json({ ok: true })
})

// POST /api/works/:rj/rescan
worksRouter.post('/:rj/rescan', async (req, res) => {
  const db = getDb()
  const rj = String(req.params.rj).toUpperCase()
  const row = db.prepare('SELECT * FROM works WHERE rj_code = ?').get(rj) as Record<string, unknown> | undefined
  if (!row) return res.status(404).json({ error: 'work not found' })
  try {
    await upsertWorkFolder(rj, String(row.folder_path), String(row.source_path))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})
