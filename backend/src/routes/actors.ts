import { Router } from 'express'
import { getDb } from '../db/connection.js'
import { hiddenWorkExpr } from '../services/hidden.js'

export const actorsRouter = Router()

// GET /api/actors —— 聚合所有声优（含引用计数，只统计可见作品，隐藏声优不展示）
actorsRouter.get('/', (_req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT a.name, COUNT(wa.work_id) AS count
       FROM actors a
       LEFT JOIN work_actors wa ON wa.actor_id = a.id
       LEFT JOIN works w ON w.id = wa.work_id
       WHERE (w.id IS NULL OR ${hiddenWorkExpr('w')})
         AND NOT EXISTS (SELECT 1 FROM hidden_items hhi WHERE hhi.type = 'actor' AND hhi.value = a.name)
       GROUP BY a.id
       ORDER BY count DESC, a.name`
    )
    .all()
  res.json(rows)
})
