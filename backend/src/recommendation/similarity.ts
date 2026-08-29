/**
 * 推荐算法纯函数模块 —— v2.0 连续型作品相似度模型。
 *
 * 与 v1 的关键区别（对齐《DLSite 作品推荐系统.md》）：
 * - 声优用纯 Jaccard，去掉「共同声优奖励」——同声优只是相似度的一部分，不是加分项；
 * - 标签分 = (1-coreW)×加权Jaccard + coreW×核心标签Jaccard（核心标签按 IDF 取前 K 个）；
 * - 标题用「字符 n-gram TF-IDF + 余弦」，并先做 NFKC 预清洗（全角→半角、统一大小写）；
 * - 四维权重 Tag > Voice > Title > Circle，某维度双方任一方缺失则动态剔除并重新归一化；
 * - 销量 / 播放次数完全不参与相似度，只用于排序期的 ±qualityImpact 微调。
 *
 * 所有函数保持纯计算、不接触数据库。
 */

export const RECOMMENDATION_VERSION = 'v2.1'

/** 相似度四维权重（配置化，来自 AppSettings）。 */
export interface SimilarityWeights {
  voice: number
  tag: number
  title: number
  circle: number
}

/** 一次相似度计算的完整结果：similarity 是唯一的作品相似度，其余子分数用于调试 / 解释。 */
export interface SimilarityResult {
  similarity: number
  voice: number
  tag: number
  title: number
  circle: number
}

/** 标题 TF-IDF 向量（预计算，供两两余弦复用）。 */
export interface TitleStats {
  vec: Map<string, number> // ngram -> tf×idf
  normSq: number           // Σ v²
}

function intersectionSize<T>(a: Set<T>, b: Set<T>): number {
  if (a.size > b.size) return intersectionSize(b, a)
  let n = 0
  for (const x of a) if (b.has(x)) n++
  return n
}

/** 声优相似度：纯 Jaccard。任一方无声优 → 该维度由调用方剔除（动态归一化）。 */
export function voiceSimilarity(actorsA: Set<number>, actorsB: Set<number>): number {
  if (!actorsA.size || !actorsB.size) return 0
  const inter = intersectionSize(actorsA, actorsB)
  const union = actorsA.size + actorsB.size - inter
  return union ? inter / union : 0
}

/** 标签加权 Jaccard：Σ IDF(共同标签) / Σ IDF(全部标签)。 */
export function weightedTagJaccard(tagsA: Set<number>, tagsB: Set<number>, idf: Map<number, number>): number {
  if (!tagsA.size || !tagsB.size) return 0
  let interSum = 0
  let unionSum = 0
  for (const t of tagsA) {
    const w = idf.get(t) ?? 0
    unionSum += w
    if (tagsB.has(t)) interSum += w
  }
  for (const t of tagsB) {
    if (!tagsA.has(t)) unionSum += idf.get(t) ?? 0
  }
  return unionSum > 0 ? interSum / unionSum : 0
}

/** 核心标签：按 IDF 取每个作品「最重要的 K 个标签」。 */
export function coreTags(tags: Set<number>, idf: Map<number, number>, k: number): Set<number> {
  if (!tags.size || tags.size <= k) return tags
  return new Set([...tags].sort((x, y) => (idf.get(y) ?? 0) - (idf.get(x) ?? 0)).slice(0, k))
}

/** 核心标签 Jaccard：双方核心主题的交并比。 */
export function coreTagSimilarity(tagsA: Set<number>, tagsB: Set<number>, idf: Map<number, number>, k: number): number {
  if (!tagsA.size || !tagsB.size) return 0
  const ca = coreTags(tagsA, idf, k)
  const cb = coreTags(tagsB, idf, k)
  const inter = intersectionSize(ca, cb)
  const union = ca.size + cb.size - inter
  return union ? inter / union : 0
}

/** 标签相似度 = (1-coreW)×加权Jaccard + coreW×核心标签Jaccard。 */
export function tagSimilarity(
  tagsA: Set<number>,
  tagsB: Set<number>,
  idf: Map<number, number>,
  coreW: number,
  coreK: number
): number {
  const wj = weightedTagJaccard(tagsA, tagsB, idf)
  const cj = coreTagSimilarity(tagsA, tagsB, idf, coreK)
  return (1 - coreW) * wj + coreW * cj
}

