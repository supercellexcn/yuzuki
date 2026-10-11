<template>
  <div class="settings">
    <h2>应用设置</h2>

    <div class="card">
      <div class="card-title">ASMR 源路径</div>
      <div class="paths">
        <div v-for="(p, i) in paths" :key="i" class="path-row">
          <el-input v-model="paths[i]" placeholder="/path/to/asmr" />
          <el-button @click="paths.splice(i, 1)" type="danger" plain>删除</el-button>
        </div>
        <el-button @click="paths.push('')" size="small">+ 添加源路径</el-button>
      </div>
      <div class="hint">支持配置多个源路径；路径须在 Docker 中以只读卷挂载到容器内同一位置。</div>
    </div>

    <div class="card">
      <div class="card-title">扫描层级深度</div>
      <el-input-number v-model="scanDepth" :min="0" :max="20" />
      <div class="hint">0 表示只扫描源路径直接子目录；每 +1 多下钻一层。</div>
    </div>

    <div class="card">
      <div class="card-title">扫描并发数</div>
      <el-input-number v-model="scanConcurrency" :min="1" :max="20" />
      <div class="hint">同时并发抓取 DLsite 的作品数量，默认 5。数值越大越快，但更可能被 DLsite 限流。</div>
    </div>

    <div class="card">
      <div class="card-title">每页加载数量</div>
      <el-input-number v-model="pageSize" :min="1" :max="200" />
      <div class="hint">媒体库一次加载的作品数量，默认 20；向下滚动自动加载同样数量。</div>
    </div>

    <div class="card">
      <div class="card-title">播放快进 / 快退秒数</div>
      <el-input-number v-model="seekSeconds" :min="1" :max="300" />
      <div class="hint">底部播放条「快进 / 快退」按钮一次跳转的秒数，默认 15 秒。</div>
    </div>

    <div class="card">
      <div class="card-title">代理服务器（用于 DLsite 抓取）</div>
      <el-input v-model="proxy" placeholder="http://host:port 或 socks5://host:port（留空则不使用代理）" />
      <div class="hint">仅作用于 DLsite 元数据抓取请求，不影响本地文件访问。</div>
    </div>

    <div class="card">
      <div class="card-title">DLsite 抓取</div>
      <div class="hint">一般无需修改，除非页面结构变化需要调整 URL 模板。</div>
      <el-input v-model="dlsite_base" placeholder="https://www.dlsite.com" style="margin-bottom: 8px" />
      <el-input v-model="dlsite_path" placeholder="/maniax/work/=/product_id/{rj}.html" />
    </div>

    <div class="card">
      <div class="card-title">封面存储目录</div>
      <el-input v-model="coverDir" placeholder="留空则使用默认目录（backend/data/covers）" />
      <div class="hint">下载的封面缓存存放路径，可填绝对路径。修改后新抓取的封面会保存到新位置，已存在的封面仍在原处。</div>
    </div>

    <div class="card">
      <div class="card-title">默认封面（无封面作品兜底）</div>
      <div class="hint">上传一张图片（jpg / png，≤50MB）。没有封面的作品会用此图作为封面。</div>
      <div v-if="hasDefaultCover" class="def-cover">
        <img :src="defaultCoverUrl()" alt="默认封面" />
      </div>
      <div class="def-cover-actions">
        <el-button type="primary" @click="pickCoverFile">上传默认封面</el-button>
        <el-button v-if="hasDefaultCover" type="danger" plain @click="doRemoveDefaultCover">删除默认封面</el-button>
      </div>
      <input
        ref="coverFileInput"
        type="file"
        accept="image/jpeg,image/png"
        style="display: none"
        @change="onCoverFileChange"
      />
    </div>

    <div class="card">
      <div class="card-title">相关推荐</div>
      <div class="setting-row">
        <div class="setting-label">
          <div>开启相关推荐</div>
          <div class="hint">在作品详情页的文件列表下方展示相关作品推荐。</div>
        </div>
        <el-switch v-model="recEnabled" />
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <div>扫描完成后自动计算推荐</div>
          <div class="hint">每次作品库扫描完成后自动更新推荐关系。</div>
        </div>
        <el-switch v-model="recAutoCalc" />
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <div>立即计算</div>
          <div class="hint">手动重新计算所有作品的推荐关系，无需等待扫描。</div>
        </div>
        <el-button :loading="recCalcRunning" @click="doRecommendationCalc">立即计算推荐</el-button>
      </div>
      <div v-if="recJob && recJob.status !== 'idle'" class="rec-status">
        <div class="status-line">
          <el-tag :type="recJob.status === 'error' ? 'danger' : recJob.status === 'done' ? 'success' : 'primary'">
            {{ recJob.status }}
          </el-tag>
          <span v-if="recJob.status === 'running'" class="current">正在计算 {{ recJob.done }}/{{ recJob.total }}</span>
          <span v-else-if="recJob.status === 'done'" class="current">
            已为 {{ recJob.total }} 个作品生成 {{ recJob.rows }} 条推荐
          </span>
        </div>
        <div v-if="recJob.errors.length" class="errors">
          <div v-for="(e, i) in recJob.errors.slice(0, 10)" :key="i" class="err">⚠ {{ e }}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">外观 · 壁纸与模糊</div>
      <div class="hint">
        壁纸与模糊为全局设置（所有用户 / 设备一致）；桌面端与移动端各用一张壁纸，按窗口宽度自动切换。
      </div>

      <div v-for="wp in WALLPAPERS" :key="wp.kind" class="wallpaper-row">
        <div class="wallpaper-label">{{ wp.label }}</div>
        <div class="wallpaper-preview">
          <img v-if="hasWallpaperOf(wp.kind)" :src="wallpaperPreview(wp.kind)" :alt="wp.label" />
          <span v-else class="wallpaper-empty">未设置</span>
        </div>
        <div class="wallpaper-actions">
          <el-button size="small" type="primary" @click="pickWallpaper(wp.kind)">上传</el-button>
          <el-button
            v-if="hasWallpaperOf(wp.kind)"
            size="small"
            type="danger"
            plain
            @click="doRemoveWallpaper(wp.kind)"
            >删除</el-button
          >
        </div>
      </div>
      <input
        ref="wallpaperFileInput"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style="display: none"
        @change="onWallpaperFileChange"
      />

      <div class="setting-row">
        <div class="setting-label">
          <div>壁纸模糊</div>
          <div class="hint">壁纸本身的模糊程度，越大越柔和。</div>
        </div>
        <el-slider v-model="wallpaperBlur" :min="0" :max="100" class="blur-slider" />
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <div>面板模糊</div>
          <div class="hint">设置卡片 / 顶部栏 / 详情页信息区 / 播放器面板的磨砂强度。</div>
        </div>
        <el-slider v-model="cardBlur" :min="0" :max="100" class="blur-slider" />
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <div>文件列表模糊</div>
          <div class="hint">作品详情页文件列表的磨砂强度。</div>
        </div>
        <el-slider v-model="filelistBlur" :min="0" :max="100" class="blur-slider" />
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <div>标签 / 输入控件模糊</div>
          <div class="hint">标签、输入框、按钮等控件的磨砂强度。</div>
        </div>
        <el-slider v-model="controlBlur" :min="0" :max="100" class="blur-slider" />
      </div>

      <div class="setting-row">
        <div class="setting-label">
          <div>动画时长</div>
          <div class="hint">
            全站动画 / 过渡的时长（0-1 秒），如文件列表展开收起、图片模式收放、
            hover 反馈等。0 秒表示关闭动画。
          </div>
        </div>
        <div class="anim-ctrl">
          <el-slider v-model="animationDuration" :min="0" :max="1" :step="0.05" class="blur-slider" />
          <span class="anim-value">{{ animationDuration.toFixed(2) }}s</span>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-label">
          <div>作品卡片大小</div>
          <div class="hint">影响媒体库、收藏与推荐卡片的宽度。</div>
        </div>
        <div class="card-size-ctrl">
          <el-radio-group v-model="cardSize" size="small">
            <el-radio-button value="small">小</el-radio-button>
            <el-radio-button value="medium">中</el-radio-button>
            <el-radio-button value="large">大</el-radio-button>
            <el-radio-button value="custom">自定义</el-radio-button>
          </el-radio-group>
          <el-input-number
            v-if="cardSize === 'custom'"
            v-model="cardWidth"
            :min="80"
            :max="480"
            size="small"
            controls-position="right"
          />
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">外观 · 主题配色</div>
      <div class="hint">
        主题色作用于导航栏、hover 框线、播放条、卡片下半部分与设置界面等全局底色；声优 / 类型标签是独立配色。
        每项可选预设色、用拾色器选色，或直接输入 16 进制色值（留空使用默认）。
      </div>
      <div v-for="item in COLOR_ITEMS" :key="item.key" class="setting-row">
        <div class="setting-label">
          <div>{{ item.label }}</div>
          <div class="hint">{{ item.hint }}</div>
        </div>
        <div class="color-ctrl">
          <span
            v-for="c in PRESET_COLORS"
            :key="c"
            class="swatch"
            :class="{ active: (themeColors[item.key] || '').toLowerCase() === c.toLowerCase() }"
            :style="{ background: c }"
            :title="c"
            @click="themeColors[item.key] = c"
          />
          <el-color-picker v-model="themeColors[item.key]" size="small" />
          <el-input
            v-model="themeColors[item.key]"
            size="small"
            class="hex-input"
            placeholder="#RRGGBB"
          />
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <div>标签透明度</div>
          <div class="hint">声优 / 类型标签的不透明度，越低越透（1-100%）。</div>
        </div>
        <el-slider v-model="tagOpacity" :min="1" :max="100" class="blur-slider" />
      </div>

      <div class="color-reset">
        <el-button size="small" @click="resetThemeColors">恢复默认配色</el-button>
      </div>
    </div>

    <div class="actions">
      <el-button type="primary" :loading="saving" @click="save">保存设置</el-button>
      <el-button type="success" :loading="scanning" @click="doScan">立即扫描</el-button>
      <el-button v-if="scanJob?.status === 'running' && !scanJob.paused" @click="doPause">暂停</el-button>
      <el-button v-if="scanJob?.status === 'running' && scanJob.paused" type="warning" @click="doResume">继续</el-button>
      <el-button :loading="coverRunning" @click="doCoverRedownload">重新下载缺失封面</el-button>
    </div>

    <div class="card danger-card">
      <div class="card-title">危险操作</div>
      <div class="hint">清空媒体库会删除所有作品元数据与封面缓存文件；播放历史与播放计数保留，重新扫描后自动接回。</div>
      <el-button type="danger" plain :loading="resetting" @click="doReset">清空媒体库</el-button>
    </div>

    <div v-if="scanJob && scanJob.status !== 'idle'" class="card scan-status">
      <div class="card-title">扫描进度</div>
      <div class="status-line">
        <el-tag :type="scanJob.status === 'error' ? 'danger' : scanJob.status === 'done' ? 'success' : 'primary'">
          {{ scanJob.status }}
        </el-tag>
        <el-tag v-if="scanJob.status === 'running' && scanJob.paused" type="warning">已暂停</el-tag>
        <span v-if="scanJob.status === 'running'" class="current">
          {{ scanJob.done }}/{{ scanJob.total }} — {{ scanJob.current }}
        </span>
      </div>
      <el-progress
        v-if="scanJob.total"
        :percentage="Math.round((scanJob.done / scanJob.total) * 100)"
      />
      <!-- 每条线程的实时执行情况 -->
      <div v-if="scanJob.workers && scanJob.workers.length" class="workers">
        <div v-for="w in scanJob.workers" :key="w.id" class="worker-line">
          <span class="w-id">线程{{ w.id + 1 }}</span>
          <span class="w-rj" :class="{ idle: !w.rj }">{{ w.rj || '空闲' }}</span>
          <span class="w-stage" :class="stageClass(w.stage)">{{ w.stage }}</span>
        </div>
      </div>
      <div v-if="scanJob.status === 'done' && scanJob.removed > 0" class="removed-note">
        已移除 {{ scanJob.removed }} 个源文件夹已不存在的工作
      </div>
      <div v-if="scanJob.errors.length" class="errors">
        <div v-for="(e, i) in scanJob.errors.slice(0, 20)" :key="i" class="err">⚠ {{ e }}</div>
      </div>
    </div>

    <div v-if="coverJob && coverJob.status !== 'idle'" class="card scan-status">
      <div class="card-title">封面重下进度</div>
      <div class="status-line">
        <el-tag :type="coverJob.status === 'error' ? 'danger' : coverJob.status === 'done' ? 'success' : 'primary'">
          {{ coverJob.status }}
        </el-tag>
        <span v-if="coverJob.status === 'running'" class="current">
          {{ coverJob.done }}/{{ coverJob.total }} — {{ coverJob.current }}
        </span>
      </div>
      <el-progress
        v-if="coverJob.total"
        :percentage="Math.round((coverJob.done / coverJob.total) * 100)"
      />
      <div v-if="coverJob.status === 'done'" class="removed-note">
        已下载 {{ coverJob.downloaded }} 个，跳过 {{ coverJob.skipped }} 个
      </div>
      <div v-if="coverJob.errors.length" class="errors">
        <div v-for="(e, i) in coverJob.errors.slice(0, 20)" :key="i" class="err">⚠ {{ e }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSettingsStore } from '../stores/settings'
