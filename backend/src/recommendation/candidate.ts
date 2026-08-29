/**
 * 候选召回层（方案文档第一层：Candidate Generation）。
 *
 * 召回 ≠ 推荐规则。这里只用「弱相关条件」找出一组可能相关的作品：
 *   同系列 OR 共同声优 OR 共同标签 OR 同社团 OR 标题存在 n-gram 重叠
 * 任何一个条件命中即进入候选池；最终是否被推荐、排多高，完全交给第二层的
 * Similarity 决定，召回条件本身不产生任何分数。
 *
 * 通过倒排索引实现：先建 series / tag / actor / circle / title-ngram 的
 * 「值 → 作品集合」映射，再对每个作品求并集去重，避免对整库做 N×N 全量两两比较。
 *
 * 自身排除（第一层防御）：倒排索引命中会把自身包含进来（如共享标签），
 * 这里统一排除 current.rj。计算层还会有第二次防御。
 */
import { normalizeSeries } from './similarity.js'

export interface WorkFeature {
  rj: string
  title: string
  circle: string
  series: string
  actors: Set<number>
  tags: Set<number>
  titleNgrams: Map<string, number> // 标题字符 n-gram 计数（供标题召回）
  sales: number
  play: number
}

function addTo(index: Map<string, Set<string>>, key: string, rj: string): void {
  let set = index.get(key)
  if (!set) {
    set = new Set()
    index.set(key, set)
  }
  set.add(rj)
}

/** 倒排索引的五个维度桶（series / tag / actor / circle / title-ngram）。 */
export interface CandidateIndexes {
  seriesIndex: Map<string, Set<string>>
  tagIndex: Map<string, Set<string>>
  actorIndex: Map<string, Set<string>>
  circleIndex: Map<string, Set<string>>
  titleIndex: Map<string, Set<string>>
}

/**
 * 建倒排索引（值 → 作品集合）。本身是 O(总特征数) 的快速操作；
 * 真正的耗时在逐个作品求并集，因此把两步拆开，让调用方可以对求并集分块让出事件循环。
 * 算法结果与 generateCandidates 完全一致。
 */
export function buildCandidateIndexes(list: WorkFeature[]): CandidateIndexes {
  const seriesIndex = new Map<string, Set<string>>()
  const tagIndex = new Map<string, Set<string>>()
  const actorIndex = new Map<string, Set<string>>()
  const circleIndex = new Map<string, Set<string>>()
  const titleIndex = new Map<string, Set<string>>()

  for (const f of list) {
    // 只有非空系列才入索引，空系列作品之间绝不会被误判为同系列
    if (f.series) addTo(seriesIndex, normalizeSeries(f.series), f.rj)
    for (const t of f.tags) addTo(tagIndex, String(t), f.rj)
    for (const a of f.actors) addTo(actorIndex, String(a), f.rj)
    if (f.circle) addTo(circleIndex, f.circle, f.rj)
    for (const g of f.titleNgrams.keys()) addTo(titleIndex, g, f.rj)
  }
  return { seriesIndex, tagIndex, actorIndex, circleIndex, titleIndex }
}

/** 为单个作品求候选集（不含自身）。结果与 generateCandidates 中逐作品逻辑一致。 */
export function candidatesFor(
  f: WorkFeature,
  indexes: CandidateIndexes,
  candidateLimit: number
): Set<string> {
  const { seriesIndex, tagIndex, actorIndex, circleIndex, titleIndex } = indexes
  const set = new Set<string>()
  // 第一层防御：任何桶里出现的 current.rj 一律跳过
  const addOthers = (index: Map<string, Set<string>>, key: string) => {
    const bucket = index.get(key)
    if (!bucket) return
    for (const rj of bucket) if (rj !== f.rj) set.add(rj)
  }
  if (f.series) addOthers(seriesIndex, normalizeSeries(f.series))
  for (const t of f.tags) addOthers(tagIndex, String(t))
  for (const a of f.actors) addOthers(actorIndex, String(a))
  if (f.circle) addOthers(circleIndex, f.circle)
  for (const g of f.titleNgrams.keys()) addOthers(titleIndex, g)

  if (set.size > candidateLimit) return new Set([...set].slice(0, candidateLimit))
  return set
}

/**
 * 为每个作品生成候选集（不含自身）。候选集是近似对称的（共同特征天然对称），
 * 上限 candidateLimit 只在极大作品库时生效，当前规模下不会截断。
 *
 * 注意：这是同步版本，供测试等小规模场景使用；推荐计算主流程用
 * buildCandidateIndexes + candidatesFor 分块执行，避免长时间占死事件循环。
 */
export function generateCandidates(
  list: WorkFeature[],
  candidateLimit: number
): Map<string, Set<string>> {
  const indexes = buildCandidateIndexes(list)
  const out = new Map<string, Set<string>>()
  for (const f of list) out.set(f.rj, candidatesFor(f, indexes, candidateLimit))
  return out
}
