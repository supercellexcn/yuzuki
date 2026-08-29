import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import {
  getSettings,
  updateSettings,
  getCoverDir,
  findDefaultCover,
  removeDefaultCover,
  invalidateDefaultCoverCache,
} from '../settings.js'
import { getDb } from '../db/connection.js'
import { startRecommendationCalc } from '../scanner/jobManager.js'

export const settingsRouter = Router()

settingsRouter.get('/', (_req, res) => {
  res.json(getSettings())
})

settingsRouter.put('/', (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>
  try {
    const before = getSettings()
    const next = updateSettings({
      source_paths: body.source_paths as string[] | undefined,
      scan_depth: body.scan_depth as number | undefined,
      scan_concurrency: body.scan_concurrency as number | undefined,
      page_size: body.page_size as number | undefined,
      seek_seconds: body.seek_seconds as number | undefined,
      proxy: body.proxy as string | undefined,
      dlsite_base: body.dlsite_base as string | undefined,
      dlsite_path: body.dlsite_path as string | undefined,
      dlsite_locale: body.dlsite_locale as string | undefined,
      cover_dir: body.cover_dir as string | undefined,
      recommendation_enabled: body.recommendation_enabled as boolean | undefined,
      recommendation_auto_calc: body.recommendation_auto_calc as boolean | undefined,
      recommendation_top_n: body.recommendation_top_n as number | undefined,
      recommendation_api_limit: body.recommendation_api_limit as number | undefined,
      recommendation_mmr_lambda: body.recommendation_mmr_lambda as number | undefined,
      recommendation_weight_voice: body.recommendation_weight_voice as number | undefined,
      recommendation_weight_tag: body.recommendation_weight_tag as number | undefined,
      recommendation_weight_title: body.recommendation_weight_title as number | undefined,
      recommendation_weight_circle: body.recommendation_weight_circle as number | undefined,
      recommendation_quality_sales_weight: body.recommendation_quality_sales_weight as number | undefined,
      recommendation_min_score: body.recommendation_min_score as number | undefined,
      recommendation_candidate_limit: body.recommendation_candidate_limit as number | undefined,
      recommendation_core_tag_weight: body.recommendation_core_tag_weight as number | undefined,
      recommendation_core_tag_count: body.recommendation_core_tag_count as number | undefined,
      recommendation_quality_impact: body.recommendation_quality_impact as number | undefined,
      recommendation_series_priority_enabled: body.recommendation_series_priority_enabled as boolean | undefined,
      recommendation_series_max_count: body.recommendation_series_max_count as number | undefined,
      recommendation_series_bypass_min_score: body.recommendation_series_bypass_min_score as boolean | undefined,
    })
    // 推荐开关从「关」切到「开」且还没有推荐结果时，立即后台计算一次
    if (!before.recommendation_enabled && next.recommendation_enabled) {
      const db = getDb()
      const works = (db.prepare('SELECT COUNT(*) AS c FROM works').get() as { c: number }).c
      const recs = (db.prepare('SELECT COUNT(*) AS c FROM work_recommendations').get() as { c: number }).c
      if (works > 1 && recs === 0) void startRecommendationCalc()
    }
    res.json(next)
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

const MAX_DEFAULT_COVER_BYTES = 10 * 1024 * 1024 // 10MB

// GET /api/settings/default-cover —— 返回当前默认封面（作品无封面时的兜底图）
settingsRouter.get('/default-cover', (_req, res) => {
  const file = findDefaultCover()
  if (!file) return res.status(404).json({ error: 'no default cover' })
  res.sendFile(file, {}, (err) => {
    if (err && !res.headersSent) res.status(404).end()
  })
})

// POST /api/settings/default-cover —— 上传默认封面 { data: base64, ext: 'jpg'|'jpeg'|'png' }，≤10MB
settingsRouter.post('/default-cover', (req, res) => {
  const data = String(req.body?.data || '')
  let ext = String(req.body?.ext || '').toLowerCase().replace('.', '')
  if (ext === 'jpeg') ext = 'jpg'
  if (ext !== 'jpg' && ext !== 'png') return res.status(400).json({ error: '仅支持 jpg / png' })

  let buf: Buffer
  try {
    buf = Buffer.from(data, 'base64')
  } catch {
    return res.status(400).json({ error: '无效的图片数据' })
  }
  if (buf.length === 0) return res.status(400).json({ error: '图片数据为空' })
  if (buf.length > MAX_DEFAULT_COVER_BYTES) return res.status(400).json({ error: '图片超过 10MB 限制' })

  removeDefaultCover() // 先清掉旧扩展名的默认封面，保证同名唯一
  fs.writeFileSync(path.join(getCoverDir(), `common-cover.${ext}`), buf)
  invalidateDefaultCoverCache() // 新文件写好后立即失效缓存
  res.json({ ok: true, ext })
})

// DELETE /api/settings/default-cover —— 删除默认封面
settingsRouter.delete('/default-cover', (_req, res) => {
  removeDefaultCover()
  res.json({ ok: true })
})
