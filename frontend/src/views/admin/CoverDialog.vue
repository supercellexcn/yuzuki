<template>
  <el-dialog
    :model-value="modelValue"
    title="修改封面"
    width="720px"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @closed="closed"
  >
    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="work" class="dialog-body">
      <div class="cover-bar">
        <span class="label">当前封面：</span>
        <img
          v-if="work.cover_url"
          :src="authedUrl(work.cover_url + (coverVersion ? '?v=' + coverVersion : ''))"
          class="thumb"
          :alt="work.title"
        />
        <span v-else class="no-cover">（无封面，展示默认封面）</span>
        <span v-if="coverModified" class="badge">已手动修改</span>
      </div>

      <div class="body">
        <!-- 左：作品文件夹内的图片目录树 -->
        <div class="tree-pane">
          <div class="pane-title">选择图片（{{ imageCount }} 张）</div>
          <el-tree
            :data="treeData"
            node-key="path"
            :props="{ label: 'name', children: 'children' }"
            highlight-current
            @node-click="onNodeClick"
          >
            <template #default="{ data }">
              <span class="tree-node" :class="data.type">
                <span class="tree-icon">{{ data.type === 'dir' ? '📁' : '▣' }}</span>
                <span class="tree-name">{{ data.name }}</span>
              </span>
            </template>
          </el-tree>
          <div v-if="!imageCount" class="empty">该作品文件夹内没有图片</div>
        </div>

        <!-- 右：预览 + 操作 -->
        <div class="preview-pane">
          <div class="pane-title">预览</div>
          <div class="preview">
            <img v-if="previewUrl" :src="previewUrl" :alt="selectedName || ''" />
            <span v-else class="preview-empty">点击左侧图片查看</span>
          </div>
          <div class="preview-name">{{ selectedName || '未选择图片' }}</div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="footer">
        <el-button @click="close">取消</el-button>
        <el-button v-if="coverModified" type="danger" :loading="busy" @click="restore">
          还原封面
        </el-button>
        <el-button v-else type="primary" :disabled="!selected" :loading="busy" @click="apply">
          设为封面
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { getAdminWork, setAdminCover, restoreAdminCover, mediaUrl, authedUrl } from '../../api'
import type { AdminWorkDetail, MediaFile } from '../../api/types'

const props = defineProps<{ modelValue: boolean; rj: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'changed'): void }>()

const work = ref<AdminWorkDetail | null>(null)
const loading = ref(false)
const busy = ref(false)
const selected = ref<MediaFile | null>(null)
const coverVersion = ref(0)

interface TreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  file?: MediaFile
  children: TreeNode[]
}

/** 把作品文件夹里的图片文件按 rel_path 组装成目录树。 */
function buildTree(files: MediaFile[]): TreeNode[] {
  const root: TreeNode[] = []
  const byPath = new Map<string, TreeNode>()
  for (const f of files) {
    const parts = f.rel_path.split('/')
    let parent: TreeNode[] = root
    let cur = ''
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      cur = cur ? `${cur}/${part}` : part
      if (i === parts.length - 1) {
        parent.push({ name: part, path: cur, type: 'file', file: f, children: [] })
      } else {
        let dir = byPath.get(cur)
        if (!dir) {
          dir = { name: part, path: cur, type: 'dir', children: [] }
          byPath.set(cur, dir)
          parent.push(dir)
        }
        parent = dir.children
      }
    }
  }
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true })
    })
    for (const n of nodes) if (n.children.length) sortNodes(n.children)
  }
  sortNodes(root)
  return root
}

const imageFiles = computed(() => work.value?.files.filter((f) => f.kind === 'image') ?? [])
const imageCount = computed(() => imageFiles.value.length)
const treeData = computed(() => buildTree(imageFiles.value))

const previewUrl = computed(() => (selected.value ? mediaUrl(props.rj, selected.value.id) : ''))
const selectedName = computed(() => selected.value?.rel_path ?? '')
const coverModified = computed(() => !!work.value?.cover_modified)

async function open() {
  loading.value = true
  selected.value = null
  coverVersion.value = 0
  try {
    work.value = await getAdminWork(props.rj)
  } catch (e) {
    ElMessage.error('加载作品失败: ' + (e as Error).message)
    close()
  } finally {
    loading.value = false
  }
}
watch(
  () => props.modelValue,
  (v) => {
    if (v) void open()
  }
)

function onNodeClick(data: TreeNode) {
  if (data.type !== 'file' || !data.file) return
  selected.value = data.file
}

async function apply() {
  if (!selected.value) return
  busy.value = true
  try {
    await setAdminCover(props.rj, selected.value.id)
    ElMessage.success('已设为封面')
    coverVersion.value = Date.now()
    if (work.value) work.value.cover_modified = true
    emit('changed')
  } catch (e) {
    ElMessage.error('设置封面失败: ' + (e as Error).message)
  } finally {
    busy.value = false
  }
}

async function restore() {
  busy.value = true
  try {
    await restoreAdminCover(props.rj)
    ElMessage.success('已还原封面')
    coverVersion.value = Date.now()
    if (work.value) work.value.cover_modified = false
    emit('changed')
  } catch (e) {
    ElMessage.error('还原封面失败: ' + (e as Error).message)
  } finally {
    busy.value = false
  }
}

function close() {
  emit('update:modelValue', false)
}
function closed() {
  work.value = null
  selected.value = null
}
</script>

<style scoped>
.empty {
  padding: 30px 0;
  text-align: center;
  color: var(--muted);
}
.cover-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  font-size: 14px;
}
.label {
  color: var(--muted);
}
.thumb {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 6px;
  background: #0d0f12;
}
.no-cover {
  color: var(--muted);
}
.badge {
  font-size: 12px;
  color: #e8a55a;
  border: 1px solid #7a5a2a;
  background: #3a2d1a;
  padding: 2px 8px;
  border-radius: 10px;
}
.body {
  display: flex;
  gap: 14px;
  min-height: 320px;
}
.tree-pane {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  max-height: 400px;
  overflow: auto;
}
.pane-title {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 8px;
}
.tree-node {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.tree-icon {
  width: 18px;
  text-align: center;
  color: var(--muted);
}
.tree-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview-pane {
  flex: 1.2;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.preview {
  flex: 1;
  min-height: 240px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #0d0f12;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.preview-empty {
  color: var(--muted);
  font-size: 13px;
}
.preview-name {
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
