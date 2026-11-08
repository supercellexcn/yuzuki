<template>
  <button
    type="button"
    class="fav-star"
    :class="{ active: faved }"
    :title="faved ? '取消收藏' : '收藏'"
    @click.stop="toggle"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path :d="STAR_PATH" />
    </svg>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useFavoritesStore } from '../stores/favorites'
import { useFavorite } from '../composables/useFavorite'

const props = defineProps<{ rj: string }>()
const favorites = useFavoritesStore()
const { fav } = useFavorite()

/** 五角星路径与侧边栏星标一致 */
const STAR_PATH =
  'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z'

const faved = computed(() => favorites.isFav('work', props.rj))

function toggle() {
  void fav('work', props.rj)
}
</script>

<style scoped>
.fav-star {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 3;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  background: transparent;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.8));
  transition: color var(--anim-duration), transform var(--anim-duration);
  -webkit-tap-highlight-color: transparent;
}
.fav-star svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linejoin: round;
}
.fav-star.active {
  color: var(--accent);
}
.fav-star.active svg {
  fill: currentColor;
}
.fav-star:hover {
  transform: scale(1.1);
}
</style>
