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

/** 解析后的单段区间；null = 头无法解析（按整文件返回）；'unsatisfiable' = 416 */
type ByteRange = { start: number; end: number } | null | 'unsatisfiable'

/**
 * 解析 Range 头，只产出**单段**结果。
 * 多段（Safari / 部分播放器会发 `bytes=0-99,200-299`）合并成「首个起点 ~ 最后一个终点」，
 * 绝不回落到整文件 —— 对几百 MB 的 flac 来说，一次全量下发等于 seek 彻底失效。
 */
function parseRange(header: string | undefined, size: number): ByteRange {
  if (!header) return null
  const m = /^bytes=(.+)$/i.exec(header.trim())
  if (!m) return null

  let start = Number.POSITIVE_INFINITY
  let end = -1
  let seen = false

  for (const part of m[1].split(',')) {
    const spec = part.trim()
    if (!spec) continue
    const dash = spec.indexOf('-')
    if (dash < 0) continue
    const head = spec.slice(0, dash).trim()
    const tail = spec.slice(dash + 1).trim()

    if (head === '') {
      // 后缀段 `-N`：最后 N 字节
      const n = Number(tail)
      if (!Number.isFinite(n) || n <= 0) continue
      const s = Math.max(0, size - Math.floor(n))
      start = Math.min(start, s)
      end = Math.max(end, size - 1)
      seen = true
      continue
    }

    const s = Number(head)
    if (!Number.isFinite(s) || s < 0) continue

    if (tail === '') {
      // 开区间 `N-`：起点越界时保留 s，交给下方 unsatisfiable 判定（RFC 要求 416）
      start = Math.min(start, Math.floor(s))
      end = Math.max(end, size - 1)
      seen = true
      continue
    }

    const e = Number(tail)
    if (!Number.isFinite(e) || e < s) continue
    start = Math.min(start, Math.floor(s))
    end = Math.max(end, Math.floor(e))
    seen = true
  }

  if (!seen) return null
  if (start >= size) return 'unsatisfiable'
  return { start, end: Math.min(end, size - 1) }
}

/** 与 send 保持一致的弱 ETag（W/"sizeHex-mtimeHex"），避免客户端缓存整体失效 */
function makeEtag(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`
}

/** 非 Range 请求的 304 判定（Range 请求一律 206，不参与缓存协商） */
function isFresh(req: { headers: Record<string, unknown> }, etag: string, mtimeMs: number): boolean {
  const inm = req.headers['if-none-match']
  if (typeof inm === 'string' && inm.length) {
    return inm.split(',').some((t) => t.trim() === etag || t.trim() === '*')
  }
  const ims = req.headers['if-modified-since']
  if (typeof ims === 'string' && ims.length) {
    const since = Date.parse(ims)
    if (Number.isFinite(since)) return Math.floor(mtimeMs / 1000) * 1000 <= since
  }
  return false
}

/** If-Range 不匹配时按整文件返回（RFC 9110 要求） */
function ifRangeMatched(req: { headers: Record<string, unknown> }, etag: string, mtimeMs: number): boolean {
  const value = req.headers['if-range']
  if (typeof value !== 'string' || !value.length) return true
  const v = value.trim()
  if (v.startsWith('W/"') || v.startsWith('"')) return v === etag
  const t = Date.parse(v)
  return Number.isFinite(t) && Math.floor(mtimeMs / 1000) * 1000 <= t
}

// GET/HEAD /api/media/:rj/:fileId —— 支持 HTTP Range 的媒体流
mediaRouter.all('/:rj/:fileId', (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    return res.status(405).json({ error: 'method not allowed' })
  }

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
  const rel = path.relative(workDir, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return res.status(403).json({ error: 'forbidden' })

  // 一次 stat 同时完成「存在性判断 + 取 size/mtime」，不再额外 existsSync
  let stat: fs.Stats
  try {
    stat = fs.statSync(abs)
  } catch {
    return res.status(404).json({ error: 'file missing on disk' })
  }
  if (!stat.isFile()) return res.status(404).json({ error: 'file missing on disk' })

  const size = stat.size
  const mtimeMs = stat.mtimeMs
  const etag = makeEtag(size, mtimeMs)
  const contentType = mimeFor(file.ext)

  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', contentType)
  res.setHeader('ETag', etag)
  res.setHeader('Last-Modified', stat.mtime.toUTCString())
  res.setHeader('Cache-Control', 'public, max-age=0')

  const rangeHeader = req.headers.range
  const range = typeof rangeHeader === 'string' && ifRangeMatched(req, etag, mtimeMs)
    ? parseRange(rangeHeader, size)
    : null

  const pipeRange = (start: number, end: number) => {
    const stream = fs.createReadStream(abs, { start, end })
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end()
      else res.destroy()
    })
    // 拖动进度条会连续打断旧请求，及时释放句柄，避免 NAS 上堆积
    res.on('close', () => stream.destroy())
    stream.pipe(res)
  }

  /** 整文件 200（无 Range、Range 无法解析、If-Range 不匹配） */
  const sendWhole = () => {
    if (isFresh(req, etag, mtimeMs)) {
      res.status(304).end()
      return
    }
    res.status(200)
    res.setHeader('Content-Length', String(size))
    if (req.method === 'HEAD') return res.end()
    pipeRange(0, size - 1)
  }

  if (range === 'unsatisfiable') {
    // 必须是 416 + `bytes *\/size`：浏览器与 ExoPlayer 都据此判断「越界但可恢复」，
    // 早先 sendFile 的错误回调会把它改写成 404，客户端会当成致命错误。
    res.status(416)
    res.setHeader('Content-Range', `bytes */${size}`)
    res.setHeader('Content-Length', '0')
    return res.end()
  }

  if (!range) return sendWhole()

  const { start, end } = range
  res.status(206)
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
  res.setHeader('Content-Length', String(end - start + 1))
  if (req.method === 'HEAD') return res.end()
  pipeRange(start, end)
})
