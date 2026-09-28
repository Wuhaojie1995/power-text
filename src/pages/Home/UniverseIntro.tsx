import { useCallback, useEffect, useRef, useState } from 'react'
import { UNIVERSE_SCROLL_HINT, UNIVERSE_SKIP_LABEL, UNIVERSE_STAGES } from './content'
import { INTRO_STAGE_ENDS, INTRO_STAGE_VH, resetIntroProgress, setIntroProgress } from './introProgress'
import './universe-intro.less'

/**
 * 开场：从星系一路落到西安的一段锁定滚动叙事。
 *
 * 结构是「固定覆盖层 + 内部进度」，不是「高个子板块 + 吸顶」：
 *
 *   .home-intro          fixed —— 盖住视口的画面层，不占文档流
 *     .home-intro-canvas  画面
 *     .home-intro-stage   文案 / 刻度 / 跳过按钮
 *
 * 为什么改成锁定滚动：原来开场是插在首页前面的一段 8 倍屏高的真实滚动距离，
 * 走完之后浏览器停在页面中段，首页正文并不在顶部。现在开场期间整个页面
 * 被锁住（html/body overflow: hidden，始终停在 scrollY = 0），滚轮、触摸和
 * 键盘事件不再滚动页面，而是推进内部的目标进度；进度走完（或点了跳过），
 * 覆盖层卸载、滚动解锁 —— 此时首页正文恰好从顶部开始，一行都不会错位。
 *
 * 进度是整段的唯一真相：这里累计、写进 introProgress.ts，3D 场景和文案都读它。
 * 累计在 rAF 循环里做，每帧一次；写 DOM 的部分全走 style，不进 React ——
 * 这一页底下跑着 WebGL，每帧 setState 会把整棵首页子树重新渲染一遍。
 */

/** 进度到这个值算走完，触发收场 */
const FINISH_AT = 0.995
/** 回看时进度退到这个值算走完：从西安倒放回星系，同样要收场 */
const REWIND_FINISH_AT = 0.002
/**
 * 画面开始收场的进度。
 *
 * 压到 0.97 而不是更早：这最后一段正是「钟楼定格的画面」——镜头在 0.93 之后
 * 基本不再下降，0.94→0.97 是留给「看清钟楼」的一屏多一点滚动距离，
 * 收场（画面淡出、首页浮上来）只占最后百分之三。
 */
const FADE_FROM = 0.97
/** 进度逼近目标的速度（指数系数/秒）。越大跟手越紧，越小越「飘」 */
const EASE_RATE = 5
/** 跳过时的逼近速度。快但不瞬移 —— 半秒左右的高空俯冲，正好把最后一段风景带上 */
const SKIP_EASE_RATE = 14
/** 单次按键推进的虚拟滚动距离（相对每站行程的比例） */
const KEY_STEP_STAGES = 0.45

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1))
  return t * t * (3 - 2 * t)
}

/** 进度落在第几站（0 起）。切站只在跨过边界时 setState，一帧一次的写全走 DOM */
function stageIndexAt(progress: number): number {
  for (let i = 0; i < INTRO_STAGE_ENDS.length; i += 1) {
    if (progress < INTRO_STAGE_ENDS[i]) return i
  }
  return INTRO_STAGE_ENDS.length - 1
}

/** 第 i 站的进度跨度（占整段的比例） */
function stageSpanAt(index: number): number {
  return INTRO_STAGE_ENDS[index] - (index > 0 ? INTRO_STAGE_ENDS[index - 1] : 0)
}

/**
 * 第 i 站占的「虚拟滚动距离」（px）。
 *
 * 长度写在 introProgress.ts 的 INTRO_STAGE_VH 里，和分段边界同一份口径：
 * 基准 95vh，星系那两站更长。于是同一格滚轮在不同站上推进的进度不一样 ——
 * 想给某一站多留一点滚动时长，改那张表就够了，3D 那边一个字都不用动。
 */
function stagePx(index: number): number {
  return (INTRO_STAGE_VH[index] / 100) * Math.max(1, window.innerHeight)
}

interface UniverseIntroProps {
  /** 进度走完（或跳过）时通知首页：卸载覆盖层、解锁滚动 */
  onFinish: () => void
  /**
   * 起始进度。默认 0：首次开场，从星系正向播到西安。
   * 传 1 表示这是「回看」：首页顶端继续向上滚时重新进入，从西安倒着播回星系。
   */
  initialProgress?: number
}

