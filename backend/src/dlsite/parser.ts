import * as cheerio from 'cheerio'
import type { DlsiteMeta, DlsiteTranslation } from './types.js'

/**
 * 解析 DLsite 作品页 HTML（静态部分）。
 *
 * DLsite 有两套信息区布局，都要支持：
 * - 新布局（当前线上，服务端渲染的 Vue 组件）：
 *   `<dt class="c-productInfo__key">字段名</dt><dd class="c-productInfo__value">值</dd>`
 * - 旧布局：`#work_outline` 表格，`<th>字段名</th><td>值</td>`
 *
 * 字段名随 locale 变化，这里同时列出日 / 简中 / 繁中以便兼容。
 */
const LABELS = {
  genre: ['ジャンル', '分类', '分類', '類型', '类型'],
  va: ['声優', '声优', '聲優'],
  release: ['販売日', '贩卖日', '販賣日', '発売日', '发售日'],
  series: ['シリーズ名', '系列名'],
  age: ['年齢指定', '年龄指定', '年齡指定', '年齢区分', '年龄分级'],
  circle: ['サークル名', '社团名', '社團名', 'ブランド名'],
}

/** 翻译版语言识别：DLsite 上的语言名（日 / 简中 / 繁中 / 英 / 韩 / 西）。 */
const LANG_CODES: Array<{ code: string; label: string; keys: string[] }> = [
  { code: 'ja', label: '日本語', keys: ['ja', 'jp', 'japanese', '日本語', '日语', '日語'] },
  { code: 'en', label: 'English', keys: ['en', 'us', 'english', '英語', '英语', '英文'] },
  {
    code: 'zh-Hans',
    label: '简体中文',
    keys: [
      'zh-hans',
      'zh_cn',
      'zh-cn',
      'zhcn',
      'cs',
      'simplified',
      'chinesesimplified',
      '简体中文',
      '簡体字',
      '简体',
      '簡體',
      '简体字',
      '中国語簡体字',
    ],
  },
  {
    code: 'zh-Hant',
    label: '繁體中文',
    keys: [
      'zh-hant',
      'zh_tw',
      'zh-tw',
      'zhtw',
      'tc',
      'traditional',
      'chinesetraditional',
      '繁體中文',
      '繁体中文',
      '繁體',
      '繁体',
      '中国語繁体字',
    ],
  },
  { code: 'ko', label: '한국어', keys: ['ko', 'kr', 'korean', '한국어', '韓国語', '韓語', '韩语'] },
  { code: 'es', label: 'Español', keys: ['es', 'spanish', 'español', 'espanol', 'スペイン語', '西班牙语'] },
]

/**
 * 从语言名文本里识别语言。
 * - 先去掉括号 / 空白 / 结尾的「版 / ver / version / 翻訳」等装饰；
 * - 短 key（≤3 字符，如 en / ja / cs）要求整串相等；
 * - 长 key 允许「前缀 + 最多 3 个字符」的写法（English（US）/ 简体中文版），
 *   这样「【繁體中文版】某作品标题」这类相关作品链接不会被误判成翻译版。
 */
function detectLanguage(raw: string): { code: string; label: string } | null {
  const key = raw
    .replace(/[【】\[\]（）()「」『』]/g, '')
    .replace(/[\s\u3000]/g, '')
    .toLowerCase()
    .replace(/(version|ver\.?|版|翻訳|翻译|翻譯|語言|语言)$/g, '')
  if (!key || key.length > 24) return null
  for (const lang of LANG_CODES) {
    for (const k of lang.keys) {
      const kk = k.toLowerCase()
      if (key === kk) return { code: lang.code, label: lang.label }
      if (kk.length > 3 && key.startsWith(kk) && key.length - kk.length <= 3) {
        return { code: lang.code, label: lang.label }
      }
    }
  }
  return null
}

/** href / value 里取出 RJ 号（product_id 形式的链接）。 */
const RJ_IN_LINK = /(RJ\d{6,10})/i

/**
 * 收集同一作品的其它语言版本。
 *
 * DLsite 的翻译版是独立商品（不同 RJ 号），页面上的语言切换 / 翻译版入口都是
 * 指向另一个 product_id 的链接，链接文本就是语言名（English / 简体中文 / 한국어…）。
 * 只认「能识别出语言」的链接：相关作品 / 同系列推荐也指向 product_id，但它们的
 * 文本是作品标题，识别不出语言，会被自然排除。
 */
function collectTranslations($: cheerio.CheerioAPI, selfRj: string): DlsiteTranslation[] {
  const out = new Map<string, DlsiteTranslation>()
  const self = selfRj.toUpperCase()

  const push = (rawRj: string, rawLang: string) => {
    const rj = rawRj.toUpperCase()
    if (rj === self || !/^RJ\d{6,10}$/.test(rj)) return
    const lang = detectLanguage(rawLang)
    if (!lang || out.has(rj)) return
    out.set(rj, { rj_code: rj, language: lang.code, language_label: lang.label })
  }

  // 1) 指向其它商品页的链接（语言切换 / 翻译版入口）
  $('a[href*="product_id"], a[data-product_id]').each((_, el) => {
    const $el = $(el)
    const hay = `${$el.attr('href') || ''} ${$el.attr('data-product_id') || ''}`
    const m = hay.match(RJ_IN_LINK)
    if (!m) return
    const langText =
      $el.attr('hreflang') ||
      $el.attr('data-lang') ||
      $el.attr('data-language') ||
      $el.text().trim() ||
      $el.find('img').first().attr('alt') ||
      $el.attr('title') ||
      ''
    push(m[1], langText)
  })

  // 2) 下拉选择式的语言切换（option value 就是 RJ 号）
  $('option[value*="RJ"], option[data-product_id]').each((_, el) => {
    const $el = $(el)
    const hay = `${$el.attr('value') || ''} ${$el.attr('data-product_id') || ''}`
    const m = hay.match(RJ_IN_LINK)
    if (!m) return
    push(m[1], $el.attr('data-lang') || $el.text().trim())
  })

  return [...out.values()]
}

