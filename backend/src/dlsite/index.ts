import { getSettings } from '../settings.js'
import { fetchHtml, fetchJson } from './client.js'
import { parseWorkPage } from './parser.js'
import { fetchApi1, fetchApi2, fetchCircleName, absolutizeCover, normalizeReleaseDate } from './fallback.js'
import type { Api1Data, Api2Data } from './fallback.js'
import { fetchHvdbMeta } from './hvdb.js'
import type { DlsiteFetchStatus, DlsiteMeta } from './types.js'

export interface DlsiteAjaxItem {
  dl_count?: string | number
  rate_average_2dp?: number | string
  rate_count?: number | string
  review_count?: number | string
  price?: number | string
  official_price?: number | string
}

/** 数字字段解析：空串 / undefined / NaN 一律视为「没抓到」（null），0 保留为有效值。 */
export function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * 合并动态数据（价格 / 评分 / 评论数 / 销量）。
 *
 * 这几项只存在于 DLsite 的 JSON 接口（作品页 HTML 里没有结构化标记，且价格随 locale
 * 变成 RMB / USD），所以 touch 与 api1 两个接口都当数据源；已有值不被覆盖，
 * 缺的才补 —— 任一接口失败时另一个还能兜住。
 */
export function applyDynamic(meta: Partial<DlsiteMeta>, item: DlsiteAjaxItem | null | undefined): void {
  if (!item) return
  // 价格取原价（official_price），没有才用当前售价；两者都是日元整数
  if (meta.price == null) meta.price = toNumber(item.official_price) ?? toNumber(item.price)
  if (meta.rating == null) meta.rating = toNumber(item.rate_average_2dp)
  // rate_count = 评分人数；review_count = 文字评论数，作为兜底
  if (meta.rating_count == null) meta.rating_count = toNumber(item.rate_count) ?? toNumber(item.review_count)
  if (meta.sales_count == null) meta.sales_count = toNumber(item.dl_count)
}

function absolutize(url: string, base: string): string {
  let u = url
  if (u.startsWith('//')) u = 'https:' + u
  if (!/^https?:\/\//i.test(u)) {
    try {
      u = new URL(u, base).toString()
    } catch {
      u = ''
    }
  }
  return u
}

/**
 * 地区禁售页特征：DLsite 对「当前出口所在国家/区域不卖这个作品」返回的是 **HTTP 200**，
 * 页面保留了 og:title / og:image（含作品标题与社团），但整块信息区（价格、发售日、
 * 类型、声优）不渲染，正文只有一句提示。各地区语言的文案不同，这里一并匹配。
 *
 * 与「作品不存在/已下架」区分：后者返回 HTTP 404（`エラー: この作品は現在販売されていません`）。
 */
const REGION_BLOCKED_HINTS =
  /无法购买此作品|無法購買此作品|お住まいの地域|cannot be purchased|not available in your (?:country|region)|not for sale in your/i

/** 正常作品页一定有信息区：新布局 dt.c-productInfo__key，旧布局 #work_outline 表格。 */
export function hasInfoSection(html: string): boolean {
  return html.includes('c-productInfo__key') || html.includes('work_outline')
}

/** 判断是否为地区禁售页：没有信息区 + 命中当地语言的禁售提示。 */
export function isRegionBlockedPage(html: string): boolean {
  if (hasInfoSection(html)) return false
  return REGION_BLOCKED_HINTS.test(html)
}

/** 页面 404 = 作品不存在 / 已下架；其余异常（超时、502…）都当作临时性失败。 */
function isNotFoundError(e: unknown): boolean {
  return (e as { response?: { status?: number } })?.response?.status === 404
}

/** 封面地址来自哪个站点，用于让 DLsite 的正式封面覆盖早前兜底写入的 HVDB 封面。 */
export function coverSourceOf(url: string): 'dlsite' | 'hvdb' | '' {
  try {
    const host = new URL(url.startsWith('//') ? `https:${url}` : url).hostname
    if (/(^|\.)dlsite\.(com|jp)$/i.test(host)) return 'dlsite'
    if (/(^|\.)hvdb\.me$/i.test(host)) return 'hvdb'
  } catch {
    /* 非法 URL 当作未知来源 */
  }
  return ''
}

