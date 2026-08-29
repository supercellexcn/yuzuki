import * as cheerio from 'cheerio'
import type { DlsiteMeta } from './types.js'

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
