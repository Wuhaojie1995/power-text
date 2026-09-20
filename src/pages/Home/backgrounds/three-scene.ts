import type * as THREE_NS from 'three'
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

/**
 * three.js 背景的通用外壳。
 *
 * 这里统一负责「和业务无关、但每个场景都要写一遍」的事：
 * canvas 尺寸 / DPR、相机、帧循环与限帧、指针平滑、页面隐藏时暂停、
 * 可选的辉光后处理，以及卸载时把 GPU 资源全部释放干净。
 * 场景文件只需要关心「画什么」和「怎么动」。
 *
 * 关键设计：three 是通过 `await import('three')` 动态加载的。
 * 默认背景（蓝图流光）根本不会触发这里，所以首屏不会为 three 付任何下载成本。
 * 上面那两行 `import type` 是纯类型导入，编译后不留痕迹，不会把后处理链拖进主包。
 */

export interface SceneContext {
  /** three 命名空间，由外壳动态加载后注入 */
  THREE: typeof THREE_NS
  renderer: THREE_NS.WebGLRenderer
  scene: THREE_NS.Scene
  camera: THREE_NS.PerspectiveCamera
  /** 画布 CSS 像素尺寸（非物理像素） */
  width: number
  height: number
  /** 指针位置，范围 -1~1，屏幕中心为原点，已做平滑（指数逼近，与帧率无关） */
  pointer: { x: number; y: number }
  /** 场景启动至今的秒数 */
  time: number
  /** 距上一帧的秒数，已钳制上限，避免切回标签页时出现巨大跳变 */
  delta: number
  /**
   * 辉光参数控制器。只有场景声明了 `bloom` 才有值。
   * 场景可以在 update 里直接改它（例如做「呼吸」式的强弱起伏），改完下一帧生效。
   */
  bloom?: BloomController
}

/** 辉光参数。只有声明了它的场景才会走「渲染到纹理 → 提亮 → 多级模糊 → 叠回」这条链 */
export interface BloomOptions {
  /** 强度。1 左右已经很明显，超过 1.6 整片会发白糊掉 */
  strength?: number
  /** 扩散半径 0~1。越大光晕铺得越开、越像雾；越小越像硬边的霓虹灯管 */
  radius?: number
  /** 亮度阈值 0~1。低于它的像素完全不发光，所以调高 = 只有最亮的芯才发亮 */
  threshold?: number
}

/** 辉光的运行时参数。字段名与 UnrealBloomPass 对齐，可直接被场景改动 */
export interface BloomController {
  strength: number
  radius: number
  threshold: number
}

export interface SceneInstance {
  /** 每帧调用，场景在这里更新自己的对象 */
  update(ctx: SceneContext): void
  /** 尺寸变化时调用（首次挂载也会调一次），CSS 像素 */
  resize?(width: number, height: number): void
  /** 释放场景自己创建的 geometry / material / texture。外壳管不到这些 */
  dispose(): void
  /**
   * 需要辉光时返回参数；返回空则不走后处理，直接 render。
   *
   * 后处理不是白给的：多 4 个 pass、多几张全屏 render target，
   * 在集显上能吃掉一半帧率。所以由场景自己决定要不要，外壳不搞「默认开」。
   */
  bloom?: BloomOptions | null
}

export type SceneFactory = (ctx: SceneContext) => SceneInstance

export interface MountOptions {
  /** 帧率上限。纯装饰背景 30fps 足够，能明显降低风扇转速 */
  maxFps?: number
  /** 设备像素比上限。高分屏上按 1.75 渲染肉眼几乎无差，GPU 负载却低一截 */
  maxPixelRatio?: number
}

export interface ThreeBackgroundHandle {
  dispose(): void
}

const DEFAULT_MAX_FPS = 30
const DEFAULT_MAX_DPR = 1.75
/**
 * 后处理链的多重采样数。
 *
 * 为什么必须显式指定：**只要走了 EffectComposer，renderer 上的 `antialias: true` 就完全失效** ——
 * 后处理是先把场景渲染到离屏纹理，那一步不享受默认帧缓冲的 MSAA。
 * 以前场景里全是点云和细线，锯齿不明显；现在太阳系里有实心球体，
 * 没有 MSAA 的球边缘就是一格一格的阶梯。
 */
const MSAA_SAMPLES = 4

