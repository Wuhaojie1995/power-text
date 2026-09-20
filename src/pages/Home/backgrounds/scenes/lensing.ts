import type * as THREE_NS from 'three'
import type { SceneContext, SceneInstance } from '../three-scene'

/**
 * 引力透镜 —— 用一次屏幕空间的坐标偏折，把背景星空拧成爱因斯坦环。
 *
 * 这套是全靠「几何奇观」撑场面的，亮度其实非常克制：
 * 全屏最亮的东西是一圈只有几个像素宽的光子环，其余全是接近黑的天。
 * 之所以震撼，是因为观众的大脑认得出来「星星的排列被弯了」——
 * 这个信息量比任何高饱和色块都大。
 *
 * 核心公式只有一行：
 *
 *     warpedR = r - k / r
 *
 * r 是像素到黑洞中心的距离，k 是偏折强度。越靠近中心，采样半径被压得越狠；
 * 当 r 小到 sqrt(k) 时采样半径归零，再往里变成负值 —— 那正好对应
 * 「光线绕过黑洞、看到它背后那片天」的次级像。
 * 所以 sqrt(k) 就是视界半径，这不是凑出来的，是公式自己给的。
 *
 * 三个配套细节，缺一个就会露馅：
 * 1. **吸积盘在偏折后的坐标里判断**，不是在屏幕坐标里。这样盘面才会自己绕到视界后面，
 *    在洞顶形成那道弧 —— 这是黑洞照片里最标志性的形状；
 * 2. **多普勒不对称**：朝观察者转过来的一侧要更亮。少了它，盘就是个对称的甜甜圈，很假；
 * 3. **光子环单独画**：真实黑洞边缘那一圈亮环比吸积盘本身还亮，是它把视界的轮廓勾出来的。
 */

/**
 * 视界半径（归一化单位：屏幕半高 = 0.5）。
 * 偏折强度直接取它的平方 —— 公式里 sqrt(k) 就是视界，两者必须对得上
 */
const SHADOW_RADIUS = 0.072
const DEFLECT = SHADOW_RADIUS * SHADOW_RADIUS

/**
 * 黑洞在画面里的位置。
 * x 偏到右边、y 抬到上方，两个原因：
 * 1. 登录卡片占着画面正中，黑洞摆中间会被整块盖住，只剩一圈漏出来的光晕，等于白做；
 * 2. 吸积盘是横贯全屏的一条，落在卡片高度上会被卡片从中间截断 ——
 *    抬到卡片上沿以上，盘面才能完整地横过去，那才是黑洞照片里最有辨识度的形状
 *
 * ⚠️ 横向位置**必须写成「可视半宽的比例」，不能写绝对值**。
 * shader 里 p 的定义是 `(vUv - 0.5) * vec2(宽高比, 1.0)`，也就是纵向恒定 ±0.5、
 * 横向是 ±宽高比/2 —— 横向的可视范围**随宽高比变**。早期这里写的是绝对值 0.5：
 * 16:9 下可视半宽 0.889，0.5 落在 78% 宽度处，看着没问题；
 * 但竖屏 480×900 时可视半宽只有 0.267，0.5 直接跑到画面外，
 * **黑洞和光子环整个消失**，只剩一条横贯的吸积盘光带（踩过，窄屏才发现）。
 *
 * 0.625 = 0.5 / (1440/900 / 2)，即按**截图用的 1440×900（16:10，不是 16:9）**反推，
 * 正好复现修之前那张图的位置，所以 1440×900 下画面逐像素不变。
 */
const CENTER_X_RATIO = 0.625
/** 纵向不受宽高比影响（半高恒为 0.5），所以这里可以是绝对值：0.3 → 距顶 20% */
const CENTER_Y = 0.3

/** 指针带动黑洞中心微移的幅度。幅度要小，大了会像画面在晃而不是像视差 */
const POINTER_X = 0.025
const POINTER_Y = 0.04

