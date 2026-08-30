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
        v-model="filters.hasCover"
        placeholder="是否有封面"
        clearable
        style="width: 130px"
        @change="onFilterChange"
      >
        <el-option value="1" label="有封面" />
        <el-option value="0" label="无封面" />
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
import { CUSTOM_TAG } from '../../api/types'
import type { AdminWork, AdminCircle, AdminActor, AdminSeries, AdminTag } from '../../api/types'
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

const filters = reactive({ q: '', circle: '', series: '', actor: '', tag: '', hasCover: '' })
const circles = ref<AdminCircle[]>([])
const series = ref<AdminSeries[]>([])
const actors = ref<AdminActor[]>([])
const tags = ref<AdminTag[]>([])

const coverVisible = ref(false)
const coverRj = ref('')
const tagVisible = ref(false)
const tagWork = ref<AdminWork | null>(null)
const syncingRj = ref('')

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
      hasCover: filters.hasCover as '1' | '0' | '',
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
</style>
