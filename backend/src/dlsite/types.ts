export interface DlsiteTag {
  name: string
  category: string
}

/** DLsite 上同一作品的其它语言版本（翻译版有独立 RJ 号）。 */
export interface DlsiteTranslation {
  rj_code: string
  /** 归一化语言码：ja / en / zh-Hans / zh-Hant / ko / es … */
  language: string
  /** 页面上的原始语言名，用于展示（English / 简体中文 / 한국어 …） */
  language_label: string
}

export interface DlsiteMeta {
  rj_code: string
  title: string
  circle: string
  release_date: string
  series: string
  sales_count: number | null
  actors: string[]
  tags: DlsiteTag[]
  cover_url: string
  /** 「年龄指定」原始文案（全年齢 / R18 …）；拿不到时为空串 */
  age_rating: string
  /** 其它语言版本列表；没有翻译时为空数组 */
  translations: DlsiteTranslation[]
  /** 发售价格（日元）；null = 没抓到，0 = 确实免费 */
  price: number | null
  /** 平均评分；null = 没抓到，0 = 无评分 */
  rating: number | null
  /** 评论数量；null = 没抓到，0 = 无评论 */
  rating_count: number | null
}
