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

/**
 * 本次抓取时 DLsite 侧的返回状态。用于入库后决定「这个作品该去哪找信息」：
 * - ok：DLsite 正常返回作品页（信息区在），数据可信
 * - region_blocked：当前出口所在区域不卖（HTTP 200 的限制页），换线路可补齐
 * - not_found：作品不存在 / 已下架（HTTP 404）
 * - error：网络、超时等异常，与作品本身无关
 * - unknown：连请求都没发出去（如新作品首次抓取被中断）
 */
export type DlsiteFetchStatus = 'ok' | 'region_blocked' | 'not_found' | 'error' | 'unknown'

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
  /** 封面地址的来源站点：dlsite / hvdb；无封面时为空 */
  cover_source?: 'dlsite' | 'hvdb' | ''
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
  /** 本次抓取的 DLsite 返回状态；调用方据此写 works.fetch_status */
  fetch_status: DlsiteFetchStatus
  /**
   * 声优字段是否由权威数据源确认过（api2 明确返回了 creaters 字段，或作品页信息区
   * 解析成功）。为 true 时 actors 为空表示「该作品确实没有声优」，不算信息缺失。
   */
  actors_confirmed?: boolean
  /**
   * 类型标签是否由权威数据源确认过（api2 明确返回了 genres / genres_replaced 字段，
   * 或作品页信息区解析成功）。为 true 时没有原生标签表示「该作品确实没有分类」。
   */
  tags_confirmed?: boolean
}