/**
 * 抓取并解析某个 RJ 作品的完整元数据。
 *
 * 主源是 DLsite 作品页 HTML（带 locale cookie，返回指定语言）；作品下架/页面 404 时，
 * 依次兜底：announce 预告页 → JSON api2（product.json，字段最全）→ JSON api1
 * （info/ajax，下架后仍返回元数据，插件已验证）→ ci-en/社团 profile 页补社团名。
 * 销量来自 DLsite 内部 JSON 接口（尽力而为，失败不影响主体）。
 *
 * 返回的 `fetch_status` 记录 DLsite 这次的返回状态，调用方写入作品表：
 * - region_blocked 时**直接返回，不走任何兜底** —— 兜底源（HVDB）会把标题/社团/标签
 *   凑成「看起来完整」，导致换到可用线路后不再重抓，反过来污染库里的数据。
 * - not_found / error 才继续兜底，此时库里的数据是 DLsite 确实没有时的补充。
 *
 * 只有所有来源都拿不到任何有效信息时才抛错，调用方据此决定保留旧数据。
 */
export async function fetchWorkMeta(rj_code: string): Promise<Partial<DlsiteMeta>> {
  const settings = getSettings()
  const base = (settings.dlsite_base || 'https://www.dlsite.com').replace(/\/+$/, '')
  const path = settings.dlsite_path || '/maniax/work/=/product_id/{rj}.html'
  const url = base + path.replace('{rj}', rj_code)

  // 作品页与动态数据相互独立，并行发出省一次往返；JSON 失败不影响主体（提前 catch 防未处理拒绝）
  const jsonPromise = fetchJson<Record<string, DlsiteAjaxItem>>(
    `${base}/maniax-touch/product/info/ajax?product_id=${rj_code}`
  ).catch((e) => {
    console.warn(`[dlsite] ${rj_code} dynamic meta failed: ${(e as Error).message}`)
    return null
  })

  // 1) HTML 主源：作品页 → 404/异常时试 announce 预告页（结构与作品页同构，复用同一解析器）
  const meta: Partial<DlsiteMeta> = {
    rj_code,
    actors: [],
    tags: [],
    translations: [],
    age_rating: '',
    price: null,
    rating: null,
    rating_count: null,
    fetch_status: 'unknown',
  }
  let pageHtml = ''
  try {
    pageHtml = await fetchHtml(url, { retryOn404: false })
    meta.fetch_status = 'ok'
  } catch (e) {
    meta.fetch_status = isNotFoundError(e) ? 'not_found' : 'error'
    try {
      pageHtml = await fetchHtml(`${base}/maniax/announce/=/product_id/${rj_code}.html`, { retryOn404: false })
    } catch {
      /* 预告页也没有：状态保持 not_found / error */
    }
  }
  if (pageHtml) {
    Object.assign(meta, parseWorkPage(pageHtml, rj_code))
    if (meta.cover_url) {
      meta.cover_url = absolutize(meta.cover_url, base)
      // DLsite 的「无图」占位图不算有效封面，置空让 api2/api1/HVDB 兜底
      if (meta.cover_url.includes('no_img_main.gif')) meta.cover_url = ''
    }
    if (meta.cover_url) meta.cover_source = coverSourceOf(meta.cover_url)

    // 地区禁售：DLsite 明确说「当前区域无法购买」→ 立刻返回，一个兜底源都不调。
    // 页面里已有的 title / circle（og:title）保留，让列表里还能认出是哪部作品；
    // 下次换到可用线路扫描时，fetch_status 会触发无条件重抓。
    if (isRegionBlockedPage(pageHtml)) {
      meta.fetch_status = 'region_blocked'
      meta.actors = []
      meta.tags = []
      return meta
    }
    // 200 但既没有信息区、也没命中禁售文案：风控 / 维护 / 改版页，不算「DL 正常返回」。
    // 标成 error 让它在下次扫描时继续重抓，而不是带着兜底数据被当成完整作品。
    if (!hasInfoSection(pageHtml)) meta.fetch_status = 'error'
  }

  // 2) 动态数据：touch JSON 与作品页并行发出，HTML 解析完就取回来。
  //    作品页被地区限制拦截时这一步仍可能拿到，属于「能拿一点是一点」。
  const dynamic = await jsonPromise
  applyDynamic(meta, dynamic?.[rj_code])

  // 3) 只对缺失字段做惰性兜底，避免对在售作品产生额外请求
  const need = (v: unknown): boolean => !v || (Array.isArray(v) && v.length === 0)
  const needTitle = need(meta.title)
  const needCircle = need(meta.circle)
  const needCover = need(meta.cover_url)
  const needActors = need(meta.actors)
  const needTags = need(meta.tags)
  const needRelease = need(meta.release_date)
  // 动态数据缺失（接口被拦 / 返回不完整）也算「需要兜底」
  const needDynamic = meta.price == null || meta.rating == null || meta.rating_count == null

  let api2: Api2Data | null = null
  let api1: Api1Data | null = null

  if (needTitle || needCircle || needCover || needActors || needTags || needRelease) {
    api2 = await fetchApi2(rj_code)
    if (api2) {
      if (needTitle && api2.work_name) meta.title = api2.work_name.trim()
      if (needCircle && api2.maker_name) meta.circle = api2.maker_name.trim()
      if (needCover && (api2.image_main?.url || api2.work_image)) {
        meta.cover_url = absolutizeCover(api2.image_main?.url || api2.work_image || '')
        meta.cover_source = coverSourceOf(meta.cover_url)
      }
      if (needRelease && api2.regist_date) meta.release_date = normalizeReleaseDate(api2.regist_date)
      if (needActors && api2.creaters?.voice_by?.length) {
        meta.actors = api2.creaters.voice_by.map((v) => v.name.trim()).filter(Boolean)
      }
      if (needTags && api2.genres?.length) {
        meta.tags = api2.genres
          .map((g) => ({ name: g.name.trim(), category: 'ジャンル' }))
          .filter((t) => t.name)
      }
      // 年龄分级兜底：只在 api2 返回可读字符串（all / r18）时才用。
      // 线上实际返回的是数字编码（如 3 = R18），含义未文档化 —— 宁可留空不打标，
      // 也不能把 R18 作品误标成「全年龄」。
      const ageRaw = String(api2.age_category ?? '')
        .trim()
        .toLowerCase()
      if (!meta.age_rating && ageRaw) {
        if (ageRaw.includes('r18') || ageRaw.includes('adult')) meta.age_rating = 'R18'
        else if (ageRaw === 'all' || ageRaw.includes('全年齢') || ageRaw.includes('all_age')) meta.age_rating = '全年齢'
      }
    }
  }

  // 4) api1：缺 cover/circle 时是下架作品的核心兜底源；动态数据没拿全时也用它再要一次
  //    （api1 与 touch 返回同一套字段，任一接口被拦时另一个还能补上价格 / 评分 / 评论数）
  if (!meta.cover_url || !meta.circle || needDynamic) {
    api1 = await fetchApi1(rj_code)
    if (api1) {
      if (!meta.title && api1.work_name) meta.title = api1.work_name.trim()
      if (!meta.cover_url && api1.work_image) {
        meta.cover_url = absolutizeCover(api1.work_image)
        meta.cover_source = coverSourceOf(meta.cover_url)
      }
      if (!meta.release_date && api1.regist_date) meta.release_date = normalizeReleaseDate(api1.regist_date)
      applyDynamic(meta, api1)
    }
  }

  // 5) 社团名兜底：api2.maker_name 拿不到时，用 maker_id 查 ci-en / 社团 profile 页
  if (!meta.circle) {
    const makerId = api2?.maker_id ?? api1?.maker_id
    if (makerId != null && makerId !== '') {
      const name = await fetchCircleName(makerId)
      if (name) meta.circle = name
    }
  }

  // 6) HVDB 兜底：DLsite 各来源仍拿不到核心字段（标题/社团/声优/标签）时，从 HVDB 抓取（参考 kikoeru）
  if (!meta.title || !meta.circle || !meta.actors?.length || !meta.tags?.length) {
    const hvdb = await fetchHvdbMeta(rj_code)
    if (hvdb) {
      if (!meta.title && hvdb.title) meta.title = hvdb.title
      if (!meta.circle && hvdb.circle) meta.circle = hvdb.circle
      // 封面优先级：DLsite(HTML/JSON) 有封面就用 DLsite 的，只有 DLsite 完全没有时才用 HVDB。
      if (hvdb.cover_url && !meta.cover_url) {
        meta.cover_url = hvdb.cover_url
        meta.cover_source = coverSourceOf(hvdb.cover_url)
      }
      if (!meta.actors?.length && hvdb.actors.length) meta.actors = hvdb.actors
      if (!meta.tags?.length && hvdb.tags.length) meta.tags = hvdb.tags
    }
  }

  // 两个 JSON 接口都没给价格 / 评分：多半是这次请求被限制了（地区 / 风控），留日志便于排查
  if (meta.price == null && meta.rating == null) {
    console.warn(`[dlsite] ${rj_code} 价格与评分均未取到（动态接口可能被限制）`)
  }

  // 7) 全部来源（DLsite 各接口 + HVDB）都无有效信息才算失败（调用方据此保留旧数据 / 记 error）
  const hasAny =
    Boolean(meta.title || meta.circle || meta.cover_url || meta.release_date) ||
    Boolean(meta.actors?.length || meta.tags?.length)
  if (!hasAny) throw new Error(`无法获取 ${rj_code} 的作品信息`)

  return meta
}
