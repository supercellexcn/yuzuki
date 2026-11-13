/**
 * 动态数据缓存（批量接口 → 逐部流程共用）。
 *
 * DLsite 的 `maniax/product/info/ajax` 支持逗号分隔一次查多个 RJ，而 `product.json`
 * (api2) 不支持多值。于是扫描 / 全库刷新开始前先按批（默认 50 个）拉一次，结果放这里；
 * 随后逐部作品的流程（touch 动态数据、api1 兜底）命中缓存就不再发请求 ——
 * N 部作品的动态数据只花 N/50 次网络请求。
 *
 * 两条铁律：
 * 1. **只缓存确实返回了的条目**。接口里没有某个 RJ，可能是「作品不存在」，也可能是
 *    「当前地区不卖」，两者在 JSON 上无法区分 —— 判定交给作品页 HTML，这里绝不下结论。
 * 2. **批量失败不影响主流程**。取不到就当作没缓存，逐部流程照旧按原逻辑单独请求。
 */

/** 批量接口 / api1 / touch 三者的条目字段是同一套（touch 少几项，数值项一致）。 */
export interface BatchEntry {
  workno?: string
  work_name?: string
  maker_id?: number | string
  regist_date?: string
  work_image?: string
  /** 销量 */
  dl_count?: string | number
  /** 当前售价（日元，受折扣影响） */
  price?: string | number
  /** 原价（日元），价格入库取这个 */
  official_price?: string | number
  /** 平均评分（两位小数） */
  rate_average_2dp?: number | string
  /** 评分人数 */
  rate_count?: number | string
  /** 文字评论数（rate_count 缺失时的兜底） */
  review_count?: number | string
  is_sale?: boolean
}

/** 缓存有效期：一次扫描可能跑几小时，超过这个时长就不再采信（当作没缓存）。 */
const TTL_MS = 3 * 60 * 60 * 1000
/** 上限，防止全库几万部作品时内存无限增长。 */
const MAX_ENTRIES = 20000

const store = new Map<string, { at: number; data: BatchEntry }>()

function keyOf(rj: string): string {
  return rj.trim().toUpperCase()
}

/** 写入一批条目，返回实际写入的数量（非对象 / 空值直接忽略）。 */
export function cacheBatchEntries(entries: Record<string, BatchEntry>): number {
  const now = Date.now()
  let n = 0
  for (const [rj, data] of Object.entries(entries)) {
    if (!data || typeof data !== 'object') continue
    const key = keyOf(rj)
    if (!key) continue
    if (store.size >= MAX_ENTRIES && !store.has(key)) continue
    store.set(key, { at: now, data })
    n++
  }
  return n
}

/** 取缓存条目；过期视为未命中并顺手清理。 */
export function getCachedEntry(rj: string): BatchEntry | null {
  const key = keyOf(rj)
  const hit = store.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > TTL_MS) {
    store.delete(key)
    return null
  }
  return hit.data
}

/** 丢弃单个条目：手动同步某个作品时用，保证拿到的是实时数据。 */
export function dropCachedEntry(rj: string): void {
  store.delete(keyOf(rj))
}

/** 清空：每次批量预取开始前调用，避免上一轮的数据混进来。 */
export function clearDynamicCache(): void {
  store.clear()
}

export function dynamicCacheSize(): number {
  return store.size
}