export function createScene(ctx: SceneContext): SceneInstance {
  const { THREE, scene, camera } = ctx

  camera.fov = 60
  camera.updateProjectionMatrix()

  // 整块画面由这一个全屏 quad 画出来，相机必须钉在原点：
  // 相机一动，贴在 z=-1 的平面就会跟着偏，四周露出底色
  camera.position.set(0, 0, 0)
  camera.rotation.set(0, 0, 0)

  const disposables: Array<{ dispose(): void }> = []

  const geometry = new THREE.PlaneGeometry(1, 1)
  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      // 初值按 1440×900 给，真正的值在 resize 里按实际宽高比算
      uCenter: { value: new THREE.Vector2(CENTER_X_RATIO * (1440 / 900 / 2), CENTER_Y) },
      uDeflect: { value: DEFLECT },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec2 uResolution;
      uniform vec2 uCenter;
      uniform float uDeflect;
      varying vec2 vUv;

      /**
       * 2D → 1D 的 hash。
       *
       * 注意不能写成常见的 fract(p * vec2(127.1, 311.7)) 那一版：
       * 这里喂进来的 p 是 floor(uv * scale)，**永远是整数**，
       * 而 127.1 = 127 + 0.1 意味着 fract(i * 127.1) = fract(i * 0.1) 只有 10 个取值，
       * 于是整个星场退化成周期 10 格的重复图案，屏幕上出现等间距的斜条纹（踩过）。
       * 下面这版用的是无理数系数量级的小数，对整数输入也是良分布的。
       *
       * ⚠️ 这段注释在模板字符串里面，任何反引号都会把 GLSL 字符串截断、Vite 直接报 500。
       */
      float hash21(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      /**
       * 平方必须写成 x * x，不能用 pow(x, 2.0)。
       *
       * GLSL 的 pow 在底数为负时是**未定义行为** —— 多数实现走 exp2(y * log2(x))，
       * 而 log2(负数) 是 NaN。下面的高斯衰减里底数正负都有，一旦出 NaN 会顺着颜色一路传染，
       * 在画面上表现为来路不明的条纹（踩过）。
       */
      float sq(float x) {
        return x * x;
      }

      /**
       * 一层程序化星空：把空间切成格子，每格按概率放一颗。
       * 星在格子内的偏移也是随机的，否则会看出规则的网格排列。
       */
      vec3 starLayer(vec2 uv, float density, float scale, float radius, float gain) {
        vec2 cell = uv * scale;
        vec2 id = floor(cell);
        vec2 local = fract(cell) - 0.5;

        float h = hash21(id);
        if (h > density) return vec3(0.0);

        vec2 offset = (vec2(hash21(id + 17.3), hash21(id + 41.9)) - 0.5) * 0.7;
        float d = length(local - offset);

        float star = smoothstep(radius, 0.0, d);
        // 每颗星亮度不同，否则一片星星像同一批 LED
        star *= 0.28 + hash21(id + 7.7) * 0.72;

        vec3 tint = mix(vec3(0.70, 0.80, 1.0), vec3(1.0, 0.90, 0.74), hash21(id + 3.3));
        return tint * star * gain;
      }

      void main() {
        // 归一化到「屏幕半高 = 0.5」，x 乘宽高比，圆才不会被拉成椭圆
        vec2 p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
        vec2 c = uCenter;

        vec2 d = p - c;
        float r = length(d);
        vec2 dir = r > 0.0001 ? d / r : vec2(1.0, 0.0);

        // ---- 引力偏折 ----
        // 分母用 max 兜住，避免 r→0 时算出 inf。注意这个 max 已经足够：
        // k / 0.010 = 0.52，所以 warpedR 天然被压在 [-0.52, r] 里，不会发散。
        //
        // ⚠️ 千万不要在这里再加一句 clamp(warpedR, -1.2, 1.2) 之类的「保险」——
        // 16:9 下屏幕四角的 r 就有 0.94，21:9 更是到 1.27，这个上限落在可视范围里面。
        // 一旦夹住，所有 r 大于它的像素都会被映射到「以黑洞为圆心、半径 1.2 的圆」上，
        // 星场沿着这个圆被反复采样、切向拉成一条条横线（踩过，查了很久）。
        float warpedR = r - uDeflect / max(r, 0.010);
        vec2 warped = c + dir * warpedR;

        // ---- 背景星空（采样偏折后的坐标，环就自己出现了）----
        // 密度刻意压得低：星点一密，整屏就浮起一层灰，那就是光污染。
        // 这里要的是「稀疏的亮点 + 大面积的黑」
        vec3 col = vec3(0.0);
        col += starLayer(warped + vec2(3.1, 1.7), 0.055, 24.0, 0.055, 0.85);
        col += starLayer(warped + vec2(9.7, 5.3), 0.090, 47.0, 0.100, 0.50);
        col += starLayer(warped + vec2(1.3, 8.9), 0.130, 91.0, 0.160, 0.26);

        float shadowR = sqrt(uDeflect);

        // ---- 吸积盘 ----
        // 在偏折后的坐标里算：盘面是 y≈0 的平面，投影到屏幕是一条水平带，
        // 而靠近视界的地方 warpedR 被压到接近 0，带子自然收紧成贴着视界的一圈
        vec2 dp = warped - c;
        float diskR = length(dp);

        // 厚度随半径略微张开，但基本是等宽的 —— 这样看起来才像一张侧对着你的薄盘。
        // 系数别给大：带子一厚就从「一道光」变成「一块亮斑」
        float halfThick = 0.003 + diskR * 0.009;
        float band = exp(-sq(dp.y / halfThick));

        // 内缘从最内稳定圆轨道起飞，外缘慢慢消散
        float span = smoothstep(shadowR * 0.95, shadowR * 1.75, diskR)
                   * (1.0 - smoothstep(0.40, 1.05, diskR));

        // 多普勒：一侧被压亮。这是「在转」唯一的视觉证据。
        // 上下限别拉太开，1.0 那侧会直接烧成一条白棒
        float doppler = 0.34 + 0.5 * smoothstep(-0.34, 0.30, dp.x);
        // 细密条纹，给盘面一点湍流的质感
        float streak = 0.82 + 0.18 * sin(dp.x * 130.0 - uTime * 2.1 + dp.y * 60.0);

        float disk = band * span * doppler * streak;

        // 内圈白热 → 外圈橙红。整套只用这一个暖色系，不铺彩虹
        vec3 hot = vec3(1.0, 0.97, 0.92);
        vec3 cool = vec3(1.0, 0.46, 0.13);
        vec3 diskCol = mix(cool, hot, 1.0 - smoothstep(shadowR, 0.62, diskR));

        col += diskCol * disk * 0.9;

        // ---- 光子环 ----
        // 全屏最亮的东西，但只有几个像素宽。亮度高 + 面积小 = 炫；亮度高 + 面积大 = 光污染
        float ring = exp(-sq((r - shadowR * 1.09) / (shadowR * 0.075)));
        col += vec3(1.0, 0.93, 0.82) * ring * 1.9;

        // 视界外侧一圈极淡的暖晕，让黑洞有「存在感」而不是一个贴上去的黑圆。
        // 强度只给 0.04 —— 它负责氛围，不负责亮
        float halo = exp(-sq((r - shadowR * 1.55) / (shadowR * 0.95)));
        col += vec3(1.0, 0.72, 0.42) * halo * 0.04;

        // ---- 视界 ----
        // 里面什么都不许有。用 smoothstep 而不是 if，边缘才不会锯齿
        col *= smoothstep(shadowR * 0.995, shadowR * 1.02, r);

        // 极暗的底，纯黑会显得像贴图没加载完
        col += vec3(0.004, 0.006, 0.013);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })

  const plane = new THREE.Mesh(geometry, material)
  // 贴在相机前 1 个单位。尺寸在 resize 里按 fov 算，保证刚好铺满视锥
  plane.position.set(0, 0, -1)
  plane.frustumCulled = false
  scene.add(plane)
  disposables.push(geometry, material)

  // shader 里横向坐标的可视半宽（归一化单位）。resize 会更新它，
  // 黑洞中心的横向位置按它算，才能在各种宽高比下都落在同一个相对位置
  let halfWidth = 1440 / 900 / 2
  const lastPointer = { x: 0, y: 0 }

  const applyCenter = () => {
    // 中心跟着指针走一点点。星空整体偏移 → 看起来像视角在动，而黑洞钉在原地
    ;(material.uniforms.uCenter.value as THREE_NS.Vector2).set(
      CENTER_X_RATIO * halfWidth + lastPointer.x * POINTER_X,
      CENTER_Y + lastPointer.y * POINTER_Y,
    )
  }

  return {
    // 阈值 0.62：只有光子环和吸积盘最内侧那一点点会发光。
    // radius 压到 0.45，光晕收得紧一点，别把周围的星空一起糊亮
    bloom: { strength: 0.9, radius: 0.45, threshold: 0.62 },

    resize(width, height) {
      // 视锥在 z = -1 处的高：2·tan(fov/2)·1
      const viewHeight = 2 * Math.tan((camera.fov * Math.PI) / 360)
      const viewWidth = viewHeight * (width / height)
      plane.scale.set(viewWidth, viewHeight, 1)
      ;(material.uniforms.uResolution.value as THREE_NS.Vector2).set(width, height)
      halfWidth = width / height / 2
      applyCenter()
    },

    update({ time, pointer }) {
      material.uniforms.uTime.value = time
      lastPointer.x = pointer.x
      lastPointer.y = pointer.y
      applyCenter()
    },

    dispose() {
      scene.remove(plane)
      disposables.forEach((item) => item.dispose())
    },
  }
}