import { useLibraryStore } from '../stores/library'
import { useAppearance } from '../composables/useAppearance'
import {
  startScan,
  getScanStatus,
  pauseScan,
  resumeScan,
  startCoverRedownload,
  getCoverStatus,
  resetLibrary,
  uploadDefaultCover,
  removeDefaultCover,
  checkDefaultCover,
  defaultCoverUrl,
  startRecommendationCalc,
  getRecommendationStatus,
  uploadWallpaper,
  removeWallpaper,
  wallpaperUrl,
} from '../api'
import type { ScanJob, CoverJob, RecommendationJob, CardSize, WallpaperKind } from '../api/types'

const store = useSettingsStore()
const library = useLibraryStore()
const paths = ref<string[]>([])
const scanDepth = ref(2)
const scanConcurrency = ref(5)
const pageSize = ref(20)
const seekSeconds = ref(15)
const proxy = ref('')
const dlsite_base = ref('https://www.dlsite.com')
const dlsite_path = ref('/maniax/work/=/product_id/{rj}.html')
const coverDir = ref('')
const hasDefaultCover = ref(false)
const coverFileInput = ref<HTMLInputElement | null>(null)

const saving = ref(false)
const scanning = ref(false)
const scanJob = ref<ScanJob | null>(null)
const coverRunning = ref(false)
const coverJob = ref<CoverJob | null>(null)
const resetting = ref(false)
let timer: number | undefined
let coverTimer: number | undefined

