import * as cheerio from 'cheerio'
import { getSettings } from '../settings.js'
import { fetchHtml } from './client.js'

/**
 * DLsite 完全拿不到作品信息时的兜底源：HVDB（https://hvdb.me）。
 * 解析逻辑参考 kikoeru-express 的 scraper/hvdb.js：
 * - <input id="Name" value="…"> → 标题
 * - <a href="…/CircleWorks/{id}">文本</a> → 社团名
 * - <a href="…/TagWorks/{id}">文本</a> → 标签
 * - <a href="…/CVWorks/{id}">文本</a> → 声优（过滤含拉丁字母的别名/转写）
 * 失败一律返回 null，绝不抛错。
 */

export interface HvdbData {
  title: string
  circle: string
  cover_url: string
  tags: Array<{ name: string; category: string }>
  actors: string[]
}

/** 从 RJ 号取 HVDB 用的数字 id：RJ123456 → 123456，RJ01000001 → 1000001。 */
export function rjToHvdbId(rj: string): string {
  const digits = String(rj).replace(/\D/g, '')
  const id = parseInt(digits, 10)
  return Number.isNaN(id) ? '' : String(id)
}

/** HVDB 页面里的相对/协议相对 URL → 绝对 URL。 */
function absolutizeHvdbUrl(src: string, base: string): string {
  const u = src.trim()
  if (!u) return ''
  if (u.startsWith('//')) return 'https:' + u
  if (/^https?:\/\//i.test(u)) return u
  if (u.startsWith('/')) return base + u
  return base + '/' + u
}

/**
 * HVDB 常把社团的多语言名/别名用 " / " 拼接展示（如 "p-blooming / p-blooming"）。
 * kikoeru 的 htmlparser 只捕获锚点内第一个文本节点，这里等价取第一段并折叠空白。
 */
function cleanCircleName(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim()
  if (!s) return ''
  const first = s.split(' / ')[0].trim()
  return first || s
}

/** 取页面里的封面图地址：兼容懒加载（data-src / data-original）与 og:image。 */
function pickCoverSrc($: cheerio.CheerioAPI): string {
  const selectors = [
    'img[src*="WorkImages"]',
    'img[data-src*="WorkImages"]',
    'img[data-original*="WorkImages"]',
  ]
  for (const sel of selectors) {
    const el = $(sel).not('[src*="loading"]').not('[data-src*="loading"]').first()
    const src = el.attr('src') || el.attr('data-src') || el.attr('data-original') || ''
    if (src) return src
  }
  return $('meta[property="og:image"]').first().attr('content') || ''
}

export async function fetchHvdbMeta(rj: string): Promise<HvdbData | null> {
  const id = rjToHvdbId(rj)
  if (!id) return null
  const base = (getSettings().hvdb_base || 'https://hvdb.me').replace(/\/+$/, '')
  try {
    const html = await fetchHtml(`${base}/Dashboard/WorkDetails/${id}`, { retryOn404: false })
    const $ = cheerio.load(html)

    const title =
      $('input#Name').first().attr('value')?.trim() ||
      $('meta[property="og:title"]').first().attr('content')?.trim() ||
      ''
    // 封面：优先页面上真实的 <img>（懒加载也兼容），其次 og:image；
    // 都没有时才按 HVDB 的命名规则猜 —— **扩展名是 .webp**（实测 HVDB 存的是 webp，
    // 早期猜 .jpg 必然 404，这是「HVDB 有封面却下载不到」的直接原因）。
    const realSrc = pickCoverSrc($)
    const circle = cleanCircleName($('a[href*="CircleWorks"]').first().text())

    const tags: Array<{ name: string; category: string }> = []
    $('a[href*="TagWorks"]').each((_, el) => {
      const name = $(el).text().trim()
      if (name && !tags.some((t) => t.name === name)) tags.push({ name, category: 'ジャンル' })
    })

    const actors: string[] = []
    $('a[href*="CVWorks"]').each((_, el) => {
      const name = $(el).text().trim()
      // 过滤含拉丁字母的名字（多为英文别名/转写），与 kikoeru 的 hasLetter 过滤一致
      if (name && !/[A-Za-z]/.test(name) && !actors.includes(name)) actors.push(name)
    })

    // 页面是否真的解析出了内容：什么都没有 → 大概率是风控挑战页 / 改版页。
    // 此时**不能**再按命名规则猜封面 URL：猜出来的必然 404，还会让上层误以为「拿到了封面」。
    const parsed = Boolean(title || circle || realSrc || tags.length || actors.length)
    if (!parsed) {
      console.warn(`[hvdb] ${rj} 页面未解析出内容（${html.length} 字节），可能被风控或站点改版`)
      return null
    }
    const cover_url = realSrc
      ? absolutizeHvdbUrl(realSrc, base)
      : `${base}/WorkImages/${String(rj).toUpperCase()}.webp`

    if (!title && !circle && !tags.length && !actors.length) return null
    return { title, circle, cover_url, tags, actors }
  } catch {
    return null
  }
}