export default function UniverseIntro({ onFinish, initialProgress = 0 }: UniverseIntroProps) {
  const rootRef = useRef<HTMLElement>(null)

  /**
   * 回看模式：收场要认低端阈值、跳过按钮要往回走、滚动提示不再出现。
   * 是个挂载期常量（不经 state），回看与否由 props 一次性决定。
   */
  const rewinding = initialProgress > 0.5
  /**
   * 真正的起点。
   *
   * 回看时故意退半步，从 FADE_FROM 起步而不是 1：1 是「已经收场」，
   * 那里的画面早被 --intro-fade 淡成黑的了，从黑屏开始倒放，
   * 用户得先滚掉一段才看得见东西。取 FADE_FROM 则画面正亮、
   * 文案还是最后一站，和刚落地那一刻所见完全一致。
   */
  const startRef = useRef(rewinding ? FADE_FROM : clamp01(initialProgress))
  /**
   * 进度真的被动过没有。
   *
   * 回看的起点就落在「走完」一侧（≥ FADE_FROM），不能一挂载就判收场，
   * 否则覆盖层刚出现就被卸载，回看变成闪一下。收场必须等进度先动一次。
   */
  const movedRef = useRef(false)

  /** 从起点对应的那一站开始，否则回看的第一帧会先闪一下第 0 站的文案 */
  const [stageIndex, setStageIndex] = useState(() => stageIndexAt(startRef.current))

  /** 进度的「目标」与「当前」。输入只改目标，当前值每帧向目标缓动 */
  const targetRef = useRef(startRef.current)
  const currentRef = useRef(startRef.current)
  /** 缓动速度。跳过时临时调快 */
  const easeRateRef = useRef(EASE_RATE)
  const rafRef = useRef(0)
  const lastTickRef = useRef(0)
  const finishedRef = useRef(false)

  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    onFinish()
  }, [onFinish])

  /** 把当前进度落到所有消费者：模块变量给 3D，CSS 变量给淡出，React 只管换站 */
  const apply = useCallback(
    (p: number) => {
      setIntroProgress(p)

      const root = rootRef.current
      if (root) {
        // 收场用同一个变量驱动画面和文案，两者不会各淡各的
        root.style.setProperty('--intro-fade', String(1 - smoothstep01(FADE_FROM, 1, p)))
      }

      setStageIndex((prev) => {
        const next = stageIndexAt(p)
        return prev === next ? prev : next
      })

      // 起点那一帧不算走完（回看的起点就在终点一侧），必须先真的推动过进度
      if (p !== startRef.current) movedRef.current = true
      if (!movedRef.current) return

      // 正向到 1 收场；回看则两头都收场 —— 退到星系、或又滑回西安，都该回首页
      if (p >= FINISH_AT || (rewinding && p <= REWIND_FINISH_AT)) finish()
    },
    [finish, rewinding],
  )

  // 主循环：缓动 + 应用。挂载期间常驻，页面被锁着不存在「滚出去」的问题
  useEffect(() => {
    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick)

      const dt = lastTickRef.current ? Math.min((now - lastTickRef.current) / 1000, 0.1) : 1 / 60
      lastTickRef.current = now

      const target = targetRef.current
      const current = currentRef.current
      if (current === target) return

      const next = current + (target - current) * (1 - Math.exp(-dt * easeRateRef.current))
      // 差距小于半像素就贴上，避免永远差一丁点不触发收场
      currentRef.current = Math.abs(target - next) < 0.0004 ? target : next
      apply(currentRef.current)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [apply])

  // 锁定页面滚动。开场期间首页正文在覆盖层底下原样待着，位置恒为顶部
  useEffect(() => {
    window.scrollTo(0, 0)
    const root = document.documentElement
    const prevHtmlOverflow = root.style.overflow
    const prevBodyOverflow = document.body.style.overflow
    root.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'

    return () => {
      root.style.overflow = prevHtmlOverflow
      document.body.style.overflow = prevBodyOverflow
      // 解锁瞬间把位置钉回顶部：开场结束 = 首页从第一屏开始
      window.scrollTo(0, 0)
    }
  }, [])

  // 画布重挂之后 --intro-fade 还是上一次的值，补一帧把画面接上
  useEffect(() => {
    apply(currentRef.current)
  }, [apply])

  /**
   * 挂载 three 场景。
   *
   * 外壳与场景并行动态加载：两者都没有静态依赖 three，会一起触发 three 的下载，
   * 首屏 bundle 里一个字节的 three 都不会有（和 HomeBackground 走的是同一条路）。
   *
   * 画布是这里现建、现挂、卸载时摘掉的，不在 JSX 里写 canvas 元素：
   * 下面的 dispose 会主动丢弃 WebGL 上下文来尽快还显存，而 WebGL 规范规定
   * 同一个 canvas 上的 getContext() 永远只返回**首次**创建的那个对象 ——
   * 上下文丢失后它只会返回那个已丢失的 context，甚至 null。
   * main.tsx 挂着 StrictMode，任何一次重新挂载都会让本 effect 重跑：
   * 复用同一个 canvas 的话，第二次 new WebGLRenderer 会直接抛
   * 「Cannot read properties of null (reading 'precision')」，开场变成一片黑。
   * 每次现建一个元素是这里唯一干净的解（HomeBackground 用的是等价的 key 方案）。
   */
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const canvas = document.createElement('canvas')
    canvas.className = 'home-intro-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    root.appendChild(canvas)

    let handle: { dispose(): void } | null = null
    let cancelled = false

    const boot = async () => {
      const [mountModule, sceneModule] = await Promise.all([
        import('./backgrounds/three-scene'),
        import('./backgrounds/scenes/universe-zoom'),
      ])
      if (cancelled) return

      // 60fps：这一屏是主角，不是背景。默认的 30fps 会让推进明显发涩
      const mounted = await mountModule.mountThreeBackground(canvas, sceneModule.createScene, {
        maxFps: 60,
      })
      if (cancelled) {
        mounted.dispose()
        return
      }
      handle = mounted
    }

    boot().catch((error) => {
      // 开场挂不起来不是致命错误：首页正文还在下面，直接放行
      console.warn('[home-intro] 开场画面启动失败：', error)
    })

    return () => {
      cancelled = true
      handle?.dispose()
      handle = null
      // 连同画布一起摘掉：下次挂载会现建一个新的
      canvas.remove()
    }
  }, [])

  useEffect(() => () => resetIntroProgress(), [])

  // ---------------- 输入：滚轮 / 触摸 / 键盘 ----------------
  useEffect(() => {
    /**
     * 滚动距离 → 进度。换算是**按当前这一站的行程**做（见 stagePx）：
     * 长站上同样一格滚轮推进得少、短站上推进得多，各站的滚动时长因此可以分别调，
     * 而画面本身与进度严格对应，观感不会因为改长度而变。
     */
    const advance = (deltaPx: number) => {
      const p = targetRef.current
      const index = stageIndexAt(p)
      targetRef.current = clamp01(p + (deltaPx * stageSpanAt(index)) / stagePx(index))
    }

    // passive: false 才能 preventDefault —— 不拦的话锁定前积累的惯性滚动会穿透
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const delta = event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY
      advance(delta)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // 按键步长与滚轮同一套口径：当前这一站行程的固定比例
      const step = KEY_STEP_STAGES * stagePx(stageIndexAt(targetRef.current))
      if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault()
        advance(step)
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        advance(-step)
      } else if (event.key === 'Home') {
        event.preventDefault()
        targetRef.current = 0
      } else if (event.key === 'End') {
        event.preventDefault()
        targetRef.current = 1
      }
    }

    let lastTouchY = 0
    const onTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (event: TouchEvent) => {
      event.preventDefault()
      const y = event.touches[0]?.clientY ?? 0
      advance(lastTouchY - y)
      lastTouchY = y
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('touchstart', onTouchStart, { passive: false })
    window.addEventListener('touchmove', onTouchMove, { passive: false })

    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
    }
    // 站与站的距离是模块级常量，不随渲染变；换算用的 ref 都是稳定的
  }, [])

  /** 跳过：目标直接设为行程的另一头，缓动速度临时调快 —— 是一次半秒的俯冲，不是瞬移 */
  const handleSkip = useCallback(() => {
    easeRateRef.current = SKIP_EASE_RATE
    targetRef.current = rewinding ? 0 : 1
  }, [rewinding])

  return (
    <section className="home-intro" ref={rootRef} aria-label="开场：从星系到西安">
      {/* 开场画面的 canvas 由上面那个 effect 现建后挂进来，原因见那里的注释 */}

      <div className="home-intro-stage">
        <div className="home-intro-copy">
          {UNIVERSE_STAGES.map((stage, index) => (
            <div
              key={stage.id}
              className={`home-intro-card${index === stageIndex ? ' is-active' : ''}`}
              aria-hidden={index !== stageIndex}
            >
              <span className="home-intro-eyebrow">{stage.eyebrow}</span>
              <h2 className="home-intro-title">{stage.title}</h2>
              <p className="home-intro-text">{stage.text}</p>
            </div>
          ))}
        </div>

        {/* 回看时不出现：那句提示是给首次进场的人「往下走」用的，倒着播的时候指错方向 */}
        <span className={`home-intro-hint${stageIndex === 0 && !rewinding ? ' is-on' : ''}`}>
          <i aria-hidden="true" />
          {UNIVERSE_SCROLL_HINT}
        </span>

        <button type="button" className="home-intro-skip" onClick={handleSkip}>
          {UNIVERSE_SKIP_LABEL}
        </button>
      </div>
    </section>
  )
}
