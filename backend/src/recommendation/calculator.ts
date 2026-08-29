/**
 * 推荐计算任务执行体 —— v2.1。
 *
 * 三层流水线（对齐方案文档 §81）：
 *   第一层 Candidate Generation（候选召回）→ candidate.ts
 *   第二层 Similarity Calculation（连续型内容相似度）→ similarity.ts
 *   第三层 Ranking（系列优先 → MMR → 质量微调）→ 本文件
 *
 * v2.1 相对 v2.0 的关键变化：
 * - 自身作品两层防御排除（候选层 + 计算层）；
 * - 系列升级为「最高优先级强关系」：同系列先选（最多 seriesMaxCount 部），
 *   再对普通候选做 MMR，系列候选不参与普通多样性惩罚；
 * - 同系列允许绕过 MIN_SIMILARITY（独立强关联通道）；
 * - MMR 相关性改用 RecommendationScore（含质量微调）。
 *
 * 只读取现有作品数据（works / work_actors / work_tags / play_counts），
 * 结果只写推荐模块自己的三张表。
 */
import { getDb, transaction } from '../db/connection.js'
import { getSettings } from '../settings.js'
import { buildCandidateIndexes, candidatesFor, type WorkFeature } from './candidate.js'
import {
  buildTitleVec,
  calculateSimilarity,
  isSameSeries,
  mmrRank,
  normalizedLogScore,
  qualityScore,
  recommendationScore,
  titleNgrams,
  RECOMMENDATION_VERSION,
  type RankedCandidate,
  type SimilarityResult,
  type SimilarityWeights,
} from './similarity.js'

export interface RecommendationCalcResult {
  works: number
  rows: number
  errors: string[]
}

/**
 * 让出事件循环一个 tick。
 *
 * 计算是 CPU 密集 + 同步 sqlite 写入的，若整段同步执行会长时间占死 Node 事件循环：
 * 「启动推荐计算」的 HTTP 响应发不出去（前端 30s 超时报「启动失败」）、计算期间
 * 登录/状态轮询/其他接口全部无响应、启动阶段自动计算还会卡住服务监听端口。
 * 因此计算改为 async 分块执行，在重循环里定期让出，让待处理的请求在间隙被服务。
 * 算法本身（相似度、MMR、排序）不做任何改动。
 */
