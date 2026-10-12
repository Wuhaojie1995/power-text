/**
 * 程序化行星表面贴图（等距圆柱投影，一张图铺满整个球面）。
 *
 * 为什么要有这个文件：太阳系里的行星此前是**纯色球**（木星、土星另加几条正弦纬度
 * 条纹），放大到几十上百像素就是一块贴纸 —— 用户一眼看出来的「不真实」就是它。
 * 地球之所以没问题，是因为它用的是真实卫星图（public/textures/earth-*.jpg）；
 * 其余几颗没有对应素材，所以在这里按各自的特征**程序化烘一张**出来：
 *
 *   水星  灰褐色、满布环形山（真实的「坑」是它唯一的辨识特征）
 *   金星  奶黄到乳白的浓云，低对比、极区略暗 —— 真实金星几乎看不到地表
 *   火星  铁锈红底 + 暗色反照率斑块（大瑟提斯那一类）+ 两极白色冰盖
 *   木星  强对比的明暗纬带 + 大红斑 + 带内的湍流扰动
 *   土星  淡金色纬带，对比度比木星低得多，极区偏冷灰
 *   天王星 近乎均匀的淡青，只有极淡的纬带
 *   海王星 深蓝 + 淡纬带 + 大暗斑 + 白色甲烷云
 *   月球  灰白 + 大片暗色月海 + 环形山
 *
 * 两条实现上的硬约束：
 *
 * 1) **横向必须无缝**。球面 UV 绕一圈回到原点，贴图左右接不上就会在球上留下一条
 *    竖缝。这里的做法是让噪声本身周期化：值噪声的格点按 baseFreq 取模，
 *    而 baseFreq 强制取整、每层八度翻倍，于是每一层的格点周期都严丝合缝
 *    （createCloudTexture 里踩过同一类坑，注释写得更细）。
 *
 * 2) **一次性烘进 CanvasTexture**。运行时只做采样，逐像素的 fbm 全在创建时算完。
 *    分辨率按「屏幕上最坏情况」定：木星、土星在开场里能到一百多像素，
 *    给 384×192；其余给 256×128。再高就是浪费 —— 球面上一半的像素根本转不到正面。
 */

import type * as THREE_NS from 'three'

/** 可生成的星球表面种类。名字即语义，不额外搞一层映射表 */
export type PlanetSurface =
  | 'mercury'
  | 'venus'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'
  | 'moon'

/** 颜色一律用 0~255 的 RGB 三元组，最后写进 ImageData */
type RGB = readonly [number, number, number]

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function mixRGB(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t)
  return [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)]
}

/**
 * 32 位整数哈希，返回 0~1。
 *
 * 用 Math.imul 而不是 `Math.sin(x * 127.1 + y * 311.7) * 43758.5453`：
 * 后者在坐标上到几百之后浮点精度不够，会出现肉眼可见的重复条纹。
 */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1013904223)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967295
}

/**
 * 值噪声。**x 方向按 periodX 取模** —— 这就是「贴图左右无缝」的全部秘密。
 * periodX 必须是整数（调用方保证），否则 ix 与 ix+1 会落到不同的格点集合上，接缝照旧。
 */
