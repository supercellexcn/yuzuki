# Yuzuki · ASMR 播放器

单机自用 ASMR 媒体库：扫描本地目录 → SQLite 入库 → 浏览器播放。前后端分离，Docker 部署。

## 技术栈
- 后端：Express 4 + Node 内置 `node:sqlite`（DatabaseSync）+ TypeScript，开发用 `tsx watch`
- 前端：Vue 3 `<script setup>` + Vite + Pinia + Element Plus + axios
- 数据：`DATA_DIR/yuzuki.db`；封面缓存、默认封面、壁纸也都在 `DATA_DIR`

## 目录速查
后端 `backend/src/`：
- `index.ts` 入口与路由挂载；`config.ts` 环境变量；`auth.ts` 登录/JWT/中间件
- `db/connection.ts` 建表与 migration
- `routes/*.ts` 每个资源一个路由文件（works/admin/settings/scan/media/cover/...）
- `services/workService.ts` 作品查询与详情拼装（作品可见性过滤在这里）
- `services/hidden.ts` 级联隐藏逻辑
- `settings.ts` 设置读写与默认值
- `scanner/` 目录扫描 + 后台任务（jobManager）
- `recommendation/` 推荐算法；`dlsite/` 元数据抓取

前端 `frontend/src/`：
- `App.vue` 外壳/顶栏/侧栏/全局布局（大文件）
- `router/index.ts` 路由与登录守卫
- `api/index.ts` 全部接口封装；`api/types.ts` 接口类型
- `stores/` pinia：auth / library / player / favorites / settings
- `views/` 页面：LibraryView（首页）、PlayerView（播放页）、SettingsView（设置，最大文件）、admin/*
- `components/` 通用组件：WorkCard、BottomPlayer、FullscreenPlayer、AppSidebar、MobileDock 等
- `composables/` 复用逻辑；`directives/longpress.ts` 长按

## 常用命令
- 后端开发：`cd backend && npm run dev`（3000）
- 前端开发：`cd frontend && npm run dev`（5173，/api 代理到 3000）
- 类型检查：`cd backend && npx tsc --noEmit`；`cd frontend && npx vue-tsc --noEmit`
- 前端构建：`cd frontend && npm run build`

## 约定
- 面向用户的文案、注释、提交信息都用中文
- 提交信息格式：`fix: ...` / `feat: ...` / `refactor: ...`
- **每次改动完成后立即本地 commit**，不攒着
- 作品可见性/隐藏相关查询必须带 `hiddenWorkExpr`（见 `services/hidden.ts`）

## 全局约束（优先级最高）
1. **先方案后动手**：任何修改前先给出明确方案（改哪些文件、怎么改、影响范围），确认后再改；禁止边猜边改、反复试错。
2. **禁止全库扫描**：优先查阅本文件的目录速查与 `README.md`；已知位置直接 Read/Grep 精确片段，不做全仓库遍历、不派探索型子代理。
3. **只用断言验证**：验证靠 typecheck / 断言 / 接口返回码等确定性检查；禁止截图、识图、启动浏览器逐屏确认。

## 省 Token 工作规范（每次任务都遵守）
1. **先定位后读取**：用 Grep 拿行号，再用 Read 的 `offset`/`limit` 只读相关片段。
2. **大文件禁止整读**（>300 行）：`SettingsView.vue` 按 `<div class="card-title">` 小节定位；`App.vue` / `FullscreenPlayer.vue` / `PlayerView.vue` 先找 template/script/style 边界再分段读。
3. **永不读取**：`node_modules/`、`dist/`、`package-lock.json`、`yuzuki.zip`、`LICENSE`、图片/二进制。
4. **Edit 之后不重读文件**；不要为了"确认"再 Read 一遍。
5. **不主动构建**：小改动不跑 build/typecheck；需要验证时只跑对应 typecheck，且只截取报错行。
6. **最小改动**：只改需求相关行，不顺手重构、不重排格式、不改无关代码。
7. **一次做完**：同一轮里把所有相关 Edit 合并执行，减少往返。
8. **回复精简**：中文、结论先行；不贴大段代码、不复述工具完整输出、不写"总结/回顾"。
9. **独立需求开新会话**：不同需求之间 `/clear`，避免历史上下文反复计费。
