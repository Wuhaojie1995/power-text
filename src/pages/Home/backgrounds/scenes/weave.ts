import type { SceneContext, SceneInstance } from '../three-scene'

/**
 * 光织 —— 三百多根发光细丝在空间里扭结成束，像一束被拉直的光纤。
 *
 * 为什么是「丝」而不是「粒子」：粒子云要好看就得密，而屏幕上每平方厘米要多少个点
 * 是跟视角、距离强相关的，一调就崩（铺在地上的粒子海尤其没救 ——
 * 视场宽度从近端几百单位涨到远端几千单位，同一份粒子数不可能两头都够密）。
 * 细丝没有这个问题：**一根丝就是一个连续的几何体**，多长都只占屏幕上一像素宽。
 * 而 1px 宽本身就是极低的光污染 —— 亮度全在细线上，暗部占满整屏。
 *
 * 结构上它是一束绕 Z 轴扭转的螺旋：
 * - 每根丝有自己的**半径**和**初相位**，所以它们不会挤成一坨；
 * - 扭转角速度**随半径变化** —— 内圈转得快、外圈转得慢。
 *   这一条是「织」和「拧」的分界：转速一致的话所有丝平行推进，看着就是一根麻花；
 *   转速有差，内外圈才会互相穿插、编出经纬；
 * - 再叠一层沿 Z 的慢速摆动，整束就有了收放，不会像根死掉的弹簧。
 *
 * 所有位置都在**顶点着色器里算**，CPU 每帧只更新两个 uniform。
 * 六万多个顶点如果每帧在 JS 里重算再上传，光这一步就能吃掉一半帧率。
 */

/** 丝的根数。少于此数束会显得空，多了只是堆叠、看不出层次 */
const STRAND_COUNT = 320
/** 每根丝的采样点数。点越密曲线越顺，但要乘上根数一起算顶点总量 */
const SEGMENTS = 110

/** 丝束沿自身轴线的范围。近端在相机身后，所以画面里看到的是中段和远端 */
const NEAR_Z = 600
const FAR_Z = -4400

/** 螺旋半径范围。相机在轴上，所以这个范围同时也是「视野被填多满」 */
const RADIUS_MIN = 260
const RADIUS_MAX = 1500

/** 扭转速率：内圈 / 外圈（每单位 Z 转过的弧度） */
const TWIST_INNER = 0.00245
const TWIST_OUTER = 0.00095

/** 整体绕轴自转的角速度 */
const SPIN_SPEED = 0.055

/**
 * 丝束的朝向。绕 Y 转出去、再绕 X 压一下，让它**斜穿画面**。
 * 不转的话轴线正对镜头，一圈圈的丝会变成同心圆环 —— 那就成了「光速跃迁」，白做。
 */
const TILT_Y = 0.52
const TILT_X = 0.34

/** 冷色三段：深青 → 冰青 → 柔紫。只用冷色，不铺彩虹 */
const PALETTE = [
  [0.16, 0.72, 0.84],
  [0.62, 0.93, 1.0],
  [0.56, 0.5, 1.0],
] as const

