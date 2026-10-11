import type { Directive } from 'vue'

/** 长按触发时长（毫秒） */
const LONG_PRESS_MS = 550
/** 按住期间位移超过该值视为拖动/滚动，取消长按 */
const MOVE_THRESHOLD = 8
/** 长按触发后吞掉紧随 click 的窗口（毫秒） */
const CLICK_SUPPRESS_MS = 600

/** 长按回调；会收到触发长按的那次 pointerdown 事件（可用于取坐标定位弹层）。 */
type LongPressHandler = (e?: PointerEvent) => void

interface LongPressState {
  handler: LongPressHandler | undefined
  timer: ReturnType<typeof setTimeout> | null
  suppressTimer: ReturnType<typeof setTimeout> | null
  startX: number
  startY: number
  fired: boolean
  cleanup: (() => void) | null
}

const states = new WeakMap<HTMLElement, LongPressState>()

/**
 * 长按指令：`v-longpress="() => doSomething()"`。桌面鼠标与移动端触屏都可用。
 *
 * - pointerdown（左键/触摸）起 550ms 定时；位移 >8px 或提前抬起则取消（短按仍是普通 click）。
 * - 长按达成时：① 在 window 的 capture 阶段注册一次性 click 拦截器，吞掉长按后必然跟随的 click，
 *   避免触发父元素的 @click（如 WorkCard 导航、FilterMenu 选中）；② 保持 contextmenu 拦截
 *   直到手指/鼠标松开，避免移动端弹出系统菜单；③ 在 touchend/pointerup 上 preventDefault
 *   抑制合成 click。
 * - 内层元素的 pointerdown 会 stopPropagation，防止长按子元素时父卡片的长按也同时武装。
 * - `touch-action: manipulation` 减少浏览器手势（双击缩放/滚动判定）对长按的干扰。
 * - 拦截器带清理超时，防止用户长按后一直按住导致下一次无关点击被误吞。
 */
export const longpress: Directive<HTMLElement, LongPressHandler | undefined> = {
  mounted(el, binding) {
    const state: LongPressState = {
      handler: binding.value,
      timer: null,
      suppressTimer: null,
      startX: 0,
      startY: 0,
      fired: false,
      cleanup: null,
    }
    states.set(el, state)
    // 减少浏览器手势（滚动/双击缩放）对长按的干扰，且不影响普通触摸滚动
    el.style.touchAction = 'manipulation'

    // 移动端长按会弹系统菜单，按住期间一律屏蔽（同一引用，可反复 add/remove 不泄漏）
    const preventCtx = (ev: Event) => ev.preventDefault()

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const handler = state.handler
      if (typeof handler !== 'function') return
      // 只武装最内层的长按，不触发父卡片
      e.stopPropagation()

      state.startX = e.clientX
      state.startY = e.clientY
      state.fired = false
      if (state.timer) clearTimeout(state.timer)
      el.addEventListener('contextmenu', preventCtx)

      const cleanup = () => {
        if (state.timer) {
          clearTimeout(state.timer)
          state.timer = null
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancelEv)
        window.removeEventListener('touchend', onTouchEnd)
        el.removeEventListener('contextmenu', preventCtx)
      }

      const onMove = (ev: PointerEvent) => {
        if (state.fired) return // 已触发长按后不再因位移取消
        if (
          Math.abs(ev.clientX - state.startX) > MOVE_THRESHOLD ||
          Math.abs(ev.clientY - state.startY) > MOVE_THRESHOLD
        ) {
          cleanup()
        }
      }
      const onUp = (ev: Event) => {
        if (state.fired) {
          // 抑制长按后浏览器合成的 click（移动端）
          ev.preventDefault()
          ev.stopPropagation()
        }
        cleanup()
      }
      const onCancelEv = () => cleanup()
      const onTouchEnd = (ev: TouchEvent) => {
        if (state.fired) ev.preventDefault()
      }

      state.timer = setTimeout(() => {
        state.timer = null
        state.fired = true
        // 吞掉长按后必然跟随的那个 click：capture 阶段拦截，防止 WorkCard 导航 / FilterMenu 选中
        const suppressClick = (ev: Event) => {
          ev.stopPropagation()
          ev.preventDefault()
        }
        window.addEventListener('click', suppressClick, { capture: true, once: true })
        if (state.suppressTimer) clearTimeout(state.suppressTimer)
        state.suppressTimer = setTimeout(() => {
          window.removeEventListener('click', suppressClick, { capture: true })
          state.suppressTimer = null
        }, CLICK_SUPPRESS_MS)
        handler(e)
        // 注意：不在这里 cleanup —— 保持 contextmenu 拦截与 onUp/onTouchEnd 抑制直到手指/鼠标松开
      }, LONG_PRESS_MS)

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancelEv)
      window.addEventListener('touchend', onTouchEnd, { passive: false })
    }

    el.addEventListener('pointerdown', onPointerDown)
    state.cleanup = () => {
      if (state.timer) clearTimeout(state.timer)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('contextmenu', preventCtx)
    }
  },
  updated(el, binding) {
    // 绑定值变化时刷新 handler，保证 v-for 复用元素时触发的是最新回调
    const s = states.get(el)
    if (s) s.handler = binding.value
  },
  unmounted(el) {
    const s = states.get(el)
    if (!s) return
    s.cleanup?.()
    if (s.suppressTimer) clearTimeout(s.suppressTimer)
    states.delete(el)
  },
}
