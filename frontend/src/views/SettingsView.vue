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
      <div class="hint">上传一张图片（jpg / png，≤10MB）。没有封面的作品会用此图作为封面。</div>
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
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSettingsStore } from '../stores/settings'
import { useLibraryStore } from '../stores/library'
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
} from '../api'
import type { ScanJob, CoverJob, RecommendationJob } from '../api/types'

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
    })
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

async function onCoverFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选择同一文件
  if (!file) return
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
      ElMessage.error('上传失败: ' + ((err as Error).message || '图片可能超过 10MB'))
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
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  gap: 16px;
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
</style>
