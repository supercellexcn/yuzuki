import type { DatabaseSync } from 'node:sqlite'

/** 自定义标签的统一 category 值（与 DLsite/hvdb 打上的原生标签区分）。 */
export const CUSTOM_TAG = 'custom'

// 内部子查询别名统一加 h 前缀，避免与调用方外层查询的同名表别名（如 t/wt）冲突。
/**
 * 「作品未被隐藏」的 WHERE 片段。隐藏是级联的：作品自身被隐藏，或它的
 * 社团/系列/任一 声优/任一 标签 被隐藏，都视为隐藏。alias 是 works 表的别名。
 */
export function hiddenWorkExpr(alias = 'w'): string {
  return `(
    NOT EXISTS (SELECT 1 FROM hidden_items hhi WHERE hhi.type = 'work' AND hhi.value = ${alias}.rj_code)
    AND NOT EXISTS (SELECT 1 FROM hidden_items hhi WHERE hhi.type = 'circle' AND hhi.value = ${alias}.circle AND ${alias}.circle != '')
    AND NOT EXISTS (SELECT 1 FROM hidden_items hhi WHERE hhi.type = 'series' AND hhi.value = ${alias}.series AND ${alias}.series != '')
    AND NOT EXISTS (
      SELECT 1 FROM work_actors hwa
      JOIN actors ha ON ha.id = hwa.actor_id
      JOIN hidden_items hhi ON hhi.type = 'actor' AND hhi.value = ha.name
      WHERE hwa.work_id = ${alias}.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM work_tags hwt
      JOIN tags ht ON ht.id = hwt.tag_id
      JOIN hidden_items hhi ON hhi.type = 'tag' AND hhi.value = ht.name AND hhi.extra = ht.category
      WHERE hwt.work_id = ${alias}.id
    )
  )`
}

/** 判断单个作品（按 rj_code）当前是否处于隐藏状态。 */
export function isWorkHidden(db: DatabaseSync, rj: string): boolean {
  const row = db.prepare('SELECT id FROM works WHERE rj_code = ?').get(rj) as { id: number } | undefined
  if (!row) return false
  const r = db
    .prepare(`SELECT ${hiddenWorkExpr('w')} AS ok FROM works w WHERE w.id = ?`)
    .get(row.id) as { ok: number }
  return !r.ok
}

/** 在 works 查询行上附加 hidden 字段的 SELECT 片段（供管理端展示隐藏状态）。 */
export function hiddenWorkFlag(alias = 'w'): string {
  return `EXISTS (SELECT 1 FROM hidden_items hhi WHERE hhi.type = 'work' AND hhi.value = ${alias}.rj_code) AS hidden`
}
