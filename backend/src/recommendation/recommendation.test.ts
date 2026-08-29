/**
 * 推荐算法单元 / 集成测试（对齐方案文档 §68-74）。
 * 运行：npx tsx src/recommendation/recommendation.test.ts
 *
 * 覆盖：
 * - 自身作品绝不进入推荐（§68 / §74）
 * - 空系列永不误判为同系列（§71）
 * - 系列名标准化后相等才算同系列（§72）
 * - 系列不做模糊匹配（§73）
 * - 同系列优先于更高相似度的非系列作品（§69）
 * - 同系列最多 3 部，超出的被过滤（§70）
 * - 同系列允许绕过 MIN_SIMILARITY（§52-54）
 */
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isSameSeries } from './similarity.js'
import { generateCandidates, type WorkFeature } from './candidate.js'
import { mmrRank, type RankedCandidate } from './similarity.js'

let passed = 0
function test(name: string, fn: () => void): void {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  }
}

function mkCandidate(related: string, final: number, series: string, sameSeries = false): RankedCandidate {
  return { related, series, sameSeries, final, similarity: final, quality: 0.5, voice: 0, tag: 0, title: 0, circle: 0 }
}

// ================= 纯函数测试 =================

test('空系列永不匹配（§71）', () => {
  assert.equal(isSameSeries({ series: '' }, { series: '' }), false)
  assert.equal(isSameSeries({ series: '' }, { series: 'S' }), false)
  assert.equal(isSameSeries({ series: 'S' }, { series: '' }), false)
})

test('系列名标准化后相等才算同系列（§72）', () => {
  assert.equal(isSameSeries({ series: '魔法少女シリーズ' }, { series: ' 魔法少女シリーズ ' }), true)
  assert.equal(isSameSeries({ series: 'ＡＢＣ' }, { series: 'ABC' }), true) // NFKC 全角→半角
})

test('系列不做模糊匹配（§73）', () => {
  assert.equal(isSameSeries({ series: '耳かきシリーズ' }, { series: '耳かき専門シリーズ' }), false)
})

test('MMR：种子系列不参与池选，但抑制过相似的普通候选', () => {
  const sim = (x: RankedCandidate, y: RankedCandidate): number => {
    const [p, q] = [x.related, y.related].sort()
    const m: Record<string, number> = { 'A|B': 0.95, 'A|S1': 0.9, 'B|S1': 0.2, 'A|C': 0.1, 'B|C': 0.1, 'C|S1': 0 }
    return m[`${p}|${q}`] ?? 0
  }
  const seed = mkCandidate('S1', 1, 'SS', true)
  const pool = [mkCandidate('A', 0.9, ''), mkCandidate('B', 0.88, ''), mkCandidate('C', 0.5, '')]
  const out = mmrRank(pool, 0.8, 3, sim, 2, 100, [seed])
  // A 与已选系列 S1 相似 0.9 → 被抑制，B 应排第一
  assert.equal(out[0].related, 'B')
})

test('候选召回：自身被排除 + 同系列进入候选', () => {
  const wf = (rj: string, series: string, tagIds: number[], grams: string[]): WorkFeature => ({
    rj,
    title: grams.join(''),
    circle: '',
    series,
    actors: new Set(),
    tags: new Set(tagIds),
    titleNgrams: new Map(grams.map((g) => [g, 1])),
    sales: 0,
    play: 0,
  })
  const list = [wf('A1', 'S', [1], ['ab', 'bc']), wf('A2', 'S', [1], ['ab']), wf('B', 'T', [2], ['xy'])]
  const sets = generateCandidates(list, 100)
  const a1 = sets.get('A1')!
  assert.ok(!a1.has('A1'), '自身必须排除')
  assert.ok(a1.has('A2'), '同系列应进入候选')
  assert.ok(!a1.has('B'), '无共同特征不进入候选')
})

// ================= 集成测试（临时数据库跑一次计算） =================

