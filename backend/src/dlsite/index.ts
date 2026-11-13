import { getSettings } from '../settings.js'
import { fetchHtml, fetchJson } from './client.js'
import { parseWorkPage } from './parser.js'
import { fetchApi1, fetchApi2, fetchCircleName, absolutizeCover, normalizeReleaseDate } from './fallback.js'
import type { Api1Data, Api2Data, Api2Creator, Api2Edition } from './fallback.js'
import { fetchHvdbMeta } from './hvdb.js'
import { getCachedEntry } from './dynamicCache.js'
import type { DlsiteFetchStatus, DlsiteMeta, DlsiteTranslation } from './types.js'

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

/** HVDB 的两档兜底计划。 */
export interface FallbackPlan {
  /** 补全元数据（标题 / 社团 / 声优 / 标签）—— 只在 DLsite 明确没有这部作品时允许 */
  meta: boolean
  /** 只补封面 —— DLsite 正常返回但没给封面时也允许（封面不参与「污染」判定，且有 cover_source 标记） */
  cover: boolean
}

/**
 * 兜底站点（HVDB）的启用条件。
 *
 * - **元数据**：只有 DLsite 明确 404（作品不存在 / 已下架）且字段不全时才补。
 *   禁售（region_blocked）已早退；网络异常 / 风控页（error / unknown）一律不碰 ——
 *   否则一次临时故障就会把兜底数据写进库，这正是要避免的污染。
 * - **封面**：`ok` 或 `not_found` 且没有任何可用封面时允许补一次。
 *   DLsite 官方原图已在前面尝试过（api2 / 作品页 og:image / api1），走到这里说明它没给，
 *   此时 HVDB 的图是唯一来源。`cover_source` 会标成 `hvdb`，日后 DLsite 给出真封面会自动覆盖。
 */
export function fallbackPlan(status: string | undefined, meta: Partial<DlsiteMeta>): FallbackPlan {
  const s = String(status || '')
  if (s !== 'ok' && s !== 'not_found') return { meta: false, cover: false }
  const missingMeta = !meta.title || !meta.circle || !meta.actors?.length || !meta.tags?.length
  return {
    meta: s === 'not_found' && missingMeta,
    cover: !meta.cover_url,
  }
}

/** api2 的 `language_editions.lang` → 项目内部的语言码与展示名。 */
const EDITION_LANGS: Record<string, { code: string; label: string }> = {
  JPN: { code: 'ja', label: '日本語' },
  ENG: { code: 'en', label: 'English' },
  CHI_HANS: { code: 'zh-Hans', label: '简体中文' },
  CHI_HANT: { code: 'zh-Hant', label: '繁體中文' },
  KO_KR: { code: 'ko', label: '한국어' },
  SPA: { code: 'es', label: 'Español' },
  FRE: { code: 'fr', label: 'Français' },
  GER: { code: 'de', label: 'Deutsch' },
  ITA: { code: 'it', label: 'Italiano' },
  POR: { code: 'pt', label: 'Português' },
  SWE: { code: 'sv', label: 'Svenska' },
  THA: { code: 'th', label: 'ไทย' },
  VIE: { code: 'vi', label: 'Tiếng Việt' },
  IND: { code: 'id', label: 'Indonesia' },
}

/**
 * api2 的 `creaters` 有两种真实形态：`{ voice_by: [...] }` 对象与 `[...]` 数组。
 *
 * 数组形态下元素带 `type`（voice_by / illust_by …）时只取声优；整组都没有 type 信息
 * （接口改版）时整体采信 —— 宁可多抓也不能一个声优都拿不到。
 */
export function api2Actors(creaters: Api2Data['creaters']): string[] {
  if (!creaters) return []
  const names = (list: unknown): string[] =>
    Array.isArray(list)
      ? list.map((c) => String((c as Api2Creator | undefined)?.name ?? '').trim()).filter(Boolean)
      : []
  if (!Array.isArray(creaters)) return names(creaters.voice_by)
  const hasType = creaters.some((c) => Boolean(c?.type || c?.type_string))
  if (!hasType) return names(creaters)
  const voice = creaters.filter((c) => {
    const t = `${c?.type ?? ''} ${c?.type_string ?? ''}`.toLowerCase()
    return t.includes('voice') || t.includes('声優') || t.includes('声优')
  })
  return names(voice)
}

