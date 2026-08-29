import { ref } from 'vue'

/** 与 CSS 断点一致（App.vue / 各组件用 @media (max-width: 760px)）。 */
const MOBILE_QUERY = '(max-width: 760px)'

let mql: MediaQueryList | null = null
let shared: ReturnType<typeof ref<boolean>> | null = null

/** 响应式判断当前是否为移动端视口。全站共享一个监听，多个组件调用不重复挂载。 */
export function useIsMobile() {
  if (typeof window === 'undefined') return ref(false)
  if (!mql) {
    mql = window.matchMedia(MOBILE_QUERY)
    shared = ref(mql.matches)
    mql.addEventListener('change', (e) => {
      if (shared) shared.value = e.matches
    })
  }
  return shared as ReturnType<typeof ref<boolean>>
}
