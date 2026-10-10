<template>
  <teleport to="body">
    <div v-if="files.length" class="viewer" @click.self="close">
      <img :src="urls[index]" alt="" />
      <button class="close" @click="close">✕</button>
      <template v-if="files.length > 1">
        <button class="nav prev" title="上一张（←）" @click.stop="step(-1)">‹</button>
        <button class="nav next" title="下一张（→）" @click.stop="step(1)">›</button>
      </template>

      <!-- 底部：页码 + 当前图片可执行的三个动作（设为封面 / 桌面壁纸 / 移动壁纸） -->
      <div class="bottom">
        <div v-if="files.length > 1" class="counter">{{ index + 1 }} / {{ files.length }}</div>
        <ImageActions :busy="busy" @pick="onPick" />
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { mediaUrl } from '../api'
import type { MediaFile } from '../api/types'
import { useImageActions, type ImageActionKind } from '../composables/useImageActions'
import ImageActions from './ImageActions.vue'

const props = defineProps<{ rj: string; files: MediaFile[]; index: number }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:index', v: number): void
  (e: 'changed', kind: ImageActionKind): void
}>()

const { run } = useImageActions()
const busy = ref(false)

/** 图片 URL 由 rj + 文件 id 现算，避免父级再维护一份列表。 */
const urls = computed(() => props.files.map((f) => mediaUrl(props.rj, f.id)))

function close() {
  emit('close')
}

/** 上一张 / 下一张（首尾循环）。 */
function step(delta: number) {
  const n = props.files.length
  if (n < 2) return
  emit('update:index', (props.index + delta + n) % n)
}

/** 执行选中的动作；改动成功后通知父级刷新（例如封面缓存）。 */
async function onPick(kind: ImageActionKind) {
  const file = props.files[props.index]
  if (!file || busy.value) return
  busy.value = true
  try {
    if (await run(kind, props.rj, file)) emit('changed', kind)
  } finally {
    busy.value = false
  }
}

/** 方向键切换、Esc 关闭。查看器常驻挂载，无图时直接忽略。 */
function onKey(e: KeyboardEvent) {
  if (!props.files.length) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowLeft') step(-1)
  else if (e.key === 'ArrowRight') step(1)
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.viewer img {
  max-width: 90vw;
  /* 给底部动作条留出空间，避免图片被挡住 */
  max-height: 74vh;
  border-radius: 8px;
}
.close {
  position: absolute;
  top: 20px;
  right: 24px;
  background: transparent;
  border: none;
  color: #fff;
  font-size: 26px;
  cursor: pointer;
}
.nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: rgba(20, 24, 30, 0.65);
  color: #fff;
  font-size: 30px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-bottom: 4px;
  transition: background 0.12s;
}
.nav:hover {
  background: var(--accent);
  color: var(--accent-fg);
}
.nav.prev {
  left: 20px;
}
.nav.next {
  right: 20px;
}
.bottom {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 14px 16px 20px;
}
.counter {
  color: #fff;
  font-size: 13px;
  background: rgba(20, 24, 30, 0.65);
  padding: 4px 12px;
  border-radius: 999px;
}
@media (max-width: 640px) {
  /* 窄屏时三个按钮竖排，避免挤成一条 */
  .bottom :deep(.image-actions) {
    flex-direction: column;
    align-self: stretch;
  }
  .bottom :deep(.act) {
    justify-content: flex-start;
  }
}
</style>
