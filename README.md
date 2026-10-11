# Yuzuki · ASMR 播放器

自托管的 DLsite ASMR 音声作品管理 / 播放器。扫描本地以 `RJ010xxxx-...` 命名的作品文件夹，自动从 DLsite/HVDB 抓取元数据（标题、声优、销量、类型标签、发售日、社团、系列、封面），提供封面网格浏览、搜索筛选与在线播放。

## 功能

- **登录**：所有功能需登录。默认账户 `admin`，初始密码 `123456`，首次登录强制改密（登录前所有接口返回 401，前端自动跳转登录页）。
- **扫描**：多源路径 + 可配置扫描层级深度与并发数；自动提取 RJ 号，抓取 DLsite 公开页元数据并下载封面到本地。
- **媒体库**：封面网格展示，封面下方显示系列、社团、销量、播放次数、声优（类型标签全部展示在封面上）；顶部搜索栏支持按标题 / 声优 / 类型搜索；排序为**分段选择**（入库 / 发售 / 销量）+ 一个升降序开关（拨左升序、拨右降序，圆钮内显示当前状态）；「全部社团 / 全部系列 / 全部声优 / 全部标签」以标签墙形式展示（如 `柚木燕 24`），点击加入筛选条件，**最多叠加 5 个条件**（条件类型可重复，如声优 1 + 声优 2，全部 AND 匹配）；「随机」按钮基于当前筛选随机推荐 20 个作品；向下滚动自动加载更多。
- **图片模式（顶栏 M 按钮）**：收起卡片下半部分信息，只留封面 / RJ 角标 / 标签，卡片收放动画时长跟随「动画时长」设置；按设备记在 localStorage。
- **播放历史**：播放文件时自动记录；**同一时间段内连听同一作品的多个文件会合并成一条**（相邻两次播放间隔 3 小时内视为同一次连听，中间播了别的作品则断开），条目上标出本次连听了几个文件；媒体库顶部横向展示最近播放 10 条（按作品去重取最近一次），横向滑到最右或点「全部历史」打开完整播放历史页；每个作品的播放次数会统计并展示。
- **界面记忆**：记住每个用户的筛选条件与排序，登录后自动还原；**不再**定位到上次浏览的作品。同一会话内从播放页返回媒体库时会恢复滚动位置。
- **播放**：点击封面 / 标题进入播放页，展示封面 + 文件列表；点击图片可查看、点击音频播放、点击视频**只播放声音**；返回时保持上次浏览位置；底部常驻全局播放条（封面在左、点击可跳回当前播放来源），支持上一曲 / 下一曲、快进 / 快退（秒数可配置）、单曲循环、音量控制。
  - **锁屏 / 通知栏媒体控件**：接入 Media Session，锁屏与通知栏显示封面 / 文件名 / 声优，支持线控与蓝牙按键的播放 / 暂停 / 上一首 / 下一首 / 快进快退，并同步进度条。
  - **图片查看器**：左右切换（按钮或方向键）限定在**同一目录**内，底部提供「设为封面 / 桌面壁纸 / 移动壁纸」三个动作。
  - **长按图片**：在按下的位置就地弹出动作菜单（设为封面 / 桌面壁纸 / 移动壁纸），与筛选弹框同形态。
  - **相关推荐**：文件列表下方横向展示完整作品卡片（不显示推荐理由）。
