import { ElMessage, ElMessageBox } from 'element-plus'
import { mediaUrl, setWorkCover, uploadWallpaper } from '../api'
import type { MediaFile, WallpaperKind } from '../api/types'
import { useAppearance } from './useAppearance'

/**
 * 作品文件夹里某张图片可以做的三件事：设为封面 / 设为桌面壁纸 / 设为移动端壁纸。
 * 长按文件列表里的图片、以及在图片查看器里，都用这三个动作。
 */
export type ImageActionKind = 'cover' | 'wallpaper-desktop' | 'wallpaper-mobile'

export const IMAGE_ACTIONS: Array<{ kind: ImageActionKind; label: string; icon: string }> = [
  { kind: 'cover', label: '设为封面', icon: '🖼' },
  { kind: 'wallpaper-desktop', label: '桌面壁纸', icon: '🖥' },
  { kind: 'wallpaper-mobile', label: '移动壁纸', icon: '📱' },
]

/** 壁纸接口的体积上限（与后端一致，10MB）。 */
const MAX_WALLPAPER_BYTES = 10 * 1024 * 1024

/** 把作品里的某张图片读成 base64 —— 壁纸接口只接受 base64 JSON。 */
async function fetchImageBase64(rj: string, file: MediaFile): Promise<{ data: string; ext: string }> {
  const res = await fetch(mediaUrl(rj, file.id))
  if (!res.ok) throw new Error(`读取图片失败（HTTP ${res.status}）`)
  const blob = await res.blob()
  if (blob.size > MAX_WALLPAPER_BYTES) {
    throw new Error(`图片 ${(blob.size / 1024 / 1024).toFixed(1)}MB，超过壁纸 10MB 上限`)
  }
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
  if (!data) throw new Error('读取图片失败')
  return { data, ext }
}

/** 优先取后端返回的 error，否则退回 axios 的 message。 */
function errorText(e: unknown): string {
  const data = (e as { response?: { data?: { error?: string } } })?.response?.data
  return data?.error || (e as Error)?.message || '未知错误'
}

export function useImageActions() {
  const appearance = useAppearance()

  /**
   * 执行一个图片动作（带二次确认与结果提示）。
   * 返回是否真的改动成功 —— 调用方据此刷新封面缓存 / 界面。
   */
  async function run(action: ImageActionKind, rj: string, file: MediaFile): Promise<boolean> {
    const label = IMAGE_ACTIONS.find((a) => a.kind === action)?.label || '操作'
    try {
      await ElMessageBox.confirm(`将「${file.filename}」${label}？`, label, {
        type: 'warning',
        confirmButtonText: '确定',
        cancelButtonText: '取消',
      })
    } catch {
      return false // 用户取消
    }

    try {
      if (action === 'cover') {
        await setWorkCover(rj, file.id)
      } else {
        const kind: WallpaperKind = action === 'wallpaper-mobile' ? 'mobile' : 'desktop'
        const { data, ext } = await fetchImageBase64(rj, file)
        await uploadWallpaper(kind, data, ext)
        // 上传后让全局外观重新探测并应用，壁纸立即生效
        await appearance.bumpWallpaperVersion()
      }
      ElMessage.success(`已${label}`)
      return true
    } catch (e) {
      ElMessage.error(`${label}失败：${errorText(e)}`)
      return false
    }
  }

  return { run }
}
