import { Router } from 'express'
import { getDb } from '../db/connection.js'
import { hiddenWorkExpr } from '../services/hidden.js'

export const seriesRouter = Router()

// GET /api/series —— 聚合所有系列（含作品计数，只统计可见作品，隐藏系列不展示）
seriesRouter.get('/', (_req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT w.series AS name, COUNT(*) AS count
       FROM works w
       WHERE w.series != '' AND ${hiddenWorkExpr('w')}
       GROUP BY w.series
       ORDER BY count DESC, w.series COLLATE NOCASE`
    )
    .all()
  res.json(rows)
})
