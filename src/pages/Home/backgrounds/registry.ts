import type { SceneFactory } from './three-scene'
import type { ThreeBackgroundId } from './types'

/**
 * three 背景 id → 场景模块的懒加载函数。
 *
 * 写成「函数」而不是直接 import，是为了让每个场景各自成为独立 chunk：
 * 默认背景（蓝图流光）不会下载任何 three 相关代码，
 * 只有用户真的切到某个 3D 背景时，对应的场景 + three 本体才会被请求。
 * 后处理链（EffectComposer 等）又比场景更深一层，只有声明了 bloom 的场景才拉得动它。
 *
 * 注意这里收的是 ThreeBackgroundId 而不是全部 WebglBackgroundId：
 * 流体模拟不在这里，它的入口在 fluid-scene.ts。
 */
export const SCENE_LOADERS: Record<ThreeBackgroundId, () => Promise<{ createScene: SceneFactory }>> = {
  particles: () => import('./scenes/particle-field'),
  starfield: () => import('./scenes/starfield'),
  lensing: () => import('./scenes/lensing'),
  galaxy: () => import('./scenes/galaxy'),
}
