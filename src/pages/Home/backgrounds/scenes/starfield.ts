import type * as THREE_NS from 'three'
import type { SceneContext, SceneInstance } from '../three-scene'

/**
 * 深空星场 —— 安静、深邃、有层次。
 *
 * 这一套的定位是「耐看」而不是「抢眼」，设计上刻意和另外两套反着来：
 * 上一批背景的毛病是「加法混合把亮度堆上去」，结果整屏都是高饱和亮色块 —— 那是光污染。
 * 这里暗部铺满整个画面，发光的东西加起来只占几个百分点，炫酷靠的是**深度**和**缓慢的变化**：
 *
 * 1. **三层视差**：远中近三层星点各自绕视线轴以不同角速度缓慢自转。
 *    指针一动，三层错位位移，纵深感立刻出来 —— 这是「星空」和「黑底白点」的分水岭。
 * 2. **银河带**：一条由两千多颗极暗小点组成的斜带。没有它，满屏均匀散点读起来像噪点；
 *    有了它，散点才被串成结构，视线也才有落点。
 * 3. **偶发流星**：每 6~14 秒一颗，细长拖尾、两端淡入淡出。
 *    这是全屏唯一「会突然出现」的东西，负责在长时间停留时给一点惊喜。
 *
 * 亮度预算（这套最关键的约束）：
 * 星点亮度走 Math.pow(random, 2.6)，所以绝大多数落在 0.2 附近、只有极少数能到 1.0；
 * 再配合 bloom 的 threshold 0.42，只有最亮的那几十颗星参与发光，其余全是死寂的小点。
 */

/** 三层星点。半径小的离得近：星少而大、转得快；半径大的离得远：星多而小、转得慢 */
const LAYERS = [
  { radius: 1400, count: 1000, size: 2.0, spin: 0.0075 },
  { radius: 2600, count: 1500, size: 2.8, spin: 0.0048 },
  { radius: 4200, count: 1000, size: 4.0, spin: 0.0026 },
] as const

/** 银河带：数量、横向铺开半径、中心厚度 */
const BAND_COUNT = 3600
const BAND_SPREAD = 2600
const BAND_THICKNESS = 175
const BAND_RADIUS = 3600

/**
 * 「主角星」：全屏只有十来颗，每颗带一个十字星芒。
 * 这是整套里唯一的「炫」担当 —— 星芒面积很小（一根臂也就 20px 长、1px 宽），
 * 但它一下子就把画面从「黑底白点」拉成「星空」。
 */
const HERO_COUNT = 14

/** 流星池大小、拖尾点数、拖尾总长度 */
const METEOR_POOL = 3
const METEOR_TAIL = 16
const METEOR_TAIL_LENGTH = 320
const METEOR_RADIUS = 3200
const METEOR_COOLDOWN_MIN = 6
const METEOR_COOLDOWN_MAX = 14

/** 指针带动的相机位移。幅度大了会晕，也失去「漂浮在深空里」的稳定感 */
const PARALLAX_X = 34
const PARALLAX_Y = 24

interface Meteor {
  points: THREE_NS.Points
  geometry: THREE_NS.BufferGeometry
  /** 拖尾各点的世界坐标，每帧重写 */
  positions: Float32Array
  /** 拖尾各点的可见度，每帧重写。用属性而不是 uniform，是为了三个流星共用一份材质 */
  fades: Float32Array
  /** 每个点相对头部的衰减，静态 */
  decay: Float32Array
  head: THREE_NS.Vector3
  dir: THREE_NS.Vector3
  speed: number
  duration: number
  /** 已经飞了多久 */
  life: number
  /** 距离下次出发还有多久 */
  cooldown: number
}

