<template>
  <canvas
    ref="canvasRef"
    class="site-icon"
    role="img"
    aria-label="Yuzuki"
    :style="{ width: size + 'px', height: size + 'px', borderRadius: radius + 'px' }"
  />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

/**
 * 站点图标：用 canvas 绘制 favicon。
 *
 * 部分手机浏览器（如 Via）的夜间模式会自动把 <img> 反色；canvas 里的像素
 * 不会被这类「图片反色」逻辑处理，因此这里用 canvas 保持插画原色。
 */
const props = withDefaults(defineProps<{ size?: number; radius?: number }>(), {
  size: 34,
  radius: 9,
})
const canvasRef = ref<HTMLCanvasElement | null>(null)

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  const img = new Image()
  img.decoding = 'async'
  img.onload = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const px = Math.max(1, Math.round(props.size * dpr))
    canvas.width = px
    canvas.height = px
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // 与 CSS 的 object-fit: cover 一致：等比放大并居中裁剪
    const scale = Math.max(px / img.naturalWidth, px / img.naturalHeight)
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    ctx.drawImage(img, (px - w) / 2, (px - h) / 2, w, h)
  }
  img.src = '/favicon.jpg'
})
</script>

<style scoped>
.site-icon {
  display: block;
  flex-shrink: 0;
}
</style>
