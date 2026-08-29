import { Router } from 'express'
import { getDb, transaction } from '../db/connection.js'
import { authMiddleware, type AuthedRequest } from '../auth.js'
import { enrichWork } from '../services/enrich.js'
import { hiddenWorkExpr } from '../services/hidden.js'

export const playsRouter = Router()
playsRouter.use(authMiddleware)

// POST /api/plays —— 记录一次播放 { rj, file_id }
playsRouter.post('/', (req, res) => {
  const db = getDb()
  const { userId } = req as unknown as AuthedRequest
  const rj = String(req.body?.rj || '').toUpperCase()
  const fileId = req.body?.file_id == null ? null : Number(req.body.file_id)
  const work = db.prepare('SELECT id FROM works WHERE rj_code = ?').get(rj) as { id: number } | undefined
  if (!work) return res.status(404).json({ error: 'work not found' })
  const now = new Date().toISOString()
  transaction(db, () => {
    db.prepare(
      'INSERT INTO play_history (user_id, work_id, rj_code, file_id, played_at) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, work.id, rj, fileId, now)
    db.prepare(
      'INSERT INTO play_counts (user_id, work_id, rj_code, count) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, work_id) DO UPDATE SET count = count + 1, rj_code = excluded.rj_code'
    ).run(userId, work.id, rj)
  })
  res.json({ ok: true })
})

// GET /api/plays/recent?limit=10&offset=0 —— 最近播放（按作品去重，取最近一次，支持翻页）
playsRouter.get('/recent', (req, res) => {
  const db = getDb()
  const { userId } = req as unknown as AuthedRequest
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10))
  const offset = Math.max(0, Number(req.query.offset) || 0)
  const rows = db
    .prepare(
      `SELECT w.*, MAX(ph.played_at) AS played_at
       FROM play_history ph JOIN works w ON w.id = ph.work_id
       WHERE ph.user_id = ? AND ${hiddenWorkExpr('w')}
       GROUP BY w.id
       ORDER BY played_at DESC, w.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(userId, limit, offset) as Array<Record<string, unknown>>
  res.json(rows.map((r) => ({ ...enrichWork(r, userId), played_at: String(r.played_at || '') })))
})

// GET /api/plays?page=&pageSize= —— 完整播放历史（每个播放事件）
playsRouter.get('/', (req, res) => {
  const db = getDb()
  const { userId } = req as unknown as AuthedRequest
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 20))
  const offset = (page - 1) * pageSize
  const total = (db.prepare('SELECT COUNT(*) AS c FROM play_history WHERE user_id = ?').get(userId) as { c: number }).c
  const rows = db
    .prepare(
      `SELECT ph.id AS play_id, ph.file_id, ph.played_at, w.*
       FROM play_history ph JOIN works w ON w.id = ph.work_id
       WHERE ph.user_id = ? AND ${hiddenWorkExpr('w')}
       ORDER BY ph.played_at DESC, ph.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(userId, pageSize, offset) as Array<Record<string, unknown>>
  res.json({
    items: rows.map((r) => ({ ...enrichWork(r, userId), play_id: Number(r.play_id), played_at: String(r.played_at || '') })),
    total,
    page,
    pageSize,
  })
})