/**
 * api2 的可读年龄分级 → 项目内部的「年龄指定」文案。
 * 只认已知值，未知值一律留空（留空 = 保持原状，不会把 R18 误标成「全年龄」）。
 */
export function api2AgeRating(raw: string | undefined): string {
  const v = (raw || '').trim().toLowerCase()
  if (!v) return ''
  if (v === 'general' || v === 'all' || v === 'all_ages') return '全年齢'
  if (v === 'adult' || v === 'r18' || v === 'r-18') return 'R18'
  if (v === 'r15') return 'R15'
  return ''
}

/** 评分人数：把 api2 的评分分布各档求和（与 api1 的 rate_count 完全一致）。 */
export function api2RatingCount(detail: Api2Data['rate_count_detail']): number | null {
  if (!detail) return null
  const nums = Array.isArray(detail)
    ? detail.map((d) => toNumber(d?.count))
    : Object.values(detail).map((v) => toNumber(v))
  const valid = nums.filter((n): n is number => n != null && n >= 0)
  if (!valid.length) return null
  return valid.reduce((a, b) => a + b, 0)
}

/** api2 的其它语言版本 → 项目内的翻译列表（跳过自身与非法 RJ 号）。 */
export function api2Translations(list: unknown, selfRj: string): DlsiteTranslation[] {
  const out: DlsiteTranslation[] = []
  const self = selfRj.toUpperCase()
  const seen = new Set<string>()
  // 防御：线上出现过 `language_editions` 不是数组的形态（对象 / null），
  // 直接 for...of 会抛 "(list || []) is not iterable"，一部作品就整轮抓取失败。
  if (!Array.isArray(list)) return out
  for (const raw of list) {
    const e = (raw || {}) as Api2Edition
    const rj = String(e.workno || '').trim().toUpperCase()
    if (!/^RJ\d{6,10}$/.test(rj) || rj === self || seen.has(rj)) continue
    const key = String(e.lang || '').trim().toUpperCase()
    const lang = EDITION_LANGS[key] || { code: key.toLowerCase(), label: String(e.label || key) }
    seen.add(rj)
    out.push({ rj_code: rj, language: lang.code, language_label: lang.label })
  }
  return out
}

/**
 * 把 api2 的字段映射进 meta（只写有值的项）。
 *
 * api2 是结构化直出，比作品页解析更可靠：社团、类型标签、翻译版本、年龄分级都直接给，
 * 价格是日元原价（不受 locale 影响）。评分只有 0.1 精度，所以这里不写 rating，
 * 留空让 api1 的 `rate_average_2dp` 填 —— 绝不把四舍五入值写进库。
 */
export function applyApi2(meta: Partial<DlsiteMeta>, api2: Api2Data, base: string): void {
  if (api2.work_name) meta.title = api2.work_name.trim()
  if (api2.maker_name) meta.circle = api2.maker_name.trim()
  const cover = api2.image_main?.url || api2.work_image || ''
  if (cover && !meta.cover_url) {
    const abs = absolutizeCover(cover)
    meta.cover_url = abs ? absolutize(abs, base) : ''
    if (meta.cover_url) meta.cover_source = coverSourceOf(meta.cover_url)
  }
  if (api2.regist_date) meta.release_date = normalizeReleaseDate(api2.regist_date)
  if (!meta.series) meta.series = (api2.title_name || api2.series_name || '').trim()
  const actors = api2Actors(api2.creaters)
  if (!meta.actors?.length && actors.length) meta.actors = actors
  // creaters 字段存在即说明接口明确回答过「有哪些声优」：此时为空 = 该作品确实没有声优
  // （CG 集 / 漫画等）。这决定后续扫描是否还要为「声优为空」重抓。
  if (api2.creaters !== undefined) meta.actors_confirmed = true
  // 防御非数组形态（接口偶发返回对象），否则 .length / .map 会抛错
  const genres = Array.isArray(api2.genres) && api2.genres.length
    ? api2.genres
    : Array.isArray(api2.genres_replaced)
      ? api2.genres_replaced
      : []
  if (!meta.tags?.length && genres.length) {
    meta.tags = genres
      .map((g) => ({ name: (g.name || '').trim(), category: 'ジャンル' }))
      .filter((t) => t.name)
  }
  // 注意：**只有真的拿到标签**才算确认。api2 返回空数组时不能直接下结论 ——
  // 有些作品的分类只在作品页「分類」区（api2 为空），要抓一次 HTML 核实后才置
  // tags_confirmed（见 shouldFetchPage / fetchWorkMeta 的 verifyTags）。
  if (meta.tags?.length) meta.tags_confirmed = true
  if (!meta.age_rating) meta.age_rating = api2AgeRating(api2.age_category_string)
  const trans = api2Translations(api2.language_editions, meta.rj_code || '')
  if (!meta.translations?.length && trans.length) meta.translations = trans
  if (meta.price == null) meta.price = toNumber(api2.official_price) ?? toNumber(api2.price)
  if (meta.rating_count == null) meta.rating_count = api2RatingCount(api2.rate_count_detail)
}

