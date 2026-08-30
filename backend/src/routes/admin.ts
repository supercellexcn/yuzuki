import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../db/connection.js'
import { enrichWork } from '../services/enrich.js'
import { setManualCover, restoreWorkCover, syncWork } from '../services/workService.js'
import { CUSTOM_TAG, hiddenWorkFlag } from '../services/hidden.js'

export const adminRouter = Router()

const HIDDEN_TYPES = new Set(['work', 'series', 'circle', 'actor', 'tag'])

function clampPage(v: unknown, fallback: number, max: number): number {
  const n = Number(v)
  return Math.max(1, Math.min(max, Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback))
}

// GET /api/admin/works?page=&pageSize=20&q=&circle=&actor=&series=&tag=&hasCover=1|0
adminRouter.get('/works', (req, res) => {
  const db = getDb()
  const page = clampPage(req.query.page, 1, 1e9)
  const pageSize = clampPage(req.query.pageSize, 20, 500)
  const offset = (page - 1) * pageSize
  const q = String(req.query.q || '').trim()
  const circle = String(req.query.circle || '').trim()
  const actor = String(req.query.actor || '').trim()
  const series = String(req.query.series || '').trim()
  const tag = String(req.query.tag || '').trim()
  const hasCover = String(req.query.hasCover || '').trim()

  const where: string[] = []
  const params: Array<string | number> = []
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`
    where.push(`(w.rj_code LIKE ? ESCAPE '\\' OR w.title LIKE ? ESCAPE '\\')`)
    params.push(like, like)
  }
  if (circle) {
    where.push('w.circle = ?')
    params.push(circle)
  }
  if (series) {
    where.push('w.series = ?')
    params.push(series)
  }
  if (actor) {
    where.push(
      'EXISTS(SELECT 1 FROM work_actors wa JOIN actors a ON a.id = wa.actor_id WHERE wa.work_id = w.id AND a.name = ?)'
    )
    params.push(actor)
  }
  if (tag) {
    where.push(
      'EXISTS(SELECT 1 FROM work_tags wt JOIN tags t ON t.id = wt.tag_id WHERE wt.work_id = w.id AND t.name = ?)'
    )
    params.push(tag)
  }
  if (hasCover === '1') where.push(`w.cover_path != ''`)
  else if (hasCover === '0') where.push(`w.cover_path = ''`)
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM works w ${whereSql}`).get(...params) as { c: number }).c
  const rows = db
    .prepare(
      `SELECT w.*, ${hiddenWorkFlag('w')} FROM works w ${whereSql}
       ORDER BY w.added_at DESC, w.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as Array<Record<string, unknown>>

  res.json({
    items: rows.map((r) => ({
      ...enrichWork(r),
      hidden: Number(r.hidden) === 1,
      cover_modified: Number(r.cover_modified) === 1,
    })),
    total,
    page,
    pageSize,
  })
})

// GET /api/admin/works/:rj —— 单作品详情（含文件列表，不受隐藏过滤影响）
adminRouter.get('/works/:rj', (req, res) => {
  const db = getDb()
  const rj = String(req.params.rj).toUpperCase()
  const row = db
    .prepare(`SELECT w.*, ${hiddenWorkFlag('w')} FROM works w WHERE w.rj_code = ?`)
    .get(rj) as Record<string, unknown> | undefined
  if (!row) return res.status(404).json({ error: 'work not found' })
  const files = db
    .prepare('SELECT id, filename, rel_path, ext, kind, is_dir, size, sort_order FROM files WHERE work_id = ? ORDER BY sort_order')
    .all(Number(row.id))
  res.json({
    ...enrichWork(row),
    hidden: Number(row.hidden) === 1,
    cover_modified: Number(row.cover_modified) === 1,
    files,
  })
})

// POST /api/admin/works/:rj/cover —— 把作品文件夹里的某张图片设为封面 { file_id }
adminRouter.post('/works/:rj/cover', (req, res) => {
  const db = getDb()
  const rj = String(req.params.rj).toUpperCase()
  const work = db.prepare('SELECT id, folder_path FROM works WHERE rj_code = ?').get(rj) as
    | { id: number; folder_path: string }
    | undefined
  if (!work) return res.status(404).json({ error: 'work not found' })

  const fileId = Number(req.body?.file_id)
  if (!fileId) return res.status(400).json({ error: 'invalid file_id' })
  const file = db.prepare('SELECT rel_path FROM files WHERE id = ? AND work_id = ?').get(fileId, work.id) as
    | { rel_path: string }
    | undefined
  if (!file) return res.status(404).json({ error: 'file not found' })

  const src = path.join(work.folder_path, file.rel_path)
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return res.status(404).json({ error: 'file missing' })
  try {
    setManualCover(db, rj, work.id, src)
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

// POST /api/admin/works/:rj/cover/restore —— 还原封面
adminRouter.post('/works/:rj/cover/restore', (req, res) => {
  const db = getDb()
  const rj = String(req.params.rj).toUpperCase()
  const work = db.prepare('SELECT id FROM works WHERE rj_code = ?').get(rj) as { id: number } | undefined
  if (!work) return res.status(404).json({ error: 'work not found' })
  restoreWorkCover(db, rj, work.id)
  res.json({ ok: true })
})

// POST /api/admin/works/:rj/sync —— 重新同步单个作品的元数据与封面
// 元信息以 DLsite 优先、缺失时用 HVDB 补；封面 DLsite 有就用 DLsite，否则用 HVDB。
adminRouter.post('/works/:rj/sync', async (req, res) => {
  const db = getDb()
  const rj = String(req.params.rj).toUpperCase()
  const work = db.prepare('SELECT id FROM works WHERE rj_code = ?').get(rj) as { id: number } | undefined
  if (!work) return res.status(404).json({ error: 'work not found' })
  try {
    await syncWork(db, work.id, rj)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// POST /api/admin/works/:rj/hidden —— 隐藏 / 展示作品 { hidden }
adminRouter.post('/works/:rj/hidden', (req, res) => {
  const db = getDb()
  const rj = String(req.params.rj).toUpperCase()
  const work = db.prepare('SELECT id FROM works WHERE rj_code = ?').get(rj) as { id: number } | undefined
  if (!work) return res.status(404).json({ error: 'work not found' })
  const hidden = Boolean(req.body?.hidden)
  if (hidden) {
    db.prepare("INSERT OR IGNORE INTO hidden_items (type, value, extra) VALUES ('work', ?, '')").run(rj)
  } else {
    db.prepare("DELETE FROM hidden_items WHERE type = 'work' AND value = ? AND extra = ''").run(rj)
  }
  res.json({ ok: true, hidden })
})

// POST /api/admin/works/:rj/tags —— 给作品添加自定义标签 { name }
adminRouter.post('/works/:rj/tags', (req, res) => {
  const db = getDb()
  const rj = String(req.params.rj).toUpperCase()
  const work = db.prepare('SELECT id FROM works WHERE rj_code = ?').get(rj) as { id: number } | undefined
  if (!work) return res.status(404).json({ error: 'work not found' })
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: '标签名不能为空' })
  if (name.length > 50) return res.status(400).json({ error: '标签名过长' })

  db.prepare('INSERT OR IGNORE INTO tags (name, category) VALUES (?, ?)').run(name, CUSTOM_TAG)
  const t = db.prepare('SELECT id FROM tags WHERE name = ? AND category = ?').get(name, CUSTOM_TAG) as { id: number }
  db.prepare('INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)').run(work.id, t.id)
  res.json({ ok: true, name, category: CUSTOM_TAG })
})

// DELETE /api/admin/works/:rj/tags?name=&category= —— 移除作品的标签（仅自定义标签）
adminRouter.delete('/works/:rj/tags', (req, res) => {
  const db = getDb()
  const rj = String(req.params.rj).toUpperCase()
  const work = db.prepare('SELECT id FROM works WHERE rj_code = ?').get(rj) as { id: number } | undefined
  if (!work) return res.status(404).json({ error: 'work not found' })
  const name = String(req.query.name || '').trim()
  const category = String(req.query.category || '').trim()
  if (!name || category !== CUSTOM_TAG) return res.status(400).json({ error: '只能移除自定义标签' })

  const t = db.prepare('SELECT id FROM tags WHERE name = ? AND category = ?').get(name, CUSTOM_TAG) as
    | { id: number }
    | undefined
  if (t) {
    db.prepare('DELETE FROM work_tags WHERE work_id = ? AND tag_id = ?').run(work.id, t.id)
  }
  res.json({ ok: true })
})

// GET /api/admin/series —— 所有系列（含隐藏状态与作品数）
adminRouter.get('/series', (_req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT w.series AS name, COUNT(*) AS count,
         EXISTS(SELECT 1 FROM hidden_items hi WHERE hi.type = 'series' AND hi.value = w.series) AS hidden
       FROM works w
       WHERE w.series != ''
       GROUP BY w.series
       ORDER BY count DESC, w.series COLLATE NOCASE`
    )
    .all() as unknown as Array<{ name: string; count: number; hidden: number }>
  res.json(rows.map((r) => ({ name: r.name, count: Number(r.count), hidden: Number(r.hidden) === 1 })))
})

