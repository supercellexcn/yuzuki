/**
 * 作品动态数据的展示文案。
 *
 * 口径（与后端 / 后台「信息缺失」保持一致）：
 * - `null` = 本次没抓到，调用方不应展示该行
 * - `0` = 确实为 0（免费 / 无评分 / 无评论），属于有效值
 */

/** 价格：库里存 DLsite 的日元原价，0 表示免费。 */
export function formatPrice(price: number | null | undefined): string {
  if (price == null) return ''
  return price === 0 ? '免费' : `${price.toLocaleString()} 日元`
}

/** 评论数量：0 时说明确实没人评论，而不是没抓到。 */
export function formatRatingNote(count: number | null | undefined): string {
  if (count == null) return ''
  return count === 0 ? '暂无评论' : `（${count.toLocaleString()} 条评论）`
}

/** 评分值：保留两位小数（DLsite 原始精度为 2 位）。 */
export function formatRating(rating: number | null | undefined): string {
  if (rating == null) return ''
  return rating.toFixed(2)
}