/** 抓取时的额外校验开关。 */
export interface FetchOptions {
  /**
   * 标签尚未确认（works.tags_confirmed = 0）：api2 标签为空时，再抓一次作品页，
   * 看「分類」区到底有没有分类。作品页也确认没有，才把 tags_confirmed 置 1。
   */
  verifyTags?: boolean
  /**
   * 库里还没有封面文件：api2 没给封面时抓一次作品页拿 `og:image`。
   * DLsite 原图优先，作品页也拿不到才走 HVDB 兜底。
   */
  verifyCover?: boolean
}

/**
 * 是否还需要抓作品页。
 *
 * 除了「api2 没命中」这个必然情况，还有三种要抓：
 * 1. 声优为空，且接口连 `creaters` 字段都没给（给了空数组就说明确实没有声优）；
 * 2. 标签为空 —— **接口给的是空数组也不能直接当作「没有分类」**：有些作品的分类
 *    只出现在作品页的「分類」区（api2 为空）。传 `verifyTags` 时强制抓一次核实，
 *    抓完以页面结果为准，之后不再重复；
 * 3. 没有封面 —— 作品页的 `og:image` 是 DLsite 官方原图，比兜底站点更准（`verifyCover`）。
 */
export function shouldFetchPage(
  api2: Api2Data | null,
  meta: Partial<DlsiteMeta>,
  opts: FetchOptions = {}
): boolean {
  const creatorKnown = api2?.creaters !== undefined
  const genresKnown = api2?.genres !== undefined || api2?.genres_replaced !== undefined
  const wantActors = !meta.actors?.length && !creatorKnown
  const wantTags = !meta.tags?.length && (opts.verifyTags || !genresKnown)
  const wantCover = !meta.cover_url && opts.verifyCover === true
  return wantActors || wantTags || wantCover
}

/** 作品页解析结果只补空缺：JSON 已经拿到的字段以 JSON 为准（结构更可靠）。 */function mergeParsed(meta: Partial<DlsiteMeta>, parsed: Partial<DlsiteMeta>, base: string): void {
  if (!meta.title && parsed.title) meta.title = parsed.title
  if (!meta.circle && parsed.circle) meta.circle = parsed.circle
  if (!meta.release_date && parsed.release_date) meta.release_date = parsed.release_date
  if (!meta.series && parsed.series) meta.series = parsed.series
  if (!meta.age_rating && parsed.age_rating) meta.age_rating = parsed.age_rating
  if (!meta.actors?.length && parsed.actors?.length) meta.actors = parsed.actors
  if (!meta.tags?.length && parsed.tags?.length) meta.tags = parsed.tags
  if (!meta.translations?.length && parsed.translations?.length) meta.translations = parsed.translations
  if (!meta.cover_url && parsed.cover_url) {
    const abs = absolutize(parsed.cover_url, base)
    // DLsite 的「无图」占位图不算有效封面
    meta.cover_url = abs.includes('no_img_main.gif') ? '' : abs
    if (meta.cover_url) meta.cover_source = coverSourceOf(meta.cover_url)
  }
}