const recEnabled = ref(true)
const recAutoCalc = ref(true)
const recJob = ref<RecommendationJob | null>(null)
const recCalcRunning = ref(false)
let recTimer: number | undefined

// ---- 外观 / 壁纸 / 主题配色 ----
const {
  hasWallpaperDesktop,
  hasWallpaperMobile,
  apply: applyAppearance,
  refreshWallpapers,
  bumpWallpaperVersion,
} = useAppearance()
const wallpaperBlur = ref(20)
const cardBlur = ref(12)
const filelistBlur = ref(12)
const controlBlur = ref(8)
const cardSize = ref<CardSize>('medium')
const cardWidth = ref(180)
/** 声优 / 类型标签不透明度（1-100） */
const tagOpacity = ref(62)
/** 全局动画时长（秒，0-1）；0 表示关闭动画 */
const animationDuration = ref(0.25)
/** el-color-picker 点「清空」会给到 null，所以这里允许 null，保存时再收敛为 ''。 */
const themeColors = reactive<Record<'theme_color_nav' | 'theme_color_actor' | 'theme_color_tag', string | null>>({
  theme_color_nav: '',
  theme_color_actor: '#7BC86C',
  theme_color_tag: '#F2A65A',
})
/** 本地版本号：仅在上传 / 删除后自增，用于让预览图破缓存（进页面时不换，避免闪一下） */
const wallpaperVersion = ref(0)
const wallpaperFileInput = ref<HTMLInputElement | null>(null)
const pendingWallpaperKind = ref<WallpaperKind>('desktop')

