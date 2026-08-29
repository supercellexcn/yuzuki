import { Router } from 'express'
import { getDb } from '../db/connection.js'
import { hiddenWorkExpr } from '../services/hidden.js'

export const circlesRouter = Router()

// GET /api/circles —— 聚合所有社团（含作品计数，只统计可见作品，隐藏社团不展示）
circlesRouter.get('/', (_req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT w.circle AS name, COUNT(*) AS count
       FROM works w
       WHERE w.circle != '' AND ${hiddenWorkExpr('w')}
       GROUP BY w.circle
       ORDER BY count DESC, w.circle COLLATE NOCASE`
    )
    .all()
  res.json(rows)
})