- **外观**（全局设置，所有设备共享；移动端与桌面端各一张壁纸，按视口宽度自动切换）
  - **壁纸**：桌面端 / 移动端分别上传，存于 `<数据目录>/wallpapers`。
  - **模糊**：只作用于壁纸本身（0-100）。全站其余表面**刻意不做磨砂** —— 壁纸已经整层模糊过，再叠一层 `backdrop-filter` 几乎看不出差别，却要给每个元素建一个合成层（媒体库几千张卡片时就是几万个），代价远大于收益。
  - **透明度**：面板 / 文件列表 / 控件 三档独立可调（0-100）。面板与文件列表这两档在有壁纸时才生效（没有壁纸时保持不透明，避免半透明面板盖在纯色背景上糊成一片）。
  - **主题配色**：主题色统一驱动导航栏、hover 框线、播放条、面板底色；声优标签与类型标签为独立配色，且**不透明度各自独立可调**。
  - **卡片尺寸**：小 / 中 / 大 / 自定义宽度。
  - **动画时长**：0-1 秒，全站动画 / 过渡统一读它，0 秒即关闭动画。
- **设置**：管理源路径、扫描深度、扫描并发数、每页加载数量、代理服务器、封面存储目录、默认封面，以及上面的外观项。

## 技术栈

- 前端：Vue 3 + Vite + TypeScript + Element Plus + Pinia + Vue Router
- 后端：Node.js + Express + TypeScript
- 数据库：SQLite（Node 内置 `node:sqlite`，文件数据库）
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

## Docker 部署

前置：后端需要 Node 22+（`node:sqlite`），Dockerfile 已用 `node:22-alpine`。

1. **准备 `.env`**（复制 `.env.example`）：务必设置 `AUTH_SECRET`（随机字符串，用 `openssl rand -hex 32` 生成）；如需代理可设 `PROXY`（容器内访问宿主机代理用 `http://host.docker.internal:7890`）。

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

- **数据库不需要手动迁移**：新增的设置项在后端启动时自动补默认值，废弃项由启动时的迁移清理；
  数据库本身在 `./backend/data` 卷里，重建镜像不会动它。
- **必须带 `--build`**：`nginx.conf` / `Dockerfile` / `package.json` / `index.html` 这些是**构建时**文件，
  不在 `src/` 下。只同步 `src/` 或不加 `--build`，容器里跑的还是旧配置 —— 典型症状是
  「本地正常、NAS 上出现怪问题」（例如上传 413）。
- **别用 `docker compose down -v`**：`-v` 会连数据卷一起删。
- 用域名 / HTTPS 访问时，前面通常还有一层反向代理；**上传体积上限要在那一层也放开**（见上表）。

## 配置项

| 项 | 说明 |
| --- | --- |
| `source_paths` | 源路径数组，每个都需在 compose 中挂载 |
| `scan_depth` | 扫描层级深度，0=只查直接子目录 |
| `scan_concurrency` | 扫描并发数（默认 5），同时并发抓取 DLsite 的作品数量 |
| `page_size` | 媒体库每页加载数量（默认 20） |
| `seek_seconds` | 播放条快进 / 快退秒数（默认 15） |
| `cover_dir` | 封面缓存目录，留空则用默认 `backend/data/covers`（壁纸不受此项影响，固定存 `<数据目录>/wallpapers`） |
| `AUTH_SECRET`（env） | JWT 签名密钥，生产环境建议通过环境变量设置 |
| `proxy` | DLsite 抓取代理，如 `http://127.0.0.1:7890` |
| `dlsite_base` / `dlsite_path` | DLsite 页面 URL 模板（一般无需改） |
| `wallpaper_blur` | 壁纸模糊强度，0-100（全站唯一的模糊项） |
| `panel_opacity` / `filelist_opacity` / `control_opacity` | 面板 / 文件列表 / 控件底色不透明度，0-100；前两项有壁纸时才生效 |
| `card_size` / `card_width` | 卡片尺寸（small / medium / large / custom）与自定义宽度 |
| `theme_color_nav` / `theme_color_actor` / `theme_color_tag` | 主题色（导航栏 + 全站强调色）、声优标签色、类型标签色，hex；留空用默认 |
| `actor_tag_opacity` / `genre_tag_opacity` | 声优标签 / 类型标签底色不透明度，1-100 |
| `animation_duration` | 全站动画时长（秒，0-1）；0 = 关闭动画 |

### 上传体积上限

