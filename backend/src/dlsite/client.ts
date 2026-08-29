import axios, { type AxiosInstance } from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import { getSettings } from '../settings.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

// 复用同一个 axios 实例与 keep-alive 连接池：不再每次请求都重建代理连接、重新走 TLS 握手。
// 扫描几百个作品时，每个作品 3 次请求，握手开销是最大的耗时来源。
let shared: AxiosInstance | null = null
let sharedProxy = ''

function buildClient(): AxiosInstance {
  const settings = getSettings()
  const proxy = (settings.proxy || '').trim()
  // 代理设置没变就沿用缓存的连接池；代理变了再重建（避免运行时改代理不生效）
  if (shared && sharedProxy === proxy) return shared
  sharedProxy = proxy

  const proxyAgent = proxy ? new HttpsProxyAgent(proxy) : undefined
  shared = axios.create({
    timeout: 15000,
    maxRedirects: 8,
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'ja,zh-CN;q=0.9,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    // 有代理时复用同一个代理 agent（内部维护 keep-alive 连接池）；无代理时用 keep-alive 的本地 agent
    httpAgent: proxyAgent ?? new http.Agent({ keepAlive: true }),
    httpsAgent: proxyAgent ?? new https.Agent({ keepAlive: true }),
  })
  return shared
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function retry<T>(fn: () => Promise<T>, attempts = 3, shouldRetry?: (e: unknown) => boolean): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (shouldRetry && !shouldRetry(e)) throw e
      await sleep(800 * (i + 1))
    }
  }
  throw lastErr
}

/**
 * 抓取页面 HTML（带 locale cookie，让 DLsite 返回指定语言页面）。
 * opts.retryOn404=false 时 404 直接抛出不重试：下架作品页必然 404，重试只会白等 ~2.4s。
 */
export async function fetchHtml(url: string, opts?: { retryOn404?: boolean }): Promise<string> {
  const locale = getSettings().dlsite_locale || 'zh-cn'
  const retryOn404 = opts?.retryOn404 !== false
  return retry(
    async () => {
      const res = await buildClient().get<string>(url, {
        responseType: 'text',
        headers: { cookie: `locale=${locale}` },
      })
      return res.data
    },
    3,
    (e) => retryOn404 || (e as { response?: { status?: number } }).response?.status !== 404
  )
}

/** 请求 DLsite 内部 JSON 接口（销量/评分等动态数据）。opts.referer 可覆盖默认来源页。 */
export async function fetchJson<T>(url: string, opts?: { referer?: string }): Promise<T> {
  const locale = getSettings().dlsite_locale || 'zh-cn'
  const res = await buildClient().get<T>(url, {
    headers: {
      cookie: `locale=${locale}`,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: opts?.referer || 'https://www.dlsite.com/',
    },
  })
  return res.data
}

/** 下载图片到本地（带 Referer，绕过防盗链）。referer 缺省用 DLsite，非 DLsite 域名（如 HVDB）时显式传入。 */
export async function downloadToFile(url: string, destPath: string, referer?: string): Promise<void> {
  const res = await buildClient().get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    headers: { Referer: referer || 'https://www.dlsite.com/' },
  })
  fs.writeFileSync(destPath, Buffer.from(res.data))
}
