import * as cheerio from 'cheerio'
import type { DlsiteMeta, DlsiteTranslation } from './types.js'

/**
 * 解析 DLsite 作品页 HTML（静态部分）。
 * 结构依据页面中的 #work_outline 表格：每个字段是一行 <tr>，<th> 是字段名，
 * 值在 <td> 里。字段名随 locale 变化，这里同时列出日/简中/繁中以便兼容。
 */
const LABELS = {
  genre: ['ジャンル', '分类', '分類', '類型', '类型'],
  va: ['声優', '声优', '聲優'],
  release: ['販売日', '贩卖日', '販賣日', '発売日', '发售日'],
  series: ['シリーズ名', '系列名'],
  age: ['年齢指定', '年龄指定', '年齡指定', '年齢区分', '年龄分级'],
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

export function parseWorkPage(html: string, rj_code: string): Partial<DlsiteMeta> {
  const $ = cheerio.load(html)
  const meta: Partial<DlsiteMeta> = { rj_code, actors: [], tags: [] }

  // 标题：og:title，去掉 "[社团] | DLsite" 后缀
  let title = $('meta[property="og:title"]').attr('content') || ''
  title = title.replace(/ \[.+\] \| DLsite$/, '').trim()
  meta.title = title || $('h1').first().text().trim() || ''

  // 社团
  meta.circle = $('span.maker_name').children('a').first().text().trim()

  // 封面：og:image 优先
  meta.cover_url =
    $('meta[property="og:image"]').attr('content') ||
    $('#work_left').attr('src') ||
    $('#main_image img').first().attr('src') ||
    ''

  const outline = $('#work_outline')

  // 贩卖日 → YYYY-MM-DD
  const releaseTd = findRow($, outline, LABELS.release)
  const releaseRaw = releaseTd.text().replace(/[^0-9]/g, '')
  meta.release_date =
    releaseRaw.length >= 8
      ? `${releaseRaw.slice(0, 4)}-${releaseRaw.slice(4, 6)}-${releaseRaw.slice(6, 8)}`
      : releaseTd.text().trim()

  // 系列
  const seriesTd = findRow($, outline, LABELS.series)
  meta.series = seriesTd.children('a').first().text().trim()

  // 年龄指定（全年齢 / R18 …）：决定是否打「全年龄」标签，拿不到就留空
  const ageTd = findRow($, outline, LABELS.age)
  meta.age_rating = ageTd.text().trim()

  // 其它语言版本
  meta.translations = collectTranslations($, rj_code)

  // 类型标签：td > div > a（兜底 td > a）
  const genreTd = findRow($, outline, LABELS.genre)
  const genreLinks = genreTd.children('div').children('a')
  const links = genreLinks.length ? genreLinks : genreTd.children('a')
  const seenTags = new Set<string>()
  links.each((_, el) => {
    const name = $(el).text().trim()
    if (name && !seenTags.has(name)) {
      seenTags.add(name)
      meta.tags!.push({ name, category: 'ジャンル' })
    }
  })

  // 声优：td > a
  const vaTd = findRow($, outline, LABELS.va)
  vaTd.children('a').each((_, el) => {
    const name = $(el).text().trim()
    if (name) meta.actors!.push(name)
  })

  return meta
}