/**
 * 抓取并解析某个 RJ 作品的完整元数据。
 *
 * 数据源顺序（2026-11 起）：
 * 1. **api2 `product.json` + touch JSON 并行**。api2 直出社团、类型标签、翻译版本、
 *    年龄分级、系列、发售日、封面、日元原价，一条请求就能凑齐静态字段；touch 给
 *    销量 / 精确评分 / 评论数。api2 本身也受地区限制，所以「api2 拿到作品」等价于
 *    「当前线路可以正常访问」—— 此时**不再抓作品页**（730KB HTML），状态记 ok。
 * 2. api2 没有 → 抓作品页 HTML 判定状态（这是唯一能区分「禁售」与「下架」的手段）：
 *    - 200 且信息区在 → ok，解析结果只补空缺；
 *    - 200 限制页（无信息区 + 命中禁售文案）→ region_blocked，**立即返回，不调任何兜底**；
 *    - 404 → not_found，才允许 api1（下架后仍返回元数据）与 HVDB 兜底；
 *    - 其它（网络 / 风控 / 改版页）→ error，不碰 HVDB，下次扫描继续重抓。
 *
 * 返回的 `fetch_status` 由调用方写入作品表，决定下次扫描是否重抓。
 * 只有所有来源都拿不到任何有效信息时才抛错，调用方据此保留旧数据。
 */
