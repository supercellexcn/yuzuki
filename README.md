# Yuzuki · ASMR 播放器

自托管的 DLsite ASMR 音声作品管理 / 播放器。扫描本地以 `RJ010xxxx-...` 命名的作品文件夹，自动从 DLsite/HVDB 抓取元数据（标题、声优、销量、类型标签、发售日、社团、系列、封面），提供封面网格浏览、搜索筛选与在线播放。

## 功能

- **登录**：所有功能需登录。默认账户 `admin`，初始密码 `123456`，首次登录强制改密（登录前所有接口返回 401，前端自动跳转登录页）。
- **扫描**：多源路径 + 可配置扫描层级深度与并发数；自动提取 RJ 号，抓取 DLsite 公开页元数据并下载封面到本地。
- **媒体库**：封面网格展示，封面下方显示系列、作者、销量、播放次数、类型标签（标签展示全部）；顶部搜索栏支持按标题 / 声优 / 类型搜索；支持按入库时间 / 发售时间 / 销量排序且可切换升 / 降序；「全部社团 / 全部系列 / 全部声优 / 全部标签」以标签墙形式展示（如 `柚木燕 24`），点击加入筛选条件，**最多叠加 5 个条件**（条件类型可重复，如声优 1 + 声优 2，全部 AND 匹配）；「随机」按钮基于当前筛选随机推荐 20 个作品；向下滚动自动加载更多。
- **播放历史**：播放文件时自动记录；媒体库顶部横向展示最近播放 10 条，横向滑到最右或点「全部历史」打开完整播放历史页；每个作品的播放次数会统计并展示。
- **界面记忆**：记住每个用户的筛选条件、排序、上次浏览的作品位置；登录后自动还原条件并定位到上次浏览的作品。
- **播放**：点击封面 / 标题进入播放页，展示封面 + 文件列表；点击图片可查看、点击音频播放、点击视频**只播放声音**；返回时保持上次浏览位置；底部常驻全局播放条（封面在左、点击可跳回当前播放来源），支持上一曲 / 下一曲、快进 / 快退（秒数可配置）、单曲循环、音量控制。
- **设置**：管理源路径、扫描深度、扫描并发数、每页加载数量、代理服务器、封面存储目录。

## 技术栈

- 前端：Vue 3 + Vite + TypeScript + Element Plus + Pinia + Vue Router
- 后端：Node.js + Express + TypeScript
- 数据库：SQLite（better-sqlite3，文件数据库）
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

## 配置项

| 项 | 说明 |
| --- | --- |
| `source_paths` | 源路径数组，每个都需在 compose 中挂载 |
| `scan_depth` | 扫描层级深度，0=只查直接子目录 |
| `scan_concurrency` | 扫描并发数（默认 5），同时并发抓取 DLsite 的作品数量 |
| `page_size` | 媒体库每页加载数量（默认 20） |
| `seek_seconds` | 播放条快进 / 快退秒数（默认 15） |
| `cover_dir` | 封面缓存目录，留空则用默认 `backend/data/covers` |
| `AUTH_SECRET`（env） | JWT 签名密钥，生产环境建议通过环境变量设置 |
| `proxy` | DLsite 抓取代理，如 `http://127.0.0.1:7890` |
| `dlsite_base` / `dlsite_path` | DLsite 页面 URL 模板（一般无需改） |

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

## 已知限制

- 浏览器原生 `<audio>` 对 `flac` / `mkv` 支持有限，首版按常见格式（mp3/m4a/wav + mp4）支持，其余格式在 UI 中可能无法播放。
- DLsite 公开页的部分作品无「販売数」字段，销量留空时 UI 自动隐藏。
- 抓取需网络可达 DLsite，视网络环境需配置代理。
