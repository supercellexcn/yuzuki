import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { getDb, transaction } from '../db/connection.js'
import { getCoverDir } from '../settings.js'
import {
  getScanJob,
  startScan,
  pauseScan,
  resumeScan,
  getCoverJob,
  startCoverRedownload,
} from '../scanner/jobManager.js'

export const scanRouter = Router()

// 扫描作品
scanRouter.post('/', async (_req, res) => {
  const ok = await startScan()
  res.json({ ok })
})

scanRouter.get('/status', (_req, res) => {
  res.json(getScanJob())
})

// 暂停 / 继续扫描
scanRouter.post('/pause', (_req, res) => {
  pauseScan()
  res.json({ ok: true })
})

scanRouter.post('/resume', (_req, res) => {
  resumeScan()
  res.json({ ok: true })
})

// 重新下载缺失封面
scanRouter.post('/redownload-covers', async (_req, res) => {
  const ok = await startCoverRedownload()
  res.json({ ok })
})

scanRouter.get('/cover-status', (_req, res) => {
  res.json(getCoverJob())
})

// 清空媒体库：删除所有作品及其关联（文件/声优/标签关联），并删除封面缓存文件。
// 播放历史与播放计数保留 —— 它们以 rj_code 为稳定键，重新扫描入库时自动接回。
scanRouter.post('/reset', (_req, res) => {
  const job = getScanJob()
  if (job.status === 'running') {
    return res.status(400).json({ error: '扫描进行中，请先等待完成或暂停后再清空' })
  }
  const db = getDb()
  let worksDeleted = 0
  transaction(db, () => {
    worksDeleted = (db.prepare('SELECT COUNT(*) AS c FROM works').get() as { c: number }).c
    db.exec('DELETE FROM works') // files / work_actors / work_tags 级联删除
    // 清理已无引用的声优 / 标签，保持筛选列表干净
    db.exec('DELETE FROM actors WHERE id NOT IN (SELECT actor_id FROM work_actors)')
    db.exec('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM work_tags)')
    // 推荐关系基于 rj_code，作品清空后一并清除（下次扫描完成后自动重建）
    db.exec('DELETE FROM work_recommendations')
    db.exec('DELETE FROM recommendation_work_state')
    db.exec('DELETE FROM recommendation_tag_stats')
  })

  let coversDeleted = 0
  const coversDir = getCoverDir()
  try {
    for (const f of fs.readdirSync(coversDir)) {
      const full = path.join(coversDir, f)
      if (fs.statSync(full).isFile()) {
        fs.unlinkSync(full)
        coversDeleted++
      }
    }
  } catch {
    /* 目录不存在等忽略 */
  }

  res.json({ ok: true, worksDeleted, coversDeleted })
})