默认封面与壁纸走 **base64 JSON** 上传，图片上限 **50MB**（base64 后约 66.7MB）。全链路的三个值必须满足
「图片上限 < base64 后体积 < 代理 / 后端上限」，改其一要同步改其余：

| 层 | 位置 | 当前值 |
| --- | --- | --- |
| 前端预检 | `frontend/src/views/SettingsView.vue`、`composables/useImageActions.ts` | 50MB |
| 后端接口校验 | `backend/src/routes/settings.ts` | 50MB |
| 前端容器 nginx | `frontend/nginx.conf` → `client_max_body_size` | 75m |
| 后端 express | `backend/src/index.ts` → `express.json({ limit })` | 75mb |

> 若宿主机上还挂了一层反向代理（群晖反向代理 / Nginx Proxy Manager / 自建 nginx 等），**那一层也要放开**
> （填 `client_max_body_size 75m;`），否则会在到达容器前就被 413 拒绝。注意它看到的是 base64 之后的
> 请求体（约 67MB），所以是 75m 而不是 50m。

## API 摘要

> 除登录接口外，所有 `/api/*` 都需要 `Authorization: Bearer <token>`。

- `POST /api/auth/login` 登录；`POST /api/auth/change-password` 改密；`GET /api/auth/me` 当前用户
- `GET /api/works?q=&cond=type:value&sort=&order=&page=&pageSize=` 列表筛选（`cond` 可重复，最多 5 个）
- `GET /api/works/random?count=&q=&cond=` 随机推荐
- `GET /api/works/:rj` 详情（含文件列表）
- `GET /api/media/:rj/:fileId` 媒体流（支持 Range）
- `GET /api/cover/:rj` 封面
- `POST /api/admin/works/:rj/sync` 单作品重新同步元数据与封面（DLsite 优先，缺失时 HVDB 补；封面 DLsite 有就用 DLsite，否则用 HVDB）
- `GET /api/tags` / `GET /api/actors` / `GET /api/circles` / `GET /api/series` 聚合（含计数）
- `POST /api/plays` 记录播放；`GET /api/plays/recent` 最近播放；`GET /api/plays` 完整历史
- `GET/PUT /api/prefs` 界面记忆（筛选条件 / 排序 / 浏览位置）
- `POST /api/scan` / `GET /api/scan/status` 扫描
- `GET/PUT /api/settings` 设置
- `GET/POST/DELETE /api/settings/default-cover` 默认封面（无封面作品兜底）
- `GET/POST/DELETE /api/settings/wallpaper/:kind` 壁纸（`kind` = `desktop` | `mobile`）

## 已知限制

- 浏览器原生 `<audio>` 对 `flac` / `mkv` 支持有限，首版按常见格式（mp3/m4a/wav + mp4）支持，其余格式在 UI 中可能无法播放。
- DLsite 公开页的部分作品无「販売数」字段，销量留空时 UI 自动隐藏。
- 抓取需网络可达 DLsite，视网络环境需配置代理。
- **Android 换曲后通知栏媒体控件可能不再出现**：完成一首自动切下一首（或手动切歌）后，音频会正常继续播放，
  但锁屏 / 通知栏的媒体控件可能不再重建。这是 Chromium 的已知行为（复用同一个 audio 元素换 `src` 时，
  通知会在换源瞬间被撤掉且重建不可靠），**只影响通知栏控件，不影响播放**。
  已尝试并**回退**过两种改法，留作记录、避免重复踩坑：
  1. 换曲时主动「释放会话再重建」（`metadata=null` + `playbackState='none'` → 新曲出声后重设）——无效；
  2. 双 `<audio>` 元素交替播放（社区对该问题的常用 workaround）——会导致
     **通知栏显示的曲目与界面实际播放的不一致，以及循环播放**，已回退。
  如需继续处理，建议先找一台设备确认「换曲瞬间是否存在没有元素在播的空窗」，再决定方向。