/** 标题预清洗：NFKC（全角→半角、统一大小写）+ 去除装饰符号 + 合并空格。 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[[\]【】「」『』()（）《》〈〉<>・…～〜♪♡♥☆★○●◎◇◆]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 字符 n-gram 计数；跳过含空白的 ngram，避免跨词 / 跨符号的无意义拼接。 */
export function titleNgrams(title: string, n = 2): Map<string, number> {
  const chars = Array.from(normalizeTitle(title))
  const out = new Map<string, number>()
  for (let i = 0; i <= chars.length - n; i++) {
    const gram = chars.slice(i, i + n).join('')
    if (gram.includes(' ')) continue
    out.set(gram, (out.get(gram) || 0) + 1)
  }
  return out
}

/** 由 ngram 计数 + 全局 IDF 构建 TF-IDF 向量，预计算范数。 */
export function buildTitleVec(ngrams: Map<string, number>, idf: Map<string, number>): TitleStats {
  let normSq = 0
  const vec = new Map<string, number>()
  for (const [g, tf] of ngrams) {
    const v = tf * (idf.get(g) ?? 0)
    vec.set(g, v)
    normSq += v * v
  }
  return { vec, normSq }
}

/** 标题相似度：TF-IDF n-gram 向量余弦。 */
export function titleSimilarity(a: TitleStats, b: TitleStats): number {
  if (!a.vec.size || !b.vec.size || !a.normSq || !b.normSq) return 0
  const small = a.vec.size <= b.vec.size ? a : b
  const large = small === a ? b : a
  let dot = 0
  for (const [g, v] of small.vec) {
    const w = large.vec.get(g)
    if (w) dot += v * w
  }
  return dot / Math.sqrt(a.normSq * b.normSq)
}

/** 社团相似度：同社团（且都非空）→ 1，否则 0。 */
export function circleSimilarity(circleA: string, circleB: string): number {
  if (!circleA || !circleB) return 0
  return circleA === circleB ? 1 : 0
}

// ---- 系列强关系（v2.1：系列不是普通特征，而是最高优先级的关联关系） ----

