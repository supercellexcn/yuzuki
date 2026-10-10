<template>
  <div v-if="player.current" class="bottom-player">
    <div class="cover" title="回到播放源" @click="goSource">
      <img v-if="coverUrl" :src="coverUrl" alt="" />
      <div v-else class="no-cover">{{ player.current.rj }}</div>
    </div>

    <div class="title" @click="goSource" :title="titleText">{{ titleText }}</div>

    <div class="progress">
      <el-slider
        :model-value="player.currentTime"
        :max="player.duration || 1"
        :step="0.1"
        :show-tooltip="false"
        @input="onSeek"
      />
      <div class="times">
        <span>{{ fmt(player.currentTime) }}</span>
        <span>{{ fmt(player.duration) }}</span>
      </div>
    </div>

    <div class="controls">
      <button
        class="ctrl"
        :class="{ active: player.loop }"
        :title="player.loop ? '重复播放（开）' : '重复播放（关）'"
        @click="player.toggleLoop()"
      >
        🔁
      </button>
      <button class="ctrl" title="上一曲" @click="player.prev()">⏮</button>
      <button class="ctrl" :title="`快退 ${seekSecs} 秒`" @click="player.seekBy(-seekSecs)">
        -{{ seekSecs }}
      </button>
      <button class="btn main" @click="player.toggle()"><PlayPauseIcon :playing="player.playing" /></button>
      <button class="ctrl" :title="`快进 ${seekSecs} 秒`" @click="player.seekBy(seekSecs)">
        +{{ seekSecs }}
      </button>
      <button class="ctrl" title="下一曲" @click="player.next()">⏭</button>
      <button class="ctrl expand" title="全屏播放器" @click="player.openFullscreenFromCurrent()">⛶</button>
    </div>

    <div class="volume">
      <span class="vol-icon">🔊</span>
      <el-slider
        :model-value="player.volume * 100"
        :max="100"
        style="width: 80px"
        @input="(v: number | number[]) => player.setVolume((Array.isArray(v) ? v[0] : v) / 100)"
      />
    </div>

    <button class="btn stop" title="停止并关闭" @click="player.stop()">✕</button>
    <!-- 移动端迷你条幅右侧的播放/暂停切换 -->
    <button class="btn mobile-toggle" :title="player.playing ? '暂停' : '播放'" @click="player.toggle()">
      <PlayPauseIcon :playing="player.playing" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePlayerStore } from '../stores/player'
import { useSettingsStore } from '../stores/settings'
import { useIsMobile } from '../composables/useIsMobile'
import { authedUrl } from '../api'
import PlayPauseIcon from './PlayPauseIcon.vue'

const player = usePlayerStore()
const settings = useSettingsStore()
const router = useRouter()
const isMobile = useIsMobile()

const seekSecs = computed(() => settings.settings?.seek_seconds || 15)
// 显示当前播放的文件名（而非作品名）
const titleText = computed(() => player.current?.file.filename || player.current?.rj || '')
const coverUrl = computed(() => authedUrl(player.current?.work?.cover_url || ''))

onMounted(() => {
  if (!settings.settings) settings.load().catch(() => {})
})

function onSeek(v: number | number[]) {
  player.seek(Array.isArray(v) ? v[0] : v)
}

/** 点击封面/标题：移动端打开全屏播放器，桌面端跳到详情页（push 入历史栈，返回可自然回退） */
function goSource() {
  if (!player.current) return
  if (isMobile.value) {
    player.openFullscreenFromCurrent()
  } else {
    router.push({ name: 'player', params: { rj: player.current.rj } })
  }
}

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<style scoped>
.bottom-player {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  /* 与全站一致：半透明 + 磨砂，主按钮/悬停框线跟随主题色（--accent） */
  background: var(--panel);
  backdrop-filter: blur(var(--card-blur));
  border-top: 1px solid var(--border);
  z-index: 200;
  display: grid;
  /* 桌面：封面 | 标题(上) / 进度(下) | 控件 | 音量 | 关闭 */
  grid-template-areas:
    'cover title controls volume stop'
    'cover progress controls volume stop';
  grid-template-columns: auto minmax(0, 1fr) auto auto auto;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 16px;
  row-gap: 2px;
  padding: 12px 24px;
}
.cover {
  grid-area: cover;
  width: 56px;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  background: #0d0f12;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.no-cover {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 9px;
}
.title {
  grid-area: title;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  min-width: 0;
}
.progress {
  grid-area: progress;
  min-width: 0;
}
.times {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--muted);
  margin-top: -4px;
}
.controls {
  grid-area: controls;
  display: flex;
  align-items: center;
  gap: 6px;
  align-self: center;
}
.ctrl {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 50%;
  width: 36px;
  height: 36px;
  cursor: pointer;
  flex-shrink: 0;
  font-size: 13px;
  transition: all 0.12s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ctrl:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.ctrl.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}
.btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 50%;
  width: 36px;
  height: 36px;
  cursor: pointer;
  flex-shrink: 0;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.btn.main {
  width: 44px;
  height: 44px;
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
  font-size: 15px;
}
.btn.main:hover {
  filter: brightness(1.1);
}
.stop {
  grid-area: stop;
}
.volume {
  grid-area: volume;
  display: flex;
  align-items: center;
  gap: 6px;
}
.vol-icon {
  font-size: 14px;
}

/* 移动端迷你条幅：封面 | 标题 | 播放/暂停（进度/控件/音量/关闭全部收进全屏播放器） */
.mobile-toggle {
  display: none;
}
@media (max-width: 760px) {
  .bottom-player {
    grid-template-areas: 'cover title toggle';
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-rows: auto;
    column-gap: 10px;
    row-gap: 0;
    padding: 8px 12px;
  }
  .cover {
    width: 40px;
    height: 40px;
  }
  .title {
    font-size: 13px;
  }
  .progress,
  .controls,
  .volume,
  .stop {
    display: none;
  }
  .mobile-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg);
    font-size: 15px;
    justify-self: end;
  }
}
</style>
