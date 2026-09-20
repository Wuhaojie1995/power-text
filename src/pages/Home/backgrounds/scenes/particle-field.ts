import type { SceneContext, SceneInstance } from '../three-scene'

/**
 * 粒子场 —— 一团悬浮在空间里的方形光点，鼠标能牵动它、点击能激起冲击波。
 *
 * 为什么用「方形点」而不是圆点或小立方体：
 * - 圆点（soft disc）满屏都是会糊成一片雾，暗部不够黑，画面立刻「脏」；
 * - 立方体（InstancedMesh）要写六面光照、要排序、几千个实例的矩阵每帧上传，代价高得没道理；
 * - 方形点用一个 gl_PointSize 就画完，边缘是硬的，暗部干净，
 *   而且「方」本身就是这套视觉的识别特征 —— 换成圆点气质就变了。
 *
 * 三个关键取舍：
 * 1) **位置全在顶点着色器里算**。五千多个点的漂移、冲击波位移如果每帧在 JS 里重算
 *    再上传，光是 attribute 上传就能吃掉一半帧率。CPU 每帧只更新四个 uniform。
 * 2) **相机不动、点自己漂**。相机位置直接决定整个画面的透视，动它会让「一箱悬浮物」
 *    变成「镜头在飞」，眩晕感陡增。这里相机只做指针视差的小幅平移（±90），
 *    漂移交给点自己的正弦位移，层次感来自深度而不是运动。
 * 3) **体积填充 + 深度衰减补偿**。均匀体积里取点，远处点自然被透视压缩成更密的点阵，
 *    所以半径分布要往远处偏一点（见 RADIUS_BIAS），否则近处一大片、远处稀稀拉拉。
 */

/**
 * 点的总数。
 *
 * 这个数是调出来的，不是估的：加法混合下亮度是**累加**的，
 * 5400 个点叠在中心会把整片烧成一个白团，压在上面的文字完全读不了。
 * 4200 配上 0.22 的单点不透明度，能铺满画面又不糊成一块。
 * 想往上加，先想清楚亮度会涨多少。
 */
const COUNT = 4200

/** 粒子云的球心与半径。球心刻意压到相机身后很远，保证所有点都在近裁面之外（z 恒为负） */
const CLOUD_CENTER_Z = -3200
const CLOUD_RADIUS = 2500

/** 半径分布的偏置指数。1/3 是均匀体积；这里取 0.42 把更多点推向远处，补偿透视压缩 */
const RADIUS_BIAS = 0.42

/**
 * 核心区：一部分点聚在中心，画面才有「核」，不然只是一层均匀的噪点。
 *
 * 两个参数是一对儿：
 * - 半径比例决定核「多大」。压到 0.22 时点会挤成一个小球，屏幕上是一团抱死的棉絮；
 *   放到 0.3 摊开成一片渐变的光晕，核还在但不结块。这就是最终取 0.3 的原因。
 * - 比例决定核「多亮」。太大（>0.35）核会被外围的点淹掉，等于没有核。
 */
const CORE_RATIO = 0.26
const CORE_RADIUS_RATIO = 0.3

/** 单个方块的边长（世界单位，最终按深度换算成像素） */
const SIZE_MIN = 5
const SIZE_MAX = 30

/** 深度衰减系数。gl_PointSize = size × uPixelRatio × (FOCAL / 深度) */
const FOCAL = 1000
/** 点尺寸上限。近处的点不夹住会变成盖住半屏的色块 */
const MAX_POINT_SIZE = 52

/** 冲击波的生命周期（秒）与扩散速度（NDC/秒）。1.5 秒走完一屏多一点，快得像一次「弹开」 */
const SHOCK_LIFE = 1.5
const SHOCK_SPEED = 1.55
/** 冲击波强度上限（NDC 位移）。超过 0.4 会让点飞出画面，反而看不出是一圈波 */
const SHOCK_AMP = 0.34

/**
 * 冷色四段：冰青 → 电蓝 → 柔紫 → 近白。
 * 权重刻意不均：蓝紫占大头，青和近白只做点缀 —— 等比例混合会变成一锅灰。
 */
const PALETTE = [
  { rgb: [0.36, 0.85, 0.94] as const, weight: 0.16 },
  { rgb: [0.35, 0.52, 0.98] as const, weight: 0.34 },
  { rgb: [0.58, 0.5, 0.98] as const, weight: 0.34 },
  { rgb: [0.88, 0.93, 1.0] as const, weight: 0.16 },
] as const

