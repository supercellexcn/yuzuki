<template>
  <div class="tags-admin">
    <div class="toolbar">
      <el-radio-group v-model="filter" @change="onFilterChange">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="custom">自定义</el-radio-button>
        <el-radio-button value="native">原生</el-radio-button>
      </el-radio-group>

      <el-input
        v-model="kw"
        placeholder="搜索标签"
        clearable
        style="width: 200px"
        @input="onSearch"
        @clear="onSearch"
      />

      <div class="spacer" />

      <el-input
        v-model="newName"
        placeholder="输入标签名"
        style="width: 200px"
        maxlength="50"
        @keyup.enter="add"
      />
      <el-button type="primary" :disabled="!newName.trim()" :loading="adding" @click="add">
        添加标签
      </el-button>
    </div>

    <el-table :data="paged" v-loading="loading" row-key="id" class="table">
      <el-table-column label="标签" prop="name" min-width="200" show-overflow-tooltip />
      <el-table-column label="类型" width="90">
        <template #default="{ row }">
          <el-tag size="small" :type="row.category === CUSTOM_TAG ? 'success' : 'info'" effect="plain">
            {{ row.category === CUSTOM_TAG ? '自定义' : '原生' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="作品数" prop="count" width="100" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.hidden" size="small" type="danger">已隐藏</el-tag>
          <el-tag v-else size="small" type="success">正常</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button size="small" :type="row.hidden ? 'success' : 'warning'" @click="toggle(row)">
            {{ row.hidden ? '取消隐藏' : '隐藏' }}
          </el-button>
          <el-button
            v-if="row.category === CUSTOM_TAG"
            size="small"
            type="danger"
            plain
            @click="remove(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <div v-if="!loading && !paged.length" class="empty">暂无标签</div>

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
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getAdminTags, addCustomTag, deleteCustomTag, setHidden } from '../../api'
import { CUSTOM_TAG } from '../../api/types'
import type { AdminTag, AdminTagFilter } from '../../api/types'
import { useLibraryStore } from '../../stores/library'
import { useAdminPageSize } from '../../composables/useAdminPageSize'

const lib = useLibraryStore()
const { pageSize, setPageSize, ensureLoaded } = useAdminPageSize('tags')
const items = ref<AdminTag[]>([])
const loading = ref(false)
const adding = ref(false)
const newName = ref('')
const filter = ref<AdminTagFilter>('all')
const kw = ref('')
const page = ref(1)

const filtered = computed(() => {
  const q = kw.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter((t) => t.name.toLowerCase().includes(q))
})

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

async function load() {
  loading.value = true
  try {
    items.value = await getAdminTags(filter.value)
  } catch (e) {
    ElMessage.error('加载标签失败: ' + (e as Error).message)
  } finally {
    loading.value = false
  }
}

function onFilterChange() {
  page.value = 1
  void load()
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

async function add() {
  const name = newName.value.trim()
  if (!name) return
  adding.value = true
  try {
    await addCustomTag(name)
    newName.value = ''
    ElMessage.success(`已添加自定义标签「${name}」`)
    filter.value = 'all'
    await load()
  } catch (e) {
    ElMessage.error('添加失败: ' + (e as Error).message)
  } finally {
    adding.value = false
  }
}

async function toggle(row: AdminTag) {
  const next = !row.hidden
  try {
    await setHidden('tag', row.name, row.category, next)
    row.hidden = next
    ElMessage.success(next ? `已隐藏标签「${row.name}」` : `已恢复标签「${row.name}」`)
    lib.resetLibraryData()
  } catch (e) {
    ElMessage.error('操作失败: ' + (e as Error).message)
  }
}

async function remove(row: AdminTag) {
  try {
    await ElMessageBox.confirm(
      `删除自定义标签「${row.name}」？该标签会从所有作品中移除。`,
      '删除标签',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await deleteCustomTag(row.name, row.category)
    items.value = items.value.filter((t) => !(t.name === row.name && t.category === row.category))
    ElMessage.success(`已删除标签「${row.name}」`)
    lib.resetLibraryData()
  } catch (e) {
    ElMessage.error('删除失败: ' + (e as Error).message)
  }
}

onMounted(async () => {
  await ensureLoaded()
  void load()
})
</script>

<style scoped>
.tags-admin {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
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
