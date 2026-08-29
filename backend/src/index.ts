import express from 'express'
import cors from 'cors'
import { getConfig } from './config.js'
import { getDb } from './db/connection.js'
import { seedAdmin, authMiddleware } from './auth.js'
import { authRouter } from './routes/auth.js'
import { worksRouter } from './routes/works.js'
import { circlesRouter } from './routes/circles.js'
import { scanRouter } from './routes/scan.js'
import { mediaRouter } from './routes/media.js'
import { coverRouter } from './routes/cover.js'
import { tagsRouter } from './routes/tags.js'
import { actorsRouter } from './routes/actors.js'
import { settingsRouter } from './routes/settings.js'
import { playsRouter } from './routes/plays.js'
import { prefsRouter } from './routes/prefs.js'
import { favoritesRouter } from './routes/favorites.js'
import { recommendationsRouter } from './routes/recommendations.js'
import { adminRouter } from './routes/admin.js'
import { getSettings } from './settings.js'
import { startRecommendationCalc } from './scanner/jobManager.js'

const config = getConfig()
getDb() // 初始化数据库
seedAdmin() // 首次启动创建默认 admin / 123456

// 首次启动 / 首次启用推荐：若已存在作品但还没有任何推荐结果，后台自动计算一次
{
  const settings = getSettings()
  if (settings.recommendation_enabled) {
    const db = getDb()
    const works = (db.prepare('SELECT COUNT(*) AS c FROM works').get() as { c: number }).c
    const recs = (db.prepare('SELECT COUNT(*) AS c FROM work_recommendations').get() as { c: number }).c
    if (works > 1 && recs === 0) void startRecommendationCalc()
  }
}

const app = express()
app.use(cors())
// 20MB 上限：默认封面以 base64 JSON 上传（10MB 图片 ≈ 13.3MB base64）
app.use(express.json({ limit: '20mb' }))

// 公开接口：健康检查 + 登录
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }))
app.use('/api/auth', authRouter)

// 其余所有 /api 接口都需要登录
app.use('/api', authMiddleware)
app.use('/api/works', worksRouter)
app.use('/api/circles', circlesRouter)
app.use('/api/scan', scanRouter)
app.use('/api/media', mediaRouter)
app.use('/api/cover', coverRouter)
app.use('/api/tags', tagsRouter)
app.use('/api/actors', actorsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/plays', playsRouter)
app.use('/api/prefs', prefsRouter)
app.use('/api/favorites', favoritesRouter)
app.use('/api/recommendations', recommendationsRouter)
app.use('/api/admin', adminRouter)

app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }))

app.listen(config.port, () => {
  console.log(`[yuzuki] backend listening on http://0.0.0.0:${config.port}`)
  console.log(`[yuzuki] data dir: ${config.dataDir}`)
})