function findRow($: cheerio.CheerioAPI, outline: cheerio.Cheerio<any>, labels: string[]) {
  return outline
    .find('th')
    .filter((_, el) => labels.includes($(el).text().trim()))
    .first()
    .parent()
    .children('td')
    .first()
}

/**
 * 取信息字段的值节点，新旧两套布局都试，取到哪个用哪个。
 * 找不到返回 null（调用方按「该字段没拿到」处理，不要瞎猜）。
 */
function findField($: cheerio.CheerioAPI, labels: string[]): cheerio.Cheerio<any> | null {
  // 新布局：dt(字段名) 的紧邻 dd(值)
  const dt = $('dt.c-productInfo__key')
    .filter((_, el) => labels.includes($(el).text().trim()))
    .first()
  if (dt.length) {
    const dd = dt.next('dd')
    if (dd.length) return dd
  }
  // 旧布局：#work_outline 表格
  const outline = $('#work_outline')
  if (outline.length) {
    const td = findRow($, outline, labels)
    if (td.length) return td
  }
  return null
}

/** 发售日统一成 YYYY-MM-DD：新布局是「2024年10月8日」，旧布局是纯数字串。 */
function normalizeRelease(text: string): string {
  const m = text.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  const digits = text.replace(/\D/g, '')
  return digits.length >= 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : text.trim()
}

export function parseWorkPage(html: string, rj_code: string): Partial<DlsiteMeta> {
  const $ = cheerio.load(html)
  const meta: Partial<DlsiteMeta> = { rj_code, actors: [], tags: [] }

  // 标题：og:title 形如「标题 [社团] | DLsite」；顺带把 [社团] 留作社团兜底
  // （地区禁售页不渲染信息区，只有 og:title / og:image，这样标题和社团仍能拿到）
  const ogTitle = $('meta[property="og:title"]').attr('content') || ''
  const ogMatch = ogTitle.match(/^(.*?)\s*\[([^\]]+)\]\s*\|\s*DLsite/)
  meta.title =
    (ogMatch ? ogMatch[1] : ogTitle.replace(/\s*\|.*$/, '')).trim() ||
    $('h1').first().text().trim() ||
    ''

  // 社团：旧布局 span.maker_name > a；新布局「社团名」字段；都没有时用 og:title 里的 [社团]
  const circleField = findField($, LABELS.circle)
  meta.circle =
    $('span.maker_name').children('a').first().text().trim() ||
    (circleField ? circleField.find('a').first().text().trim() || circleField.text().trim() : '') ||
    (ogMatch ? ogMatch[2].trim() : '')

  // 封面：og:image 优先。DLsite 的通用宣传图（页面没有作品信息时会退化成这张）不算封面
  const ogImage = $('meta[property="og:image"]').attr('content') || ''
  meta.cover_url = /\/modpub\/images\/web\/home\/summary_large_image/i.test(ogImage)
    ? ''
    : ogImage ||
      $('#work_left').attr('src') ||
      $('#main_image img').first().attr('src') ||
      ''

  // 贩卖日 → YYYY-MM-DD
  const releaseField = findField($, LABELS.release)
  meta.release_date = releaseField ? normalizeRelease(releaseField.text().replace(/\s+/g, ' ').trim()) : ''

  // 系列
  const seriesField = findField($, LABELS.series)
  meta.series = seriesField ? seriesField.find('a').first().text().trim() || seriesField.text().trim() : ''

  // 年龄指定（全年齢 / R18 …）：决定是否打「全年龄」标签，拿不到就留空
  const ageField = findField($, LABELS.age)
  meta.age_rating = ageField ? ageField.text().replace(/\s+/g, ' ').trim() : ''

  // 其它语言版本
  meta.translations = collectTranslations($, rj_code)

  // 类型标签：值节点里的链接（新旧布局的链接都在这层，不再区分 td > div > a）
  const genreField = findField($, LABELS.genre)
  const seenTags = new Set<string>()
  genreField?.find('a').each((_, el) => {
    const name = $(el).text().trim()
    if (name && !seenTags.has(name)) {
      seenTags.add(name)
      meta.tags!.push({ name, category: 'ジャンル' })
    }
  })

  // 声优：优先链接，没有链接时按分隔符切分纯文本
  const vaField = findField($, LABELS.va)
  if (vaField) {
    const links = vaField.find('a')
    if (links.length) {
      links.each((_, el) => {
        const name = $(el).text().trim()
        if (name) meta.actors!.push(name)
      })
    } else {
      for (const name of vaField.text().split(/[\s\u3000、,，/]+/)) {
        if (name.trim()) meta.actors!.push(name.trim())
      }
    }
  }

  return meta
}
