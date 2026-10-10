import { ref, watch } from 'vue'

/**
 * 全局视图模式。目前只有「图片模式」：开启后作品卡片只保留图片部分
 * （封面 + 左上角 RJ 角标 + 封面上的标签），隐藏卡片下半部分的信息区。
 *
 * 属于纯前端显示偏好，按设备记在 localStorage（不同设备互不影响）。
 */

const KEY = 'yuzuki_image_only'

function readInitial(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

const imageOnly = ref(readInitial())

function syncHtmlClass(v: boolean): void {
  document.documentElement.classList.toggle('image-only', v)
}

// 初始化：把已保存的状态同步到 html（样式表用 html.image-only 隐藏卡片信息区）
syncHtmlClass(imageOnly.value)

watch(imageOnly, (v) => {
  try {
    localStorage.setItem(KEY, v ? '1' : '0')
  } catch {
    /* 隐私模式下写入失败，忽略 */
  }
  syncHtmlClass(v)
})

export function useViewMode() {
  return {
    imageOnly,
    toggleImageOnly() {
      imageOnly.value = !imageOnly.value
    },
  }
}
