# Yuzuki · ASMR 播放器

自托管的 DLsite ASMR 音声作品管理 / 播放器。扫描本地以 `RJ010xxxx-...` 命名的作品文件夹，自动从 DLsite/HVDB 抓取元数据（标题、声优、销量、类型标签、发售日、社团、系列、封面），提供封面网格浏览、搜索筛选、收藏、播放历史与在线播放。桌面端与手机浏览器共用同一套界面。

## 目录

- [功能](#功能)
  - [账号与登录](#账号与登录)
  - [媒体库](#媒体库)
  - [播放](#播放)
  - [收藏](#收藏)
  - [播放历史](#播放历史)
  - [外观](#外观)
  - [管理后台](#管理后台)
  - [设置](#设置)
- [技术栈](#技术栈)
- [本地开发](#本地开发)
- [Docker 部署](#docker-部署)
- [配置项](#配置项)
- [上传体积上限](#上传体积上限)
- [API 摘要](#api-摘要)
- [已知限制](#已知限制)
- [最近更新](#最近更新)

## 功能

### 账号与登录

- 所有 `/api/*`（登录接口除外）都需要登录；未登录时前端自动跳转登录页。
- 默认账户 `admin` / 初始密码 `123456`，**首次登录强制修改密码**；登录后可在侧栏用户菜单再次改密。
- 管理后台仅桌面端提供：移动端访问 `/admin` 会被路由守卫直接送回媒体库。

### 媒体库

- **左侧边栏**：站点图标 / 站名、全部社团 / 系列 / 声优 / 标签（带作品数，点击加入筛选）、我的收藏、最近播放、用户菜单、管理功能、设置；可收起为图标栏，移动端为抽屉。
- **顶栏**：搜索与排序是两个独立胶囊。搜索匹配 RJ / 标题 / 声优 / 类型标签；排序支持入库时间 / 发售日 / 销量，右侧图标切换升序 / 降序。搜索框占位符直接显示当前作品数（随机模式显示随机推荐数）。
- **快捷按钮**：桌面端顶栏为 R（随机推荐）/ M（图片模式）/ T（回到顶部）三个圆形按钮；移动端改为可拖动的悬浮按钮组（首页 / T / M / R），松手吸附到最近一侧并记住位置。
- **封面网格**：类型标签叠加在封面上；信息区显示系列、社团、销量、播放次数、声优。点击卡片进入播放页。
- **筛选**：最多叠加 5 个条件，条件类型可重复（如声优 1 + 声优 2），全部 AND 匹配；「随机」沿用当前筛选条件。
- **加载**：向下滚动自动加载下一页；大屏第一页不足以产生滚动条时会自动补加载，直到页面可滚动或数据取完。
- **界面记忆**：每个用户记住筛选条件与排序，登录后还原；同一会话内从播放页返回媒体库时恢复滚动位置。

### 播放

- 播放页展示封面 + 文件列表：点图片打开查看器，点音频播放，点视频**只播放声音**。
- **文件列表**按目录树展示，默认全部折叠，使用线性图标，展开 / 收起有动画（时长跟随全局「动画时长」设置）。
- **底部常驻播放条**：封面、标题、上一曲 / 下一曲、快进 / 快退（秒数可配置）、单曲循环、音量；点封面跳回当前播放来源。
- **移动端**：迷你条右上角切换播放 / 暂停；点开为全屏播放器，支持按住下滑退出，播放列表只含当前文件同目录的可播放文件。全屏壁纸上覆盖整屏蒙版，其不透明度 / 模糊跟随「面板透明度 / 面板模糊」设置。
- **Media Session**：锁屏 / 通知栏显示封面、文件名、声优，支持线控 / 蓝牙按键的播放暂停、切歌、快进快退，并同步进度。
- **图片查看器**：左右切换（按钮或方向键）限定在同一目录；可设为封面 / 桌面壁纸 / 移动壁纸。长按图片会在按下的位置就地弹出同样的动作菜单。
- **相关推荐**：文件列表下方横向展示完整作品卡片（不显示推荐理由），可在设置中关闭。

### 收藏

- 四类收藏：作品 / 标签 / 社团 / 声优。
- 作品：封面左上角星标，点击收藏 / 取消。
- 详情页：标签、社团、声优后的 `+` / `−` 收藏或取消（社团为独立方形标签）。
- 「我的收藏」页按四个 Tab 展示；点击收藏的标签 / 社团 / 声优会回到媒体库并按该条件筛选。
- 收藏保存在服务端，多设备同步；长按收藏已移除（长按图片仍会弹出图片动作菜单）。

### 播放历史

- 开始播放即记录；同一作品相邻两次播放间隔 **小于 3 小时**视为同一次「连听」，合并成一条并标出本次连听的文件数，中间播了别的作品则断开。
- 记录每次实际播放时长；历史页支持**列表 / 卡片**两种视图（按设备记住选择）。卡片显示播放时间、本次时长、文件数；图片模式下历史卡片只保留一行时间与时长。
- 侧栏「最近播放」进入完整历史，分页加载；媒体库卡片显示作品累计播放次数。

### 外观

- 全局设置（所有用户 / 设备一致）；桌面端与移动端各一张壁纸，按视口宽度自动切换。壁纸可上传、删除、**停用（保留文件）**，存于 `<数据目录>/wallpapers`。
- **模糊**分三层独立可调（0-100）：壁纸本身；面板亚克力毛玻璃（作品卡片、导航栏、侧栏、用户菜单弹层、底部播放栏、设置卡片、管理页表格等大色块）；标签亚克力毛玻璃（详情页 / 收藏页 / 全屏播放器的声优与类型标签；作品卡片上的标签不参与）。此外 Element Plus 控件（输入框 / 下拉 / 按钮）用标签级轻模糊、弹出层（下拉列表 / 对话框 / 消息框 / 提示条）跟随面板模糊，形成全站液态玻璃质感。面板 / 标签的模糊与玻璃高光始终生效，无壁纸时模糊作用于面板后方滚动的内容。
- **透明度**：面板 / 文件列表 / 控件三档独立可调（0-100），始终生效；有壁纸时透出壁纸，没有壁纸时透出页面底色。
- **主题配色**：主题色统一驱动导航栏、hover 框线、播放条、面板底色；声优标签与类型标签独立配色且不透明度各自可调；标签文字统一白色；主题色过暗时按 WCAG 对比度沿原色相自动提亮。
- **卡片尺寸**：小 / 中 / 大 / 自定义宽度。
- **动画时长**：0-1 秒，全站过渡统一读取；0 即关闭动画。
- **图片模式**：隐藏卡片信息区，只保留封面 / RJ 角标 / 标签；销量以火焰徽标显示在卡片右上边框（≤1000 灰色 1 朵；1000-2999 黄色 1 朵；3000-5999 黄色 2 朵；6000-9999 黄色 3 朵；10000+ 红色 1 朵起、每 3000 加 1 朵最多 3 朵；≥19999 彩色大火 1 朵）。
- 站点图标由 canvas 绘制并声明深色，避免手机夜间模式反色。

### 管理后台

- 仅桌面端；五个 Tab：作品 / 系列 / 社团 / 声优 / 标签。
- **作品管理**：按 RJ / 标题、社团、系列、声优、标签、是否有封面筛选；表格显示封面、标签、隐藏状态。支持修改封面（从该作品文件里选图，可还原原始封面）、编辑自定义标签、重新同步（DLsite 优先，缺失时用 HVDB 补；封面同理）、隐藏 / 展示。
- **系列 / 社团 / 声优 / 标签**：可隐藏或展示；隐藏会级联到作品。
- 隐藏的作品不会出现在媒体库、搜索、随机推荐、播放历史、收藏的作品列表和相关推荐中。
- 管理端改名 / 隐藏 / 封面变更后，媒体库下次进入会自动刷新。

### 设置

- **自动保存**：鼠标离开控件后立即弹出 5 秒倒计时提示，到时保存生效（纯键盘操作停止修改 1.5 秒后兜底弹出）；点 × 取消本次修改并还原到上次保存状态。
- **壁纸相关设置立即生效**：壁纸模糊拖动即时预览，桌面 / 移动壁纸启停即时预览，且不弹保存提示；没有其他未保存修改时会静默自动保存。
- **系统设置**：源路径（可多条）、扫描层级深度、扫描并发数、每页加载数量、快进 / 快退秒数、DLsite 代理、DLsite URL 模板、封面存储目录、默认封面（无封面作品兜底）。
- **扫描**：立即扫描、进度（含每条线程的实时阶段）、暂停 / 继续、错误列表、已移除文件夹统计。
- **相关推荐**：开关、扫描完成后自动计算、立即计算与进度。
- **危险操作**：清空媒体库（删除作品元数据与封面缓存；播放历史与播放次数保留，重新扫描后自动接回；扫描进行中不允许清空）。

## 技术栈

- 前端：Vue 3 + Vite + TypeScript + Element Plus + Pinia + Vue Router
- 后端：Node.js 22+ + Express 4 + TypeScript，数据库为 Node 内置 `node:sqlite`（文件数据库）
- 部署：Docker Compose（前端 nginx + 后端 node）

## 本地开发

### 后端

```bash
cd backend
npm install
npm run dev        # http://localhost:3000
```

### 前端

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173，已代理 /api 到 3000
```

开发时后端数据目录默认在 `backend/data`。

常用检查：

```bash
cd backend && npx tsc --noEmit          # 后端类型检查
cd frontend && npx vue-tsc --noEmit     # 前端类型检查
cd frontend && npm run build            # 前端生产构建
```

## Docker 部署

前置：后端需要 Node 22+（`node:sqlite`），Dockerfile 已用 `node:22-alpine`。

1. **准备 `.env`**（复制 `.env.example`）：务必设置 `AUTH_SECRET`（随机字符串，用 `openssl rand -hex 32` 生成）；如需改前端端口可设 `FRONTEND_PORT`（默认 8080）。

2. **挂载 ASMR 源目录**：编辑 `docker-compose.yml`，把后端容器的源目录按 `宿主机路径:容器内路径:ro` 挂载（只读）：

   ```yaml
   backend:
     volumes:
       - ./backend/data:/data        # 数据卷，保留数据库与封面
       - "/你的ASMR目录:/asmr1:ro"     # ← 你的源目录，可加多条
   ```

   `./backend/data` 默认挂到容器 `/data`，本地开发积累的数据库可直接复用。

3. **构建并启动**：

   ```bash
   docker compose up --build -d
   ```

4. **访问与初始化**：打开 `http://<服务器IP>:8080`
   - 默认账户 `admin` / 密码 `123456`，首次登录会**强制修改密码**
   - 「设置」→ 添加源路径（填写**容器内**路径，即上面挂载的 `/asmr1` 等）→ 配置扫描深度、并发数、代理 → 保存并「立即扫描」
   - 若 DLsite 抓不到数据，多半是容器网络无法直连 DLsite，需在设置里配置代理（见上）。

### 更新部署

```bash
docker compose stop backend                              # 先停后端，让 SQLite 的 WAL 合并回主库
cp -a backend/data backend/data.bak-$(date +%Y%m%d)      # 备份（含 covers / wallpapers）
git pull                                                 # 或把改动同步上去
docker compose up -d --build                             # ← 必须带 --build
```

要点：

- **数据库不需要手动迁移**：新增的设置项在后端启动时自动补默认值，废弃项由启动时的迁移清理；数据库本身在 `./backend/data` 卷里，重建镜像不会动它。
- **必须带 `--build`**：`nginx.conf` / `Dockerfile` / `package.json` / `index.html` 这些是**构建时**文件，不在 `src/` 下。只同步 `src/` 或不加 `--build`，容器里跑的还是旧配置 —— 典型症状是「本地正常、NAS 上出现怪问题」（例如上传 413）。
- **别用 `docker compose down -v`**：`-v` 会连数据卷一起删。
- 用域名 / HTTPS 访问时，前面通常还有一层反向代理；**上传体积上限要在那一层也放开**（见上表）。

## 配置项

### 环境变量

| 变量 | 使用方 | 说明 |
| --- | --- | --- |
| `AUTH_SECRET` | 后端 | JWT 签名密钥，生产环境务必改为随机字符串 |
| `PORT` | 后端 | 后端监听端口，默认 `3000` |
| `DATA_DIR` | 后端 | 数据目录（SQLite / 封面 / 壁纸），默认 `./data`；Docker 中为 `/data` |
| `FRONTEND_PORT` | compose | 前端对外端口，默认 `8080` |

> `.env.example` 中的 `ASM_PATHS` / `SCAN_DEPTH` / `PROXY` 为旧版遗留，当前代码不再读取；源路径、扫描深度、代理请在「设置」页配置。

### 应用设置

设置保存在数据库，可在「设置」页修改。

| 项 | 说明 |
| --- | --- |
| `source_paths` | 源路径数组，每个都需在 compose 中挂载 |
| `scan_depth` | 扫描层级深度，默认 2；0 = 只查直接子目录 |
| `scan_concurrency` | 扫描并发数（默认 5），同时并发抓取 DLsite 的作品数量 |
| `page_size` | 媒体库每页加载数量（默认 20） |
| `seek_seconds` | 播放条快进 / 快退秒数（默认 15） |
| `proxy` | DLsite 抓取代理，如 `http://127.0.0.1:7890`；留空直连 |
| `dlsite_base` / `dlsite_path` | DLsite 页面 URL 模板（一般无需改） |
| `dlsite_locale` | DLsite 抓取语言，默认 `zh-cn` |
| `hvdb_base` | HVDB 站点地址，默认 `https://hvdb.me` |
| `cover_dir` | 封面缓存目录，留空则用默认 `backend/data/covers`（壁纸固定存 `<数据目录>/wallpapers`） |
| `recommendation_enabled` | 是否开启相关推荐 |
| `recommendation_auto_calc` | 扫描完成后自动重算推荐 |
| `recommendation_top_n` / `recommendation_api_limit` | 每个作品生成 / 接口返回的推荐数量 |
| `recommendation_weight_voice` / `_tag` / `_title` / `_circle` | 声优 / 标签 / 标题 / 社团相似度权重 |
| `recommendation_mmr_lambda` | MMR 多样性系数 |
| `recommendation_quality_sales_weight` / `_quality_impact` | 销量对质量分的权重与影响幅度 |
| `recommendation_min_score` / `_candidate_limit` | 最低推荐分 / 候选池大小 |
| `recommendation_core_tag_weight` / `_core_tag_count` | 核心标签加权与数量 |
| `recommendation_series_priority_enabled` / `_series_max_count` / `_series_bypass_min_score` | 同系列优先、同系列上限、是否绕过最低分 |
| `wallpaper_desktop_enabled` / `wallpaper_mobile_enabled` | 桌面 / 移动壁纸是否启用 |
| `wallpaper_blur` | 壁纸模糊强度，0-100 |
| `panel_blur` / `tag_blur` | 面板 / 标签的亚克力毛玻璃强度，0-100；标签模糊不作用于作品卡片上的标签 |
| `panel_opacity` / `filelist_opacity` / `control_opacity` | 面板 / 文件列表 / 控件不透明度，0-100；前两项有壁纸时才生效 |
| `card_size` / `card_width` | 卡片尺寸（small / medium / large / custom）与自定义宽度 |
| `theme_color_nav` / `theme_color_actor` / `theme_color_tag` | 主题色（导航栏 + 全站强调色）、声优标签色、类型标签色，hex；留空用默认 |
| `actor_tag_opacity` / `genre_tag_opacity` | 声优标签 / 类型标签不透明度，0-100 |
| `animation_duration` | 全站动画时长（秒，0-1）；0 = 关闭动画 |

## 上传体积上限

默认封面与壁纸走 **base64 JSON** 上传，图片上限 **50MB**（base64 后约 66.7MB）。全链路的三个值必须满足「图片上限 < base64 后体积 < 代理 / 后端上限」，改其一要同步改其余：

| 层 | 位置 | 当前值 |
| --- | --- | --- |
| 前端预检 | `frontend/src/views/SettingsView.vue`、`composables/useImageActions.ts` | 50MB |
| 后端接口校验 | `backend/src/routes/settings.ts` | 50MB |
| 前端容器 nginx | `frontend/nginx.conf` → `client_max_body_size` | 75m |
| 后端 express | `backend/src/index.ts` → `express.json({ limit })` | 75mb |

> 若宿主机上还挂了一层反向代理（群晖反向代理 / Nginx Proxy Manager / 自建 nginx 等），**那一层也要放开**（填 `client_max_body_size 75m;`），否则会在到达容器前就被 413 拒绝。注意它看到的是 base64 之后的请求体（约 67MB），所以是 75m 而不是 50m。

## API 摘要

> 除登录接口外，所有 `/api/*` 都需要 `Authorization: Bearer <token>`。

**认证**

- `POST /api/auth/login` 登录；`POST /api/auth/change-password` 改密；`GET /api/auth/me` 当前用户

**作品与媒体**

- `GET /api/works?q=&cond=type:value&sort=&order=&page=&pageSize=` 列表筛选（`cond` 可重复，最多 5 个；`sort` = added / release / sales / title / updated）
- `GET /api/works/random?count=&q=&cond=` 随机推荐（遵循筛选）
- `GET /api/works/:rj` 详情（含文件列表）
- `GET /api/works/:rj/recommendations` 相关推荐
- `POST /api/works/:rj/cover` 从作品文件设置封面 `{ file_id }`
- `POST /api/works/:rj/rescan` 重新扫描单个作品文件夹
- `GET /api/media/:rj/:fileId` 媒体流（支持 Range）
- `GET /api/cover/:rj` 封面

**聚合**

- `GET /api/tags` / `GET /api/actors` / `GET /api/circles` / `GET /api/series`（含计数）

**收藏**

- `GET /api/favorites` 分组收藏；`POST /api/favorites` `{ type, value, extra? }`；`DELETE /api/favorites?type=&value=`

**播放与历史**

- `POST /api/plays` 记录播放，返回 `play_id`
- `POST /api/plays/:id/duration` 回写本次实际播放时长 `{ seconds }`
- `GET /api/plays/recent?limit=&offset=` 最近播放（按作品去重）
- `GET /api/plays?page=&pageSize=` 完整历史（按「连听」分组）

**界面偏好**

- `GET/PUT /api/prefs` 筛选条件 / 排序 / 浏览位置

**扫描**

- `POST /api/scan` / `GET /api/scan/status` 扫描与状态
- `POST /api/scan/pause` / `POST /api/scan/resume` 暂停 / 继续
- `POST /api/scan/redownload-covers` / `GET /api/scan/cover-status` 重下封面
- `POST /api/scan/reset` 清空媒体库（保留历史与计数）

**推荐**

- `POST /api/recommendations/calc` 触发计算；`GET /api/recommendations/status` 任务状态

**设置**

- `GET/PUT /api/settings`
- `GET/POST/DELETE /api/settings/default-cover` 默认封面
- `GET/POST/DELETE /api/settings/wallpaper/:kind` 壁纸（`kind` = `desktop` | `mobile`）

**管理后台**

- `GET /api/admin/works` / `GET /api/admin/works/:rj`
- `POST /api/admin/works/:rj/cover` / `POST /api/admin/works/:rj/cover/restore`
- `POST /api/admin/works/:rj/sync` 重新同步元数据与封面（DLsite 优先，HVDB 补）
- `POST /api/admin/works/:rj/hidden` 隐藏 / 展示作品
- `POST/DELETE /api/admin/works/:rj/tags` 自定义标签
- `GET /api/admin/series|circles|actors|tags`；`POST/DELETE /api/admin/tags`
- `POST /api/admin/hidden` 通用隐藏（series / circle / actor / tag）

## 已知限制

- 浏览器原生 `<audio>` 对 `flac` / `mkv` 支持有限，首版按常见格式（mp3/m4a/wav + mp4）支持，其余格式在 UI 中可能无法播放。
- DLsite 公开页的部分作品无「販売数」字段，销量留空时 UI 自动隐藏。
- 抓取需网络可达 DLsite，视网络环境需配置代理。
- 管理后台仅桌面端可用；移动端输入 `/admin` 会跳回媒体库。
- **Android 换曲后通知栏媒体控件可能不再出现**：完成一首自动切下一首（或手动切歌）后，音频会正常继续播放，但锁屏 / 通知栏的媒体控件可能不再重建。这是 Chromium 的已知行为（复用同一个 audio 元素换 `src` 时，通知会在换源瞬间被撤掉且重建不可靠），**只影响通知栏控件，不影响播放**。已尝试并**回退**过两种改法，留作记录、避免重复踩坑：
  1. 换曲时主动「释放会话再重建」（`metadata=null` + `playbackState='none'` → 新曲出声后重设）——无效；
  2. 双 `<audio>` 元素交替播放（社区对该问题的常用 workaround）——会导致通知栏显示的曲目与界面实际播放的不一致，以及循环播放。
  如需继续处理，建议先找一台设备确认「换曲瞬间是否存在没有元素在播的空窗」，再决定方向。

## 最近更新

| 日期 | 改动 |
| --- | --- |
| 2026-11-09 | 修复弹出层（对话框 / 消息框 / 提示条 / 下拉选项）文字未按面板色取反色、深色玻璃上看不清的问题；全站 Element Plus 控件（输入框 / 下拉 / 按钮）与弹出层（下拉列表 / 对话框 / 消息框 / 提示条）接入液态玻璃：控件用标签级轻模糊 + 玻璃高光，弹出层跟随面板模糊、底色换半透明面板色；管理页表格改为圆角并接入面板同款亚克力毛玻璃（底色跟随面板、文字色按面板色自动取反色、悬停态半透明）；侧栏用户菜单弹层迁到 body 并改为 fixed 定位，修复被侧栏 backdrop-filter 拦截、看不到亚克力毛玻璃的问题；用户菜单三角改为收起时指向内部、展开时指向外部 |
| 2026-11-08 | 收藏改为封面星标 + 详情标签 `±`，移除长按收藏；文件列表统一线性图标；播放历史记录时长并支持卡片视图；顶栏搜索 / 排序改为独立胶囊；移动端顶栏与控件放大；面板 / 标签亚克力毛玻璃与独立模糊强度；设置自动保存改为离开控件即提示 5 秒，壁纸相关立即生效；全屏播放器整屏蒙版跟随面板透明度 / 模糊；无壁纸时面板亚克力模糊与透明度仍生效；系统设置子卡片不再出现异常色块；README 全面补齐并重组 |
| 2026-11-04 | 修复图片模式封面圆角；大屏无滚动条时自动补页填满视口；主题色过暗时按对比度自动提亮 |
| 2026-11-03 | 媒体库改为左侧边栏；设置页自动保存与壁纸启停；图片模式销量火焰分档；相关推荐卡片宽度 / 顶部空间修复；站点图标 canvas 绘制避免夜间反色 |
| 2026-10-11 | 磨砂改为透明度；播放历史按「一次连听」合并；新增全局动画时长；图片上传上限提到 50MB（请求体 75MB）；图片支持设为封面 / 壁纸；接入 Media Session |

> 本 README 随功能改动同步更新，是项目功能与配置的权威说明。
