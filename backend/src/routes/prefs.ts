import { Router } from 'express'
import { authMiddleware, type AuthedRequest } from '../auth.js'
import { getPrefs, savePrefs, type Prefs } from '../prefs.js'

export const prefsRouter = Router()
prefsRouter.use(authMiddleware)

// GET /api/prefs —— 当前用户的界面记忆
prefsRouter.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest
  res.json(getPrefs(userId))
})

// PUT /api/prefs —— 保存界面记忆
prefsRouter.put('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest
  const body = (req.body || {}) as Partial<Prefs>
  const next = savePrefs(userId, body)
  res.json(next)
})
