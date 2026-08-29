import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../db/connection.js'

export const mediaRouter = Router()

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wma: 'audio/x-ms-wma',
  aiff: 'audio/aiff',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  m4v: 'video/mp4',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
}

function mimeFor(ext: string): string {
  return MIME[ext] || 'application/octet-stream'
}

// GET /api/media/:rj/:fileId —— 支持 HTTP Range 的媒体流
mediaRouter.get('/:rj/:fileId', (req, res) => {
  const db = getDb()
  const rj = String(req.params.rj).toUpperCase()
  const fileId = Number(req.params.fileId)

  const work = db.prepare('SELECT * FROM works WHERE rj_code = ?').get(rj) as
    | Record<string, unknown>
    | undefined
  if (!work) return res.status(404).json({ error: 'work not found' })

  const file = db
    .prepare('SELECT * FROM files WHERE id = ? AND work_id = ?')
    .get(fileId, Number(work.id)) as { rel_path: string; ext: string } | undefined
  if (!file) return res.status(404).json({ error: 'file not found' })

  const workDir = path.normalize(String(work.folder_path))
  const abs = path.normalize(path.join(workDir, file.rel_path))
  if (!abs.startsWith(workDir)) return res.status(403).json({ error: 'forbidden' })
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'file missing on disk' })

  res.sendFile(abs, { acceptRanges: true, headers: { 'Content-Type': mimeFor(file.ext) } }, (err) => {
    if (err && !res.headersSent) {
      res.status(404).end()
    }
  })
})
