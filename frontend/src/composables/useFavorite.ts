import { ElMessage } from 'element-plus'
import { useFavoritesStore } from '../stores/favorites'
import type { FavoriteType } from '../api/types'

/** 长按收藏/取消收藏的统一入口：切换状态并弹提示（"已收藏xx" / "已取消收藏xx"）。 */
export function useFavorite() {
  const favorites = useFavoritesStore()

  async function fav(type: FavoriteType, value: string, extra = ''): Promise<void> {
    const name = type === 'work' ? String(value).toUpperCase() : String(value)
    const nowFav = await favorites.toggle(type, value, extra)
    ElMessage.success(nowFav ? `已收藏 ${name}` : `已取消收藏 ${name}`)
  }

  return { fav }
}