async function integrationTest(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yuzuki-rec-'))
  process.env.DATA_DIR = tmp
  const { getDb, closeDb } = await import('../db/connection.js')
  const { calculateRecommendations } = await import('./calculator.js')
  const db = getDb()

  const insW = db.prepare('INSERT INTO works (rj_code, title, circle, series, sales_count) VALUES (?,?,?,?,?)')
  const insActor = db.prepare('INSERT OR IGNORE INTO actors (name) VALUES (?)')
  const insTag = db.prepare('INSERT OR IGNORE INTO tags (name, category) VALUES (?, ?)')
  const insWA = db.prepare('INSERT OR IGNORE INTO work_actors (work_id, actor_id) VALUES (?,?)')
  const insWT = db.prepare('INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?,?)')

  const wid = (rj: string): number => (db.prepare('SELECT id FROM works WHERE rj_code=?').get(rj) as { id: number }).id
  const aid = (name: string): number => (db.prepare('SELECT id FROM actors WHERE name=?').get(name) as { id: number }).id
  const tid = (name: string): number => (db.prepare('SELECT id FROM tags WHERE name=?').get(name) as { id: number }).id
  const addTags = (rj: string, names: string[]): void => {
    for (const n of names) {
      insTag.run(n, 'テスト')
      insWT.run(wid(rj), tid(n))
    }
  }

  // A1~A5 同一系列 S；B 不同系列 T 但内容与 A1 高度相似；C 无系列
  insW.run('A1', 'アルファ アルファ', '', 'S', 1000)
  insW.run('A2', 'アルファ', '', 'S', 500)
  insW.run('A3', 'アルファ ベータ', '', 'S', 400)
  insW.run('A4', 'ゼット', '', 'S', 300)
  insW.run('A5', 'エックス', '', 'S', 200)
  insW.run('B', 'アルファ アルファ アルファ', '', 'T', 9000)
  insW.run('C', 'オザワ', '', '', 100)
  addTags('A1', ['t1', 't2'])
  addTags('A2', ['t1'])
  addTags('A3', ['t2'])
  addTags('B', ['t1', 't2', 't3'])
  addTags('A4', ['t9'])
  addTags('A5', ['t10'])
  addTags('C', ['t8'])

  await calculateRecommendations()

  const all = (sql: string, ...p: Array<string | number | null>): unknown[] =>
    db.prepare(sql).all(...p) as unknown[]
  const get = (sql: string, ...p: Array<string | number | null>): Record<string, unknown> =>
    db.prepare(sql).get(...p) as Record<string, unknown>

  test('整库：没有任何作品推荐自身（§68 / §74）', () => {
    const c = (get('SELECT COUNT(*) AS c FROM work_recommendations WHERE rj_code = related_rj_code').c as number)
    assert.equal(c, 0)
  })

  test('A1：同系列 A2/A3/A4 全部进入，第4个同系列 A5 被过滤（§70）', () => {
    const recs = all('SELECT related_rj_code FROM work_recommendations WHERE rj_code=?', 'A1') as Array<{ related_rj_code: string }>
    const rjs = recs.map((r) => r.related_rj_code)
    for (const x of ['A2', 'A3', 'A4']) assert.ok(rjs.includes(x), `${x} 应被推荐`)
    assert.ok(!rjs.includes('A5'), '系列上限 3，A5 不应出现')
  })

  test('A1：同系列排在更高相似度的 B 之前（§69 / §61）', () => {
    const recs = all('SELECT related_rj_code, rank_position, content_score FROM work_recommendations WHERE rj_code=?', 'A1') as Array<{
      related_rj_code: string
      rank_position: number
      content_score: number
    }>
    const pos = (rj: string): number => recs.find((r) => r.related_rj_code === rj)!.rank_position
    const simB = recs.find((r) => r.related_rj_code === 'B')!.content_score
    const simA2 = recs.find((r) => r.related_rj_code === 'A2')!.content_score
    assert.ok(simB > simA2, `B 的相似度(${simB})应高于 A2(${simA2})，才能验证系列优先`)
    assert.ok(pos('A2') < pos('B'), 'A2 应排在 B 前')
    assert.ok(pos('A3') < pos('B'), 'A3 应排在 B 前')
    assert.ok(pos('A4') < pos('B'), 'A4（绕过阈值）也应排在 B 前')
  })

  test('A1：同系列低相似度（A4≈0）绕过 MIN_SIMILARITY（§52-54）', () => {
    const r = get('SELECT content_score FROM work_recommendations WHERE rj_code=? AND related_rj_code=?', 'A1', 'A4') as {
      content_score: number
    }
    assert.ok(r, 'A4 应被推荐')
    assert.ok(r.content_score < 0.2, `A4 相似度 ${r.content_score} 应低于 0.20 仍被保留`)
  })

  closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
}

// ================= 入口 =================

void (async () => {
  console.log('纯函数测试：')
  try {
    await integrationTest()
    console.log(`\n全部通过（${passed} 项）`)
  } catch (e) {
    console.error('\n测试失败')
    process.exitCode = 1
  }
})()
