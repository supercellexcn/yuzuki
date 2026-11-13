import { Router } from 'express'
import { getRecommendationJob, startRecommendationCalc } from '../scanner/jobManager.js'

export const recommendationsRouter = Router()

// POST /api/recommendations/calc —— 手动触发推荐计算（后台执行，立即返回）
// 手动触发是「强制重算」：即使作品数据没变也会跑一遍（例如调过权重之后）。
recommendationsRouter.post('/calc', async (_req, res) => {
  const ok = await startRecommendationCalc(true)
  res.json({ ok })
})

// GET /api/recommendations/status —— 推荐计算任务状态
recommendationsRouter.get('/status', (_req, res) => {
  res.json(getRecommendationJob())
})
