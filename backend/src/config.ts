import dotenv from 'dotenv'
import path from 'node:path'
import fs from 'node:fs'

dotenv.config()

export interface AppConfig {
  port: number
  dataDir: string
  coversDir: string
  dbPath: string
}

export function getConfig(): AppConfig {
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'))
  const coversDir = path.join(dataDir, 'covers')
  fs.mkdirSync(coversDir, { recursive: true })
  return {
    port: Number(process.env.PORT || 3000),
    dataDir,
    coversDir,
    dbPath: path.join(dataDir, 'yuzuki.db'),
  }
}
