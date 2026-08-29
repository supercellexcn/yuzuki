<template>
  <Teleport to="body">
    <div v-if="work" class="fp-mask" @click.self="close">
      <div class="fp-panel">
        <div class="fp-head">
          <div class="fp-title-wrap">
            <div class="fp-work-title">{{ work.title || work.rj_code }}</div>
            <div class="fp-work-rj">{{ work.rj_code }}</div>
          </div>
          <button class="fp-close" @click="close">✕</button>
        </div>

        <!-- 所有内容以标签形式展示，点选即收藏/取消 -->
        <div class="fp-chips">
          <span class="fp-chip" :class="{ fav: isFav('work', rj) }" @click="toggle('work', rj)">
            <span class="dot work" /><span class="chip-name">{{ rj }}</span><i v-if="isFav('work', rj)" class="check">✓</i>
          </span>
          <span
            v-if="work.circle"
            class="fp-chip"
            :class="{ fav: isFav('circle', work.circle) }"
            @click="toggle('circle', work.circle)"
          >
            <span class="dot circle" /><span class="chip-name">{{ work.circle }}</span
            ><i v-if="isFav('circle', work.circle)" class="check">✓</i>
          </span>
          <span
            v-for="a in work.actors"
            :key="'a' + a"
            class="fp-chip"
            :class="{ fav: isFav('actor', a) }"
            @click="toggle('actor', a)"
          >
            <span class="dot actor" /><span class="chip-name">{{ a }}</span><i v-if="isFav('actor', a)" class="check">✓</i>
          </span>
          <span
            v-for="t in work.tags"
            :key="'t' + t.name + t.category"
            class="fp-chip"
            :class="{ fav: isFav('tag', t.name, t.category) }"
            @click="toggle('tag', t.name, t.category)"
          >
            <span class="dot tag" /><span class="chip-name">{{ t.name }}</span
            ><i v-if="isFav('tag', t.name, t.category)" class="check">✓</i>
          </span>
          <div v-if="!work.actors.length && !work.tags.length && !work.circle" class="fp-empty">没有可收藏的内容</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFavoritesStore } from '../stores/favorites'
import type { FavoriteType } from '../api/types'

const favorites = useFavoritesStore()
const work = computed(() => favorites.pickerWork)
const rj = computed(() => work.value?.rj_code || '')

// 页面滚动时自动关闭（非 capture 的 window scroll 只响应页面滚动，不影响面板内标签列表自身的滚动）
function closeOnPageScroll() {
  if (favorites.pickerWork) favorites.closePicker()
}
onMounted(() => window.addEventListener('scroll', closeOnPageScroll, { passive: true }))
onUnmounted(() => window.removeEventListener('scroll', closeOnPageScroll))

function isFav(type: FavoriteType, value: string, extra = ''): boolean {
  return favorites.isFav(type, value, extra)
}

/** 点选标签：未收藏 → 直接收藏；已收藏（置灰）→ 弹确认后取消。 */
async function toggle(type: FavoriteType, value: string, extra = '') {
  if (favorites.isFav(type, value, extra)) {
    try {
      await ElMessageBox.confirm(`确认取消收藏「${value}」？`, '取消收藏', {
        type: 'warning',
        confirmButtonText: '取消收藏',
        cancelButtonText: '再想想',
      })
    } catch {
      return
    }
    await favorites.toggle(type, value, extra)
    ElMessage.success(`已取消收藏 ${value}`)
  } else {
    await favorites.toggle(type, value, extra)
    ElMessage.success(`已收藏 ${value}`)
  }
}

function close() {
  favorites.closePicker()
}
</script>

<style scoped>
.fp-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
/* 居中偏下一点，方便移动端拇指操作 */
.fp-panel {
  width: min(92vw, 460px);
  max-height: 80vh;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translateY(6vh);
}
.fp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.fp-title-wrap {
  min-width: 0;
}
.fp-work-title {
  font-size: 15px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fp-work-rj {
  font-size: 12px;
  color: var(--muted);
  font-family: Consolas, monospace;
}
.fp-close {
  background: transparent;
  border: none;
  color: var(--muted);
  font-size: 16px;
  cursor: pointer;
  flex-shrink: 0;
}
/* 标签区 */
.fp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 16px 18px;
  max-height: 52vh;
  overflow-y: auto;
  align-content: flex-start;
}
.fp-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border-radius: 16px;
  background: #262b33;
  color: #d3d9e3;
  font-size: 14px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.12s;
  user-select: none;
}
.fp-chip:active {
  transform: scale(0.96);
}
/* 已收藏：置灰 + 描边 */
.fp-chip.fav {
  opacity: 0.45;
  border-color: var(--muted);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot.work {
  background: var(--accent);
}
.dot.circle {
  background: #7bd88f;
}
.dot.actor {
  background: #9db8e6;
}
.dot.tag {
  background: #c3cbd7;
}
.chip-name {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.check {
  font-style: normal;
  color: var(--accent);
  font-size: 12px;
}
.fp-chip.fav .check {
  color: var(--muted);
}
.fp-empty {
  width: 100%;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  padding: 20px 0;
}
</style>