const WALLPAPERS: Array<{ kind: WallpaperKind; label: string }> = [
  { kind: 'desktop', label: '桌面端壁纸' },
  { kind: 'mobile', label: '移动端壁纸' },
]
/** 预设配色（偏二次元的高饱和色） */
const PRESET_COLORS = ['#4FA8F5', '#A78BFA', '#7BC86C', '#F78FB3', '#F2A65A']
const COLOR_ITEMS: Array<{ key: keyof typeof themeColors; label: string; hint: string }> = [
  {
    key: 'theme_color_nav',
    label: '主题色',
    hint: '顶部导航栏、hover 框线、播放条、卡片下半部分、设置界面等全局底色都由它决定。',
  },
  { key: 'theme_color_actor', label: '声优标签颜色', hint: '作品卡片与详情页的声优标签底色。' },
  { key: 'theme_color_tag', label: '类型标签颜色', hint: '卡片封面标签与详情页类型标签底色。' },
]

onMounted(async () => {
  const s = await store.load()
  paths.value = s.source_paths.length ? [...s.source_paths] : ['']
  scanDepth.value = s.scan_depth
  scanConcurrency.value = s.scan_concurrency
  pageSize.value = s.page_size
  seekSeconds.value = s.seek_seconds
  proxy.value = s.proxy
  dlsite_base.value = s.dlsite_base
  dlsite_path.value = s.dlsite_path
  coverDir.value = s.cover_dir
  hasDefaultCover.value = await checkDefaultCover().catch(() => false)
  scanJob.value = await getScanStatus()
  if (scanJob.value.status === 'running') startPolling()
  coverJob.value = await getCoverStatus()
  if (coverJob.value.status === 'running') startCoverPolling()
  recEnabled.value = s.recommendation_enabled
  recAutoCalc.value = s.recommendation_auto_calc
  recJob.value = await getRecommendationStatus()
  if (recJob.value.status === 'running') startRecPolling()
  wallpaperBlur.value = s.wallpaper_blur
  cardBlur.value = s.card_blur
  filelistBlur.value = s.filelist_blur
  controlBlur.value = s.control_blur
  cardSize.value = s.card_size
  cardWidth.value = s.card_width
  themeColors.theme_color_nav = s.theme_color_nav
  themeColors.theme_color_actor = s.theme_color_actor
  themeColors.theme_color_tag = s.theme_color_tag
  tagOpacity.value = s.tag_opacity
  animationDuration.value = s.animation_duration
  await refreshWallpapers() // 只探测，不换版本号，避免进入本页时壁纸重载闪屏
})

