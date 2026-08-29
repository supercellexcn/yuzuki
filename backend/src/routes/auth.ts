import { Router } from 'express'
import { getDb } from '../db/connection.js'
import { hashPassword, verifyPassword, signToken, authMiddleware, type AuthedRequest } from '../auth.js'
import { getPrefs } from '../prefs.js'

export const authRouter = Router()

// POST /api/auth/login —— 公开
authRouter.post('/login', (req, res) => {
  const { username, password } = (req.body || {}) as { username?: string; password?: string }
  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' })
  }
  const row = getDb().prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim()) as
    | { id: number; username: string; password_hash: string; must_change_password: number }
    | undefined
  if (!row || !verifyPassword(String(password), row.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  const token = signToken({ userId: row.id, username: row.username })
  res.json({
    token,
    username: row.username,
    must_change_password: !!row.must_change_password,
    prefs: getPrefs(row.id),
  })
})

// 以下接口需要登录
authRouter.use(authMiddleware)

// POST /api/auth/change-password
authRouter.post('/change-password', (req, res) => {
  const db = getDb()
  const { userId } = req as unknown as AuthedRequest
  const { old_password, new_password } = (req.body || {}) as { old_password?: string; new_password?: string }
  const row = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(userId) as
    | { id: number; password_hash: string }
    | undefined
  if (!row) return res.status(401).json({ error: '用户不存在' })
  if (!old_password || !verifyPassword(String(old_password), row.password_hash)) {
    return res.status(400).json({ error: '原密码错误' })
  }
  const np = String(new_password || '')
  if (np.length < 6) return res.status(400).json({ error: '新密码至少 6 位' })
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(np), userId)
  res.json({ ok: true })
})

// GET /api/auth/me
authRouter.get('/me', (req, res) => {
  const db = getDb()
  const { userId } = req as unknown as AuthedRequest
  const row = db.prepare('SELECT id, username, must_change_password, created_at FROM users WHERE id = ?').get(userId) as
    | { id: number; username: string; must_change_password: number; created_at: string }
    | undefined
  if (!row) return res.status(401).json({ error: 'user not found' })
  res.json({
    ...row,
    must_change_password: !!row.must_change_password,
    prefs: getPrefs(userId),
  })
})
