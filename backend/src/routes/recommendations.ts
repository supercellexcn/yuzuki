import { Router } from 'express'
import { getRecommendationJob, startRecommendationCalc } from '../scanner/jobManager.js'

export const recommendationsRouter = Router()

// POST /api/recommendations/calc —— 手动触发推荐计算（后台执行，立即返回）
recommendationsRouter.post('/calc', async (_req, res) => {
  const ok = await startRecommendationCalc()
  res.json({ ok })
})

// GET /api/recommendations/status —— 推荐计算任务状态
recommendationsRouter.get('/status', (_req, res) => {
  res.json(getRecommendationJob())
})
