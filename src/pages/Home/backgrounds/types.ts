/**
 * 登录页背景方案的「型号表」。
 *
 * 这里只放纯数据 + 纯函数，不 import three、也不 import React、更不 import 任何渲染代码，
 * 这样切换器 UI 可以随时读它，而渲染代码只在真正用到时才被下载。
 */

/** 全部可选背景 */
export type BackgroundId = 'blueprint' | 'particles' | 'starfield' | 'lensing' | 'galaxy' | 'fluid'

/** 依赖 WebGL 渲染的背景（其余由 CSS 画） */
export type WebglBackgroundId = Exclude<BackgroundId, 'blueprint'>

/**
 * 由 three.js 渲染的背景。
 *
 * 流体模拟虽然也是 WebGL，但走的是自己那条独立管线（fluid-scene.ts），
 * 不经过 three-scene.ts，也不下载 three —— 所以它必须从这一组里排掉。
 */
export type ThreeBackgroundId = Exclude<WebglBackgroundId, 'fluid'>

export interface BackgroundOption {
  id: BackgroundId
  /** 切换面板上显示的名字 */
  label: string
  /** 一句话说明，面板里显示在名字下面 */
  desc: string
  /** 是否由 WebGL 渲染。true 意味着：① 渲染代码走动态加载 ② 只在深色主题下生效 */
  webgl: boolean
  /** 名字后面的小角标：提醒这一项会额外拉一段不轻的渲染代码。没有角标就是纯 CSS */
  badge?: string
}

export const BACKGROUND_OPTIONS: readonly BackgroundOption[] = [
  { id: 'blueprint', label: '蓝图流光', desc: '网格与光束，工程图纸的秩序感', webgl: false },
  { id: 'particles', label: '粒子场', desc: '悬浮方块光点，点一下激起冲击波', webgl: true, badge: '3D' },
  { id: 'starfield', label: '深空星场', desc: '三层视差星点与银河，偶有流星划过', webgl: true, badge: '3D' },
  { id: 'lensing', label: '引力透镜', desc: '黑洞把背景星空拧成环，光子环勾出视界', webgl: true, badge: '3D' },
  { id: 'galaxy', label: '星系', desc: '螺旋星系斜陈深空，太阳系与地球在其中运转', webgl: true, badge: '3D' },
  { id: 'fluid', label: '流体模拟', desc: '彩色墨流在暗底上缓慢晕开，按住拖动可以搅动', webgl: true, badge: 'GPU' },
] as const

/** 默认背景：作品集首页要的第一眼观感，就是那团悬浮的方块光点 */
export const DEFAULT_BACKGROUND: BackgroundId = 'particles'

/** 存 localStorage 的键。注意 index.html 里的首屏底色脚本不读这个键，改名不影响它 */
export const BACKGROUND_STORAGE_KEY = 'patrol_login_bg'

export function isWebglBackground(id: BackgroundId): id is WebglBackgroundId {
  return BACKGROUND_OPTIONS.some((option) => option.id === id && option.webgl)
}

export function isThreeBackground(id: BackgroundId): id is ThreeBackgroundId {
  return isWebglBackground(id) && id !== 'fluid'
}

export function getBackgroundLabel(id: BackgroundId): string {
  return BACKGROUND_OPTIONS.find((option) => option.id === id)?.label ?? id
}
