import { DatabaseSync } from 'node:sqlite'
import { getConfig } from '../config.js'
import { RECOMMENDATION_VERSION } from '../recommendation/similarity.js'
import { ALL_AGES_TAG, CUSTOM_TAG } from '../services/hidden.js'

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
  price INTEGER,
  rating REAL,
  rating_count INTEGER,
  cover_path TEXT NOT NULL DEFAULT '',
  folder_path TEXT NOT NULL DEFAULT '',
  source_path TEXT NOT NULL DEFAULT '',
  file_count INTEGER NOT NULL DEFAULT 0,
  /**
   * 上次抓取时 DLsite 侧的返回状态，决定「这个作品该去哪找信息」：
   * ''（未抓过 / 旧数据）| ok（正常返回作品页）| region_blocked（所在区域不卖，
   * 换线路可补）| not_found（作品不存在或已下架）| error（网络等异常）
   */
  fetch_status TEXT NOT NULL DEFAULT '',
  /** 当前封面文件来自哪里：'' | dlsite | hvdb —— 用于让 DLsite 封面覆盖早前兜底写入的封面 */
  cover_source TEXT NOT NULL DEFAULT '',
  /**
   * 声优字段是否已被权威数据源确认过（api2 返回过 creaters / 作品页信息区解析成功）。
   * 1 = 已确认：此时「声优为空」表示该作品确实没有声优（CG 集、漫画等），不算缺失；
   * 0 = 未确认：老数据或没抓到声优，下次扫描需要补抓。
   */
  actors_confirmed INTEGER NOT NULL DEFAULT 0,
  /**
   * 类型标签是否已被权威数据源确认过（api2 返回过 genres / genres_replaced 字段，
   * 或作品页信息区解析成功）。1 = 已确认：此时「没有原生标签」表示该作品确实没有分类
   * （只有「作品形式」没有「分類」的作品，如全年龄 ASMR 企划），不算缺失。
   */
  tags_confirmed INTEGER NOT NULL DEFAULT 0,
  /** 上次扫描的处置结果：'' | 跳过 | 已处理 | 禁售 | 下架 | 失败 —— 便于判断该去哪找信息 */
  last_scan_result TEXT NOT NULL DEFAULT '',
  /** 上次扫描处置的时间（ISO 字符串，空表示还没被扫描处理过） */
  last_scan_at TEXT NOT NULL DEFAULT '',
  /**
   * 文件夹目录树的签名（各子目录 mtimeMs 的哈希）。签名没变说明文件夹结构没动过，
   * 扫描时连 readdir + stat 都跳过 —— 媒体库几万部作品时这能省掉每轮几十万次 IO。
   */
  folder_sig TEXT NOT NULL DEFAULT '',
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

-- 同一作品其它语言版本：DLsite 的翻译版是独立 RJ 号，这里记录 RJ 与语言，
-- 供后续「按任意语言版本 RJ 搜索到该作品」等功能使用。
CREATE TABLE IF NOT EXISTS work_translations (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  rj_code TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT '',
  language_label TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (work_id, rj_code)
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
  duration_seconds INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS idx_work_translations_rj ON work_translations(rj_code);
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

-- 推荐模块的元信息（如「输入指纹」）：作品数据没变时跳过整次计算
CREATE TABLE IF NOT EXISTS recommendation_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
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
  // 内置「全年龄」标签：每次启动确保存在（标签管理里不允许删除，见 routes/admin.ts）
  d.prepare('INSERT OR IGNORE INTO tags (name, category) VALUES (?, ?)').run(ALL_AGES_TAG, CUSTOM_TAG)

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

  // works 动态数据列：price / rating / rating_count 用 NULL 表示「没抓到」，
  // 与 0（确实免费 / 无评分 / 无评论）区分开 —— 「信息是否完整」的判定依赖这一点。
  if (!w.some((c) => c.name === 'price')) {
    d.exec('ALTER TABLE works ADD COLUMN price INTEGER')
  }
  if (!w.some((c) => c.name === 'rating')) {
    d.exec('ALTER TABLE works ADD COLUMN rating REAL')
  }
  if (!w.some((c) => c.name === 'rating_count')) {
    d.exec('ALTER TABLE works ADD COLUMN rating_count INTEGER')
  }
  // DL 状态与封面来源：老库升级后 fetch_status 为空（未知），下次扫描按缺失项正常判定
  if (!w.some((c) => c.name === 'fetch_status')) {
    d.exec("ALTER TABLE works ADD COLUMN fetch_status TEXT NOT NULL DEFAULT ''")
  }
  if (!w.some((c) => c.name === 'cover_source')) {
    d.exec("ALTER TABLE works ADD COLUMN cover_source TEXT NOT NULL DEFAULT ''")
  }
  // 声优是否已被权威数据源确认：老库为 0，下次扫描会把「声优为空」的作品重抓一次，
  // 抓完（api2 的 creaters 或作品页信息区）置 1，从此「空」即代表该作品真的没有声优。
  if (!w.some((c) => c.name === 'actors_confirmed')) {
    d.exec('ALTER TABLE works ADD COLUMN actors_confirmed INTEGER NOT NULL DEFAULT 0')
  }
  // 标签是否已被权威数据源确认：有些作品（全年龄 ASMR 企划、素材集）在 DLsite 上
  // 只有「作品形式」没有「分類」，确认过之后就不再每轮重抓。
  if (!w.some((c) => c.name === 'tags_confirmed')) {
    d.exec('ALTER TABLE works ADD COLUMN tags_confirmed INTEGER NOT NULL DEFAULT 0')
  }
  // 上次扫描处置结果 / 时间：老数据留空，下一轮扫描会全部写一遍
  if (!w.some((c) => c.name === 'last_scan_result')) {
    d.exec("ALTER TABLE works ADD COLUMN last_scan_result TEXT NOT NULL DEFAULT ''")
  }
  if (!w.some((c) => c.name === 'last_scan_at')) {
    d.exec("ALTER TABLE works ADD COLUMN last_scan_at TEXT NOT NULL DEFAULT ''")
  }
  // 目录树签名：老数据为空 → 下一轮扫描各自计算一次并写入，此后目录没动就跳过文件遍历
  if (!w.some((c) => c.name === 'folder_sig')) {
    d.exec("ALTER TABLE works ADD COLUMN folder_sig TEXT NOT NULL DEFAULT ''")
  }

  // play_history.rj_code：以 RJ 号作为稳定关联键，作品被删后重新入库时能接回历史
  const ph = d.prepare('PRAGMA table_info(play_history)').all() as unknown as Array<{ name: string }>
  if (!ph.some((c) => c.name === 'rj_code')) {
    d.exec("ALTER TABLE play_history ADD COLUMN rj_code TEXT NOT NULL DEFAULT ''")
  }
  // play_history.duration_seconds：该次播放实际听了多少秒，历史查询时按作品汇总
  if (!ph.some((c) => c.name === 'duration_seconds')) {
    d.exec('ALTER TABLE play_history ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0')
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

  // 已废弃的设置项：旧的各表面模糊 key（现由新的 panel_blur / tag_blur 统一控制，
  // 旧 key 不再读取）。
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