/** 系列名标准化：NFKC + 去首尾空白 + 连续空白合并。 */
export function normalizeSeries(series: string): string {
  return series.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

/**
 * 是否同一系列：双方都非空且标准化后完全相同。
 * 空系列 / null 永不匹配——否则所有「没有系列信息」的作品都会被误判成同系列。
 * 第一阶段不做模糊匹配（不做 includes / 编辑距离），只有完全相等才算同系列。
 */
export function isSameSeries(a: { series: string }, b: { series: string }): boolean {
  if (!a.series || !b.series) return false
  return normalizeSeries(a.series) === normalizeSeries(b.series)
}

/**
 * 综合相似度 + 动态权重归一化。
 * 某维度双方任一方缺失（如 A 有声优、B 无声优）时剔除该维度，再对剩余权重归一化，
 * 避免「信息缺失」被误当成「完全不同」。
 */
export function calculateSimilarity(
  a: { actors: Set<number>; tags: Set<number>; title: TitleStats | null; circle: string },
  b: { actors: Set<number>; tags: Set<number>; title: TitleStats | null; circle: string },
  w: SimilarityWeights,
  idf: Map<number, number>,
  coreW: number,
  coreK: number
): SimilarityResult {
  const result: SimilarityResult = { similarity: 0, voice: 0, tag: 0, title: 0, circle: 0 }
  const dims: Array<{ weight: number; value: number; key: keyof SimilarityResult }> = []
  if (a.actors.size && b.actors.size) dims.push({ weight: w.voice, value: voiceSimilarity(a.actors, b.actors), key: 'voice' })
  if (a.tags.size && b.tags.size) dims.push({ weight: w.tag, value: tagSimilarity(a.tags, b.tags, idf, coreW, coreK), key: 'tag' })
  if (a.title && b.title) dims.push({ weight: w.title, value: titleSimilarity(a.title, b.title), key: 'title' })
  if (a.circle && b.circle) dims.push({ weight: w.circle, value: circleSimilarity(a.circle, b.circle), key: 'circle' })

  const totalW = dims.reduce((s, d) => s + d.weight, 0)
  if (!totalW) return result // 双方没有任何可比维度 → 0，不进入推荐

  let sim = 0
  for (const d of dims) {
    result[d.key] = d.value
    sim += (d.weight / totalW) * d.value
  }
  result.similarity = Math.min(1, Math.max(0, sim))
  return result
}

// ---- 质量 / 排序（不属于相似度） ----

/** 归一化对数分：log(1+x)/log(1+max)，用于销量 / 播放次数。 */
export function normalizedLogScore(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0
  return Math.log(1 + value) / Math.log(1 + max)
}

/** 质量分（0~1）：w×SalesScore + (1-w)×PlayScore。只用于排序微调，不进入相似度。 */
export function qualityScore(salesWeight: number, sales: number, play: number): number {
  return salesWeight * sales + (1 - salesWeight) * play
}

/**
 * 推荐排序分 = Similarity × (1 − impact + 2×impact×QualityScore)。
 * impact 默认 0.05 → 倍率 0.95~1.05（±5%），保证相似度永远是第一优先级。
 */
export function recommendationScore(similarity: number, quality: number, impact: number): number {
  return similarity * (1 - impact + 2 * impact * quality)
}

/** 参与 MMR 排序的候选条目。 */
export interface RankedCandidate {
  related: string
  series: string
  sameSeries: boolean // 是否与源作品同系列（v2.1 强关系标记，不污染 similarity）
  final: number // RecommendationScore（含质量微调），MMR 相关性 / 系列内部排序依据
  similarity: number // 原始内容相似度（0~1）
  quality: number
  voice: number
  tag: number
  title: number
  circle: number
}

/**
 * MMR（最大边际相关性）多样性排序 —— 只负责「普通候选」之间的多样性（v2.1）。
 *   score(c) = λ×RecommendationScore(c) − (1−λ)×max Similarity(c, selected)
 * 贪心选取，最终返回至多 topN 个候选。
 *
 * seedSelected：已选中的同系列作品作为「种子」参与普通候选的多样性抑制
 * （普通候选太像已选系列时被降权），但种子本身不在池中、也不被惩罚。
 * 系列配额 seriesQuota 只作用于池内候选（防止某个非源系列刷屏）。
 *
 * 性能：先按 final 截断到 poolCap，再用「运行期 maxSim 数组」避免每轮重复扫描，
 * 复杂度 O(poolCap × topN)。
 */
export function mmrRank(
  candidates: RankedCandidate[],
  lambda: number,
  topN: number,
  simFn: (c: RankedCandidate, s: RankedCandidate) => number,
  seriesQuota = 2,
  poolCap = 100,
  seedSelected: RankedCandidate[] = []
): RankedCandidate[] {
  const pool = [...candidates]
    .filter((c) => c.related)
    .sort((a, b) => b.final - a.final || a.related.localeCompare(b.related))
    .slice(0, poolCap)
  const selected: RankedCandidate[] = []
  const seriesCount = new Map<string, number>()
  for (const s of seedSelected) if (s.series) seriesCount.set(s.series, (seriesCount.get(s.series) || 0) + 1)
  const maxSim = new Array<number>(pool.length).fill(0)
  // 已选系列作品对普通候选的多样性抑制（种子不算进 selected，不被惩罚）
  for (const s of seedSelected) {
    for (let i = 0; i < pool.length; i++) {
      const sim = simFn(pool[i], s)
      if (sim > maxSim[i]) maxSim[i] = sim
    }
  }

  while (selected.length < topN && pool.length) {
    let bestIdx = -1
    let bestScore = -Infinity
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i]
      if (c.series && (seriesCount.get(c.series) || 0) >= seriesQuota) continue
      const score = lambda * c.final - (1 - lambda) * maxSim[i]
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }
    if (bestIdx < 0) break
    const pick = pool.splice(bestIdx, 1)[0]
    maxSim.splice(bestIdx, 1)
    for (let i = 0; i < pool.length; i++) {
      const sim = simFn(pick, pool[i])
      if (sim > maxSim[i]) maxSim[i] = sim
    }
    selected.push(pick)
    if (pick.series) seriesCount.set(pick.series, (seriesCount.get(pick.series) || 0) + 1)
  }
  return selected
}
