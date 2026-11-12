import { computed, ref } from 'vue'
import { usePlayerStore } from '../stores/player'

/**
 * 进度条拖动：拖动中只更新本地预览值，松手才真正 seek。
 *
 * 直接把进度条绑到 `player.currentTime` 并每次 `input` 就 seek 会带来两个问题：
 * 1. 拖动途中 `timeupdate` 把中间位置写回进度条，受控 slider 立刻重绘，
 *    表现为「远距离拖动时进度点跳回」（几百 MB 的 flac 尤其明显）；
 * 2. 一次跨度的拖动会连发几十个 seek，每个都打断上一个 Range 请求。
 * 因此拖动期间冻结显示值，松手（change）才下发一次 seek。
 */
export function useSeekBar() {
  const player = usePlayerStore()
  const scrubbing = ref(false)
  const scrubValue = ref(0)
  /** 拖动中显示预览值，其余时间跟随播放进度 */
  const displayTime = computed(() => (scrubbing.value ? scrubValue.value : player.currentTime))

  const toNumber = (v: number | number[]): number => (Array.isArray(v) ? v[0] : v)

  function onInput(v: number | number[]) {
    const t = toNumber(v)
    if (!Number.isFinite(t)) return
    scrubbing.value = true
    scrubValue.value = t
  }

  function onChange(v: number | number[]) {
    const t = toNumber(v)
    scrubbing.value = false
    if (Number.isFinite(t)) player.seek(t)
  }

  return { scrubbing, scrubValue, displayTime, onInput, onChange }
}