function valueNoise(x: number, y: number, periodX: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const wrap = (v: number): number => ((v % periodX) + periodX) % periodX
  const a = hash(wrap(ix), iy, seed)
  const b = hash(wrap(ix + 1), iy, seed)
  const c = hash(wrap(ix), iy + 1, seed)
  const d = hash(wrap(ix + 1), iy + 1, seed)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

/**
 * 分形噪声，返回 0~1。u、v 都是 0~1 的贴图坐标，freqU / freqV 是基频（贴图内铺几格）。
 * freqU 会被强制取整，之后每层八度翻倍，所以整条 fbm 与贴图同周期 —— 横向无缝。
 */
function fbm(u: number, v: number, freqU: number, freqV: number, octaves: number, seed: number): number {
  let value = 0
  let amp = 0.5
  let norm = 0
  let fu = Math.max(1, Math.round(freqU))
  let fv = Math.max(1, Math.round(freqV))
  for (let i = 0; i < octaves; i += 1) {
    value += amp * valueNoise(u * fu, v * fv, fu, seed + i * 37)
    norm += amp
    fu *= 2
    fv *= 2
    amp *= 0.5
  }
  return value / norm
}

/** 经度方向的环形距离，结果落在 [-0.5, 0.5]。贴图左右相接，距离必须按环算 */
function wrapDelta(a: number, b: number): number {
  return a - b - Math.round(a - b)
}

interface Crater {
  /** 经度 0~1 */
  u: number
  /** 纬度参数 0~1（0 = 北极） */
  v: number
  /** 半长轴，单位与 u 相同 */
  ra: number
  /** 短轴 / 长轴。真实撞击坑不会是正圆 */
  ratio: number
  /** 长轴朝向 */
  cos: number
  sin: number
  /** 深度系数，让每个坑的深浅不一样 */
  depth: number
}

/** 撒一把环形山。半径按三次幂分布 —— 真实撞击坑也是小坑远多于大坑 */
function makeCraters(count: number, seed: number, minR: number, maxR: number): Crater[] {
  const out: Crater[] = []
  let state = seed >>> 0
  const rnd = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  for (let i = 0; i < count; i += 1) {
    const rot = rnd() * Math.PI
    out.push({
      // v 走 acos 分布，球面上才是均匀的；直接取均匀分布会把坑全堆到两极
      u: rnd(),
      v: Math.acos(1 - 2 * rnd()) / Math.PI,
      ra: minR + rnd() ** 3 * (maxR - minR),
      ratio: 0.68 + rnd() * 0.32,
      cos: Math.cos(rot),
      sin: Math.sin(rot),
      depth: 0.6 + rnd() * 0.8,
    })
  }
  return out
}

// 数量刻意压住：坑一多、对比一强，整颗球就变成一张「气泡膜」。
// 真实的月球、水星靠的是**大小悬殊**（几个大盆地 + 无数看不清的小坑），不是均匀铺满
const MERCURY_CRATERS = makeCraters(78, 11, 0.004, 0.11)
const MOON_CRATERS = makeCraters(54, 29, 0.005, 0.14)

/**
 * 把环形山压到颜色上。三个环带，从内到外：
 * 坑底压暗 → 坑缘提亮 → 外围溅射毯略压暗。
 *
 * 距离里的 `dv * 0.5`：u 绕 360°、v 只跨 180°，同一个角度差在 v 上只有 u 的一半，
 * 不折算的话坑在纬度方向会被拉成两倍高的椭圆。
 *
 * 对比度是这里唯一要盯的数：坑缘提亮给到 40 以上，几十像素的球上就是一串白圈。
 */
function applyCraters(col: RGB, u: number, v: number, craters: readonly Crater[], depth: number): RGB {
  let r = col[0]
  let g = col[1]
  let b = col[2]
  for (let i = 0; i < craters.length; i += 1) {
    const c = craters[i]
    const du = wrapDelta(u, c.u)
    const dv = (v - c.v) * 0.5
    // 先用外接方框筛掉绝大多数像素，省下 sqrt
    const reach = c.ra * 1.85
    if (du > reach || du < -reach || dv > reach || dv < -reach) continue

    // 转到坑自己的坐标系里算椭圆距离：每个坑的朝向和扁率都不一样
    const x = (du * c.cos + dv * c.sin) / c.ra
    const y = (-du * c.sin + dv * c.cos) / (c.ra * c.ratio)
    const t = Math.sqrt(x * x + y * y)
    if (t > 1.85) continue

    const floor = 1 - smoothstep(0.6, 1.0, t)
    const rim = smoothstep(0.8, 0.97, t) * (1 - smoothstep(0.97, 1.2, t))
    const ejecta = smoothstep(1.02, 1.5, t) * (1 - smoothstep(1.5, 1.85, t))
    // 坑缘只提亮 13：给到 24 以上，几十像素的球上就是一串白圈 —— 气泡膜就是这么来的
    const dark = floor * depth * c.depth
    const lift = rim * 13 + ejecta * 5
    r = r * (1 - dark) + lift
    g = g * (1 - dark) + lift
    b = b * (1 - dark) + lift
  }
  return [r, g, b]
}

function shadeMercury(u: number, v: number): RGB {
  // 底色对比压得很低：真实的「水星灰」接近一片均匀的中性灰，
  // 起伏全交给环形山，底色再花就只剩噪点
  const n = fbm(u, v, 9, 9, 5, 101)
  const broad = fbm(u, v, 2, 2, 3, 137)
  let col = mixRGB([124, 118, 110], [180, 174, 164], smoothstep(0.3, 0.72, n))
  col = mixRGB(col, [142, 134, 124], broad * 0.5)
  return applyCraters(col, u, v, MERCURY_CRATERS, 0.26)
}

function shadeVenus(u: number, v: number): RGB {
  // 真实金星在可见光下几乎是**没有特征**的：一层又厚又匀的硫酸云，
  // 只有极淡的 Y 形暗纹。所以这里的对比必须低到「像没画东西」——
  // 一旦按纬度铺正弦，球上就会浮出一条赤道暗带，那是木星才有的东西
  const swirl = fbm(u, v, 3, 3, 4, 211)
  const veil = fbm(u, v, 7, 6, 4, 233)
  let col = mixRGB([214, 184, 130], [244, 232, 202], smoothstep(0.25, 0.8, swirl))
  col = mixRGB(col, [250, 244, 224], smoothstep(0.5, 0.88, veil) * 0.3)
  // 极区略暗、略暖：真实金星在极区有一圈深色的「旋涡」
  return mixRGB(col, [196, 166, 118], smoothstep(0.75, 1.0, Math.abs(v - 0.5) * 2) * 0.28)
}

function shadeMars(u: number, v: number): RGB {
  // 低频打底（大块的明暗地域）+ 一层很轻的细粒。火星的「花」是低频的，
  // 高频给多了就是一身迷彩；色彩也压着一档 —— 真火星是哑光的锈陶土色，
  // 不是纯橙红
  const n = fbm(u, v, 4, 4, 5, 307)
  let col = mixRGB([158, 92, 58], [212, 148, 102], smoothstep(0.32, 0.74, n))
  const dark = fbm(u, v, 3, 3, 3, 331)
  col = mixRGB(col, [122, 64, 44], smoothstep(0.5, 0.84, dark) * 0.5)
  const bright = fbm(u, v, 10, 9, 4, 353)
  col = mixRGB(col, [228, 182, 138], smoothstep(0.58, 0.86, bright) * 0.3)
  // 极冠：边缘用噪声打碎，否则就是扣在球两极的两顶规整的白帽子
  const capEdge = Math.abs(v - 0.5) * 2 + (fbm(u, v, 14, 14, 3, 359) - 0.5) * 0.1
  return mixRGB(col, [238, 234, 228], smoothstep(0.87, 0.97, capEdge) * 0.95)
}

function shadeJupiter(u: number, v: number): RGB {
  const lat = (v - 0.5) * 2
  // 湍流只把纬带推歪一点点。给大了（0.22 那版）整张图会卷成一块飘动的绸子，
  // 而真实木星的带子基本是**横平**的，起伏只在带的边缘
  const turb = (fbm(u, v, 8, 6, 4, 401) - 0.5) * 0.09
  const lv = lat + turb
  // 五个频率叠出「一条亮带夹一条暗带」的层次。木星从北极到南极能数出十来条，
  // 频率给低了就只剩四五条宽色块
  let band = 0.62 * Math.sin(lv * 9 + 0.2)
  band += 0.34 * Math.sin(lv * 19 + 1.6)
  band += 0.2 * Math.sin(lv * 33 - 0.7)
  band += 0.11 * Math.sin(lv * 57 + 2.2)
  // smoothstep 而不是线性：真实纬带的边界比中间陡，线性映射出来是一团雾
  const zone = smoothstep(-0.6, 0.6, band)
  let col = mixRGB([126, 76, 40], [246, 238, 218], zone)
  // 带内色相变化：有的带偏橘、有的偏灰
  col = mixRGB(col, [190, 148, 106], fbm(u, v, 3, 11, 3, 409) * 0.32)
  // 带内细碎扰动，让每一带的亮度不是常数
  const detail = fbm(u, v, 26, 40, 3, 419) - 0.5
  col = [col[0] * (1 + detail * 0.18), col[1] * (1 + detail * 0.16), col[2] * (1 + detail * 0.12)]
  col = mixRGB(col, [118, 80, 50], smoothstep(0.8, 1.0, Math.abs(lat)) * 0.5)

  // 大红斑。u 上的半宽 0.07 ≈ 经度 25°，v 折半后同尺度 —— 长轴约为短轴两倍
  const du = wrapDelta(u, 0.3)
  const dv = (v - 0.625) * 0.5
  const e = (du / 0.07) ** 2 + (dv / 0.034) ** 2
  // 外圈一圈浅色的「涡流环」，再往里是红斑本体和更亮的中心
  col = mixRGB(col, [238, 224, 196], smoothstep(1.0, 1.45, e) * (1 - smoothstep(1.45, 2.2, e)) * 0.35)
  col = mixRGB(col, [178, 76, 46], (1 - smoothstep(0.6, 1.05, e)) * 0.92)
  col = mixRGB(col, [216, 130, 88], (1 - smoothstep(0.0, 0.5, e)) * 0.5)

  // 几颗小白椭圆：木星上常见的小风暴
  const oval = (cu: number, cv: number, rw: number, rh: number): number => {
    const ou = wrapDelta(u, cu)
    const ov = (v - cv) * 0.5
    return 1 - smoothstep(0.55, 1.05, (ou / rw) ** 2 + (ov / rh) ** 2)
  }
  col = mixRGB(col, [246, 240, 226], oval(0.62, 0.52, 0.028, 0.014) * 0.6)
  col = mixRGB(col, [242, 236, 220], oval(0.86, 0.71, 0.022, 0.011) * 0.5)
  return col
}

function shadeSaturn(u: number, v: number): RGB {
  const lat = (v - 0.5) * 2
  const turb = (fbm(u, v, 6, 7, 4, 503) - 0.5) * 0.06
  const lv = lat + turb
  let band = 0.5 * Math.sin(lv * 7.5 + 0.3)
  band += 0.22 * Math.sin(lv * 15 - 1.1)
  band += 0.1 * Math.sin(lv * 29 + 1.8)
  // 对比度比木星低一档：土星在可见光下是一颗**淡金色的奶油球**，
  // 带子有，但远没有木星那么横冲直撞
  const zone = smoothstep(-0.72, 0.72, band)
  let col = mixRGB([216, 192, 144], [247, 241, 220], zone)
  col = mixRGB(col, [230, 208, 164], fbm(u, v, 4, 13, 3, 521) * 0.3)
  const detail = fbm(u, v, 20, 30, 3, 529) - 0.5
  col = [col[0] * (1 + detail * 0.1), col[1] * (1 + detail * 0.09), col[2] * (1 + detail * 0.08)]
  // 极区偏冷灰：土星两极有六边形急流和偏蓝的色调
  return mixRGB(col, [186, 190, 190], smoothstep(0.84, 1.0, Math.abs(lat)) * 0.35)
}

function shadeUranus(u: number, v: number): RGB {
  const lat = (v - 0.5) * 2
  const n = fbm(u, v, 4, 5, 4, 601)
  // 天王星是太阳系里最「平」的一颗：整颗球几乎只有一片均匀的青，带子淡到要凑近看
  let col = mixRGB([142, 204, 210], [182, 228, 233], smoothstep(0.25, 0.8, n))
  const band = 0.5 + 0.5 * Math.sin(lat * 5 + (fbm(u, v, 4, 4, 3, 617) - 0.5) * 1.2)
  col = mixRGB(col, [164, 216, 221], band * 0.16)
  // 真实天王星两极比赤道亮（自转轴几乎躺倒），这里给极区一点提亮
  return mixRGB(col, [202, 238, 241], smoothstep(0.72, 1.0, Math.abs(lat)) * 0.28)
}

function shadeNeptune(u: number, v: number): RGB {
  const lat = (v - 0.5) * 2
  const n = fbm(u, v, 5, 6, 4, 701)
  let col = mixRGB([56, 82, 172], [100, 138, 216], smoothstep(0.2, 0.85, n))
  const band = 0.5 + 0.5 * Math.sin(lat * 6 + (fbm(u, v, 4, 4, 3, 719) - 0.5) * 1.4)
  col = mixRGB(col, [80, 116, 206], band * 0.28)
  // 大暗斑
  const du = wrapDelta(u, 0.62)
  const dv = (v - 0.62) * 0.5
  const e = (du / 0.055) ** 2 + (dv / 0.028) ** 2
  col = mixRGB(col, [30, 50, 132], (1 - smoothstep(0.6, 1.05, e)) * 0.72)
  // 高层白色甲烷云。横向拉长靠的是「经度频率低、纬度频率高」——
  // 反过来给就成了一地碎点子，那不像云带，像雪花屏
  const cloud = fbm(u, v, 6, 30, 3, 733)
  return mixRGB(col, [232, 240, 250], smoothstep(0.68, 0.88, cloud) * 0.34)
}

function shadeMoon(u: number, v: number): RGB {
  const n = fbm(u, v, 8, 8, 5, 809)
  let col = mixRGB([118, 118, 124], [196, 196, 200], smoothstep(0.32, 0.76, n))
  // 月海：大块的暗色玄武岩平原，是月球第一眼最认得出的特征
  const maria = fbm(u, v, 2, 3, 3, 827)
  col = mixRGB(col, [86, 86, 94], smoothstep(0.5, 0.78, maria) * 0.75)
  return applyCraters(col, u, v, MOON_CRATERS, 0.28)
}

function shade(surface: PlanetSurface, u: number, v: number): RGB {
  switch (surface) {
    case 'mercury':
      return shadeMercury(u, v)
    case 'venus':
      return shadeVenus(u, v)
    case 'mars':
      return shadeMars(u, v)
    case 'jupiter':
      return shadeJupiter(u, v)
    case 'saturn':
      return shadeSaturn(u, v)
    case 'uranus':
      return shadeUranus(u, v)
    case 'neptune':
      return shadeNeptune(u, v)
    case 'moon':
      return shadeMoon(u, v)
  }
}

/** 木星、土星在开场里最大，纬带也最细，给高一档的分辨率；其余 256 足够 */
const WIDTHS: Record<PlanetSurface, number> = {
  mercury: 256,
  venus: 256,
  mars: 256,
  jupiter: 384,
  saturn: 384,
  uranus: 256,
  neptune: 256,
  moon: 256,
}

/**
 * 纯计算：把某个表面烘成一张 RGBA 像素缓冲（等距圆柱投影，宽 = 2 × 高）。
 *
 * 和 createPlanetSurfaceTexture 分开，是因为这一段不碰 DOM、也不碰 three ——
 * 换掉 canvas 就能在 Node 里跑，出图对着看一眼就知道调色对不对。
 */
export function renderPlanetSurface(surface: PlanetSurface, width: number): Uint8ClampedArray {
  const height = width / 2
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height
    for (let x = 0; x < width; x += 1) {
      const col = shade(surface, (x + 0.5) / width, v)
      const i = (y * width + x) * 4
      // Uint8ClampedArray 自带 0~255 截断，环形山那几处越界的加减不用自己夹
      data[i] = col[0]
      data[i + 1] = col[1]
      data[i + 2] = col[2]
      data[i + 3] = 255
    }
  }
  return data
}

/**
 * 烘一张行星表面贴图。
 *
 * 调用方负责 dispose —— 这里不做模块级缓存：贴图的生命周期跟着场景走，
 * 缓存一份被 dispose 过的贴图，下次挂载场景时就是一张空图。
 */
export function createPlanetSurfaceTexture(
  THREE: typeof THREE_NS,
  surface: PlanetSurface,
): THREE_NS.CanvasTexture | null {
  const width = WIDTHS[surface]
  const height = width / 2
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const painter = canvas.getContext('2d')
  // 拿不到 2D 上下文就返回 null：调用方会退回纯色球。
  // 不能返回一张空画布 —— 那会是一颗纯黑的球，比纯色难看得多
  if (!painter) return null

  const image = painter.createImageData(width, height)
  image.data.set(renderPlanetSurface(surface, width))
  painter.putImageData(image, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  // 和地球那两张卫星图同一套色彩管理：贴图按 sRGB 存，采样时由 GPU 解到线性
  texture.colorSpace = THREE.SRGBColorSpace
  // 横向重复：球面 UV 绕一圈，接缝两侧正好互相兜住。纵向只跨 180°，clamp
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}
