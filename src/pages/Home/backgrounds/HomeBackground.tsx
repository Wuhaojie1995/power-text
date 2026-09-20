import { useEffect, useRef } from 'react'
import type { BackgroundId } from './types'
import { isThreeBackground, isWebglBackground } from './types'
import { SCENE_LOADERS } from './registry'

/** 各种背景的启动结果只要能释放就行，具体是 three 还是流体不关心 */
interface BackgroundHandle {
  dispose(): void
}

interface HomeBackgroundProps {
  background: BackgroundId
  /**
   * 是否真正渲染。
   * 浅色主题下传 false —— 这些背景的本质是「亮点在暗底上」，
   * 在浅色底上要么看不见、要么糊成脏点，不如直接不画，让页面回落到 CSS 背景。
   */
  active: boolean
}

/**
 * WebGL 背景的 React 承载层。
 *
 * 它只做四件事：挂一个 canvas、按背景类型挑一条启动路径、卸载时释放、尊重系统偏好。
 * 渲染细节一概不在这里：
 *   - three 场景  → three-scene.ts（通用外壳）+ scenes/（画面内容）
 *   - 流体模拟    → fluid-scene.ts（独立 WebGL 管线）
 *
 * 两种背景共用同一个 canvas 元素，而不是各自渲染一个 canvas：
 * 下面那条「换 canvas」的规则（见 return 处的 key）是踩过坑写下来的，
 * 复制两份迟早只改到一处。
 */
export default function HomeBackground({ background, active }: HomeBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!active || !isWebglBackground(background)) return

    const canvas = canvasRef.current
    if (!canvas) return

    // 尊重系统的「减少动态效果」：整屏持续运动的背景对前庭敏感人群很不友好。
    // 这里直接不启动 WebGL，页面自然回落到静态的 CSS 层。
    // （Home/index.tsx 里还有一层同样的判断，那次是为了决定要不要挂 has-webgl-bg 类。）
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let handle: BackgroundHandle | null = null
    let cancelled = false

    const boot = async () => {
      if (isThreeBackground(background)) {
        // 外壳和场景并行加载：两者都没有静态依赖 three，所以会一起触发 three 的下载
        const [mountModule, sceneModule] = await Promise.all([
          import('./three-scene'),
          SCENE_LOADERS[background](),
        ])
        if (cancelled) return

        const mounted = await mountModule.mountThreeBackground(canvas, sceneModule.createScene)
        if (cancelled) {
          // 启动过程中用户已经切走了，直接释放，避免留下一个没人管的 WebGL 上下文
          mounted.dispose()
          return
        }
        handle = mounted
        return
      }

      // 流体是独立的一条 WebGL 管线，不经过 three —— 选到它不会下载 three 相关的任何代码
      const { mountFluidBackground } = await import('./fluid-scene')
      if (cancelled) return
      handle = mountFluidBackground(canvas)
    }

    boot().catch((error) => {
      // 设备不支持 WebGL、上下文创建失败等都不该影响浏览作品集：
      // 底层的 CSS 背景还在，只是少了一层动效
      console.warn('[home-bg] 背景启动失败，已回落到静态背景：', error)
    })

    return () => {
      cancelled = true
      handle?.dispose()
      handle = null
    }
  }, [background, active])

  return (
    <canvas
      /*
       * key 必须跟着「背景 id + 是否启用」变，让每次挂载都拿到一个全新的 canvas 元素。
       *
       * 原因（踩过）：dispose() 里会主动丢掉 WebGL 上下文来让浏览器尽快回收显存，
       * 而 WebGL 规范规定同一个 canvas 上 getContext() 永远返回**首次**创建的那个对象——
       * 上下文丢失后它只会返回那个已丢失的 context（甚至 null），不会新建。
       * 于是第二次切换背景时 three 会在 new WebGLRenderer 里
       * `Cannot read properties of null (reading 'precision')` 直接抛错，
       * 表现成「切了没反应」（流体那条路径的报错会略有不同，机理一样）。
       * 换元素是唯一干净的解。
       */
      key={`${background}:${active ? 'on' : 'off'}`}
      ref={canvasRef}
      className="home-bg-canvas"
      aria-hidden="true"
    />
  )
}
