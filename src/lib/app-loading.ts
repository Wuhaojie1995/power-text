/**
 * 首屏加载蒙层的收尾。
 *
 * 蒙层本身（DOM + 样式）写在 index.html 里，不是 React 组件 ——
 * 它要在 JS 包下载、解析、执行之前就出现，挂进 React 树里就晚了。
 * 所以那边只管画，这里只管摘，两边靠 #app-loading 这个 id 认领。
 */

/**
 * 最短展示时长（毫秒）。
 *
 * 本地起服务时，从按下刷新到 React 挂载可能只有一两百毫秒，
 * 蒙层一闪而过反而像是画面抖了一下 —— 比不显示更难看。
 *
 * 定在 1600ms 是把它当一次开场，而不是纯进度指示：波纹一圈 2.6s，
 * 500ms 就走了 1/5，看到的是个半截动作，三圈波纹也没铺开。
 * 1600ms 时前两圈已经拉开、第三圈刚出来，画面是完整的；再算上 480ms 淡出，
 * 实际停留约 2.1s。
 */
const MIN_VISIBLE_MS = 1600
/** 淡出时长。要和 index.html 里 #app-loading 的 transition 对上 */
const FADE_MS = 480
/**
 * 摘节点的兜底时限。
 *
 * 正常靠 transitionend 触发，但系统开了「减少动态效果」时过渡会被砍掉，
 * 那个事件就永远不来 —— 不能因为这个把一个全屏节点永久留在 DOM 上。
 */
const FALLBACK_MS = FADE_MS + 160

/** 摘掉首屏蒙层。由 main.tsx 在应用首次渲染之后调用 */
export function dismissAppLoading(): void {
  const splash = document.getElementById('app-loading')
  if (!splash) return

  // performance.now() 的原点是 navigationStart，也就是用户按下刷新那一刻，
  // 所以「已经展示了多久」直接就能算出来，不用在 HTML 里埋时间戳。
  const remaining = Math.max(0, MIN_VISIBLE_MS - performance.now())

  const finish = () => {
    // 这个类只服务蒙层，摘蒙层时一并清掉，别留在 <html> 上影响后续渲染
    document.documentElement.classList.remove('is-app-dark', 'is-app-light')

    const remove = () => splash.remove()
    splash.addEventListener('transitionend', remove, { once: true })
    splash.classList.add('is-done')
    window.setTimeout(remove, FALLBACK_MS)
  }

  if (remaining > 0) window.setTimeout(finish, remaining)
  else finish()
}
