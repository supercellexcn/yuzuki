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
  subscribeJob,
  getJobSnapshot,
} from '../scanner/jobManager.js'

export const scanRouter = Router()

/** 同时允许的 SSE 连接数上限：正常只有几个标签页，超出说明有人在堆积连接。 */
const MAX_EVENT_STREAMS = 20
let eventStreams = 0

// 扫描作品
scanRouter.post('/', async (_req, res) => {
  const ok = await startScan()
  res.json({ ok })
})

scanRouter.get('/status', (_req, res) => {
  res.json(getScanJob())
})

/**
 * 任务状态推送（SSE）。
 *
 * 连接建立后先推一帧全量快照（scan / cover / recommendation），之后只推有变化的那几类。
 * 状态保存在后端进程内存里，所以**刷新页面 / 重新连接都能立刻恢复最新进度** ——
 * 唯一的丢失场景是后端进程重启（内存清零，扫描本身也随之中断）。
 *
 * 心跳每 15 秒一条注释行，用于穿越 nginx / 群晖反代 / NPM 的空闲超时。
 */
scanRouter.get('/events', (req, res) => {
  if (eventStreams >= MAX_EVENT_STREAMS) {
    res.status(503).json({ error: 'too many event streams' })
    return
  }
  eventStreams++

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // 关闭 nginx 的响应缓冲，否则事件会被攒在缓冲区里不发（群晖反代 / NPM 需同样处理）
    'X-Accel-Buffering': 'no',
  })
  // SSE 是长连接：不能因为「一段时间没数据」被 Node 的默认超时掐断
  req.socket.setTimeout(0)
  req.socket.setNoDelay(true)

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  // retry：告诉浏览器断线后 3 秒重连；紧接着推一次全量快照
  res.write('retry: 3000\n\n')
  const initial = getJobSnapshot()
  send('scan', initial.scan)
  send('cover', initial.cover)
  send('recommendation', initial.recommendation)

  const unsubscribe = subscribeJob((snapshot, kinds) => {
    if (kinds.has('scan')) send('scan', snapshot.scan)
    if (kinds.has('cover')) send('cover', snapshot.cover)
    if (kinds.has('recommendation')) send('recommendation', snapshot.recommendation)
  })

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000)

  let closed = false
  const cleanup = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    unsubscribe()
    eventStreams--
  }
  req.on('close', cleanup)
  res.on('error', cleanup)
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

// 重新下载缺失封面；{ refresh_stats: true } 时顺带更新所有作品的价格 / 评分 / 评论数 / 销量
scanRouter.post('/redownload-covers', async (req, res) => {
  const refreshStats = req.body?.refresh_stats === true
  const ok = await startCoverRedownload(refreshStats)
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