// GET /api/admin/circles —— 所有社团（含隐藏状态与作品数）
adminRouter.get('/circles', (_req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT w.circle AS name, COUNT(*) AS count,
         EXISTS(SELECT 1 FROM hidden_items hi WHERE hi.type = 'circle' AND hi.value = w.circle) AS hidden
       FROM works w
       WHERE w.circle != ''
       GROUP BY w.circle
       ORDER BY count DESC, w.circle COLLATE NOCASE`
    )
    .all() as unknown as Array<{ name: string; count: number; hidden: number }>
  res.json(rows.map((r) => ({ name: r.name, count: Number(r.count), hidden: Number(r.hidden) === 1 })))
})

// GET /api/admin/actors —— 所有声优（含隐藏状态与作品数）
adminRouter.get('/actors', (_req, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT a.name, COUNT(wa.work_id) AS count,
         EXISTS(SELECT 1 FROM hidden_items hi WHERE hi.type = 'actor' AND hi.value = a.name) AS hidden
       FROM actors a
       LEFT JOIN work_actors wa ON wa.actor_id = a.id
       GROUP BY a.id
       ORDER BY count DESC, a.name`
    )
    .all() as unknown as Array<{ name: string; count: number; hidden: number }>
  res.json(rows.map((r) => ({ name: r.name, count: Number(r.count), hidden: Number(r.hidden) === 1 })))
})