onUnmounted(() => {
  stopPolling()
  stopCoverPolling()
  stopRecPolling()
})

async function save() {
  saving.value = true
  try {
    await store.save({
      source_paths: paths.value.map((p) => p.trim()).filter(Boolean),
      scan_depth: scanDepth.value,
      scan_concurrency: scanConcurrency.value,
      page_size: pageSize.value,
      seek_seconds: seekSeconds.value,
      proxy: proxy.value.trim(),
      dlsite_base: dlsite_base.value.trim(),
      dlsite_path: dlsite_path.value.trim(),
      cover_dir: coverDir.value.trim(),
      recommendation_enabled: recEnabled.value,
      recommendation_auto_calc: recAutoCalc.value,
      wallpaper_blur: wallpaperBlur.value,
      card_blur: cardBlur.value,
      filelist_blur: filelistBlur.value,
      control_blur: controlBlur.value,
      card_size: cardSize.value,
      card_width: cardWidth.value,
      theme_color_nav: (themeColors.theme_color_nav || '').trim(),
      theme_color_actor: (themeColors.theme_color_actor || '').trim(),
      theme_color_tag: (themeColors.theme_color_tag || '').trim(),
      tag_opacity: tagOpacity.value,
      animation_duration: animationDuration.value,
    })
    applyAppearance() // 立即生效，无需刷新页面
    ElMessage.success('已保存')
  } catch (e) {
    ElMessage.error('保存失败: ' + (e as Error).message)
  } finally {
    saving.value = false
  }
}

