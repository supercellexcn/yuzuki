import { Router } from 'express'
import { getDb } from '../db/connection.js'
import { authMiddleware, type AuthedRequest } from '../auth.js'
import { enrichWork } from '../services/enrich.js'
import { hiddenWorkExpr } from '../services/hidden.js'

export const favoritesRouter = Router()
favoritesRouter.use(authMiddleware)

const FAV_TYPES = new Set(['work', 'tag', 'circle', 'actor'])

// GET /api/favorites —— 一次返回当前用户的分组收藏
// works 用 enrichWork 增强（需传 userId 才有真实 play_count）；已删作品的收藏行被 JOIN 自然丢弃，行本身保留。
favoritesRouter.get('/', (req, res) => {
  const db = getDb()
  const { userId } = req as unknown as AuthedRequest

  const workRows = db
    .prepare(
      `SELECT w.* FROM favorites f JOIN works w ON w.rj_code = f.value
       WHERE f.user_id = ? AND f.type = 'work' AND ${hiddenWorkExpr('w')}
       ORDER BY f.created_at DESC`
    )
    .all(userId) as Array<Record<string, unknown>>

  const tagRows = db
    .prepare(
      `SELECT value, extra FROM favorites WHERE user_id = ? AND type = 'tag' ORDER BY created_at DESC`
    )
    .all(userId) as Array<{ value: string; extra: string }>

  const circleRows = db
    .prepare(
      `SELECT value FROM favorites WHERE user_id = ? AND type = 'circle' ORDER BY created_at DESC`
    )
    .all(userId) as Array<{ value: string }>

  const actorRows = db
    .prepare(
      `SELECT value FROM favorites WHERE user_id = ? AND type = 'actor' ORDER BY created_at DESC`
    )
    .all(userId) as Array<{ value: string }>

  res.json({
    works: workRows.map((r) => enrichWork(r, userId)),
    tags: tagRows.map((t) => ({ name: t.value, category: t.extra })),
    circles: circleRows.map((c) => c.value),
    actors: actorRows.map((a) => a.value),
  })
})

// POST /api/favorites —— 添加收藏 { type, value, extra? }
favoritesRouter.post('/', (req, res) => {
  const db = getDb()
  const { userId } = req as unknown as AuthedRequest
  const type = String(req.body?.type || '')
  let value = String(req.body?.value || '').trim()
  const extra = String(req.body?.extra || '').trim()

  if (!FAV_TYPES.has(type)) return res.status(400).json({ error: 'invalid type' })
  if (!value || value.length > 200) return res.status(400).json({ error: 'invalid value' })
  if (type === 'work') value = value.toUpperCase()

  // INSERT OR IGNORE 吃掉 (user_id, type, value) 唯一约束冲突：重复收藏不报错，靠 changes 判断是否新建
  const r = db
    .prepare('INSERT OR IGNORE INTO favorites (user_id, type, value, extra) VALUES (?, ?, ?, ?)')
    .run(userId, type, value, extra)
  res.json({ ok: true, created: r.changes === 1 })
})

// DELETE /api/favorites?type=&value= —— 取消收藏
favoritesRouter.delete('/', (req, res) => {
  const db = getDb()
  const { userId } = req as unknown as AuthedRequest
  const type = String(req.query.type || '')
  let value = String(req.query.value || '')

  if (!FAV_TYPES.has(type) || !value) return res.status(400).json({ error: 'invalid params' })
  if (type === 'work') value = value.toUpperCase()

  const r = db.prepare('DELETE FROM favorites WHERE user_id = ? AND type = ? AND value = ?').run(userId, type, value)
  res.json({ ok: true, removed: r.changes })
})