// GET /api/admin/tags?filter=all|custom|native —— 所有标签
adminRouter.get('/tags', (req, res) => {
  const db = getDb()
  const filter = String(req.query.filter || 'all')
  const where =
    filter === 'custom'
      ? `WHERE t.category = '${CUSTOM_TAG}'`
      : filter === 'native'
        ? `WHERE t.category != '${CUSTOM_TAG}'`
        : ''
  const rows = db
    .prepare(
      `SELECT t.name, t.category, COUNT(wt.work_id) AS count,
         EXISTS(SELECT 1 FROM hidden_items hi WHERE hi.type = 'tag' AND hi.value = t.name AND hi.extra = t.category) AS hidden
       FROM tags t
       LEFT JOIN work_tags wt ON wt.tag_id = t.id
       ${where}
       GROUP BY t.id
       ORDER BY (t.category = '${CUSTOM_TAG}') ASC, t.category, count DESC, t.name`
    )
    .all() as unknown as Array<{ name: string; category: string; count: number; hidden: number }>
  res.json(rows.map((r) => ({ name: r.name, category: r.category, count: Number(r.count), hidden: Number(r.hidden) === 1 })))
})

// POST /api/admin/tags —— 新增自定义标签 { name }
adminRouter.post('/tags', (req, res) => {
  const db = getDb()
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: '标签名不能为空' })
  if (name.length > 50) return res.status(400).json({ error: '标签名过长' })
  const exists = db.prepare('SELECT id FROM tags WHERE name = ? AND category = ?').get(name, CUSTOM_TAG) as
    | { id: number }
    | undefined
  if (exists) return res.status(400).json({ error: '该自定义标签已存在' })
  db.prepare('INSERT INTO tags (name, category) VALUES (?, ?)').run(name, CUSTOM_TAG)
  res.json({ ok: true, name, category: CUSTOM_TAG })
})

// DELETE /api/admin/tags?name=&category= —— 删除自定义标签（级联移除作品关联/隐藏记录/收藏）
adminRouter.delete('/tags', (req, res) => {
  const db = getDb()
  const name = String(req.query.name || '').trim()
  const category = String(req.query.category || '').trim()
  if (!name || category !== CUSTOM_TAG) return res.status(400).json({ error: '只能删除自定义标签' })
  const t = db.prepare('SELECT id FROM tags WHERE name = ? AND category = ?').get(name, CUSTOM_TAG) as
    | { id: number }
    | undefined
  if (t) {
    db.prepare('DELETE FROM tags WHERE id = ?').run(t.id) // work_tags 级联删除
    db.prepare("DELETE FROM hidden_items WHERE type = 'tag' AND value = ? AND extra = ?").run(name, CUSTOM_TAG)
    db.prepare("DELETE FROM favorites WHERE type = 'tag' AND value = ? AND extra = ?").run(name, CUSTOM_TAG)
  }
  res.json({ ok: true })
})

// POST /api/admin/hidden —— 通用隐藏 / 取消隐藏（series / circle / actor / tag）
adminRouter.post('/hidden', (req, res) => {
  const db = getDb()
  const type = String(req.body?.type || '')
  const value = String(req.body?.value || '').trim()
  const extra = String(req.body?.extra || '').trim()
  const hidden = Boolean(req.body?.hidden)
  if (!HIDDEN_TYPES.has(type) || !value) return res.status(400).json({ error: 'invalid params' })
  if (type === 'work' && hidden) {
    db.prepare("INSERT OR IGNORE INTO hidden_items (type, value, extra) VALUES ('work', ?, '')").run(value.toUpperCase())
    return res.json({ ok: true, hidden })
  }
  if (hidden) {
    db.prepare('INSERT OR IGNORE INTO hidden_items (type, value, extra) VALUES (?, ?, ?)').run(type, value, extra)
  } else {
    db.prepare('DELETE FROM hidden_items WHERE type = ? AND value = ? AND extra = ?').run(type, value, extra)
  }
  res.json({ ok: true, hidden })
})
