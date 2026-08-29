import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { getDb } from './db/connection.js'

const SECRET = process.env.AUTH_SECRET || 'yuzuki-secret-change-me'
const TOKEN_TTL = 1000 * 60 * 60 * 24 * 30 // 30 天

/** scrypt 加盐哈希：格式 `salt:hash` */
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const test = crypto.scryptSync(pw, salt, 64).toString('hex')
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(test, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export interface AuthPayload {
  userId: number
  username: string
  exp: number
}

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

export function signToken(payload: { userId: number; username: string }): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' })
  const body = b64url({ ...payload, exp: Date.now() + TOKEN_TTL })
  const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

export function verifyToken(token: string): AuthPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  const expected = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as AuthPayload
    if (!payload.userId || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export interface AuthedRequest extends Request {
  userId: number
  username: string
}

/** 鉴权中间件：从 Authorization: Bearer <token> 或 ?token= 校验并写入 req.userId / req.username */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || ''
  const headerToken = header.startsWith('Bearer ') ? header.slice(7) : ''
  const queryToken = req.query?.token ? String(req.query.token) : ''
  const token = headerToken || queryToken
  const payload = verifyToken(token)
  if (!payload) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  ;(req as unknown as AuthedRequest).userId = payload.userId
  ;(req as unknown as AuthedRequest).username = payload.username
  next()
}

/** 首次启动创建默认 admin 账户（密码 123456，需强制改密） */
export function seedAdmin(): void {
  const db = getDb()
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }
  if (c === 0) {
    db.prepare(
      'INSERT INTO users (username, password_hash, must_change_password, created_at) VALUES (?, ?, 1, ?)'
    ).run('admin', hashPassword('123456'), new Date().toISOString())
  }
}
