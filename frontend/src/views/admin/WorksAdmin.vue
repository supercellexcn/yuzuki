<template>
  <div class="works-admin">
    <!-- 筛选栏 -->
    <div class="filters">
      <el-input
        v-model="filters.q"
        placeholder="搜索 RJ / 标题"
        clearable
        style="width: 200px"
        @keyup.enter="onFilterChange"
        @clear="onFilterChange"
      />
      <el-select
        v-model="filters.circle"
        placeholder="全部社团"
        filterable
        clearable
        style="width: 180px"
        @change="onFilterChange"
      >
        <el-option v-for="c in circles" :key="c.name" :value="c.name" :label="`${c.name}（${c.count}）`" />
      </el-select>
      <el-select
        v-model="filters.series"
        placeholder="全部系列"
        filterable
        clearable
        style="width: 180px"
        @change="onFilterChange"
      >
        <el-option v-for="s in series" :key="s.name" :value="s.name" :label="`${s.name}（${s.count}）`" />
      </el-select>
      <el-select
        v-model="filters.actor"
        placeholder="全部声优"
        filterable
        clearable
        style="width: 180px"
        @change="onFilterChange"
      >
        <el-option v-for="a in actors" :key="a.name" :value="a.name" :label="`${a.name}（${a.count}）`" />
      </el-select>
      <el-select
        v-model="filters.tag"
        placeholder="全部标签"
        filterable
        clearable
        style="width: 180px"
        @change="onFilterChange"
      >
        <el-option v-for="t in tags" :key="t.name + t.category" :value="t.name" :label="t.name" />
      </el-select>
      <el-select
        v-model="filters.missing"
        placeholder="信息缺失"
        multiple
        collapse-tags
        collapse-tags-tooltip
        clearable
        style="width: 200px"
        @change="onFilterChange"
      >
        <el-option v-for="f in MISSING_FIELD_OPTIONS" :key="f" :value="f" :label="MISSING_FIELD_LABELS[f]" />
      </el-select>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <!-- 表格 -->
    <el-table :data="items" v-loading="loading" size="default" row-key="id" class="table">
      <el-table-column label="封面" width="64">
        <template #default="{ row }">
          <img
            v-if="row.cover_url"
            :src="authedUrl(row.cover_url + (coverVersion ? '?v=' + coverVersion : ''))"
            class="cover-thumb"
            :alt="row.rj_code"
          />
          <div v-else class="no-cover">{{ row.rj_code }}</div>
        </template>
      </el-table-column>
      <el-table-column label="RJ" prop="rj_code" width="120" />
      <el-table-column label="标题" prop="title" min-width="220" show-overflow-tooltip />
      <el-table-column label="社团" prop="circle" width="130" show-overflow-tooltip />
      <el-table-column label="系列" prop="series" width="130" show-overflow-tooltip />
      <el-table-column label="声优" min-width="150">
        <template #default="{ row }">{{ row.actors.slice(0, 3).join('、') }}</template>
      </el-table-column>
      <el-table-column label="标签" min-width="160">
        <template #default="{ row }">
          <el-tag
            v-for="t in row.tags.slice(0, 4)"
            :key="t.name + t.category"
            size="small"
            effect="plain"
            :class="{ 'tag-custom': t.category === CUSTOM_TAG }"
          >
            {{ t.name }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="评分 / 评论 / 价格" width="140">
        <template #default="{ row }">
          <div class="stats-line">
            {{ row.rating == null && row.rating_count == null ? '—' : `${row.rating ?? 0} 分（${row.rating_count ?? 0}）` }}
          </div>
          <div class="stats-line">{{ priceText(row.price) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="信息缺失" width="170">
        <template #default="{ row }">
          <el-tag v-if="!row.missing.length" size="small" type="success" effect="plain">完整</el-tag>
          <el-tag
            v-for="f in row.missing"
            :key="f"
            size="small"
            type="danger"
            effect="plain"
            class="missing-tag"
          >
            {{ fieldLabel(f) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="DL 状态" width="110">
        <template #default="{ row }">
          <el-tooltip :content="dlStatusHint(row.fetch_status)" placement="top">
            <el-tag :type="dlStatusType(row.fetch_status)" size="small" effect="plain">
              {{ dlStatusLabel(row.fetch_status) }}
            </el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="80">
        <template #default="{ row }">
          <el-tag v-if="row.hidden" size="small" type="danger">已隐藏</el-tag>
          <el-tag v-else size="small" type="success">正常</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="280" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openCover(row)">修改封面</el-button>
          <el-button size="small" @click="openTags(row)">标签</el-button>
          <el-button size="small" :loading="syncingRj === row.rj_code" @click="syncWork(row)">同步</el-button>
          <el-button size="small" :type="row.hidden ? 'success' : 'warning'" @click="toggleHidden(row)">
            {{ row.hidden ? '展示' : '隐藏' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页：默认每页 20 条 -->
    <div class="pager">
      <el-pagination
        layout="total, prev, pager, next, sizes"
        :total="total"
        :page-size="pageSize"
        :current-page="page"
        :page-sizes="[10, 20, 40, 100]"
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <CoverDialog v-model="coverVisible" :rj="coverRj" @changed="onDialogChanged" />
    <TagEditDialog v-model="tagVisible" :work="tagWork" @changed="onDialogChanged" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getAdminWorks,
  getAdminCircles,
  getAdminActors,
  getAdminSeries,
  getAdminTags,
  setWorkHidden,
  syncAdminWork,
  authedUrl,
} from '../../api'
import { CUSTOM_TAG, DL_STATUS_LABELS, MISSING_FIELD_LABELS, MISSING_FIELD_OPTIONS } from '../../api/types'
import type {
  AdminWork,
  AdminCircle,
  AdminActor,
  AdminSeries,
  AdminTag,
  DlFetchStatus,
  MissingField,
} from '../../api/types'
import { useLibraryStore } from '../../stores/library'
import { useAdminPageSize } from '../../composables/useAdminPageSize'
import CoverDialog from './CoverDialog.vue'
import TagEditDialog from './TagEditDialog.vue'

const lib = useLibraryStore()
const { pageSize, setPageSize, ensureLoaded } = useAdminPageSize('works')

const items = ref<AdminWork[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const coverVersion = ref(0)

const filters = reactive({ q: '', circle: '', series: '', actor: '', tag: '', missing: [] as MissingField[] })
const circles = ref<AdminCircle[]>([])
const series = ref<AdminSeries[]>([])
const actors = ref<AdminActor[]>([])
const tags = ref<AdminTag[]>([])

const coverVisible = ref(false)
const coverRj = ref('')
const tagVisible = ref(false)
const tagWork = ref<AdminWork | null>(null)
const syncingRj = ref('')

/** 价格展示：null = 没抓到，0 = 免费 */
function priceText(v: number | null): string {
  if (v == null) return '价格未知'
  return v === 0 ? '免费' : `¥${v.toLocaleString()}`
}

function fieldLabel(f: MissingField): string {
  return MISSING_FIELD_LABELS[f]
}

/**
 * DL 状态：说明这部作品在 DLsite 侧是什么情况，也就是「该去哪找信息」。
 * 地区禁售的作品，字段可能是兜底站点补的，换到可用线路后扫描会自动重抓纠正。
 */
function dlStatusLabel(s: DlFetchStatus | undefined): string {
  return DL_STATUS_LABELS[s || ''] || '未记录'
}

function dlStatusType(s: DlFetchStatus | undefined): 'success' | 'warning' | 'info' | 'danger' {
  if (s === 'ok') return 'success'
  if (s === 'region_blocked') return 'warning'
  if (s === 'error') return 'danger'
  return 'info'
}

function dlStatusHint(s: DlFetchStatus | undefined): string {
  switch (s) {
    case 'ok':
      return 'DLsite 正常返回作品页，信息来自 DLsite'
    case 'region_blocked':
      return 'DLsite 判定当前线路所在区域不卖这部作品：换到可用线路后重新扫描会自动补齐，不写兜底数据'
    case 'not_found':
      return 'DLsite 上没有这部作品（不存在或已下架）：信息来自 DLsite 接口 / 兜底站点，不再重复抓取'
    case 'error':
      return '上次抓取时网络异常，下次扫描会重试'
    default:
      return '尚未记录（升级前的老数据，下次扫描时写入）'
  }
}

async function loadOptions() {
  try {
    const [c, s, a, t] = await Promise.all([
      getAdminCircles(),
      getAdminSeries(),
      getAdminActors(),
      getAdminTags(),
    ])
    circles.value = c
    series.value = s
    actors.value = a
    tags.value = t
  } catch {
    /* 忽略 */
  }
}

async function load() {
  loading.value = true
  try {
    const res = await getAdminWorks({
      q: filters.q || undefined,
      circle: filters.circle || undefined,
      series: filters.series || undefined,
      actor: filters.actor || undefined,
      tag: filters.tag || undefined,
      missing: filters.missing.length ? filters.missing.join(',') : undefined,
      page: page.value,
      pageSize: pageSize.value,
    })
    items.value = res.items
    total.value = res.total
  } catch (e) {
    ElMessage.error('加载作品失败: ' + (e as Error).message)
  } finally {
    loading.value = false
  }
}

function onFilterChange() {
  page.value = 1
  void load()
}
function onPageChange(p: number) {
  page.value = p
  void load()
}
function onSizeChange(s: number) {
  setPageSize(s)
  page.value = 1
  void load()
}

function openCover(row: AdminWork) {
  coverRj.value = row.rj_code
  coverVisible.value = true
}
function openTags(row: AdminWork) {
  tagWork.value = row
  tagVisible.value = true
}

async function toggleHidden(row: AdminWork) {
  const next = !row.hidden
  try {
    await setWorkHidden(row.rj_code, next)
    row.hidden = next
    ElMessage.success(next ? `已隐藏 ${row.rj_code}` : `已展示 ${row.rj_code}`)
    invalidateLibrary()
  } catch (e) {
    ElMessage.error('操作失败: ' + (e as Error).message)
  }
}

/** 重新同步单个作品：DLsite 优先、缺失时 HVDB 补；封面 DLsite 有就用 DLsite，否则用 HVDB。 */
async function syncWork(row: AdminWork) {
  try {
    await ElMessageBox.confirm(
      `将重新从 DLsite / HVDB 抓取「${row.rj_code}」的元数据与封面并覆盖当前信息，是否继续？`,
      '同步元信息',
      { type: 'warning', confirmButtonText: '同步', cancelButtonText: '取消' }
    )
  } catch {
    return // 用户取消
  }
  syncingRj.value = row.rj_code
  try {
    await syncAdminWork(row.rj_code)
    ElMessage.success(`已同步 ${row.rj_code}`)
    onDialogChanged()
  } catch (e) {
    ElMessage.error('同步失败: ' + (e as Error).message)
  } finally {
    syncingRj.value = ''
  }
}

/** 封面 / 标签变更后刷新当前页，并让媒体库下次进入重新拉取。 */
function onDialogChanged() {
  coverVersion.value = Date.now()
  invalidateLibrary()
  void load()
}

function invalidateLibrary() {
  lib.resetLibraryData()
}

onMounted(async () => {
  await ensureLoaded()
  void loadOptions()
  void load()
})
</script>

<style scoped>
.works-admin {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.table {
  width: 100%;
}
.cover-thumb {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 6px;
  background: #0d0f12;
  display: block;
}
.no-cover {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  background: #0d0f12;
  color: var(--muted);
  font-size: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pager {
  display: flex;
  justify-content: flex-end;
}
.stats-line {
  font-size: 12px;
  color: var(--muted);
  line-height: 18px;
}
.missing-tag {
  margin: 0 4px 4px 0;
}
</style>
