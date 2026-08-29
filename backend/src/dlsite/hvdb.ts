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
    // 封面：HVDB 页面没有 og:image，封面是 <img src="/WorkImages/RJxxxxxx.jpg">（文件名用完整 RJ 号）
    const cover_url =
      absolutizeHvdbUrl($('img[src*="WorkImages"]').first().attr('src') || '', base) ||
      absolutizeHvdbUrl($('meta[property="og:image"]').first().attr('content') || '', base) ||
      `${base}/WorkImages/${String(rj).toUpperCase()}.jpg`
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

    if (!title && !circle && !cover_url && !tags.length && !actors.length) return null
    return { title, circle, cover_url, tags, actors }
  } catch {
    return null
  }
}