export async function mountThreeBackground(
  canvas: HTMLCanvasElement,
  createScene: SceneFactory,
  options: MountOptions = {},
): Promise<ThreeBackgroundHandle> {
  const THREE = await import('three')

  const maxFps = options.maxFps ?? DEFAULT_MAX_FPS
  const maxPixelRatio = options.maxPixelRatio ?? DEFAULT_MAX_DPR
  const frameInterval = maxFps > 0 ? 1000 / maxFps : 0

  const renderer = new THREE.WebGLRenderer({
    canvas,
    // 这个开关只对「不走后处理」的场景有效。声明了 bloom 的场景会渲染到离屏纹理，
    // 那条路径上的抗锯齿由 setupPost 里的 MSAA render target 负责（见 MSAA_SAMPLES）。
    // 保持 false 是因为开启它会额外分配一个带 MSAA 的默认帧缓冲，白白吃显存
    antialias: false,
    alpha: true,
    powerPreference: 'high-performance',
  })
  // 画布透明，露出页面自己的深色渐变，两层叠加才有层次
  renderer.setClearAlpha(0)

  const scene = new THREE.Scene()
  /**
   * near 压到 0.1 是为了让贴着镜头的物体也能画；far 给到 24000 是星系那套要的 ——
   * 星系盘中心在 z≈-7400，盘远端还要再往外两千多，6000 的远平面会把它整片裁掉
   * （症状是「场景跑起来了、控制台没报错、画面上什么都没有」）。
   *
   * 深度精度：near/far 跨了 24 万倍，24 位深度缓冲在盘那个距离上只剩几十单位的精度。
   * 这一页没有共面几何体（轨道环还特意关掉了 depthWrite），所以不构成问题。
   */
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 24000)

  const pointerTarget = { x: 0, y: 0 }
  const pointer = { x: 0, y: 0 }

  const ctx: SceneContext = {
    THREE,
    renderer,
    scene,
    camera,
    width: 0,
    height: 0,
    pointer,
    time: 0,
    delta: 0,
  }

  let instance: SceneInstance | null = null
  let composer: EffectComposer | null = null
  let bloomPass: UnrealBloomPass | null = null
  let width = 0
  let height = 0
  let elapsed = 0
  let lastFrameAt = 0
  let rafId = 0
  let disposed = false

  /**
   * 搭后处理链。
   *
   * 四个模块都走动态 import —— 否则只要有一个场景用辉光，
   * 所有 3D 背景的 chunk 里都会被塞进整条后处理链。
   *
   * pass 顺序不能变：RenderPass 把场景画进离屏纹理 → UnrealBloomPass 提亮、多级模糊后叠回去
   * → OutputPass 做线性转 sRGB。
   * 最后这步最容易漏：离屏渲染不会自动做色彩空间转换，少了 OutputPass 整屏会明显发暗发灰。
   */
  const setupPost = async (bloomOptions: BloomOptions) => {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/examples/jsm/postprocessing/EffectComposer.js'),
      import('three/examples/jsm/postprocessing/RenderPass.js'),
      import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
      import('three/examples/jsm/postprocessing/OutputPass.js'),
    ])

    // 自带 samples 的 render target：composer 内部会 clone 一份做 ping-pong，
    // RenderTarget.copy 里会把 samples 一起复制过去，所以两边都带上 MSAA。
    // 尺寸取 drawing buffer（已含 DPR），和 composer 默认那条路径保持一致
    const bufferSize = renderer.getDrawingBufferSize(new THREE.Vector2())
    const msaaTarget = new THREE.WebGLRenderTarget(bufferSize.width, bufferSize.height, {
      // 默认就是 HalfFloatType，保持不动 —— bloom 需要 HDR 的余量
      type: THREE.HalfFloatType,
      samples: MSAA_SAMPLES,
    })

    const nextComposer = new EffectComposer(renderer, msaaTarget)
    nextComposer.setPixelRatio(renderer.getPixelRatio())
    nextComposer.setSize(width, height)
    nextComposer.addPass(new RenderPass(scene, camera))

    // UnrealBloomPass 内部自己按传入分辨率的一半起算，逐级降到 1/32，所以这里给全尺寸即可
    const pass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      bloomOptions.strength ?? 0.9,
      bloomOptions.radius ?? 0.6,
      bloomOptions.threshold ?? 0.22,
    )
    nextComposer.addPass(pass)
    nextComposer.addPass(new OutputPass())

    composer = nextComposer
    bloomPass = pass
    // UnrealBloomPass 的这三个字段正好就是 BloomController 的形状，直接交出去，
    // 场景只看得见这三个数字，不用知道 pass 在哪
    ctx.bloom = pass
  }

  const applySize = () => {
    const nextWidth = Math.max(1, Math.round(canvas.clientWidth || 1))
    const nextHeight = Math.max(1, Math.round(canvas.clientHeight || 1))
    if (nextWidth === width && nextHeight === height) return

    width = nextWidth
    height = nextHeight
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio))
    // 第三个参数 false：不要用行内样式覆盖 canvas 尺寸，尺寸归 CSS 管
    renderer.setSize(width, height, false)
    // 后处理的 render target 不归 renderer 管，得自己同步，否则窗口一拉伸画面就糊
    composer?.setPixelRatio(renderer.getPixelRatio())
    composer?.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()

    ctx.width = width
    ctx.height = height
    instance?.resize?.(width, height)
  }

  const frame = (now: number) => {
    rafId = requestAnimationFrame(frame)

    // 限帧：不足一帧的间隔直接跳过渲染，但调度不停，保证时间轴连续
    if (lastFrameAt && frameInterval && now - lastFrameAt < frameInterval) return

    const delta = lastFrameAt ? Math.min((now - lastFrameAt) / 1000, 1 / 20) : 1 / 60
    lastFrameAt = now
    elapsed += delta

    // 指数逼近：1 - e^(-k·dt)，换帧率时观感一致
    const ease = 1 - Math.exp(-delta * 3)
    pointer.x += (pointerTarget.x - pointer.x) * ease
    pointer.y += (pointerTarget.y - pointer.y) * ease

    ctx.time = elapsed
    ctx.delta = delta
    instance?.update(ctx)
    if (composer) composer.render()
    else renderer.render(scene, camera)
  }

  const start = () => {
    if (rafId || disposed) return
    // 重置基准时间，否则恢复第一帧会算出一个巨大的 delta，画面会「跳」一下
    lastFrameAt = 0
    rafId = requestAnimationFrame(frame)
  }

  const stop = () => {
    if (!rafId) return
    cancelAnimationFrame(rafId)
    rafId = 0
  }

  const onPointerMove = (event: PointerEvent) => {
    pointerTarget.x = (event.clientX / window.innerWidth) * 2 - 1
    pointerTarget.y = -((event.clientY / window.innerHeight) * 2 - 1)
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') stop()
    else start()
  }

  const onContextLost = (event: Event) => {
    // 不 preventDefault 的话浏览器不会尝试恢复；这里主动停掉，避免控制台刷错误
    event.preventDefault()
    stop()
  }

  // 先建场景（它会设定 fov、fog 等相机/场景参数），再按尺寸初始化，
  // 最后才建后处理 —— 这样 composer 一出生就是正确的分辨率
  const created = createScene(ctx)
  instance = created
  applySize()
  if (created.bloom) await setupPost(created.bloom)

  window.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('visibilitychange', onVisibilityChange)
  canvas.addEventListener('webglcontextlost', onContextLost)

  const resizeObserver = new ResizeObserver(applySize)
  resizeObserver.observe(canvas)

  if (document.visibilityState !== 'hidden') start()

  return {
    dispose() {
      if (disposed) return
      disposed = true
      stop()
      resizeObserver.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      canvas.removeEventListener('webglcontextlost', onContextLost)

      instance?.dispose()
      instance = null

      // 兜底：场景可能往 scene 里塞了没在 dispose 里登记的零碎对象，
      // 漏一个就是一块显存泄漏，所以统一再扫一遍。
      scene.traverse((object) => {
        const mesh = object as THREE_NS.Mesh & {
          geometry?: THREE_NS.BufferGeometry
          material?: THREE_NS.Material | THREE_NS.Material[]
        }
        mesh.geometry?.dispose()
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
        materials.forEach((material) => {
          Object.values(material).forEach((value) => {
            if (value && typeof value === 'object' && 'isTexture' in value) {
              ;(value as THREE_NS.Texture).dispose()
            }
          })
          material.dispose()
        })
      })

      // 后处理的 render target 是显存大户（bloom 一张链就是十几个），
      // 必须显式释放，renderer.dispose() 管不到它们
      bloomPass?.dispose()
      bloomPass = null
      composer?.dispose()
      composer = null

      renderer.dispose()
      // 主动丢上下文，让浏览器尽快回收显存。
      // 注意：**丢过上下文的 canvas 不能再拿来新建 renderer** ——
      // WebGL 规范规定 getContext() 永远返回首次创建的那个对象，丢失后只会返回它（或 null）。
      // 所以 HomeBackground.tsx 里用 key 强制每次挂载都换一个新 canvas，两处是配套的，别单独删。
      renderer.forceContextLoss()
    },
  }
}
