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

/**
 * 「一次连听」的合并间隔上限（秒）。
 * 相邻两条播放记录：作品相同、且间隔小于该值 → 视为同一次连听，合并成一条。
 * ASMR 单文件经常超过 1 小时（记录发生在「开始播放」时刻，所以两次记录的间隔≈上一个文件的时长），
 * 3 小时能覆盖一整段连听，又不会把隔天再听同一部作品并进来。
 */
const GROUP_GAP_SECONDS = 3 * 60 * 60

/**
 * 播放历史的分组 CTE：按时间排序后做 gaps-and-islands ——
 * 相邻事件「作品相同且间隔 < 阈值」就归入同一组，换作品必然断开。
 * 组号 grp 由 is_new_group 的前缀和得到；分页发生在分组之后，所以一组不会被拆到两页。
 *
 * 占位符顺序：user_id、间隔阈值。页面查询与总数查询共用这一段，保证两边分组口径完全一致。
 * 隐藏作品的过滤放在 LAG 之前 —— 被隐藏的作品视同没播过，也就不会切断两侧同作品的分组。
 */
const HISTORY_GROUPS_CTE = `
  WITH visible AS (
    SELECT ph.id AS id, ph.work_id AS work_id, ph.played_at AS played_at
    FROM play_history ph
    JOIN works w ON w.id = ph.work_id
    WHERE ph.user_id = ? AND ${hiddenWorkExpr('w')}
  ),
  ordered AS (
    SELECT id, work_id, played_at,
           LAG(work_id)   OVER (ORDER BY played_at, id) AS prev_work_id,
           LAG(played_at) OVER (ORDER BY played_at, id) AS prev_played_at
    FROM visible
  ),
  marked AS (
    SELECT id, work_id, played_at,
           CASE
             WHEN prev_work_id IS NULL THEN 1
             WHEN prev_work_id <> work_id THEN 1
             WHEN (julianday(played_at) - julianday(prev_played_at)) * 86400.0 < ? THEN 0
             ELSE 1
           END AS is_new_group
    FROM ordered
  ),
  runs AS (
    SELECT id, work_id, played_at,
           SUM(is_new_group) OVER (ORDER BY played_at, id) AS grp
    FROM marked
  ),
  grouped AS (
    -- play_id 取组内第一条事件的 id：play_history 只追加，新事件永远排在组的末尾，
    -- 所以它在整组生命周期内不变（用 MAX(id) 会随正在连播的那一组增长，前端分页会错乱）。
    SELECT grp,
           MIN(work_id)   AS work_id,
           MIN(id)        AS play_id,
           MIN(played_at) AS started_at,
           MAX(played_at) AS played_at,
           COUNT(*)       AS group_count
    FROM runs
    GROUP BY grp
  )`

// GET /api/plays?page=&pageSize= —— 播放历史（同一时间段内的同一作品合并为一条）
playsRouter.get('/', (req, res) => {
  const db = getDb()
  const { userId } = req as unknown as AuthedRequest
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 20))
  const offset = (page - 1) * pageSize
  // 总数也按「组」统计，与列表口径一致（旧实现统计的是全表事件数，还包含被隐藏的作品，
  // 和列表对不上会让前端无限滚动多加载一轮）
  const total = (
    db.prepare(`${HISTORY_GROUPS_CTE} SELECT COUNT(*) AS c FROM grouped`).get(userId, GROUP_GAP_SECONDS) as {
      c: number
    }
  ).c
  const rows = db
    .prepare(
      `${HISTORY_GROUPS_CTE}
       SELECT g.play_id, g.started_at, g.played_at, g.group_count, w.*
       FROM grouped g
       JOIN works w ON w.id = g.work_id
       ORDER BY g.played_at DESC, g.play_id DESC
       LIMIT ? OFFSET ?`
    )
    .all(userId, GROUP_GAP_SECONDS, pageSize, offset) as Array<Record<string, unknown>>
  res.json({
    items: rows.map((r) => ({
      ...enrichWork(r, userId),
      play_id: Number(r.play_id),
      played_at: String(r.played_at || ''),
      started_at: String(r.started_at || ''),
      // 命名刻意避开 play_count —— 那个是 enrichWork 给出的「该作品历史总播放次数」
      group_count: Number(r.group_count),
    })),
    total,
    page,
    pageSize,
  })
})