async function doScan() {
  await save()
  scanning.value = true
  try {
    await startScan()
    scanJob.value = await getScanStatus()
    startPolling()
  } catch (e) {
    ElMessage.error('启动扫描失败: ' + (e as Error).message)
  } finally {
    scanning.value = false
  }
}

async function doPause() {
  try {
    await pauseScan()
    scanJob.value = await getScanStatus()
  } catch {
    ElMessage.error('暂停失败')
  }
}

async function doResume() {
  try {
    await resumeScan()
    scanJob.value = await getScanStatus()
  } catch {
    ElMessage.error('继续失败')
  }
}

function pickCoverFile() {
  coverFileInput.value?.click()
}

/** 图片上传上限，与后端（50MB）保持一致：前端先拦一次，免得白传一趟才吃 413。 */
const MAX_IMAGE_BYTES = 50 * 1024 * 1024

/** 上传前校验体积，超限给出明确提示。 */
function checkImageSize(file: File): boolean {
  if (file.size <= MAX_IMAGE_BYTES) return true
  ElMessage.error(`图片 ${(file.size / 1024 / 1024).toFixed(1)}MB，超过 50MB 上限`)
  return false
}

/**
 * 提取接口错误信息。axios 默认只给「Request failed with status code 413」这种无用文案，
 * 能拿到后端返回的 error 字段时优先用它。
 */
function apiErrorMessage(e: unknown, fallback: string): string {
  const data = (e as { response?: { data?: { error?: string } } })?.response?.data
  return data?.error || (e as Error)?.message || fallback
}

async function onCoverFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选择同一文件
  if (!file || !checkImageSize(file)) return
  const ext = file.type === 'image/png' ? 'png' : 'jpg'
  const reader = new FileReader()
  reader.onload = async () => {
    const dataUrl = String(reader.result)
    const data = dataUrl.split(',')[1] || ''
    try {
      await uploadDefaultCover(data, ext)
      hasDefaultCover.value = true
      ElMessage.success('默认封面上传成功')
    } catch (err) {
      ElMessage.error('上传失败：' + apiErrorMessage(err, '图片可能超过 50MB'))
    }
  }
  reader.readAsDataURL(file)
}

async function doRemoveDefaultCover() {
  try {
    await removeDefaultCover()
    hasDefaultCover.value = false
    ElMessage.success('已删除默认封面')
  } catch {
    ElMessage.error('删除失败')
  }
}

function stageClass(stage: string): string {
  if (stage === '完成') return 'ok'
  if (stage === '已暂停') return 'pause'
  return ''
}

function startPolling() {
  stopPolling()
  timer = window.setInterval(async () => {
    scanJob.value = await getScanStatus()
    if (scanJob.value.status === 'done' || scanJob.value.status === 'error') {
      stopPolling()
      ElMessage.success('扫描完成')
    }
  }, 1500)
}

function stopPolling() {
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
}