export async function fetchWorkMeta(rj_code: string, opts: FetchOptions = {}): Promise<Partial<DlsiteMeta>> {
  const settings = getSettings()
  const base = (settings.dlsite_base || 'https://www.dlsite.com').replace(/\/+$/, '')
  const path = settings.dlsite_path || '/maniax/work/=/product_id/{rj}.html'
  const url = base + path.replace('{rj}', rj_code)

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

  // 1) api2 与动态数据并行发出，省一次往返；touch 失败不影响主体。
  //    动态数据若已被批量预取进缓存（扫描 / 全库刷新开始前按 50 个一批拉过），
  //    直接用缓存，不再单独请求 —— 这是把 N 次请求压成 N/50 的关键。
  const cachedDynamic = getCachedEntry(rj_code)
  const touchPromise: Promise<DlsiteAjaxItem | null> = cachedDynamic
    ? Promise.resolve(cachedDynamic as DlsiteAjaxItem)
    : fetchJson<Record<string, DlsiteAjaxItem>>(
        `${base}/maniax-touch/product/info/ajax?product_id=${rj_code}`
      )
        .then((data) => data?.[rj_code] ?? null)
        .catch((e) => {
          console.warn(`[dlsite] ${rj_code} dynamic meta failed: ${(e as Error).message}`)
          return null
        })
  const [api2, touch] = await Promise.all([fetchApi2(rj_code), touchPromise])

  const api2Ok = Boolean(api2 && (api2.work_name || api2.workno))
  // 动态数据（实时销量 / 精确评分）优先写入，api2 只补静态字段里还空着的项
  applyDynamic(meta, touch)
  if (api2 && api2Ok) applyApi2(meta, api2, base)

  // 2) api2 命中：静态字段已齐，唯一还要抓作品页的原因是「接口形态对不上」——
  //    声优 / 标签拿不到且接口没给对应字段；或者标签为空但库里还没确认过
  //    （verifyTags，见 shouldFetchPage）。抓一次确认后就能定论，不会每轮重复。
  let needHtml = !api2Ok
  if (api2 && api2Ok) needHtml = shouldFetchPage(api2, meta, opts)
  // api2 命中即已确认「当前线路可正常访问」，状态先钉成 ok：
  // 后面补 HTML 只是补字段，成败都不影响这个判断（否则会退化成 unknown → 每次扫描重抓）
  if (api2Ok) meta.fetch_status = 'ok'

  if (needHtml) {
    let pageHtml = ''
    try {
      pageHtml = await fetchHtml(url, { retryOn404: false })
      if (!api2Ok) meta.fetch_status = 'ok'
    } catch (e) {
      if (!api2Ok) meta.fetch_status = isNotFoundError(e) ? 'not_found' : 'error'
      try {
        pageHtml = await fetchHtml(`${base}/maniax/announce/=/product_id/${rj_code}.html`, {
          retryOn404: false,
        })
      } catch {
        /* 预告页也没有：状态保持上面判定的值 */
      }
    }

    if (pageHtml) {
      mergeParsed(meta, parseWorkPage(pageHtml, rj_code), base)

      // 作品页信息区解析成功 → 声优 / 分类字段已有权威答案（页面里没有「分類」行 = 真的没有）。
      // 禁售页没有信息区，不会走到这里，所以不会把「没抓到」误标成「确认没有」。
      if (hasInfoSection(pageHtml)) {
        meta.actors_confirmed = true
        meta.tags_confirmed = true
      }

      // 地区禁售：当前线路所在区域不卖。api2 已经拿到数据说明线路可用，不采信禁售判定。
      if (!api2Ok && isRegionBlockedPage(pageHtml)) {
        meta.fetch_status = 'region_blocked'
        meta.actors = []
        meta.tags = []
        // 禁售页的 og:image 是站点通用宣传图（不是作品封面），一律不采用：
        // 否则会被当成 dlsite 来源的封面存下来，日后 DLsite 给出真封面时不再替换。
        meta.cover_url = ''
        meta.cover_source = ''
        return meta
      }
      // 200 但既没有信息区、也没命中禁售文案：风控 / 维护 / 改版页，不算「DL 正常返回」。
      // 标成 error 让它在下次扫描时继续重抓，而不是带着兜底数据被当成完整作品。
      if (!api2Ok && !hasInfoSection(pageHtml) && meta.fetch_status === 'ok') meta.fetch_status = 'error'
    }
  }
  // 走到这里 needHtml=false 一定意味着 api2Ok（状态已在上面钉成 ok），无需再处理 else

  // 3) 动态数据仍缺（touch 被拦 / 返回不全）时用 api1 再要一次：两者同一套字段，
  //    任一接口被限制时另一个还能补上价格 / 评分 / 评论数。api1 也是下架作品的核心兜底源。
  let makerId = api2?.maker_id
  if (meta.price == null || meta.rating == null || meta.rating_count == null || !meta.circle) {
    const api1 = await fetchApi1(rj_code)
    if (api1) {
      if (!meta.title && api1.work_name) meta.title = api1.work_name.trim()
      if (!meta.cover_url && api1.work_image) {
        meta.cover_url = absolutizeCover(api1.work_image)
        if (meta.cover_url) meta.cover_source = coverSourceOf(meta.cover_url)
      }
      if (!meta.release_date && api1.regist_date) meta.release_date = normalizeReleaseDate(api1.regist_date)
      applyDynamic(meta, api1)
      if (makerId == null || makerId === '') makerId = api1.maker_id
    }
  }

  // 4) 社团名兜底：api2.maker_name 拿不到时，用 maker_id 查 ci-en / 社团 profile 页
  if (!meta.circle && makerId != null && makerId !== '') {
    const name = await fetchCircleName(makerId)
    if (name) meta.circle = name
  }

  // 5) HVDB 兜底，分两档（判定见 fallbackPlan）：
  //    - 元数据：只在 DLsite 明确 404 且字段不全时补；
  //    - 封面：DLsite 正常返回（ok）或下架（not_found）但始终没给封面时补 ——
  //      DLsite 原图（api2 / 作品页 og:image / api1）已经在前面全部尝试过。
  const plan = fallbackPlan(meta.fetch_status, meta)
  if (plan.meta || plan.cover) {
    const hvdb = await fetchHvdbMeta(rj_code)
    if (hvdb) {
      if (plan.meta) {
        if (!meta.title && hvdb.title) meta.title = hvdb.title
        if (!meta.circle && hvdb.circle) meta.circle = hvdb.circle
        if (!meta.actors?.length && hvdb.actors.length) meta.actors = hvdb.actors
        if (!meta.tags?.length && hvdb.tags.length) meta.tags = hvdb.tags
      }
      if (plan.cover && !meta.cover_url && hvdb.cover_url) {
        meta.cover_url = hvdb.cover_url
        meta.cover_source = coverSourceOf(hvdb.cover_url)
      }
    }
  }

  // 两个 JSON 接口都没给价格 / 评分：多半是这次请求被限制了（地区 / 风控），留日志便于排查
  if (meta.price == null && meta.rating == null) {
    console.warn(`[dlsite] ${rj_code} 价格与评分均未取到（动态接口可能被限制）`)
  }

  // 6) 全部来源都无有效信息才算失败（调用方据此保留旧数据）
  const hasAny =
    Boolean(meta.title || meta.circle || meta.cover_url || meta.release_date) ||
    Boolean(meta.actors?.length || meta.tags?.length)
  if (!hasAny) throw new Error(`无法获取 ${rj_code} 的作品信息`)

  return meta
}
