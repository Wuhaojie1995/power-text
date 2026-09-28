/**
 * 开场「宇宙缩放」的共享约定：滚动进度、分段边界，以及「这段到底跑不跑得起来」。
 *
 * 为什么这些必须收在一个模块里：
 *
 * 1) **进度只能量一次**。3D 场景挂在 three-scene.ts 的外壳里，入口签名是固定的
 *    `(ctx) => instance`，拿不到组件里的 ref 和 scroll 监听；两边各量一次的话，
 *    只要量法有一点不同步（一边读 scrollY、一边读 offsetTop 加缓动），
 *    画面和文案就会错半屏 —— 这种错位在连续滚动里非常刺眼。
 *    所以约定：**只由 UniverseIntro.tsx 测量并写入，场景只读**。
 *    值域 0~1：0 = 还停在最远处的星系，1 = 已经落到西安。
 *
 * 2) **分段边界只能有一份**。文案、3D 切口、换卡的时机三处必须严格对齐，
 *    各写一份字面量迟早会错开（表现是「文案说到地球了，画面还在太阳系」）。
 *
 * 3) 能力探测（canRunIntro）放在组件文件里会让整个文件失去 Fast Refresh ——
 *    react-refresh 要求组件文件只导出组件。
 */

/**
 * 每一站的结束进度，起点是上一站的结束、最后一站的结束是 1。
 *
 * 三处同时遵守它：
 *   - content.ts 的 UNIVERSE_STAGES —— 数组长度必须与这里相等（一站一条文案）；
 *   - UniverseIntro.tsx —— 决定什么时候换文案；
 *   - scenes/universe-zoom.ts —— 切口（星流 / 云幕）必须落在这几条边界上。
 *
 * 间距不均匀是故意的：口径按「这一站要讲多少东西」定。走完星系只要一眼，
 * 地球到西安那段反而是重点，各给了更长的行程。
 */
export const INTRO_STAGE_ENDS: readonly number[] = [0.13, 0.26, 0.42, 0.56, 0.65, 0.75, 0.85, 1]

/**
 * 每一站的滚动距离（vh）—— 与 INTRO_STAGE_ENDS **一一对应，长度必须相等**。
 *
 * 为什么不写成「所有站共用一个数」：长度本身就是分段的叙事工具。
 * 95 是基准（「一屏多一点」，再短会觉得话没说完就被推走）。前几站更长：
 * 01 星系 130、02 银河系 180、03 太阳系 130 —— 这一段镜头几乎在原地逼近，
 * 画面层次最多（盘心一路长到太阳系），值得多停一会儿；其中 02、03 还特意加长，
 * 给「星系放大收尾 → 太阳系刚出现」之间、以及「太阳系放大」这一段多留滚动空间，
 * 滚起来不赶。
 *
 * 换算见 UniverseIntro.tsx：进度到滚动距离是**逐站**算的，同一格滚轮在长站上
 * 推进的进度少、短站上推进得多。所以这张表是「这一段能滚多久」唯一的口径，
 * 改它不需要动任何 3D 参数；反过来，改 3D 的轨道（CAM_Z / GROUND_DROP）也不会
 * 让这里的时长跟着变。
 *
 * 地表那几站不要再加长：那一段的节奏已经钉在两条轨道上，拉长只会让
 * 「每滚一屏放大多少倍」变乱 —— 要改观感得去改轨道。
 */
export const INTRO_STAGE_VH: readonly number[] = [130, 180, 130, 95, 95, 95, 95, 95]

let progress = 0

export function setIntroProgress(next: number): void {
  progress = next
}

export function getIntroProgress(): number {
  return progress
}

/** 组件卸载时归零，免得下次挂载的头一帧先用上一次的末值画一帧「西安」出来 */
export function resetIntroProgress(): void {
  progress = 0
}

/**
 * 这段开场跑不跑得起来。
 *
 * 任何一个条件不满足就整个不加载：系统开了「减少动态效果」（整屏连续运动对前庭敏感
 * 人群不友好，而且这里不是减速能解决的）、设备没有 WebGL、拿不到 canvas 上下文。
 * 返回 false 时首页会完全跳过开场，直接从首屏开始 —— 绝不能让人卡在一段
 * 八倍屏高、既滚不动又没画面的空白里。
 */
export function canRunIntro(): boolean {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false

    const probe = document.createElement('canvas')
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl')
    if (!gl) return false

    // 探测用的上下文要主动还回去：浏览器对同时存在的 WebGL 上下文数量有上限
    // （通常十几个），白白占着一个名额，真场景反而可能开不出来
    const lose = (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')
    lose?.loseContext()
    return true
  } catch {
    return false
  }
}