async function doReset() {
  try {
    await ElMessageBox.confirm(
      '将删除媒体库中所有作品元数据与封面缓存文件，播放历史与播放计数会保留（重新扫描后自动接回）。确定继续吗？',
      '清空媒体库',
      { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' }
    )
  } catch {
    return // 用户取消
  }
  resetting.value = true
  try {
    const r = await resetLibrary()
    library.resetLibraryData()
    ElMessage.success(`已清空 ${r.worksDeleted} 个作品、${r.coversDeleted} 个封面，可重新扫描`)
  } catch (e) {
    ElMessage.error('清空失败: ' + (e as Error).message)
  } finally {
    resetting.value = false
  }
}

async function doCoverRedownload() {
  await save()
  coverRunning.value = true
  try {
    await startCoverRedownload()
    coverJob.value = await getCoverStatus()
    startCoverPolling()
  } catch (e) {
    ElMessage.error('启动封面重下失败: ' + (e as Error).message)
  } finally {
    coverRunning.value = false
  }
}

function startCoverPolling() {
  stopCoverPolling()
  coverTimer = window.setInterval(async () => {
    coverJob.value = await getCoverStatus()
    if (coverJob.value.status === 'done' || coverJob.value.status === 'error') {
      stopCoverPolling()
      ElMessage.success('封面重下完成')
    }
  }, 1500)
}

function stopCoverPolling() {
  if (coverTimer) {
    clearInterval(coverTimer)
    coverTimer = undefined
  }
}

async function doRecommendationCalc() {
  await save()
  recCalcRunning.value = true
  try {
    await startRecommendationCalc()
    recJob.value = await getRecommendationStatus()
    startRecPolling()
  } catch (e) {
    ElMessage.error('启动推荐计算失败: ' + (e as Error).message)
  } finally {
    recCalcRunning.value = false
  }
}

function startRecPolling() {
  stopRecPolling()
  recTimer = window.setInterval(async () => {
    recJob.value = await getRecommendationStatus()
    if (recJob.value.status === 'done' || recJob.value.status === 'error') {
      stopRecPolling()
      ElMessage.success('推荐计算完成')
    }
  }, 1500)
}

function stopRecPolling() {
  if (recTimer) {
    clearInterval(recTimer)
    recTimer = undefined
  }
}

// ---- 壁纸 ----

/** 壁纸预览 URL（带破缓存时间戳）。 */
function wallpaperPreview(kind: WallpaperKind): string {
  return wallpaperUrl(kind, wallpaperVersion.value || undefined)
}

/** 指定端是否已上传壁纸。 */
function hasWallpaperOf(kind: WallpaperKind): boolean {
  return kind === 'mobile' ? hasWallpaperMobile.value : hasWallpaperDesktop.value
}

/** 上传 / 删除后：换版本号破缓存并重新探测（进设置页时只探测，不换版本号，避免闪屏）。 */
async function refreshWallpaperState() {
  wallpaperVersion.value = Date.now()
  await bumpWallpaperVersion()
}

function pickWallpaper(kind: WallpaperKind) {
  pendingWallpaperKind.value = kind
  wallpaperFileInput.value?.click()
}

async function onWallpaperFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选择同一文件
  if (!file || !checkImageSize(file)) return
  const kind = pendingWallpaperKind.value
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const reader = new FileReader()
  reader.onload = async () => {
    const data = String(reader.result).split(',')[1] || ''
    try {
      await uploadWallpaper(kind, data, ext)
      await refreshWallpaperState()
      ElMessage.success('壁纸已上传')
    } catch (err) {
      ElMessage.error('上传失败：' + apiErrorMessage(err, '图片可能超过 50MB'))
    }
  }
  reader.readAsDataURL(file)
}

async function doRemoveWallpaper(kind: WallpaperKind) {
  try {
    await removeWallpaper(kind)
    await refreshWallpaperState()
    ElMessage.success('已删除壁纸')
  } catch {
    ElMessage.error('删除壁纸失败')
  }
}