function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export async function calculateRecommendations(
  onProgress?: (done: number, total: number) => void
): Promise<RecommendationCalcResult> {
  const db = getDb()
  const s = getSettings()
  const weights: SimilarityWeights = {
    voice: s.recommendation_weight_voice,
    tag: s.recommendation_weight_tag,
    title: s.recommendation_weight_title,
    circle: s.recommendation_weight_circle,
  }
  const topN = s.recommendation_top_n
  const lambda = s.recommendation_mmr_lambda
  const minScore = s.recommendation_min_score
  const candidateLimit = s.recommendation_candidate_limit
  const coreW = s.recommendation_core_tag_weight
  const coreK = s.recommendation_core_tag_count
  const impact = s.recommendation_quality_impact
  const salesW = s.recommendation_quality_sales_weight
  const seriesEnabled = s.recommendation_series_priority_enabled
  const seriesMaxCount = s.recommendation_series_max_count
  const seriesBypassMinScore = s.recommendation_series_bypass_min_score
  const errors: string[] = []
  const now = new Date().toISOString()

  // ---- 第一层数据准备：读入全部作品特征 ----
  const works = db
    .prepare('SELECT rj_code, title, circle, series, sales_count FROM works')
    .all() as unknown as Array<{
    rj_code: string
    title: string
    circle: string
    series: string
    sales_count: number | null
  }>

  const features = new Map<string, WorkFeature>()
  for (const w of works) {
    features.set(w.rj_code, {
      rj: w.rj_code,
      title: w.title || '',
      circle: w.circle || '',
      series: w.series || '',
      actors: new Set(),
      tags: new Set(),
      titleNgrams: titleNgrams(w.title || ''),
      sales: w.sales_count ?? 0,
      play: 0,
    })
  }
  const actorRows = db
    .prepare('SELECT w.rj_code, wa.actor_id FROM work_actors wa JOIN works w ON w.id = wa.work_id')
    .all() as unknown as Array<{ rj_code: string; actor_id: number }>
  for (const r of actorRows) features.get(r.rj_code)?.actors.add(r.actor_id)
  const tagRows = db
    .prepare('SELECT w.rj_code, wt.tag_id FROM work_tags wt JOIN works w ON w.id = wt.work_id')
    .all() as unknown as Array<{ rj_code: string; tag_id: number }>
  for (const r of tagRows) features.get(r.rj_code)?.tags.add(r.tag_id)
  const playRows = db
    .prepare('SELECT rj_code, SUM(count) AS cnt FROM play_counts GROUP BY rj_code')
    .all() as unknown as Array<{ rj_code: string; cnt: number }>
  for (const r of playRows) {
    const f = features.get(r.rj_code)
    if (f) f.play = Number(r.cnt) || 0
  }

  const list = [...features.values()]
  const n = list.length
  if (n < 2) {
    transaction(db, () => {
      db.prepare('DELETE FROM work_recommendations').run()
      const upsertState = db.prepare(
        `INSERT INTO recommendation_work_state (rj_code, calculated_at, algorithm_version, status)
         VALUES (?, ?, ?, 'COMPLETED')
         ON CONFLICT(rj_code) DO UPDATE SET calculated_at = excluded.calculated_at, algorithm_version = excluded.algorithm_version, status = excluded.status`
      )
      for (const f of list) upsertState.run(f.rj, now, RECOMMENDATION_VERSION)
    })
    return { works: n, rows: 0, errors }
  }

  // 尽早回报总数并让出事件循环：让「启动推荐计算」的 HTTP 响应立即返回，
  // 也让启动阶段自动计算不阻塞服务监听端口（否则监听前就会卡住，登录一直失败）。
  onProgress?.(0, n)
  await yieldToLoop()

  // ---- 标签 IDF ----
  const tagDf = new Map<number, number>()
  for (const f of list) for (const t of f.tags) tagDf.set(t, (tagDf.get(t) || 0) + 1)
  const tagIdf = new Map<number, number>()
  for (const [t, df] of tagDf) tagIdf.set(t, Math.log((n + 1) / (df + 1)) + 1)

  // ---- 标题 n-gram IDF + TF-IDF 向量（内存缓存，不落库） ----
  const gramDf = new Map<string, number>()
  for (const f of list) for (const g of f.titleNgrams.keys()) gramDf.set(g, (gramDf.get(g) || 0) + 1)
  const gramIdf = new Map<string, number>()
  for (const [g, df] of gramDf) gramIdf.set(g, Math.log((n + 1) / (df + 1)) + 1)
  const titleVecs = new Map<string, ReturnType<typeof buildTitleVec> | null>()
  for (const f of list) {
    titleVecs.set(f.rj, f.title ? buildTitleVec(f.titleNgrams, gramIdf) : null)
  }

  // ---- 质量分全局统计 ----
  let maxSales = 0
  let maxPlay = 0
  for (const f of list) {
    if (f.sales > maxSales) maxSales = f.sales
    if (f.play > maxPlay) maxPlay = f.play
  }
  const qualityOf = (f: WorkFeature): number =>
    qualityScore(salesW, normalizedLogScore(f.sales, maxSales), normalizedLogScore(f.play, maxPlay))

  // ---- 第一层：候选召回（已排除自身） ----
  // 建索引很快；逐作品求并集在大库时很耗时（2500 作品约 6s），拆成小块执行并
  // 定期让出事件循环，避免计算早期整段阻塞（否则启动后首个请求 / 登录会卡数秒）。
  const indexes = buildCandidateIndexes(list)
  await yieldToLoop()
  const candidateSets = new Map<string, Set<string>>()
  for (let i = 0; i < n; i += 100) {
    const end = Math.min(n, i + 100)
    for (let j = i; j < end; j++) candidateSets.set(list[j].rj, candidatesFor(list[j], indexes, candidateLimit))
    await yieldToLoop()
  }

  // ---- 第二层：相似度计算（含自身排除、系列判断、阈值规则） ----
  // pairSim 以「排序后的 rj 对」为键缓存 SimilarityResult，每个无向对只算一次，
  // A→B 与 B→A 拿到同一相似度、各自的 RecommendationScore。
  const candidates = new Map<string, RankedCandidate[]>()
  for (const f of list) candidates.set(f.rj, [])
  const pairSim = new Map<string, SimilarityResult>()

  const sortedKey = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`)

  for (let i = 0; i < n; i++) {
    // 分块让出事件循环：避免整个计算期间阻塞所有 HTTP 请求（登录 / 状态轮询等）
    if (i > 0 && i % 100 === 0) await yieldToLoop()
    const a = list[i]
    for (const crj of candidateSets.get(a.rj) ?? []) {
      // 第二层防御：即使候选层被其他功能复用，自身也绝不进入计算
      if (crj === a.rj) continue
      const b = features.get(crj)
      if (!b) continue
      const key = sortedKey(a.rj, b.rj)
      const sameSeries = isSameSeries(a, b)
      if (!pairSim.has(key)) {
        const r = calculateSimilarity(
          { actors: a.actors, tags: a.tags, title: titleVecs.get(a.rj) ?? null, circle: a.circle },
          { actors: b.actors, tags: b.tags, title: titleVecs.get(b.rj) ?? null, circle: b.circle },
          weights,
          tagIdf,
          coreW,
          coreK
        )
        // 普通作品：相似度 >= minScore 才保留；
        // 同系列：作为独立强关联通道，允许绕过 MIN_SIMILARITY（方案 §52-54）
        const keep = r.similarity >= minScore || (seriesEnabled && seriesBypassMinScore && sameSeries)
        if (keep) pairSim.set(key, r)
      }
      const sim = pairSim.get(key)
      if (!sim) continue
      const qb = qualityOf(b)
      candidates.get(a.rj)!.push({
        related: b.rj,
        series: b.series,
        sameSeries,
        final: recommendationScore(sim.similarity, qb, impact),
        similarity: sim.similarity,
        quality: qb,
        voice: sim.voice,
        tag: sim.tag,
        title: sim.title,
        circle: sim.circle,
      })
    }
    onProgress?.(i + 1, n)
  }

  // MMR 多样性：候选对之间的内容相似度用缓存的 pairSim
  const simBetween = (x: RankedCandidate, y: RankedCandidate): number =>
    pairSim.get(sortedKey(x.related, y.related))?.similarity ?? 0

  // ---- 第三层：系列优先 + MMR + 质量微调 ----
  const ranked = new Map<string, RankedCandidate[]>()
  let mi = 0
  for (const f of list) {
    // 同第二层：定期让出事件循环，保持计算期间服务可用
    if (mi > 0 && mi % 100 === 0) await yieldToLoop()
    mi++
    const all = candidates.get(f.rj)!
    if (!seriesEnabled) {
      // 关闭系列优先：全部候选统一走 MMR（退化到 v2.0 行为）
      ranked.set(f.rj, mmrRank(all, lambda, topN, simBetween))
      continue
    }

    // 1) 系列优先：同系列按 RecommendationScore 取前 seriesMaxCount 部（方案 §33/§51）
    const seriesSelected = all
      .filter((c) => c.sameSeries)
      .sort((a, b) => b.final - a.final || a.related.localeCompare(b.related))
      .slice(0, seriesMaxCount)

    // 2) 普通候选：进 MMR（相关性 = RecommendationScore），系列作品作为种子参与多样性抑制
    const normalCandidates = all.filter((c) => !c.sameSeries)
    const normalTopN = Math.max(0, topN - seriesSelected.length)
    const normalSelected = mmrRank(normalCandidates, lambda, normalTopN, simBetween, 2, 100, seriesSelected)

    // 3) 合并：系列永远在前，普通候选保持 MMR 顺序（方案 §92）
    ranked.set(f.rj, [...seriesSelected, ...normalSelected])
  }

  // ---- 写回推荐模块自己的表（单事务，全量重建） ----
  let rows = 0
  transaction(db, () => {
    db.prepare('DELETE FROM work_recommendations').run()

    const insRec = db.prepare(
      `INSERT INTO work_recommendations
       (rj_code, related_rj_code, voice_score, tag_score, title_score, circle_score, content_score, quality_score, final_score, rank_position, algorithm_version, calculated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const f of list) {
      const recs = ranked.get(f.rj)!
      recs.forEach((r, idx) => {
        insRec.run(f.rj, r.related, r.voice, r.tag, r.title, r.circle, r.similarity, r.quality, r.final, idx, RECOMMENDATION_VERSION, now)
        rows++
      })
    }

    const upsertState = db.prepare(
      `INSERT INTO recommendation_work_state (rj_code, calculated_at, algorithm_version, status)
       VALUES (?, ?, ?, 'COMPLETED')
       ON CONFLICT(rj_code) DO UPDATE SET calculated_at = excluded.calculated_at, algorithm_version = excluded.algorithm_version, status = excluded.status`
    )
    for (const f of list) upsertState.run(f.rj, now, RECOMMENDATION_VERSION)

    const upsertTag = db.prepare(
      `INSERT INTO recommendation_tag_stats (tag_id, work_count, idf_score, calculated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(tag_id) DO UPDATE SET work_count = excluded.work_count, idf_score = excluded.idf_score, calculated_at = excluded.calculated_at`
    )
    for (const [tid, df] of tagDf) upsertTag.run(tid, df, tagIdf.get(tid) ?? 0, now)
  })

  console.log(`[recommendation] 已计算 ${n} 个作品的推荐关系（${rows} 行，${RECOMMENDATION_VERSION}）`)
  return { works: n, rows, errors }
}
