import { DatabaseSync } from 'node:sqlite'
import { getConfig } from '../config.js'
import { RECOMMENDATION_VERSION } from '../recommendation/similarity.js'

let db: DatabaseSync | null = null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rj_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  circle TEXT NOT NULL DEFAULT '',
  release_date TEXT NOT NULL DEFAULT '',
  series TEXT NOT NULL DEFAULT '',
  sales_count INTEGER,
  cover_path TEXT NOT NULL DEFAULT '',
  folder_path TEXT NOT NULL DEFAULT '',
  source_path TEXT NOT NULL DEFAULT '',
  file_count INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS actors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  UNIQUE(name, category)
);

CREATE TABLE IF NOT EXISTS work_actors (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  PRIMARY KEY (work_id, actor_id)
);

CREATE TABLE IF NOT EXISTS work_tags (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (work_id, tag_id)
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  ext TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'other',
  is_dir INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  work_id INTEGER NOT NULL,
  rj_code TEXT NOT NULL DEFAULT '',
  file_id INTEGER,
  played_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS play_counts (
  user_id INTEGER NOT NULL,
  work_id INTEGER NOT NULL,
  rj_code TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, work_id)
);

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id INTEGER PRIMARY KEY,
  prefs TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  extra TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, type, value)
);

-- 管理功能：隐藏的作品/系列/社团/声优/标签（value 存名称，work 存 rj_code；extra 存标签 category）
CREATE TABLE IF NOT EXISTS hidden_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  extra TEXT NOT NULL DEFAULT '',
  UNIQUE(type, value, extra)
);

CREATE INDEX IF NOT EXISTS idx_hidden_type_value ON hidden_items(type, value);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_work ON files(work_id);
CREATE INDEX IF NOT EXISTS idx_work_actors_work ON work_actors(work_id);
CREATE INDEX IF NOT EXISTS idx_work_tags_work ON work_tags(work_id);
CREATE INDEX IF NOT EXISTS idx_play_history_user ON play_history(user_id, played_at DESC);

-- 推荐模块独立表（只读现有作品数据，不改动作品/标签/声优等原表）
-- 以 rj_code 为稳定关联键：作品删除后重新入库时，推荐关系也能自动接回
CREATE TABLE IF NOT EXISTS work_recommendations (
  rj_code TEXT NOT NULL,
  related_rj_code TEXT NOT NULL,
  voice_score REAL NOT NULL DEFAULT 0,
  tag_score REAL NOT NULL DEFAULT 0,
  title_score REAL NOT NULL DEFAULT 0,
  circle_score REAL NOT NULL DEFAULT 0,
  content_score REAL NOT NULL DEFAULT 0,
  quality_score REAL NOT NULL DEFAULT 0,
  final_score REAL NOT NULL DEFAULT 0,
  rank_position INTEGER NOT NULL DEFAULT 0,
  algorithm_version TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (rj_code, related_rj_code)
);
CREATE INDEX IF NOT EXISTS idx_rec_work_rank ON work_recommendations(rj_code, rank_position);
CREATE INDEX IF NOT EXISTS idx_rec_related ON work_recommendations(related_rj_code);

CREATE TABLE IF NOT EXISTS recommendation_work_state (
  rj_code TEXT PRIMARY KEY,
  calculated_at TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETED'
);

