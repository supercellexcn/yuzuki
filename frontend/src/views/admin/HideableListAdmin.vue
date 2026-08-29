<template>
  <div class="admin-list">
    <div class="toolbar">
      <el-input
        v-model="kw"
        :placeholder="'搜索' + title"
        clearable
        style="width: 220px"
        @input="onSearch"
        @clear="onSearch"
      />
    </div>

    <el-table :data="paged" v-loading="loading" row-key="name" class="table">
      <el-table-column :label="title" prop="name" min-width="240" show-overflow-tooltip />
      <el-table-column label="作品数" prop="count" width="110" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.hidden" size="small" type="danger">已隐藏</el-tag>
          <el-tag v-else size="small" type="success">正常</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="130">
        <template #default="{ row }">
          <el-button size="small" :type="row.hidden ? 'success' : 'warning'" @click="toggle(row)">
            {{ row.hidden ? '取消隐藏' : '隐藏' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <div v-if="!loading && !paged.length" class="empty">暂无{{ title }}</div>

    <div class="pager">
      <el-pagination
        layout="total, prev, pager, next, sizes"
        :total="filtered.length"
        :page-size="pageSize"
        :current-page="page"
        :page-sizes="[10, 20, 40, 100]"
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { getAdminSeries, getAdminCircles, getAdminActors, setHidden } from '../../api'
import type { HiddenType } from '../../api/types'
import { useLibraryStore } from '../../stores/library'
import { useAdminPageSize, type AdminSection } from '../../composables/useAdminPageSize'

const props = defineProps<{ type: 'series' | 'circle' | 'actor'; title: string }>()

const lib = useLibraryStore()
// 系列/社团/声优各自独立的每页数量
const section = ({ series: 'series', circle: 'circles', actor: 'actors' } as const)[props.type] as AdminSection
const { pageSize, setPageSize, ensureLoaded } = useAdminPageSize(section)
const items = ref<Array<{ name: string; count: number; hidden: boolean }>>([])
const loading = ref(false)
const kw = ref('')
const page = ref(1)

const loaders: Record<string, () => Promise<Array<{ name: string; count: number; hidden: boolean }>>> = {
  series: getAdminSeries,
  circle: getAdminCircles,
  actor: getAdminActors,
}

const filtered = computed(() => {
  const q = kw.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter((i) => i.name.toLowerCase().includes(q))
})

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

async function load() {
  loading.value = true
  try {
    items.value = await loaders[props.type]()
  } catch (e) {
    ElMessage.error(`加载${props.title}失败: ` + (e as Error).message)
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
}
function onPageChange(p: number) {
  page.value = p
}
function onSizeChange(s: number) {
  setPageSize(s)
  page.value = 1
}

async function toggle(row: { name: string; hidden: boolean }) {
  const next = !row.hidden
  try {
    await setHidden(props.type as HiddenType, row.name, '', next)
    row.hidden = next
    ElMessage.success(next ? `已隐藏${props.title}「${row.name}」` : `已恢复${props.title}「${row.name}」`)
    lib.resetLibraryData()
  } catch (e) {
    ElMessage.error('操作失败: ' + (e as Error).message)
  }
}

watch(() => props.type, () => void load())
onMounted(async () => {
  await ensureLoaded()
  void load()
})
</script>

<style scoped>
.admin-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.table {
  width: 100%;
}
.pager {
  display: flex;
  justify-content: flex-end;
}
.empty {
  padding: 30px 0;
  text-align: center;
  color: var(--muted);
}
</style>
