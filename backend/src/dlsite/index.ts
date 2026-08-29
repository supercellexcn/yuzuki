import { getSettings } from '../settings.js'
import { fetchHtml, fetchJson } from './client.js'
import { parseWorkPage } from './parser.js'
import { fetchApi1, fetchApi2, fetchCircleName, absolutizeCover, normalizeReleaseDate } from './fallback.js'
import type { Api1Data, Api2Data } from './fallback.js'
import { fetchHvdbMeta } from './hvdb.js'
import type { DlsiteMeta } from './types.js'

interface DlsiteAjaxItem {
  dl_count?: string | number
  rate_average_2dp?: number
  rate_count?: number
  price?: number
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
 * 抓取并解析某个 RJ 作品的完整元数据。
 *
 * 主源是 DLsite 作品页 HTML（带 locale cookie，返回指定语言）；作品下架/页面 404 时，
 * 依次兜底：announce 预告页 → JSON api2（product.json，字段最全）→ JSON api1
 * （info/ajax，下架后仍返回元数据，插件已验证）→ ci-en/社团 profile 页补社团名。
 * 销量来自 DLsite 内部 JSON 接口（尽力而为，失败不影响主体）。
 *
 * 只有所有来源都拿不到任何有效信息时才抛错，调用方据此决定保留旧数据。
 */
export async function fetchWorkMeta(rj_code: string): Promise<Partial<DlsiteMeta>> {
  const settings = getSettings()
  const base = (settings.dlsite_base || 'https://www.dlsite.com').replace(/\/+$/, '')
  const path = settings.dlsite_path || '/maniax/work/=/product_id/{rj}.html'
  const url = base + path.replace('{rj}', rj_code)

  // 作品页与销量 JSON 相互独立，并行发出省一次往返；JSON 失败不影响主体（提前 catch 防未处理拒绝）
  const jsonPromise = fetchJson<Record<string, DlsiteAjaxItem>>(
    `${base}/maniax-touch/product/info/ajax?product_id=${rj_code}`
  ).catch((e) => {
    console.warn(`[dlsite] ${rj_code} dynamic meta failed: ${(e as Error).message}`)
    return null
  })

  // 1) HTML 主源：作品页 → 失败则试 announce 预告页（结构与作品页同构，复用同一解析器）
  const meta: Partial<DlsiteMeta> = { rj_code, actors: [], tags: [] }
  let coverFromHtml = false
  try {
    const html = await fetchHtml(url, { retryOn404: false })
    Object.assign(meta, parseWorkPage(html, rj_code))
  } catch {
    try {
      const html = await fetchHtml(`${base}/maniax/announce/=/product_id/${rj_code}.html`, { retryOn404: false })
      Object.assign(meta, parseWorkPage(html, rj_code))
    } catch {
      /* 预告页也没有 */
    }
  }
  if (meta.cover_url) {
    meta.cover_url = absolutize(meta.cover_url, base)
    coverFromHtml = true
  }

  // 2) 只对缺失字段做惰性兜底，避免对在售作品产生额外请求
  const need = (v: unknown): boolean => !v || (Array.isArray(v) && v.length === 0)
  const needTitle = need(meta.title)
  const needCircle = need(meta.circle)
  const needCover = need(meta.cover_url)
  const needActors = need(meta.actors)
  const needTags = need(meta.tags)
  const needRelease = need(meta.release_date)

  let api2: Api2Data | null = null
  let api1: Api1Data | null = null

  if (needTitle || needCircle || needCover || needActors || needTags || needRelease) {
    api2 = await fetchApi2(rj_code)
    if (api2) {
      if (needTitle && api2.work_name) meta.title = api2.work_name.trim()
      if (needCircle && api2.maker_name) meta.circle = api2.maker_name.trim()
      if (needCover && (api2.image_main?.url || api2.work_image)) {
        meta.cover_url = absolutizeCover(api2.image_main?.url || api2.work_image || '')
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
    }
  }

  // 3) 仍缺 cover/circle 时才请求 api1（下架作品的核心兜底源；顺带补 title/release/sales）
  if (!meta.cover_url || !meta.circle) {
    api1 = await fetchApi1(rj_code)
    if (api1) {
      if (!meta.title && api1.work_name) meta.title = api1.work_name.trim()
      if (!meta.cover_url && api1.work_image) meta.cover_url = absolutizeCover(api1.work_image)
      if (!meta.release_date && api1.regist_date) meta.release_date = normalizeReleaseDate(api1.regist_date)
    }
  }

  // 4) 社团名兜底：api2.maker_name 拿不到时，用 maker_id 查 ci-en / 社团 profile 页
  if (!meta.circle) {
    const makerId = api2?.maker_id ?? api1?.maker_id
    if (makerId != null && makerId !== '') {
      const name = await fetchCircleName(makerId)
      if (name) meta.circle = name
    }
  }

  // 5) HVDB 兜底：DLsite 各来源仍拿不到核心字段（标题/社团/声优/标签）时，从 HVDB 抓取（参考 kikoeru）
  if (!meta.title || !meta.circle || !meta.actors?.length || !meta.tags?.length) {
    const hvdb = await fetchHvdbMeta(rj_code)
    if (hvdb) {
      if (!meta.title && hvdb.title) meta.title = hvdb.title
      if (!meta.circle && hvdb.circle) meta.circle = hvdb.circle
      // 封面优先级：HTML > HVDB > JSON(api2/api1)。
      // 下架作品的 api2/api1 封面 URL 指向已删除的图片，下载会 404；HVDB 封面更可靠。
      if (hvdb.cover_url && !coverFromHtml) meta.cover_url = hvdb.cover_url
      if (!meta.actors?.length && hvdb.actors.length) meta.actors = hvdb.actors
      if (!meta.tags?.length && hvdb.tags.length) meta.tags = hvdb.tags
    }
  }

  // 6) 销量：触摸版 JSON 优先，拿不到则用 api1.dl_count
  const data = await jsonPromise
  const item = data?.[rj_code]
  if (item?.dl_count != null) {
    meta.sales_count = Number(String(item.dl_count).replace(/,/g, '')) || null
  } else if (api1?.dl_count != null) {
    meta.sales_count = Number(String(api1.dl_count).replace(/,/g, '')) || null
  }

  // 7) 全部来源（DLsite 各接口 + HVDB）都无有效信息才算失败（调用方据此保留旧数据 / 记 error）
  const hasAny =
    Boolean(meta.title || meta.circle || meta.cover_url || meta.release_date) ||
    Boolean(meta.actors?.length || meta.tags?.length)
  if (!hasAny) throw new Error(`无法获取 ${rj_code} 的作品信息`)

  return meta
}
