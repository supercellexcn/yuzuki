import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../db/connection.js'
import { getCoverDir, findDefaultCover } from '../settings.js'

export const coverRouter = Router()

/**
 * 解析封面实际文件路径：
 * - 存储的相对文件名 → 相对当前封面目录解析；
 * - 存储的旧绝对路径（本地开发时代）若仍存在则直接用；
 * - 旧绝对路径已失效时（库迁移到别的机器），按文件名在当前封面目录里找。
 */
function resolveCover(stored: string): string | null {
  if (path.isAbsolute(stored) && fs.existsSync(stored)) return stored
  const inDir = path.join(getCoverDir(), path.basename(stored))
  return fs.existsSync(inDir) ? inDir : null
}

// GET /api/cover/:rj —— 返回本地缓存的封面；作品无封面/文件缺失时回退到用户上传的默认封面
coverRouter.get('/:rj', (req, res) => {
  const db = getDb()
  const rj = String(req.params.rj).toUpperCase()
  const row = db.prepare('SELECT cover_path FROM works WHERE rj_code = ?').get(rj) as
    | { cover_path: string }
    | undefined
  const abs = row?.cover_path ? resolveCover(row.cover_path) : null
  const file = abs || findDefaultCover()
  if (!file) {
    return res.status(404).json({ error: 'no cover' })
  }
  res.sendFile(file, {}, (err) => {
    if (err && !res.headersSent) res.status(404).end()
  })
})
