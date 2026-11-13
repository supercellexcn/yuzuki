import * as cheerio from 'cheerio'
import { getSettings } from '../settings.js'
import { fetchHtml, fetchJson } from './client.js'
import { cacheBatchEntries, getCachedEntry, type BatchEntry } from './dynamicCache.js'

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

/**
 * api1 `/maniax/product/info/ajax` 的条目。与 touch 动态数据、批量接口返回同一套字段，
 * 因此直接复用缓存模块的条目定义（`BatchEntry` 就是 api1 的字段集合）。
 */
export type Api1Data = BatchEntry

/** 批量接口单次最多查多少个 RJ：50 个约 700 字符，远低于 URL 长度限制。 */
export const BATCH_SIZE = 50

function getDlsiteBase(): string {
  return (getSettings().dlsite_base || 'https://www.dlsite.com').replace(/\/+$/, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
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

/** 把 RJ 列表按批量上限切块。 */
export function splitRjs(rjs: string[], size = BATCH_SIZE): string[][] {
  const out: string[][] = []
  for (let i = 0; i < rjs.length; i += size) out.push(rjs.slice(i, i + size))
  return out
}

/** 批量接口地址：多个 RJ 用逗号分隔后整体编码（与线上验证过的请求完全一致）。 */
export function buildBatchUrl(base: string, rjs: string[]): string {
  return `${base}/maniax/product/info/ajax?product_id=${encodeURIComponent(rjs.join(','))}`
}

/**
 * 批量抓取动态数据并写入缓存。
 *
 * 一次请求最多 50 个 RJ，返回 `{ RJ: {...} }`；不存在的 RJ 直接不出现（不影响其它条目，
 * 线上已验证）。**任何一批失败都不抛错**：跳过这一批，逐部流程会退回单独请求。
 *
 * `onProgress` 每完成一批回调一次（done / total 均以「批」为单位），供扫描进度展示 ——
 * 预取阶段没有单部进度，不显示批进度的话界面上看起来像卡死。
 */
export async function fetchApi1Batch(
  rjs: string[],
  size = BATCH_SIZE,
  onProgress?: (done: number, total: number) => void
): Promise<Record<string, Api1Data>> {
  const out: Record<string, Api1Data> = {}
  const base = getDlsiteBase()
  const chunks = splitRjs(rjs, size)
  let done = 0
  for (const chunk of chunks) {
    try {
      const data = await fetchJson<Record<string, Api1Data>>(buildBatchUrl(base, chunk))
      if (data && typeof data === 'object') {
        for (const [rj, item] of Object.entries(data)) {
          if (item && typeof item === 'object') out[rj.toUpperCase()] = item
        }
      }
    } catch (e) {
      console.warn(
        `[dlsite] 批量接口请求失败（${chunk.length} 个 RJ），这批退回逐个抓取: ${(e as Error).message}`
      )
    }
    done++
    onProgress?.(done, chunks.length)
    // 批次之间稍作间隔，避免连续几十个请求被风控
    await sleep(120)
  }
  cacheBatchEntries(out)
  return out
}

/** 惰性调用时用：下架作品也能返回元数据。批量预取命中时直接返回缓存，不再发请求。 */
export async function fetchApi1(rj: string): Promise<Api1Data | null> {
  const cached = getCachedEntry(rj)
  if (cached) return cached
  try {
    const base = getDlsiteBase()
    const data = await fetchJson<Record<string, Api1Data>>(
      `${base}/maniax/product/info/ajax?product_id=${rj}&cdn_cache_min=1`
    )
    const item = data?.[rj]
    if (!item || typeof item !== 'object' || Object.keys(item).length === 0) return null
    // 顺手入缓存：同一轮扫描里再要这个作品就不必重复请求
    cacheBatchEntries({ [rj]: item })
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