export function createScene(ctx: SceneContext): SceneInstance {
  const { THREE, scene, camera } = ctx

  camera.fov = 60
  camera.updateProjectionMatrix()

  const positions = new Float32Array(COUNT * 3)
  const sizes = new Float32Array(COUNT)
  const tints = new Float32Array(COUNT * 3)
  const seeds = new Float32Array(COUNT)

  // 累积权重表，把一次 [0,1) 随机数映射到配色 —— 比逐点写 if/else 干净，也方便调权重
  const cumulative: number[] = []
  let acc = 0
  for (const entry of PALETTE) {
    acc += entry.weight
    cumulative.push(acc)
  }

  const pickColor = (u: number): readonly [number, number, number] => {
    for (let i = 0; i < cumulative.length; i += 1) {
      if (u <= cumulative[i]) return PALETTE[i].rgb
    }
    return PALETTE[PALETTE.length - 1].rgb
  }

  for (let i = 0; i < COUNT; i += 1) {
    const isCore = i / COUNT < CORE_RATIO
    const radius = CLOUD_RADIUS * (isCore ? CORE_RADIUS_RATIO : 1) * Math.pow(Math.random(), RADIUS_BIAS)

    // 球面均匀取向：z 分量按 [-1,1] 均匀取，方位角均匀取，
    // 这样点不会在南北极堆出两个疙瘩（直接对三个分量各取正态再归一化也可以，但没必要）
    const cosTheta = Math.random() * 2 - 1
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta))
    const phi = Math.random() * Math.PI * 2

    positions[i * 3] = radius * sinTheta * Math.cos(phi)
    positions[i * 3 + 1] = radius * sinTheta * Math.sin(phi)
    positions[i * 3 + 2] = CLOUD_CENTER_Z + radius * cosTheta

    // 尺寸用平方分布：小点占多数、大点少量。线性分布会让画面到处是大色块，很吵
    const sizeSeed = Math.random()
    sizes[i] = SIZE_MIN + (SIZE_MAX - SIZE_MIN) * sizeSeed * sizeSeed

    const rgb = pickColor(Math.random())
    tints[i * 3] = rgb[0]
    tints[i * 3 + 1] = rgb[1]
    tints[i * 3 + 2] = rgb[2]

    seeds[i] = Math.random()
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 3))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))

  const material = new THREE.ShaderMaterial({
    transparent: true,
    // 加法混合：重叠处自然叠亮，密度高的中心会「烧」出一小块白 —— 这正是要的星云核
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uShock: { value: new THREE.Vector3(0, 0, -999) },
      uDrift: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute vec3 aTint;
      attribute float aSeed;

      uniform float uTime;
      uniform float uPixelRatio;
      uniform vec3 uShock;   // xy: 冲击波中心的 NDC 坐标  z: 触发时刻
      uniform float uDrift;

      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;

        // 缓慢漂移。三个轴给不同的频率与相位，点才不会整团一起晃 ——
        // 同频同相就成了「整张纸在抖」，一眼假
        p.x += sin(uTime * 0.11 + aSeed * 6.2831) * 34.0;
        p.y += cos(uTime * 0.14 + aSeed * 4.7124) * 28.0;
        p.z += sin(uTime * 0.08 + aSeed * 2.0) * 40.0;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec4 clip = projectionMatrix * mv;

        // 相机在 z≈0、点全在负 z，所以 w 恒为正；这里仍然兜一手，
        // 免得以后调云的位置把点挪到相机后面时出现整屏乱飞的鬼影
        float w = max(clip.w, 0.0001);
        vec2 ndc = clip.xy / w;

        // 画面中心亮、四周暗。缺了这一层，满屏等亮的点就是一张噪点图，没有纵深
        float radial = length(ndc);
        float centerFade = 1.0 - smoothstep(0.18, 1.3, radial);

        // 距离衰减：太近的点会糊成一大块，压暗让它退到背景里
        float depth = -mv.z;
        float nearFade = smoothstep(700.0, 1500.0, depth);

        // ---- 冲击波 ----
        float waveBoost = 0.0;
        float age = uTime - uShock.z;
        if (age >= 0.0 && age < ${SHOCK_LIFE.toFixed(2)}) {
          float d = distance(ndc, uShock.xy);
          // 波前以恒定速度向外推，点被「环」扫到才动 —— 用高斯环而不是 d<r 的实心圆，
          // 实心圆会把中心一次推空，看着像画面破了个洞
          float front = age * ${SHOCK_SPEED.toFixed(2)};
          float ring = exp(-pow((d - front) * 3.6, 2.0));
          float decay = 1.0 - age / ${SHOCK_LIFE.toFixed(2)};
          float amp = ring * decay * ${SHOCK_AMP.toFixed(2)};

          vec2 dir = ndc - uShock.xy;
          // 退化情况（点正好落在波心）dir 是零向量，normalize 会出 NaN，所以先兜一个极小的偏移
          dir = normalize(dir + vec2(0.0001, 0.0001));
          ndc += dir * amp;

          waveBoost = amp * 5.0;
        }

        clip = vec4(ndc * w, clip.z, w);
        gl_Position = clip;

        // 近大远小。uPixelRatio 必须乘进去 —— gl_PointSize 的单位是物理像素，
        // 漏了它高分屏上整片点会小一半
        float px = aSize * uPixelRatio * (${FOCAL.toFixed(1)} / max(depth, 1.0));
        gl_PointSize = clamp(px, 1.0, ${MAX_POINT_SIZE.toFixed(1)});

        vColor = aTint;
        // 基础不透明度 0.22。加法混合下这是亮度总闸门：
        // 单点看着很暗，但一片点叠起来就是明亮的光云。给到 0.5 会整片过曝
        vAlpha = centerFade * nearFade * (0.22 + uDrift * 0.08 + waveBoost * 0.5);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        // 把方点裁成方块。gl_PointCoord 在点内是 0~1，取到中心的距离后按切比雪夫距离
        // （max(|dx|,|dy|)）判定 —— 欧氏距离会切成圆形，那就白用方点了
        vec2 offset = abs(gl_PointCoord - 0.5);
        float box = max(offset.x, offset.y);
        if (box > 0.5) discard;

        // 边缘只留一丝软度：完全硬边会有锯齿，软太多又会糊成圆点，0.46~0.5 这 4% 刚好
        float edge = 1.0 - smoothstep(0.46, 0.5, box);

        float alpha = vAlpha * edge;
        if (alpha <= 0.002) discard;

        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  })

  const points = new THREE.Points(geometry, material)
  // 位置都在 attribute 里，包围球按初始位置算即可；但点会漂出球外，
  // 关掉剔除省得边缘的点被整片裁掉
  points.frustumCulled = false
  scene.add(points)

  /**
   * 当前时间由 update 写入，供 pointerdown 打时间戳用。
   * 不能在这里读 performance.now() —— 那是绝对时钟，而 uTime 是外壳的累计秒数，
   * 两者相减会得到一个天文数字，冲击波永远算作「已结束」。
   */
  let elapsed = 0

  const onPointerDown = (event: PointerEvent) => {
    // 只认主键，右键菜单和中键滚动不该炸出冲击波
    if (event.button !== 0) return
    const x = (event.clientX / window.innerWidth) * 2 - 1
    const y = -((event.clientY / window.innerHeight) * 2 - 1)
    material.uniforms.uShock.value.set(x, y, elapsed)
  }

  window.addEventListener('pointerdown', onPointerDown, { passive: true })

  return {
    // 点本身是加法混合的亮块，辉光只负责给它们一层绒边。
    // 阈值给到 0.55 是关键：只有最亮的那批点才发光，否则整片点会被一起糊成一团白雾，
    // 中心那点层次全没了（踩过：0.34 时画面中心是一个纯白洞）
    bloom: { strength: 0.42, radius: 0.5, threshold: 0.55 },

    update({ time, pointer, renderer }) {
      elapsed = time
      material.uniforms.uTime.value = time
      // 亮度做极慢的呼吸。注意必须是有界的 0~1 —— 直接把 time 传进去，
      // 这个系数会随时间无限增大，几分钟后整片点会全白烧掉
      material.uniforms.uDrift.value = Math.sin(time * 0.45) * 0.5 + 0.5
      material.uniforms.uPixelRatio.value = renderer.getPixelRatio()

      // 指针视差。幅度刻意压得很小（±90 / ±62）：粒子云本身已经在漂，
      // 相机再大幅平移，整团会像被甩出去，眩晕感立刻上来
      camera.position.set(pointer.x * 90, pointer.y * 62, 0)
      camera.rotation.set(pointer.y * 0.035, pointer.x * 0.05, 0)
    },

    dispose() {
      window.removeEventListener('pointerdown', onPointerDown)
      scene.remove(points)
      geometry.dispose()
      material.dispose()
    },
  }
}
