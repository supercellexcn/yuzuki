<template>
  <el-dialog
    :model-value="modelValue"
    title="编辑标签"
    width="520px"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="tag-dialog">
      <div class="group">
        <div class="group-title">当前标签</div>
        <div v-if="!tags.length" class="empty">暂无标签</div>
        <div v-else class="tags">
          <!-- 系统标签（DLsite/hvdb 来源）：只读，不可移除 -->
          <el-tag v-for="t in nativeTags" :key="'n' + t.name + t.category" size="small" effect="plain">
            {{ t.name }}
          </el-tag>
          <!-- 自定义标签：可移除 -->
          <el-tag
            v-for="t in customTags"
            :key="'c' + t.name"
            size="small"
            class="tag-custom"
            closable
            :close-transition="false"
            @close="remove(t)"
          >
            {{ t.name }}
          </el-tag>
        </div>
      </div>

      <div class="group">
        <div class="group-title">添加自定义标签</div>
        <div class="add-row">
          <el-select
            v-model="adding"
            filterable
            placeholder="选择标签"
            style="width: 260px"
            size="default"
          >
            <el-option v-for="t in available" :key="t.name" :value="t.name" :label="t.name" />
          </el-select>
          <el-button type="primary" :disabled="!adding" :loading="busy" @click="add">添加</el-button>
        </div>
        <div v-if="!available.length" class="hint">
          没有可添加的自定义标签，请先在「标签管理」中添加。
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { getAdminTags, addWorkTag, removeWorkTag } from '../../api'
import { CUSTOM_TAG } from '../../api/types'
import type { AdminWork, WorkTag, AdminTag } from '../../api/types'

const props = defineProps<{ modelValue: boolean; work: AdminWork | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'changed'): void }>()

const pool = ref<AdminTag[]>([])
const adding = ref('')
const busy = ref(false)

const tags = computed<WorkTag[]>(() => props.work?.tags ?? [])
const nativeTags = computed(() => tags.value.filter((t) => t.category !== CUSTOM_TAG))
const customTags = computed(() => tags.value.filter((t) => t.category === CUSTOM_TAG))
const available = computed(() => {
  const onWork = new Set(customTags.value.map((t) => t.name))
  return pool.value.filter((t) => !onWork.has(t.name))
})

watch(
  () => props.modelValue,
  async (v) => {
    if (!v || !props.work) return
    adding.value = ''
    try {
      pool.value = await getAdminTags('custom')
    } catch {
      pool.value = []
    }
  }
)

async function remove(t: WorkTag) {
  if (!props.work) return
  busy.value = true
  try {
    await removeWorkTag(props.work.rj_code, t.name, t.category)
    const tags = props.work.tags
    const idx = tags.findIndex((x) => x.name === t.name && x.category === t.category)
    if (idx >= 0) tags.splice(idx, 1)
    ElMessage.success(`已移除「${t.name}」`)
    emit('changed')
  } catch (e) {
    ElMessage.error('移除失败: ' + (e as Error).message)
  } finally {
    busy.value = false
  }
}

async function add() {
  if (!props.work || !adding.value) return
  busy.value = true
  try {
    const name = adding.value
    await addWorkTag(props.work.rj_code, name)
    props.work.tags.push({ name, category: CUSTOM_TAG })
    adding.value = ''
    ElMessage.success(`已添加「${name}」`)
    emit('changed')
  } catch (e) {
    ElMessage.error('添加失败: ' + (e as Error).message)
  } finally {
    busy.value = false
  }
}

function close() {
  emit('update:modelValue', false)
}
</script>

<style scoped>
.tag-dialog {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.group-title {
  font-size: 13px;
  color: var(--muted);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.add-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.empty {
  color: var(--muted);
  font-size: 13px;
}
.hint {
  font-size: 12px;
  color: var(--muted);
}
</style>
