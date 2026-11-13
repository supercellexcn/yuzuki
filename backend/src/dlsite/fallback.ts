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
  name?: string
  /** 创作者角色：DLsite 用 voice_by / illust_by / scenario_by 等 */
  type?: string
  type_string?: string
}

export interface Api2Genre {
  name?: string
  id?: number | string
  search_val?: string
}

/** api2 的 `language_editions`：同一作品的其它语言版本（各自独立 RJ 号） */
export interface Api2Edition {
  workno?: string
  lang?: string
  label?: string
}

/**
 * api2 `/maniax/api/=/product.json` 的真实返回结构（按 2026-11 线上样本核对）。
 *
 * 与早期实现的三处差异，改动前务必注意：
 * 1. `creaters` 是**数组**（`[{ name, type }]`），不是 `{ voice_by: [...] }` 对象；
 * 2. `age_category` 是**数字编码**（3 = 成人向），可读值在 `age_category_string`（adult / general）；
 * 3. 没有 `is_sale`，在售标记是 `on_sale`；`custom_genres` 是优惠券（对象数组），不是类型标签。
 */
export interface Api2Data {
  workno?: string
  product_id?: string
  work_name?: string
  maker_name?: string
  maker_id?: number | string
  regist_date?: string
  /** 系列名（对应 HTML 里的「シリーズ名」） */
  title_name?: string
  series_name?: string
  image_main?: { url?: string }
  work_image?: string
  age_category?: string | number
  /** 可读年龄分级：general（全年龄）/ adult（成人向） */
  age_category_string?: string
  creaters?: Api2Creator[] | { voice_by?: Api2Creator[] }
  genres?: Api2Genre[]
  genres_replaced?: Api2Genre[]
  language_editions?: Api2Edition[]
  official_price?: number | string
  price?: number | string
  on_sale?: number | string | boolean
  /** 作品类型：SOU（音声）/ ICG（CG・イラスト）/ MNG（漫画）… */
  work_type?: string
  /** 星级（0~50，精度 0.1）；两位小数的精确评分只在 api1 的 rate_average_2dp */
  rate_average_star?: number | string
  /** 评分分布，各档求和即为评分人数（等于 api1 的 rate_count） */
  rate_count_detail?: Record<string, number | string> | Array<{ count?: number | string }>
  update_date?: string
}

export interface Api1Data {
  work_name?: string
  maker_id?: number | string
  regist_date?: string
  work_image?: string
  dl_count?: string | number
  /** 价格（日元）；下架作品也能返回 */
  price?: string | number
  /** 原价（日元），与 price 的区别在于不受折扣影响 */
  official_price?: string | number
  /** 平均评分（两位小数）与评分人数 / 文字评论数 */
  rate_average_2dp?: number | string
  rate_count?: number | string
  review_count?: number | string
  is_sale?: boolean
}

function getDlsiteBase(): string {
  return (getSettings().dlsite_base || 'https://www.dlsite.com').replace(/\/+$/, '')
}

/**
 * 惰性调用时用：任意异常/空对象都返回 null。
 *
 * 固定带 `locale=ja-JP`：标题等文案必须与库里已有的日文原名一致，
 * 否则换线路抓一次就变成另一种语言，看起来像两部作品。
 */
export async function fetchApi2(rj: string): Promise<Api2Data | null> {
  try {
    const base = getDlsiteBase()
    const data = await fetchJson<Api2Data | Api2Data[]>(
      `${base}/maniax/api/=/product.json?workno=${encodeURIComponent(rj)}&locale=ja-JP`
    )
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
