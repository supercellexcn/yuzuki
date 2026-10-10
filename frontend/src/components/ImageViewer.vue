<template>
  <teleport to="body">
    <div v-if="urls.length" class="viewer" @click.self="close">
      <img :src="urls[index]" alt="" />
      <button class="close" @click="close">✕</button>
      <template v-if="urls.length > 1">
        <button class="nav prev" title="上一张（←）" @click.stop="step(-1)">‹</button>
        <button class="nav next" title="下一张（→）" @click.stop="step(1)">›</button>
        <div class="counter">{{ index + 1 }} / {{ urls.length }}</div>
      </template>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

const props = defineProps<{ urls: string[]; index: number }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'update:index', v: number): void }>()

function close() {
  emit('close')
}

/** 上一张 / 下一张（首尾循环）。 */
function step(delta: number) {
  const n = props.urls.length
  if (n < 2) return
  emit('update:index', (props.index + delta + n) % n)
}

/** 方向键切换、Esc 关闭。查看器常驻挂载，无图时直接忽略。 */
function onKey(e: KeyboardEvent) {
  if (!props.urls.length) return
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
  max-height: 90vh;
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
.counter {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  color: #fff;
  font-size: 13px;
  background: rgba(20, 24, 30, 0.65);
  padding: 4px 12px;
  border-radius: 999px;
}
</style>
