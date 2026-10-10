<template>
  <div class="file-list">
    <div
      v-for="f in visibleFiles"
      :key="f.id"
      class="file-item"
      :class="{ dir: f.is_dir === 1, playing: isCurrent(f) }"
      :style="{ paddingLeft: 12 + depth(f) * 20 + 'px' }"
      @click="onClick(f)"
      v-longpress="f.is_dir !== 1 && f.kind === 'image' ? () => emit('set-cover', f) : undefined"
    >
      <span class="kind">
        <template v-if="f.is_dir === 1">{{ expanded.has(f.rel_path) ? '▾' : '▸' }}</template>
        <template v-else>{{ icon(f.kind) }}</template>
      </span>
      <span class="name">
        <span v-if="f.is_dir === 1" class="folder-icon">📁</span>{{ f.filename }}
      </span>
      <span v-if="f.is_dir !== 1" class="size">{{ formatSize(f.size) }}</span>
      <span v-if="f.is_dir !== 1 && actionLabel(f)" class="action">{{ actionLabel(f) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue'
import type { MediaFile, Work } from '../api/types'
import { usePlayerStore } from '../stores/player'
import { useIsMobile } from '../composables/useIsMobile'

const props = defineProps<{ files: MediaFile[]; rj: string; work?: Work | null }>()
const emit = defineEmits<{
  (e: 'open-image', f: MediaFile): void
  (e: 'set-cover', f: MediaFile): void
}>()
const isMobile = useIsMobile()

// 当前作品的可播放队列（音频+视频，按展示顺序），供上/下一曲使用
const playableQueue = computed(() =>
  props.files.filter((f) => f.is_dir !== 1 && (f.kind === 'audio' || f.kind === 'video'))
)

const player = usePlayerStore()
// 已展开目录的 rel_path 集合，初始为空 → 默认全部折叠
const expanded = reactive(new Set<string>())

function depth(f: MediaFile): number {
  return Math.max(0, f.rel_path.split('/').length - 1)
}

function isVisible(f: MediaFile): boolean {
  const ancestors = f.rel_path.split('/').slice(0, -1)
  return ancestors.every((_, i) => expanded.has(ancestors.slice(0, i + 1).join('/')))
}

const visibleFiles = computed(() => props.files.filter(isVisible))

function toggle(dir: string) {
  if (expanded.has(dir)) expanded.delete(dir)
  else expanded.add(dir)
}

function icon(kind: string): string {
  return { audio: '♪', video: '▶', image: '▣', other: '📄' }[kind] || '·'
}

function actionLabel(f: MediaFile): string {
  if (f.kind === 'image') return '查看'
  if (f.kind === 'audio' || f.kind === 'video') return '播放'
  return ''
}

/** 文件的目录（rel_path 去掉文件名）。 */
function dirOf(f: MediaFile): string {
  const i = f.rel_path.lastIndexOf('/')
  return i >= 0 ? f.rel_path.slice(0, i) : ''
}

function onClick(f: MediaFile) {
  if (f.is_dir === 1) {
    toggle(f.rel_path)
    return
  }
  if (f.kind === 'image') {
    emit('open-image', f)
    return
  }
  if (f.kind === 'audio' || f.kind === 'video') {
    // 移动端：点音频直接打开全屏播放器，播放列表/上一曲/下一曲限定为当前文件同目录的可播放文件
    if (isMobile.value) {
      const dirQueue = playableQueue.value.filter((x) => dirOf(x) === dirOf(f))
      player.openFullscreen(props.rj, props.work || null, dirQueue)
      player.play(props.rj, f, props.work || null, dirQueue)
    } else {
      player.play(props.rj, f, props.work || null, playableQueue.value)
    }
  }
}

function isCurrent(f: MediaFile): boolean {
  return player.current?.file.id === f.id
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>

<style scoped>
.file-list {
  display: flex;
  flex-direction: column;
  /* 主题底色 + 磨砂（模糊强度可在设置里改） */
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  backdrop-filter: blur(var(--filelist-blur));
}
.file-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 10px;
  padding-bottom: 10px;
  padding-right: 14px;
  border-bottom: 1px solid var(--border);
  font-size: 15px;
  cursor: pointer;
  user-select: none;
}
.file-item:last-child {
  border-bottom: none;
}
.file-item.dir {
  font-weight: 600;
}
.file-item:not(.dir):hover {
  background: rgba(34, 38, 45, 0.65);
}
.file-item.playing {
  background: var(--accent-soft);
  color: var(--accent);
}
.kind {
  width: 22px;
  text-align: center;
  flex-shrink: 0;
  color: var(--muted);
}
.folder-icon {
  margin-right: 6px;
}
.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.size {
  color: var(--muted);
  font-size: 13px;
  flex-shrink: 0;
}
.action {
  color: var(--muted);
  font-size: 13px;
  flex-shrink: 0;
}
</style>