export function createScene(ctx: SceneContext): SceneInstance {
  const { THREE, scene, camera } = ctx

  camera.fov = 60
  camera.updateProjectionMatrix()

  const disposables: Array<{ dispose(): void }> = []

  const perStrand = (SEGMENTS - 1) * 2
  const vertexCount = STRAND_COUNT * perStrand

  // position 只用来撑出顶点数量，真正的坐标在顶点着色器里算。
  // 用自定义属性承载「这根丝是谁、走到哪了」，比在 JS 里每帧重算并上传省得多。
  const positions = new Float32Array(vertexCount * 3)
  const params = new Float32Array(vertexCount * 3)
  const tints = new Float32Array(vertexCount * 3)
  const steps = new Float32Array(vertexCount)

  const tint = new THREE.Color()

  for (let s = 0; s < STRAND_COUNT; s += 1) {
    const radial = STRAND_COUNT > 1 ? s / (STRAND_COUNT - 1) : 0
    const radius = RADIUS_MIN + radial * (RADIUS_MAX - RADIUS_MIN)
    // 相位用黄金角铺开，相邻丝的初相位差得远，束才不会出现一整条空隙
    const phase = s * 2.39996 + radial * 0.9

    // 颜色沿径向渐变：芯部冰青、外圈柔紫，中间过渡
    if (radial < 0.5) {
      const k = radial / 0.5
      tint.setRGB(
        PALETTE[0][0] + (PALETTE[1][0] - PALETTE[0][0]) * k,
        PALETTE[0][1] + (PALETTE[1][1] - PALETTE[0][1]) * k,
        PALETTE[0][2] + (PALETTE[1][2] - PALETTE[0][2]) * k,
      )
    } else {
      const k = (radial - 0.5) / 0.5
      tint.setRGB(
        PALETTE[1][0] + (PALETTE[2][0] - PALETTE[1][0]) * k,
        PALETTE[1][1] + (PALETTE[2][1] - PALETTE[1][1]) * k,
        PALETTE[1][2] + (PALETTE[2][2] - PALETTE[1][2]) * k,
      )
    }

    const base = s * perStrand
    for (let seg = 0; seg < SEGMENTS - 1; seg += 1) {
      const t0 = seg / (SEGMENTS - 1)
      const t1 = (seg + 1) / (SEGMENTS - 1)
      const a = base + seg * 2
      const b = a + 1
      for (const [vi, t] of [
        [a, t0],
        [b, t1],
      ] as const) {
        params[vi * 3] = phase
        params[vi * 3 + 1] = radius
        params[vi * 3 + 2] = radial
        tints[vi * 3] = tint.r
        tints[vi * 3 + 1] = tint.g
        tints[vi * 3 + 2] = tint.b
        steps[vi] = t
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aParams', new THREE.BufferAttribute(params, 3))
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 3))
  geometry.setAttribute('aStep', new THREE.BufferAttribute(steps, 1))
  disposables.push(geometry)

  const material = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uNear: { value: NEAR_Z },
      uFar: { value: FAR_Z },
      uTwistInner: { value: TWIST_INNER },
      uTwistOuter: { value: TWIST_OUTER },
      uSpin: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aParams;   // x: 初相位  y: 螺旋半径  z: 归一化径向位置 0~1
      attribute vec3 aTint;
      attribute float aStep;    // 0~1，沿这根丝从近到远

      uniform float uTime;
      uniform float uNear;
      uniform float uFar;
      uniform float uTwistInner;
      uniform float uTwistOuter;
      uniform float uSpin;

      varying vec3 vColor;
      varying float vBright;

      void main() {
        float phase = aParams.x;
        float radius = aParams.y;
        float radial = aParams.z;

        // 沿轴线的位置：aStep 0 在近端、1 在远端
        float z = mix(uNear, uFar, aStep);

        // 扭转速率随半径递减 —— 内外圈转速有差，丝才会互相穿插、编出经纬。
        // 速率一致的话所有丝平行推进，看着只是一根麻花
        float twist = mix(uTwistInner, uTwistOuter, radial);
        float angle = phase + z * twist + uSpin;

        // 再叠一层沿轴的慢速摆动，整束有收放，不至于像根死掉的弹簧
        angle += sin(z * 0.0009 + uTime * 0.25 + phase) * 0.42;

        // 半径也随位置起伏，束身就有了粗细变化
        float r = radius * (1.0 + 0.17 * sin(z * 0.0012 - uTime * 0.31 + phase * 1.7));

        vec3 local = vec3(cos(angle) * r, sin(angle) * r, z);
        vec4 mv = modelViewMatrix * vec4(local, 1.0);
        gl_Position = projectionMatrix * mv;

        // 两端淡出。
        // 远端必须淡得早（从 0.35 就开始），这是整套亮度的命门：
        // 丝束的远端在屏幕上被压缩成很小一块，几百根丝加法叠在一起会烧出一个白核 ——
        // 那就是最典型的光污染。让它提前化进黑暗里，比事后调辉光有效得多
        float endFade = smoothstep(0.0, 0.18, aStep) * (1.0 - smoothstep(0.35, 0.80, aStep));
        // 沿丝跑的光脉冲。同一根丝上相位连续，看起来就是一道光在丝里流动
        float pulse = 0.5 + 0.5 * sin(aStep * 22.0 - uTime * 1.9 + phase * 2.0);
        // 外圈的丝压暗一档：束要有芯，整束一样亮就成了一团雾
        float core = 1.0 - radial * 0.55;

        vBright = endFade * core * (0.3 + pulse * 0.62);
        vColor = aTint;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vBright;

      void main() {
        // 线只有一像素宽，不需要再做软边，亮度直接给出去
        gl_FragColor = vec4(vColor * vBright, vBright);
      }
    `,
  })
  disposables.push(material)

  const lines = new THREE.LineSegments(geometry, material)
  // position 全是 0，包围球算出来是个点，不关掉剔除会被整片裁掉
  lines.frustumCulled = false
  lines.rotation.set(TILT_X, TILT_Y, 0)
  scene.add(lines)

  return {
    // 阈值 0.45：细丝本身亮度压得低，阈值再高就只剩零星几点在发光、束会散；
    // 半径 0.45 让光晕收得紧，避免细线糊成一片。强度只给 0.55 —— 这里辉光的职责是「让丝有绒感」
    bloom: { strength: 0.55, radius: 0.45, threshold: 0.45 },

    update({ time, pointer }) {
      material.uniforms.uTime.value = time
      material.uniforms.uSpin.value = time * SPIN_SPEED

      // 相机做很小的位移：丝束本身在转，相机再大动会让人晕，
      // 而且轴上一动，同心感会被破坏
      camera.position.set(pointer.x * 70, pointer.y * 50, 0)
      camera.rotation.set(pointer.y * 0.05, pointer.x * 0.07, Math.sin(time * 0.06) * 0.03)
    },

    dispose() {
      scene.remove(lines)
      disposables.forEach((item) => item.dispose())
    },
  }
}
