import { Router } from 'express'
import { getDb } from '../db/connection.js'
import { hiddenWorkExpr, CUSTOM_TAG } from '../services/hidden.js'

export const tagsRouter = Router()

// GET /api/tags —— 聚合所有标签（含引用计数）
// 只统计可见作品，隐藏标签本身也不出现在筛选列表；自定义标签排在系统标签之后。
tagsRouter.get('/', (_req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT t.name, t.category, COUNT(wt.work_id) AS count
       FROM tags t
       LEFT JOIN work_tags wt ON wt.tag_id = t.id
       LEFT JOIN works w ON w.id = wt.work_id
       WHERE (w.id IS NULL OR ${hiddenWorkExpr('w')})
         AND NOT EXISTS (SELECT 1 FROM hidden_items hi WHERE hi.type = 'tag' AND hi.value = t.name AND hi.extra = t.category)
       GROUP BY t.id
       ORDER BY (t.category = '${CUSTOM_TAG}') ASC, t.category, count DESC, t.name`
    )
    .all()
  res.json(rows)
})