export function createScene(ctx: SceneContext): SceneInstance {
  const { THREE, scene, camera } = ctx

  camera.fov = 60
  camera.updateProjectionMatrix()

  const disposables: Array<{ dispose(): void }> = []

  // ---------------- 三层星点 ----------------
  // 三层各自的 Points 绕视线轴自转，角速度不同 → 时间上也有视差，不只是指针动的时候才有
  const starLayers = LAYERS.map((layer) => {
    const positions = new Float32Array(layer.count * 3)
    const colors = new Float32Array(layer.count * 3)
    const sizes = new Float32Array(layer.count)
    const phases = new Float32Array(layer.count)
    const seeds = new Float32Array(layer.count)

    const tint = new THREE.Color()

    for (let i = 0; i < layer.count; i += 1) {
      // 球面上均匀取点（用归一化的三维随机向量，避免极点堆积）
      const x = Math.random() * 2 - 1
      const y = Math.random() * 2 - 1
      const z = Math.random() * 2 - 1
      const len = Math.hypot(x, y, z) || 1

      // 半径带一点抖动，否则同一层会看出「壳」的边界
      const radius = layer.radius * (0.88 + Math.random() * 0.24)
      positions[i * 3] = (x / len) * radius
      positions[i * 3 + 1] = (y / len) * radius
      positions[i * 3 + 2] = (z / len) * radius

      // 亮度分布：pow 2.0 让多数星落在 0.3~0.5，只有少数能到 1.0。
      // 均匀分布会让满屏都是亮星、看起来像 LED 灯阵；
      // 但下限也不能压到 0.2 以下 —— 那样星点会掉到亚像素、被光栅化直接抹掉，整片天就空了（踩过）
      const magnitude = 0.32 + Math.pow(Math.random(), 1.8) * 0.68
      const roll = Math.random()
      // 大部分近白，少量偏冷 / 偏暖。全冷像 LED、全暖像烛光，混一点才像真实星空
      if (roll < 0.12) tint.setRGB(1.0, 0.86, 0.72)
      else if (roll < 0.3) tint.setRGB(0.72, 0.84, 1.0)
      else tint.setRGB(0.94, 0.96, 1.0)

      colors[i * 3] = tint.r * magnitude
      colors[i * 3 + 1] = tint.g * magnitude
      colors[i * 3 + 2] = tint.b * magnitude

      // 尺寸同样偏态分布，但下限给到 0.7 倍基尺寸。
      // 之前用 pow 3.0 压到 0.55 倍，结果大多数星点不足 1 个像素、被光栅化抹掉，整片天看着是空的
      sizes[i] = layer.size * (0.7 + Math.pow(Math.random(), 2.2) * 1.8)
      phases[i] = Math.random() * Math.PI * 2
      seeds[i] = Math.random()
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))

    const material = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // ShaderMaterial 不会自动带顶点色，要用 color 属性必须显式开这个开关
      vertexColors: true,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aPhase;
        attribute float aSeed;
        uniform float uTime;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vColor = color;

          // 每颗星一个独立相位，整片天不会一起呼吸
          float twinkle = 0.55 + 0.45 * sin(uTime * 0.9 + aPhase);
          // 挑出约 7% 的星做慢速大幅闪烁，像变星。数量少才不会显得热闹
          float flare = step(0.93, aSeed) * (0.5 + 0.5 * sin(uTime * 0.35 + aPhase * 3.0));
          vAlpha = (0.4 + twinkle * 0.6) * (1.0 + flare * 1.5);

          gl_PointSize = aSize * uPixelRatio;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          // gl_PointCoord 把方点修成软边圆
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          // 指数给到 2.6：芯实一点、边柔一点。给到 3.2 以上会让每颗星缩成一个亚像素点，
          // 加上尺寸本来就小，整片天会空掉
          float core = pow(1.0 - d, 2.6);
          gl_FragColor = vec4(vColor, core * vAlpha);
        }
      `,
    })

    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    scene.add(points)
    disposables.push(geometry, material)

    return { points, material, spin: layer.spin }
  })

  // ---------------- 银河带 ----------------
  const bandPositions = new Float32Array(BAND_COUNT * 3)
  const bandColors = new Float32Array(BAND_COUNT * 3)
  const bandSizes = new Float32Array(BAND_COUNT)
  const bandPhases = new Float32Array(BAND_COUNT)
  const bandTint = new THREE.Color()

  /** 近似高斯：三个均匀随机数相加。比 Box-Muller 省事，形状也够用 */
  const gauss = () => (Math.random() + Math.random() + Math.random()) / 1.5 - 1

  for (let i = 0; i < BAND_COUNT; i += 1) {
    // 横向也走高斯：中心密、两侧稀，自然形成一条中间厚两头薄的带子
    const x = gauss() * BAND_SPREAD
    // 厚度随横向距离变宽，带子两端是散开的，不是一根等宽的棍
    const y = gauss() * (BAND_THICKNESS + Math.abs(x) * 0.1)
    const z = -BAND_RADIUS + gauss() * 420

    bandPositions[i * 3] = x
    bandPositions[i * 3 + 1] = y
    bandPositions[i * 3 + 2] = z

    // 带子整体压得比背景星还暗，它是「一层雾」而不是「一堆星」。
    // 5% 的成员给到正常亮度，充当带子里的亮星，否则整条带太均匀、看不出结构
    const bright = Math.random() < 0.05 ? 0.55 + Math.random() * 0.45 : 0.16 + Math.random() * 0.28
    // 中心偏暖（星族老）、边缘偏蓝（星族年轻），是很便宜的真实感
    const warm = Math.max(0, 1 - Math.abs(x) / BAND_SPREAD)
    bandTint.setRGB(0.86 + warm * 0.12, 0.9, 1.0 - warm * 0.06)

    bandColors[i * 3] = bandTint.r * bright
    bandColors[i * 3 + 1] = bandTint.g * bright
    bandColors[i * 3 + 2] = bandTint.b * bright

    bandSizes[i] = 1.2 + Math.pow(Math.random(), 1.8) * 2.0
    bandPhases[i] = Math.random() * Math.PI * 2
  }

  const bandGeometry = new THREE.BufferGeometry()
  bandGeometry.setAttribute('position', new THREE.BufferAttribute(bandPositions, 3))
  bandGeometry.setAttribute('color', new THREE.BufferAttribute(bandColors, 3))
  bandGeometry.setAttribute('aSize', new THREE.BufferAttribute(bandSizes, 1))
  bandGeometry.setAttribute('aPhase', new THREE.BufferAttribute(bandPhases, 1))
  bandGeometry.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(BAND_COUNT), 1))

  const bandMaterial = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
    },
    // 和星点同一套 shader，只是闪烁幅度小一些（带子里的星不该闪得比亮星还明显）
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vColor = color;
        float twinkle = 0.75 + 0.25 * sin(uTime * 0.6 + aPhase);
        vAlpha = twinkle * 0.85;
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core = pow(1.0 - d, 2.4);
        gl_FragColor = vec4(vColor, core * vAlpha);
      }
    `,
  })

  const band = new THREE.Points(bandGeometry, bandMaterial)
  band.frustumCulled = false
  // 斜着挂在天上：绕 Z 转出倾角，再绕 X 压一点，带子就有了「横跨天空」的透视
  band.rotation.z = -0.46
  band.rotation.x = 0.24
  scene.add(band)
  disposables.push(bandGeometry, bandMaterial)

  // ---------------- 主角星（带十字星芒）----------------
  const heroPositions = new Float32Array(HERO_COUNT * 3)
  const heroColors = new Float32Array(HERO_COUNT * 3)
  const heroSizes = new Float32Array(HERO_COUNT)
  const heroTint = new THREE.Color()
  let heroIndex = 0
  let heroGuard = 0

  while (heroIndex < HERO_COUNT && heroGuard < 4000) {
    heroGuard += 1
    const x = Math.random() * 2 - 1
    const y = Math.random() * 2 - 1
    const z = -Math.random() - 0.1
    const len = Math.hypot(x, y, z) || 1
    if (len < 0.3) continue

    const nx = x / len
    const ny = y / len
    const nz = z / len
    // 避开登录卡片占的那块矩形。星芒再好看，被卡片盖住也等于没画
    const sx = Math.abs(nx / nz)
    const sy = Math.abs(ny / nz)
    if (sx < 0.45 && sy < 0.2) continue

    const radius = 2000 + Math.random() * 1400
    heroPositions[heroIndex * 3] = nx * radius
    heroPositions[heroIndex * 3 + 1] = ny * radius
    heroPositions[heroIndex * 3 + 2] = nz * radius

    // 主角星一半偏冷一半偏暖，纯白会显得像贴纸
    if (Math.random() < 0.5) heroTint.setRGB(0.78, 0.87, 1.0)
    else heroTint.setRGB(1.0, 0.92, 0.8)
    heroColors[heroIndex * 3] = heroTint.r
    heroColors[heroIndex * 3 + 1] = heroTint.g
    heroColors[heroIndex * 3 + 2] = heroTint.b

    heroSizes[heroIndex] = 14 + Math.random() * 12
    heroIndex += 1
  }

  const heroGeometry = new THREE.BufferGeometry()
  heroGeometry.setAttribute('position', new THREE.BufferAttribute(heroPositions, 3))
  heroGeometry.setAttribute('color', new THREE.BufferAttribute(heroColors, 3))
  heroGeometry.setAttribute('aSize', new THREE.BufferAttribute(heroSizes, 1))
  disposables.push(heroGeometry)

  const heroMaterial = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      uniform float uTime;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vPulse;

      void main() {
        vColor = color;
        // 慢速呼吸，让星芒有存在感但不会抢视线
        vPulse = 0.72 + 0.28 * sin(uTime * 0.7 + aSize);
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vPulse;

      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q) * 2.0;
        if (d > 1.0) discard;

        // 实心核：只占整个 sprite 很小一块
        float core = pow(1.0 - d, 6.0);

        // 十字星芒：两根极细的臂。系数决定臂的粗细 ——
        // 给 34 时臂宽不到一个像素，会被抗锯齿直接抹平（踩过）；12 大约是 1.5~2px
        float armX = max(0.0, 1.0 - abs(q.y) * 12.0) * pow(max(0.0, 1.0 - abs(q.x) * 2.0), 2.2);
        float armY = max(0.0, 1.0 - abs(q.x) * 12.0) * pow(max(0.0, 1.0 - abs(q.y) * 2.0), 2.2);

        // 星芒压到核的 55%：核是「亮」，芒是「炫」，主次要分清
        float alpha = (core + (armX + armY) * 0.55) * vPulse;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  })
  disposables.push(heroMaterial)

  const heroStars = new THREE.Points(heroGeometry, heroMaterial)
  heroStars.frustumCulled = false
  scene.add(heroStars)

  // ---------------- 流星 ----------------
  // 拖尾的每点衰减是静态的（头亮尾暗），全局淡入淡出写在 aFade 属性里逐帧更新，
  // 这样三个流星可以共用同一份材质，不用为每个流星克隆 shader
  const meteorDecay = new Float32Array(METEOR_TAIL)
  const meteorSizes = new Float32Array(METEOR_TAIL)
  for (let i = 0; i < METEOR_TAIL; i += 1) {
    const t = i / (METEOR_TAIL - 1)
    meteorDecay[i] = Math.pow(1 - t, 1.7)
    meteorSizes[i] = 2.6 - t * 2.0
  }

  const meteorMaterial = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uPixelRatio: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aFade;
      attribute float aSize;
      uniform float uPixelRatio;
      varying float vFade;

      void main() {
        vFade = aFade;
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vFade;

      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core = pow(1.0 - d, 2.6);
        // 冷白偏一点点蓝，和背景暖白的星区分开，一眼能认出「这是流星不是星」
        gl_FragColor = vec4(vec3(0.84, 0.92, 1.0), core * vFade);
      }
    `,
  })
  disposables.push(meteorMaterial)

  const meteors: Meteor[] = []
  for (let i = 0; i < METEOR_POOL; i += 1) {
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(METEOR_TAIL * 3)
    const fades = new Float32Array(METEOR_TAIL)
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aFade', new THREE.BufferAttribute(fades, 1))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(meteorSizes, 1))
    disposables.push(geometry)

    const points = new THREE.Points(geometry, meteorMaterial)
    points.frustumCulled = false
    scene.add(points)

    meteors.push({
      points,
      geometry,
      positions,
      fades,
      decay: meteorDecay,
      head: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      speed: 0,
      duration: 1,
      life: 0,
      // 错开首次出发时间，否则一进页面三颗一起飞
      cooldown: 1.5 + i * 3.5 + Math.random() * 3,
    })
  }

  const spawnMeteor = (meteor: Meteor) => {
    // 起点：只取相机前方（z < 0）的天球，且偏高一些。
    // 拒绝采样比算球面坐标省事，多试几次总能凑够
    let x = 0
    let y = 0
    let z = 0
    let len = 1
    do {
      x = Math.random() * 2 - 1
      y = Math.random() * 2 - 1
      z = -Math.random() - 0.15
      len = Math.hypot(x, y, z) || 1
    } while (len < 0.4 || y / len < -0.05)

    meteor.head.set((x / len) * METEOR_RADIUS, (y / len) * METEOR_RADIUS, (z / len) * METEOR_RADIUS)

    // 方向：随机但抹掉径向分量（贴着自己那层天球飞），再往下压一点。
    // 真实流星几乎都是斜着往下掉的，水平乱飞会假
    meteor.dir.randomDirection()
    const radial = meteor.head.clone().normalize()
    meteor.dir.addScaledVector(radial, -meteor.dir.dot(radial))
    meteor.dir.y -= 0.42
    meteor.dir.normalize()

    const travel = 1400 + Math.random() * 1600
    meteor.duration = 0.85 + Math.random() * 0.7
    meteor.speed = travel / meteor.duration
    meteor.life = 0
    meteor.cooldown = 0
  }

  const writeMeteor = (meteor: Meteor) => {
    // 两端淡入淡出：sin 曲线在 0 和 1 处导数为 0，出现和消失都不会「啪」一下
    const progress = meteor.duration > 0 ? meteor.life / meteor.duration : 1
    const global = Math.sin(Math.min(1, progress) * Math.PI)
    const tailStep = METEOR_TAIL_LENGTH / (METEOR_TAIL - 1)

    for (let i = 0; i < METEOR_TAIL; i += 1) {
      const back = i * tailStep
      meteor.positions[i * 3] = meteor.head.x - meteor.dir.x * back
      meteor.positions[i * 3 + 1] = meteor.head.y - meteor.dir.y * back
      meteor.positions[i * 3 + 2] = meteor.head.z - meteor.dir.z * back
      meteor.fades[i] = global * meteor.decay[i]
    }

    meteor.geometry.attributes.position.needsUpdate = true
    meteor.geometry.attributes.aFade.needsUpdate = true
  }

  // ---------------- 每帧 ----------------
  const lookTarget = new THREE.Vector3()

  return {
    // 阈值 0.3：亮度超过它的星才参与辉光。星点亮度下限在 0.26，所以中层以上的星都带一点绒光，
    // 这是「星空」和「黑底白点」的分界；但辉光半径收在 0.7，不会糊成一片雾
    bloom: { strength: 0.85, radius: 0.7, threshold: 0.3 },

    update({ time, delta, pointer, renderer }) {
      const pixelRatio = renderer.getPixelRatio()

      for (const layer of starLayers) {
        // 自转：三层角速度不同，所以即使指针不动，画面也在极缓慢地重排
        layer.points.rotation.z = time * layer.spin
        layer.material.uniforms.uTime.value = time
        layer.material.uniforms.uPixelRatio.value = pixelRatio
      }

      band.rotation.z = -0.46 + time * 0.0016
      bandMaterial.uniforms.uTime.value = time
      bandMaterial.uniforms.uPixelRatio.value = pixelRatio

      // 主角星不跟着三层转 —— 它们在天上「钉住」，才有参照物的感觉
      heroMaterial.uniforms.uTime.value = time
      heroMaterial.uniforms.uPixelRatio.value = pixelRatio

      for (const meteor of meteors) {
        if (meteor.life > 0) {
          meteor.life += delta
          meteor.head.addScaledVector(meteor.dir, meteor.speed * delta)
          writeMeteor(meteor)

          if (meteor.life >= meteor.duration) {
            meteor.life = 0
            meteor.cooldown = METEOR_COOLDOWN_MIN + Math.random() * (METEOR_COOLDOWN_MAX - METEOR_COOLDOWN_MIN)
            // 收尾：清掉拖尾，别让它留在天上
            meteor.fades.fill(0)
            meteor.geometry.attributes.aFade.needsUpdate = true
          }
        } else {
          meteor.cooldown -= delta
          if (meteor.cooldown <= 0) spawnMeteor(meteor)
        }
      }

      meteorMaterial.uniforms.uPixelRatio.value = pixelRatio

      // 相机平移而不是旋转 —— 只有平移才能让不同半径的三层产生错位，
      // 绕原点旋转等于转天球，三层会一起动，视差就没了
      camera.position.set(pointer.x * PARALLAX_X, pointer.y * PARALLAX_Y, 0)
      camera.lookAt(lookTarget.set(pointer.x * 60, pointer.y * 42, -1000))
      // 极轻微的滚转，像漂浮在深空里慢慢翻身
      camera.rotation.z += Math.sin(time * 0.05) * 0.025
    },

    dispose() {
      starLayers.forEach((layer) => scene.remove(layer.points))
      scene.remove(band)
      scene.remove(heroStars)
      meteors.forEach((meteor) => scene.remove(meteor.points))
      disposables.forEach((item) => item.dispose())
    },
  }
}