CREATE TABLE IF NOT EXISTS recommendation_tag_stats (
  tag_id INTEGER PRIMARY KEY,
  work_count INTEGER NOT NULL,
  idf_score REAL NOT NULL,
  calculated_at TEXT NOT NULL
);
`

const DEFAULTS: Array<[string, unknown]> = [
  ['source_paths', []],
  ['scan_depth', 2],
  ['proxy', ''],
  ['dlsite_base', 'https://www.dlsite.com'],
  ['dlsite_path', '/maniax/work/=/product_id/{rj}.html'],
  ['dlsite_locale', 'zh-cn'],
  ['hvdb_base', 'https://hvdb.me'],
]

function migrate(d: DatabaseSync): void {
  const cols = d.prepare('PRAGMA table_info(files)').all() as unknown as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'is_dir')) {
    d.exec('ALTER TABLE files ADD COLUMN is_dir INTEGER NOT NULL DEFAULT 0')
  }

  // works 管理功能列：cover_modified 标记封面是否被手动改过（决定「还原封面」入口），
  // original_cover_path 保存手动改封面前的原始封面，供还原时指回（不联网）。
  const w = d.prepare('PRAGMA table_info(works)').all() as unknown as Array<{ name: string }>
  if (!w.some((c) => c.name === 'cover_modified')) {
    d.exec('ALTER TABLE works ADD COLUMN cover_modified INTEGER NOT NULL DEFAULT 0')
  }
  if (!w.some((c) => c.name === 'original_cover_path')) {
    d.exec("ALTER TABLE works ADD COLUMN original_cover_path TEXT NOT NULL DEFAULT ''")
  }

  // play_history.rj_code：以 RJ 号作为稳定关联键，作品被删后重新入库时能接回历史
  const ph = d.prepare('PRAGMA table_info(play_history)').all() as unknown as Array<{ name: string }>
  if (!ph.some((c) => c.name === 'rj_code')) {
    d.exec("ALTER TABLE play_history ADD COLUMN rj_code TEXT NOT NULL DEFAULT ''")
  }
  d.exec(
    "UPDATE play_history SET rj_code = COALESCE((SELECT rj_code FROM works WHERE works.id = play_history.work_id), '') WHERE rj_code = ''"
  )
  d.exec("DELETE FROM play_history WHERE rj_code = ''")

  // play_counts.rj_code：同理，保证播放计数在作品回归后累加
  const pc = d.prepare('PRAGMA table_info(play_counts)').all() as unknown as Array<{ name: string }>
  if (!pc.some((c) => c.name === 'rj_code')) {
    d.exec("ALTER TABLE play_counts ADD COLUMN rj_code TEXT NOT NULL DEFAULT ''")
  }
  d.exec(
    "UPDATE play_counts SET rj_code = COALESCE((SELECT rj_code FROM works WHERE works.id = play_counts.work_id), '') WHERE rj_code = ''"
  )
  d.exec("DELETE FROM play_counts WHERE rj_code = ''")

  // 已废弃的设置项：作品卡片下半部分颜色（现由统一主题色 theme_color_nav 决定）
  d.exec("DELETE FROM settings WHERE key = 'theme_color_card'")

  // 已废弃的设置项：各表面的模糊（现只保留「壁纸模糊」，其余表面改为控制不透明度）。
  // 必须真删掉：getSettings() 会把 settings 表里的每一行都并进对象，
  // 残留的旧 key 会在下次保存设置时被原样写回去。
  d.exec(
    "DELETE FROM settings WHERE key IN ('card_blur', 'filelist_blur', 'control_blur', 'tag_opacity')"
  )

  // 推荐算法 v2.0：检测到旧版本推荐数据（v1.x）时，清空推荐结果并重置推荐配置。
  // 只触发一次——下次计算写入的 algorithm_version 就是 v2.0，之后启动不再进入。
  const staleRec = (
    d.prepare('SELECT COUNT(*) AS c FROM work_recommendations WHERE algorithm_version != ?').get(RECOMMENDATION_VERSION) as {
      c: number
    }
  ).c
  if (staleRec > 0) {
    d.exec('DELETE FROM work_recommendations')
    d.exec('DELETE FROM recommendation_work_state')
    d.exec('DELETE FROM recommendation_tag_stats')
    const recDefaults: Array<[string, unknown]> = [
      ['recommendation_weight_voice', 0.25],
      ['recommendation_weight_tag', 0.45],
      ['recommendation_weight_title', 0.2],
      ['recommendation_weight_circle', 0.1],
      ['recommendation_min_score', 0.2],
      ['recommendation_candidate_limit', 1000],
      ['recommendation_core_tag_weight', 0.3],
      ['recommendation_core_tag_count', 5],
      ['recommendation_quality_impact', 0.05],
      ['recommendation_series_priority_enabled', true],
      ['recommendation_series_max_count', 3],
      ['recommendation_series_bypass_min_score', true],
    ]
    const reset = d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    for (const [k, v] of recDefaults) reset.run(k, JSON.stringify(v))
    console.log('[recommendation] 检测到旧版本推荐数据，已重置（v2.0）')
  }
}

export function getDb(): DatabaseSync {
  if (db) return db
  const { dbPath } = getConfig()
  db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)
  migrate(db)
  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
  for (const [k, v] of DEFAULTS) stmt.run(k, JSON.stringify(v))
  return db
}

/** 用 BEGIN/COMMIT/ROLLBACK 包装一个同步事务（node:sqlite 无内建 transaction 助手）。 */
export function transaction<T>(d: DatabaseSync, fn: () => T): T {
  d.exec('BEGIN')
  try {
    const result = fn()
    d.exec('COMMIT')
    return result
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
