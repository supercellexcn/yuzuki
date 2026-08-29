import * as cheerio from 'cheerio'
import { getSettings } from '../settings.js'
import { fetchHtml, fetchJson } from './client.js'

/**
 * 作品页 HTML 获取失败（下架/404）时的备用数据源，逻辑参考 VoiceLinks 插件：
 * - api2 `/maniax/api/=/product.json?workno=…`：字段最全（标题/社团/封面/声优/标签/发售日）
 * - api1 `/maniax/product/info/ajax?product_id=…`：作品下架后仍会返回元数据（插件注释原话）
 * - ci-en 社团查询 + 社团 profile 页：补社团名
 * 所有函数内部 try/catch，失败一律返回 null，绝不向上抛。
 */

export interface Api2Creator {
  name: string
}

export interface Api2Genre {
  name: string
}

export interface Api2Data {
  work_name?: string
  maker_name?: string
  maker_id?: number | string
  regist_date?: string
  image_main?: { url?: string }
  work_image?: string
  creaters?: {
    voice_by?: Api2Creator[]
    scenario_by?: Api2Creator[]
    illust_by?: Api2Creator[]
    music_by?: Api2Creator[]
  }
  genres?: Api2Genre[]
  is_sale?: boolean
}

export interface Api1Data {
  work_name?: string
  maker_id?: number | string
  regist_date?: string
  work_image?: string
  dl_count?: string | number
  is_sale?: boolean
}

function getDlsiteBase(): string {
  return (getSettings().dlsite_base || 'https://www.dlsite.com').replace(/\/+$/, '')
}

/** 惰性调用时用：任意异常/空对象都返回 null。 */
export async function fetchApi2(rj: string): Promise<Api2Data | null> {
  try {
    const base = getDlsiteBase()
    const data = await fetchJson<Api2Data | Api2Data[]>(`${base}/maniax/api/=/product.json?workno=${rj}`)
    const item = Array.isArray(data) ? data[0] : data
    if (!item || typeof item !== 'object' || Object.keys(item).length === 0) return null
    return item
  } catch {
    return null
  }
}

/** 惰性调用时用：下架作品也能返回元数据。 */
export async function fetchApi1(rj: string): Promise<Api1Data | null> {
  try {
    const base = getDlsiteBase()
    const data = await fetchJson<Record<string, Api1Data>>(
      `${base}/maniax/product/info/ajax?product_id=${rj}&cdn_cache_min=1`
    )
    const item = data?.[rj]
    if (!item || typeof item !== 'object' || Object.keys(item).length === 0) return null
    return item
  } catch {
    return null
  }
}

/** 通过 maker_id 查社团名：先 ci-en lookup，再兜底社团 profile 页。 */
export async function fetchCircleName(makerId: number | string | undefined): Promise<string | null> {
  if (makerId == null || makerId === '') return null
  try {
    const data = await fetchJson<Array<{ name?: string }>>(
      `https://media.ci-en.jp/dlsite/lookup/${makerId}.json`,
      { referer: 'https://www.dlsite.com/' }
    )
    const name = Array.isArray(data) ? data[0]?.name : undefined
    if (name) return String(name).trim()
  } catch {
    /* 落到 HTML 兜底 */
  }
  try {
    const base = getDlsiteBase()
    const html = await fetchHtml(`${base}/maniax/circle/profile/=/maker_id/${makerId}.html`, {
      retryOn404: false,
    })
    const $ = cheerio.load(html)
    const name = $('strong.prof_maker_name').first().text().trim()
    if (name) return name
  } catch {
    /* ignore */
  }
  return null
}

/** 封面 URL 绝对化：`//` 前缀补 https:，过滤 DLsite 的"无图"占位图。 */
export function absolutizeCover(url: string): string {
  if (!url) return ''
  let u = url
  if (u.startsWith('//')) u = 'https:' + u
  if (u.includes('no_img_main.gif')) return ''
  return u
}

/** 发售日统一为 YYYY-MM-DD，保证 works 表的 release 排序正确。 */
export function normalizeReleaseDate(raw: string): string {
  if (!raw) return ''
  const s = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/(\d{4})\D*(\d{1,2})\D*(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return s
}

/** 标题/社团/封面三项是否齐全（用于判断核心信息是否够用）。 */
export function isCoreComplete(meta: { title?: string; circle?: string; cover_url?: string }): boolean {
  return Boolean(meta.title && meta.circle && meta.cover_url)
}