/** 恢复内置默认配色（主题色留空 = 默认蓝，声优绿 / 类型橙）。 */
function resetThemeColors() {
  themeColors.theme_color_nav = ''
  themeColors.theme_color_actor = '#7BC86C'
  themeColors.theme_color_tag = '#F2A65A'
}
</script>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
}
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  backdrop-filter: blur(var(--card-blur));
}
.card-title {
  font-weight: 600;
  font-size: 16px;
}
.paths {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.path-row {
  display: flex;
  gap: 8px;
}
.def-cover {
  align-self: flex-start;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  width: 140px;
  height: 140px;
  background: #0d0f12;
}
.def-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.def-cover-actions {
  display: flex;
  gap: 10px;
}
.hint {
  font-size: 13px;
  color: var(--muted);
}
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px 16px;
  /* 放不下时整行换行，控件不会被挤出卡片 */
  flex-wrap: wrap;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.setting-row:last-child {
  border-bottom: none;
}
.setting-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 14px;
  /* 允许收缩到比内容更窄，说明文字才会换行，而不是把右侧控件顶出卡片 */
  flex: 1 1 220px;
  min-width: 0;
}
.rec-status {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
}
.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.danger-card {
  border-color: rgba(238, 136, 136, 0.4);
}
.status-line {
  display: flex;
  align-items: center;
  gap: 12px;
}
.current {
  font-size: 13px;
  color: var(--muted);
}
.removed-note {
  font-size: 13px;
  color: #e8c27a;
}
.workers {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  background: #15181d;
}
.worker-line {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.w-id {
  color: var(--accent);
  flex-shrink: 0;
  width: 44px;
}
.w-rj {
  font-family: Consolas, monospace;
  flex-shrink: 0;
  width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.w-rj.idle {
  color: var(--muted);
}
.w-stage {
  color: #c3cbd7;
  flex: 1;
}
.w-stage.ok {
  color: #7bd88f;
}
.w-stage.pause {
  color: #e8c27a;
}
.errors {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.err {
  font-size: 12px;
  color: #e88;
}

/* ---- 外观 · 壁纸 ---- */
.wallpaper-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.wallpaper-label {
  width: 96px;
  flex-shrink: 0;
  font-size: 14px;
}
.wallpaper-preview {
  width: 132px;
  height: 74px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: #0d0f12;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.wallpaper-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.wallpaper-empty {
  color: var(--muted);
  font-size: 12px;
}
.wallpaper-actions {
  display: flex;
  gap: 8px;
}
.blur-slider {
  /* 固定宽度但允许整行换行带走它；max-width 兜底，永远不会超出卡片 */
  flex: 0 0 200px;
  max-width: 100%;
  min-width: 0;
}
/* 动画时长：滑杆 + 右侧秒数读数 */
.anim-ctrl {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  flex-wrap: wrap;
  min-width: 0;
}
.anim-value {
  color: var(--muted);
  font-size: 13px;
  min-width: 44px;
  text-align: right;
}
.card-size-ctrl {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
  min-width: 0;
}

/* ---- 外观 · 主题配色 ---- */
.color-ctrl {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  /* 换行时靠右对齐，色块 / 拾色器 / 十六进制输入不会散在左边 */
  justify-content: flex-end;
  min-width: 0;
}
.swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  box-shadow: 0 0 0 1px var(--border);
  transition: transform var(--anim-duration);
}
.swatch:hover {
  transform: scale(1.1);
}
.swatch.active {
  border-color: var(--text);
}
.hex-input {
  width: 108px;
  flex: 0 0 auto;
}
.color-reset {
  padding-top: 6px;
}

/*
 * 窄屏：设置项改为「标签在上、控件在下并占满整行」，
 * 控件不再被长说明文字挤到卡片外面。
 */
@media (max-width: 640px) {
  .setting-row {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .setting-label {
    flex: 0 0 auto;
  }
  .blur-slider {
    flex: 0 0 auto;
    width: 100%;
  }
  .card-size-ctrl,
  .color-ctrl,
  .anim-ctrl {
    justify-content: flex-start;
  }
}
</style>
