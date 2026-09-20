import type * as THREE_NS from 'three'
import type { SceneContext, SceneInstance } from '../three-scene'

/**
 * 星系 —— 一座斜倚在深空里的螺旋星系，盘面缓缓自转，前景悬着一套太阳系。
 *
 * 三层东西叠在一起：
 *
 * 1. **螺旋星系盘**：两万多个星点按对数螺旋铺成两条旋臂，越靠外臂越松散。
 *    盘中心那团暖色核球用一张 sprite 画，**不是**用点云堆出来的 ——
 *    中心区域的点密度天然极高，几百个加法混合的点叠在同一像素上必然烧成白饼，
 *    所以点云从 640 单位半径处才开始铺，最里面交给一张柔和的贴图。
 *
 * 2. **太阳系**：太阳、六颗行星、轨道环，外加一颗带大气亮边的地球和它的月亮。
 *    尺度是艺术化的 —— 真按比例来，行星在屏幕上连一个像素都占不到。
 *    太阳系挂在前景（z 约 -950），背后正好是星系盘，读起来就是「太阳系在星系里」。
 *
 * 3. **上下滑动**：页面滚动进度驱动整个星系沿 Y 平移。星系盘幅度大、太阳系幅度小，
 *    两层错开就有了纵深；再叠一层极慢的自发浮动，不滚动时画面也不是死的。
 *
 * 亮度预算（这套最关键的约束，缺一条中心就糊）：
 * 星点尺寸压在 1.2~3.4 像素、中心区亮度额外乘 0.34 的衰减、辉光阈值抬到 0.36。
 *
 * 投影密度补偿：盘面是斜的，近端距相机只有远端的一半，同一份点撒下去近端会稀得可怜。
 * 所以撒点走 rejection sampling，接受概率正比于 1/深度²，让**屏幕上**的点密度均匀。
 */

// ---------------- 星系盘 ----------------

/** 盘的半径。注意它和相机距离的比值直接决定盘在屏幕上占多大 */
const DISC_RADIUS = 6000
/** 目标星点数。实际落点数会略少（rejection sampling 的余量） */
const DISC_POINTS = 26000
/** 点云从这里开始铺，里面那圈留给核球 sprite */
const CORE_RADIUS = 640
/** 盘的半厚度（内圈）。外圈会按半径收缩 */
const DISC_THICKNESS = 220

/** 旋臂条数。两条是最容易一眼认出的「星系」形态，三条以上会开始像漩涡 */
const ARM_COUNT = 2
/** 旋臂从内到外一共扫过多少弧度。对数螺旋，内圈转得急、外圈转得缓 */
const ARM_TWIST = 3.4
/** 旋臂的角向散开量（内圈），外圈会按半径放大 */
const ARM_SPREAD = 0.52
/** 落在旋臂上的点占比，其余均匀铺在盘面上充当弥散星族 */
const ARM_RATIO = 0.74

/** 盘面倾角。60° 时垂直方向压成一半，正好是银河照片里那种斜倚的扁椭圆 */
const DISC_TILT = Math.PI / 3
/** 盘的自转角速度（弧度/秒）。慢是故意的 —— 星系不该转得像电风扇 */
const DISC_SPIN = 0.018
/** 盘中心的世界坐标 z */
const DISC_Z = -6800
/**
 * 盘中心的初始高度。正数 = 往上抬。
 *
 * 抬这一下是为了把核球从主标题正后方挪开：700 世界单位在 6800 的深度上
 * 约合屏幕上移 80px，核球亮核正好落进主标题和副标题之间那道空隙，
 * 光晕从文字背后透出来，而不是被整块盖住。再往上抬盘的下半部分就开始出屏了。
 */
const DISC_BASE_Y = 700

/** 页面滚到底时，星系盘相对首屏再沿 Y 上移多少世界单位 */
const DISC_SLIDE = 1700
/** 自发浮动幅度与角速度。幅度很小，只是让画面别「死」 */
const DISC_BREATHE = 110
const DISC_BREATHE_SPEED = 0.12

// ---------------- 太阳系 ----------------

/** 太阳系中心到相机的距离。它决定行星在屏幕上多大 —— 这是「清不清晰」的第一变量 */
const SOLAR_DIST = 800
/** 黄道面倾角，让轨道在屏幕上呈椭圆而不是一条线 */
const SOLAR_TILT = 0.62
/** 太阳系跟着滚动的幅度，比星系盘小得多 —— 否则它会直接滑出画面 */
const SOLAR_SLIDE = 200
/** 公转角速度基准（弧度/秒），乘上每颗行星自己的 speed */
const ORBIT_BASE = 0.195
/** 行星自转角速度基准（弧度/秒），乘上每颗行星自己的 spin */
const SPIN_BASE = 0.55
const SUN_RADIUS = 26
const MOON_ORBIT = 34
const MOON_RADIUS = 4.6
const MOON_SPEED = 1.35
/**
 * 太阳系的环境光下限。
 *
 * 纯朗伯光照下背光面是纯黑，行星只剩一道月牙，在几十像素的尺寸上会显得「缺了一块」。
 * 给 0.14 的底，暗面留一点轮廓，又不至于把体积感抹平。
 */
const SOLAR_AMBIENT = 0.14

interface PlanetSpec {
  /** 轨道半径 */
  orbit: number
  /** 星球半径 */
  radius: number
  /** 十六进制颜色 */
  color: string
  /** 相对角速度 */
  speed: number
  /** 初始相位，让六颗星别排成一条直线 */
  phase: number
  /** 相对自转角速度 */
  spin: number
  /** 表面条纹强度 0~1，0 就是纯色 */
  banding?: number
  /** 条纹的对比色 */
  bandColor?: string
  /** 条纹频率，越高条纹越密 */
  bandFreq?: number
  /** 是否带环（土星） */
  ring?: boolean
}

/**
 * 六颗行星。半径和轨道都刻意夸张了 —— 真按比例，地球在这里只有 0.01 个像素。
 *
 * 尺度按「屏幕上至少 25 像素直径」倒推：低于这个数，球体的明暗交界和表面细节
 * 都压在一两个像素里，看起来就是一块色斑，加多少 shader 都救不回来。
 *
 * 轨道间距拉得比真实比例还开，是为了让相邻两颗在屏幕上不粘成一颗。
 * 地球排第三位，是唯一有海陆和云的一颗，目的就是让人一眼认出「那是地球」。
 */
const PLANETS: readonly PlanetSpec[] = [
  { orbit: 62, radius: 4.4, color: '#b0a69c', speed: 1.0, phase: 0.4, spin: 0.5 },
  { orbit: 98, radius: 7.2, color: '#f5cf7c', speed: 0.72, phase: 2.1, spin: 0.36 },
  { orbit: 140, radius: 15, color: '#2f6fe0', speed: 0.54, phase: 4.0, spin: 1.0 },
  { orbit: 186, radius: 6.0, color: '#d05a34', speed: 0.42, phase: 1.2, spin: 0.92 },
  {
    orbit: 252,
    radius: 21,
    color: '#dcb87c',
    speed: 0.3,
    phase: 5.3,
    spin: 1.4,
    banding: 0.5,
    bandColor: '#f4e4c4',
    // 频率按「球面上能看清几个周期」定：木星在屏幕上直径四十来像素，
    // 给到 13 时每条纹不到 5 像素，采样下来就是一片糊 —— 8 是能看清的上限
    bandFreq: 8,
  },
  {
    orbit: 312,
    radius: 17.5,
    color: '#e2d3a4',
    speed: 0.22,
    phase: 3.1,
    spin: 1.2,
    banding: 0.38,
    bandColor: '#f8f0d8',
    bandFreq: 6,
    ring: true,
  },
]

/** 地球在 PLANETS 里的下标 */
const EARTH_INDEX = 2

/**
 * 太阳系在屏幕上的锚点（归一化坐标，-1~1，原点在屏幕中心）。
 * 用屏幕坐标而不是世界坐标来定，是为了让它在任何宽高比下都待在同一个相对位置。
 */
const SOLAR_ANCHOR_X = 0.54
/**
 * 纵向锚点。**-0.42 那版太阳正好被底部那排数据卡的上沿切掉一块**，
 * 光晕还整片铺在卡面上（实测卡片顶边在屏幕 y≈647，太阳圆心落在 y≈609，
 * 半径 25px 的日面下缘直接进卡片）。抬到 -0.28 后太阳整体上移约 63px，
 * 日面和光晕都让开了卡片；再往上抬轨道弧顶就要撞导航栏了。
 */
const SOLAR_ANCHOR_Y = -0.28

/** 高斯近似：三个均匀随机数相加。比 Box-Muller 省事，形状够用 */
function gauss(): number {
  return (Math.random() + Math.random() + Math.random()) / 1.5 - 1
}

/**
 * 生成一张径向渐变的辉光贴图，给太阳和地球当光晕用。
 *
 * 用 Sprite 而不是自己写 billboard 面片：Sprite 天然永远面向相机，
 * 省掉每帧对齐的四元数运算，而这里只有两个发光体，性能差异可以忽略。
 */
function createGlowTexture(THREE: typeof THREE_NS): THREE_NS.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const painter = canvas.getContext('2d')
  if (painter) {
    const gradient = painter.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    // 衰减要陡。平缓的渐变铺在卡片上就是一大片暖色糊光 —— 那是光污染；
    // 陡一点，亮区收在中心百分之十几的半径里，才像「一颗星」而不是「一盏灯」
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.16, 'rgba(255,255,255,0.45)')
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.11)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    painter.fillStyle = gradient
    painter.fillRect(0, 0, size, size)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * 太阳系里所有星球共享的两个 uniform。
 *
 * 引用同一份对象而不是每个材质各存一份：`uSunPos` 每帧都要跟着太阳系的位置走，
 * 六颗行星 + 月球 + 地球各更新一次纯属浪费，共享之后一句 `copy()` 就够。
 */
interface SolarUniforms {
  sunPos: THREE_NS.IUniform<THREE_NS.Vector3>
  ambient: THREE_NS.IUniform<number>
}

/**
 * 行星材质。
 *
 * 这一版和之前那版的分界只有一条：**之前用 `MeshBasicMaterial`，是平涂的**。
 * 平涂的球体没有明暗，放大到几十像素就是一块贴纸 —— 加多少细节都救不回来。
 * 现在三层叠起来：
 *
 * 1. **朗伯光照**，光源是太阳。太阳方向由 `uSunPos` 每帧传入，
 *    所以行星公转到不同位置时，被照亮的那一半会跟着转。
 * 2. **纬度条纹**（木星、土星用）。按**物体空间**法线的 y 分量分层 ——
 *    这一点必须用物体空间：用视图空间算的话，球体自转时条纹会满球乱爬。
 * 3. **明暗交界柔化**。指数 0.85 把交界附近稍微提亮，
 *    否则在几十像素的尺寸上，暗面会「吃掉」大半个球。
 */
function createPlanetMaterial(
  THREE: typeof THREE_NS,
  spec: Pick<PlanetSpec, 'color' | 'banding' | 'bandColor' | 'bandFreq'>,
  shared: SolarUniforms,
): THREE_NS.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(spec.color) },
      uBandColor: { value: new THREE.Color(spec.bandColor ?? spec.color) },
      uBandAmount: { value: spec.banding ?? 0 },
      uBandFreq: { value: spec.bandFreq ?? 12 },
      uSunPos: shared.sunPos,
      uAmbient: shared.ambient,
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vObjNormal;
      varying vec3 vToSun;

      uniform vec3 uSunPos;

      void main() {
        // 光照和菲涅尔都在视图空间算，所以法线要先转过去
        vNormal = normalize(normalMatrix * normal);
        // 条纹要跟着球走、不能跟着相机走，所以另存一份物体空间法线
        vObjNormal = normalize(position);

        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        // 世界空间里算「指向太阳」的方向，再转到视图空间。
        // w 给 0：这是方向向量，不能被平移分量影响
        vToSun = (viewMatrix * vec4(uSunPos - worldPos.xyz, 0.0)).xyz;

        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uBandColor;
      uniform float uBandAmount;
      uniform float uBandFreq;
      uniform float uAmbient;

      varying vec3 vNormal;
      varying vec3 vObjNormal;
      varying vec3 vToSun;

      void main() {
        vec3 n = normalize(vNormal);

        vec3 base = uColor;
        if (uBandAmount > 0.001) {
          // 两层频率叠一下。单一频率的条纹看着像斑马线，叠一层错开的才像大气环流
          float b1 = 0.5 + 0.5 * sin(vObjNormal.y * uBandFreq + 1.7);
          float b2 = 0.5 + 0.5 * sin(vObjNormal.y * uBandFreq * 2.6 - 0.5);
          float band = mix(b1, b2, 0.34);
          base = mix(uColor, uBandColor, band * uBandAmount);
        }

        float lambert = max(0.0, dot(n, normalize(vToSun)));
        float shade = uAmbient + pow(lambert, 0.85) * (1.0 - uAmbient);

        gl_FragColor = vec4(base * shade, 1.0);
      }
    `,
  })
}

/**
 * 地球材质。
 *
 * 和通用行星材质的区别在于表面：海陆 + 极冠 + 云 + 大气亮边。
 * 这几样都是「便宜的辨识特征」—— 在三十来像素的球上，一颗有白色极冠、
 * 蓝色海洋和一圈大气亮边的球，比一颗纯蓝球好认十倍。
 */
function createEarthMaterial(
  THREE: typeof THREE_NS,
  shared: SolarUniforms,
): THREE_NS.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOcean: { value: new THREE.Color('#0d3f8f') },
      uLand: { value: new THREE.Color('#2f7a48') },
      uSand: { value: new THREE.Color('#a8935e') },
      uIce: { value: new THREE.Color('#e8f2ff') },
      uAtmo: { value: new THREE.Color('#5cb4ff') },
      uSunPos: shared.sunPos,
      uAmbient: shared.ambient,
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vObjNormal;
      varying vec3 vViewDir;
      varying vec3 vToSun;

      uniform vec3 uSunPos;

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vObjNormal = normalize(position);

        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mv.xyz);

        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vToSun = (viewMatrix * vec4(uSunPos - worldPos.xyz, 0.0)).xyz;

        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uOcean;
      uniform vec3 uLand;
      uniform vec3 uSand;
      uniform vec3 uIce;
      uniform vec3 uAtmo;
      uniform float uAmbient;

      varying vec3 vNormal;
      varying vec3 vObjNormal;
      varying vec3 vViewDir;
      varying vec3 vToSun;

      void main() {
        vec3 n = normalize(vNormal);
        vec3 on = normalize(vObjNormal);

        // 域扭曲：先拿另一组低频正弦把采样坐标推开，再拿去取噪声。
        //
        // 三轴正弦相乘在数学上就是一张**正交的格子**，不做这一步，大陆和云在球面上
        // 都是一排排等间距的方块 —— 10 倍放大看非常明显，像球上贴了马赛克。
        // 推开 0.28 之后格子被打散，出来的是不规则的大陆和絮状云
        vec3 warp = vec3(
          sin(on.y * 3.3 + 1.7),
          sin(on.z * 2.7 - 0.9),
          sin(on.x * 3.1 + 2.4)
        ) * 0.28;
        vec3 p = normalize(on + warp);

        // 海陆：三层不同频率的正弦叠出大陆斑块。一层太规整，四层以上就糊成一团噪点。
        //
        // 频率整体比上一版提了约 1.6 倍。上一版第一层是 4.3，在球面上一个波长约 22px，
        // 而地球本身才 30px 宽 —— 于是整个可见半球就是「一块大陆 + 一片海」，
        // 看起来像随便抹了一笔。提到 6.8 之后波长降到 14px，能同时看到三四块陆地
        float h = sin(p.x * 6.8 + 1.7) * sin(p.y * 5.9 - 0.6) * sin(p.z * 7.7 + 2.3);
        h += 0.62 * sin(p.x * 12.9 - 0.4) * sin(p.z * 11.7 + 1.1) * sin(p.y * 10.7 + 0.3);
        h += 0.32 * sin(p.x * 24.5 + 2.1) * sin(p.z * 21.9 - 1.4);

        float land = smoothstep(0.06, 0.38, h);
        // 海岸线：把 land 的高位切出来当沙色，给大陆一圈暖边
        float coast = smoothstep(0.30, 0.52, h) * (1.0 - smoothstep(0.52, 0.74, h));
        vec3 col = mix(uOcean, mix(uLand, uSand, coast), land);

        // 极冠。
        //
        // 门槛从 0.70 提到 0.88：|y| 是纬度的正弦，0.70 对应北纬 45° ——
        // 上一版等于把整个球的上半部分糊成白的，地球读起来就是个「戴白帽的蓝球」，
        // 用户看到的那团白色大斑就是它。0.88 对应 61.6°，才是真正常年积雪的范围。
        // 这一项仍然用 on 而不是 p：极冠必须老老实实待在两极，
        // 跟着扭曲走会飘到中纬度去
        float ice = smoothstep(0.88, 0.985, abs(on.y));
        col = mix(col, uIce, ice * 0.85);

        // 云。
        //
        // 上一版是单组三正弦相乘，就是上面说的那张格子，投到球面上是一排等间距的白圆点。
        // 现在既有了域扭曲，又叠了第二组更高频、相位错开的云，两组互相打散
        float c1 = sin(p.x * 11.0 + 0.8) * sin(p.z * 9.4 - 1.2) * sin(p.y * 8.1 + 2.6);
        float c2 = sin(p.x * 19.0 - 2.1) * sin(p.z * 17.3 + 0.7) * sin(p.y * 15.1 - 1.9);
        float cloud = c1 + 0.45 * c2;
        // 强度 0.32 → 0.30。再浓就把海陆盖没了，那就白做了
        col = mix(col, vec3(1.0), smoothstep(0.26, 0.66, cloud) * 0.30);

        // 光照
        float lambert = max(0.0, dot(n, normalize(vToSun)));
        float shade = uAmbient + pow(lambert, 0.85) * (1.0 - uAmbient);
        col *= shade;

        // 大气亮边。**加在光照之后** —— 大气是散射层，背光面的边缘同样会亮，
        // 跟着光照一起变暗反而不像地球。
        // 指数 2.6 → 3.4、强度 0.8 → 0.5：上一版那条边宽到像给地球套了个发光圆环，
        // 收窄压暗之后才是一层薄大气
        float rim = pow(1.0 - max(0.0, dot(n, normalize(vViewDir))), 3.4);
        col += uAtmo * rim * 0.5;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}

/**
 * 土星环材质。
 *
 * 用 shader 按半径做条纹，而不是拿一张贴图：环在屏幕上只有几十像素宽，
 * 贴图会被采样糊掉，程序化的条纹反而更锐。
 */
function createRingMaterial(
  THREE: typeof THREE_NS,
  inner: number,
  outer: number,
): THREE_NS.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color('#e6d6a8') },
      uInner: { value: inner },
      uOuter: { value: outer },
      uOpacity: { value: 0.72 },
    },
    vertexShader: /* glsl */ `
      uniform float uInner;
      uniform float uOuter;
      varying float vRadial;

      void main() {
        // RingGeometry 躺在 XY 平面，顶点到原点的距离就是半径
        float r = length(position.xy);
        vRadial = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vRadial;

      void main() {
        // 细密环纹：土星环本质上是无数条小环
        float fine = 0.66 + 0.34 * sin(vRadial * 132.0);
        // 卡西尼缝：偏外侧那条宽暗带。没有它，环就是一整块圆盘
        float cassini = smoothstep(0.56, 0.64, vRadial) * (1.0 - smoothstep(0.70, 0.78, vRadial));
        // 内外缘都淡出，否则环的边界会是一条生硬的圆
        float edge = smoothstep(0.0, 0.14, vRadial) * (1.0 - smoothstep(0.86, 1.0, vRadial));

        float a = uOpacity * fine * edge * (1.0 - cassini * 0.82);
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  })
}

/**
 * 太阳材质。
 *
 * 一个纯色球在几十像素上就是个贴纸，所以给两样东西：
 * **临边昏暗**（真实恒星的边缘比中心暗，因为视线在边缘穿过的光球层更薄）
 * 和一点表面颗粒。
 */
function createSunMaterial(THREE: typeof THREE_NS): THREE_NS.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      // 核心不用纯白。纯白（#fff6dc，亮度 0.96）配上 0.36 的辉光阈值，
      // 结果是整个日面都在参与辉光，糊成一块没有边界的光斑 —— 这就是「模糊」的来源之一。
      // 压到暖黄并把衰减铺开之后，只有最中心那一小块超过阈值
      uCore: { value: new THREE.Color('#fff0b8') },
      uEdge: { value: new THREE.Color('#ff8a2a') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vObjNormal;
      varying vec3 vViewDir;

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vObjNormal = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCore;
      uniform vec3 uEdge;
      varying vec3 vNormal;
      varying vec3 vObjNormal;
      varying vec3 vViewDir;

      void main() {
        vec3 n = normalize(vNormal);
        vec3 on = normalize(vObjNormal);

        // 临边昏暗。
        //
        // 指数从 0.42 提到 1.05 是这一版最关键的一处改动。0.42 那版把衰减全挤在最外
        // 15% 半径里（半半径处还剩 0.75 的亮度），日面看上去是一块平的白色圆盘 ——
        // 在五十像素的尺寸上，那和一张贴纸没有区别，用户说的「看着都不行」就是它。
        // 1.05 让亮度从圆心 1.0 一路滑到边缘 0.26：半半径 0.85、0.7 半径 0.68、
        // 0.95 半径 0.26，整个球面都有层次，读起来才是个「球」。
        float mu = max(0.0, dot(n, normalize(vViewDir)));
        float limb = pow(mu, 1.05);

        // 表面颗粒。只是让球面「有东西」，不是真模拟米粒组织。
        // 频率比行星的条纹高得多 —— 日面的颗粒本来就该是细密的
        float granule = sin(on.x * 44.0 + 1.3) * sin(on.y * 39.0 - 0.7) * sin(on.z * 47.0 + 2.1);
        granule = 0.5 + 0.5 * granule;

        vec3 col = mix(uEdge, uCore, limb);
        col *= 0.92 + 0.08 * granule;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}

export function createScene(ctx: SceneContext): SceneInstance {
  const { THREE, scene, camera } = ctx

  camera.fov = 60
  camera.updateProjectionMatrix()

  const disposables: Array<{ dispose(): void }> = []

  // ================= 星系盘 =================

  // 两层 group：外层管倾角和位置，内层管自转。
  // 不能合并成一个 —— 欧拉角默认 XYZ 顺序，同一个对象上同时改 rotation.x 和 rotation.y，
  // 先转 X 再转 Y 是「内旋」，盘会被拧歪。
  const discGroup = new THREE.Group()
  const spinGroup = new THREE.Group()
  discGroup.add(spinGroup)
  discGroup.rotation.x = DISC_TILT
  discGroup.position.set(0, DISC_BASE_Y, DISC_Z)
  scene.add(discGroup)

  // ---- 星点云 ----
  // 投影密度补偿的基准深度：盘上离相机最近的那条边。
  // 接受概率取 (基准/深度)²，正好抵消屏幕面积随 1/深度² 的收缩
  const nearDepth = -DISC_Z - DISC_RADIUS * Math.cos(DISC_TILT)

  const positions: number[] = []
  const colors: number[] = []
  const sizes: number[] = []
  const seeds: number[] = []

  const tint = new THREE.Color()
  let guard = 0
  const guardLimit = DISC_POINTS * 8

  while (positions.length / 3 < DISC_POINTS && guard < guardLimit) {
    guard += 1

    // 径向分布走对数（面密度 exp(-r/h) 的反函数），中心密、外圈疏。
    // 除以 2.4 控制衰减速度：再小中心会挤成一坨，再大外圈会空
    const u = Math.random()
    const rNorm = Math.min(1, -Math.log(1 - u * 0.985) / 2.4)
    const radius = CORE_RADIUS + rNorm * (DISC_RADIUS - CORE_RADIUS)

    // 角度：七成落在旋臂上，三成当弥散星族铺满盘面。
    // 全落旋臂上会显得假 —— 真实星系的旋臂之间也有大量恒星
    const onArm = Math.random() < ARM_RATIO
    let angle: number
    if (onArm) {
      // 对数螺旋：同样的半径增量，内圈扫过的角度远大于外圈，臂才卷得起来
      const spiral = Math.log(1 + rNorm * 6.5) * ARM_TWIST
      // 臂宽随半径放大，外圈的臂是散开的，不是一根等宽的绳
      const spread = ARM_SPREAD * (0.28 + rNorm * 0.85)
      const arm = Math.floor(Math.random() * ARM_COUNT)
      angle = spiral + (arm / ARM_COUNT) * Math.PI * 2 + gauss() * spread
    } else {
      angle = Math.random() * Math.PI * 2
    }

    const localX = Math.cos(angle) * radius
    const localZ = Math.sin(angle) * radius

    // 厚度：内圈厚（核球）、外圈薄。再加一层抖动，免得盘的上下边界像被刀切过
    const thickness = DISC_THICKNESS * (1 - rNorm * 0.62)
    const localY = gauss() * thickness * (0.6 + Math.random() * 0.8)

    // 深度：把局部坐标按盘的倾角转到世界系。盘的横向偏移不影响 z，所以只算 z 分量
    const worldZ = DISC_Z + localY * Math.sin(DISC_TILT) + localZ * Math.cos(DISC_TILT)
    const depth = -worldZ
    if (depth <= 60) continue

    // 密度补偿：屏幕面积正比于 1/深度²，接受率也取 1/深度²
    const accept = Math.min(1, (nearDepth / depth) ** 2)
    if (Math.random() > accept) continue

    positions.push(localX, localY, localZ)

    // 颜色：内圈暖黄（年老星族），外圈蓝白（年轻星族），中间过渡。
    // warmth 到 0.42 半径处就衰减完，所以只有核球附近是暖的
    const warmth = Math.max(0, 1 - rNorm * 2.4)
    let cr = 0.62 + 0.38 * warmth
    let cg = 0.76 + 0.2 * warmth
    let cb = 1.0 - 0.24 * warmth

    // 少量粉红的电离氢区。真实星系旋臂上那几点红，是「有恒星在诞生」的信号
    if (onArm && Math.random() < 0.055) {
      cr = 1.0
      cg = 0.5
      cb = 0.66
    }

    // 亮度：偏态分布，绝大多数点很暗，只有少数几颗是亮星。
    // 均匀分布会让盘变成一片灰白的雾，结构全没了
    let bright = 0.1 + Math.pow(Math.random(), 2.1) * 0.55
    // 旋臂上的亮星更集中 —— 年轻蓝巨星都在臂里
    if (onArm) bright *= 1.45
    // 中心区压暗：那里点密，同样的亮度叠起来就是过曝。
    // 这条是整套亮度的命门，去掉它核球周围立刻糊成白饼
    bright *= 0.34 + 0.66 * Math.min(1, rNorm / 0.26)

    tint.setRGB(cr * bright, cg * bright, cb * bright)
    colors.push(tint.r, tint.g, tint.b)

    // 尺寸下限给到 1.2 像素：低于 1px 的点会被光栅化直接丢弃，整片盘会「空掉」
    sizes.push(1.2 + Math.pow(Math.random(), 1.9) * 2.2)
    seeds.push(Math.random())
  }

  const discGeometry = new THREE.BufferGeometry()
  discGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  discGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  discGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1))
  discGeometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1))

  const discMaterial = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // ShaderMaterial 不会自动带顶点色，用 color 属性必须显式开这个开关
    vertexColors: true,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vColor = color;
        // 幅度只有 ±18% 的慢闪。星系尺度的变化本来就该是慢的，
        // 闪得再明显一点，整片盘就会开始「滋滋」响
        vAlpha = 0.82 + 0.18 * sin(uTime * 0.7 + aSeed * 6.283);
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
        // 指数 2.2：芯实、边柔。星点本来就小，指数再大就剩不下几个像素了
        float core = pow(1.0 - d, 2.2);
        gl_FragColor = vec4(vColor, core * vAlpha);
      }
    `,
  })
  disposables.push(discGeometry, discMaterial)

  const discPoints = new THREE.Points(discGeometry, discMaterial)
  // 位置属性是真实坐标，但盘会整体平移，包围球算出来会偏，索性关掉剔除
  discPoints.frustumCulled = false
  spinGroup.add(discPoints)

  // ---- 核球 ----
  // 躺在盘面里的一个面片（rotation.x = -90° 把它从 XY 平面翻到 XZ 平面），
  // 随盘倾斜后自然变成椭圆 —— 这正是真实星系照片里核球的形状
  const coreSize = CORE_RADIUS * 2.6
  const coreGeometry = new THREE.PlaneGeometry(coreSize, coreSize)
  const coreMaterial = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color('#ffd9a0') },
      uIntensity: { value: 0.42 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;

      void main() {
        float d = length(vUv - 0.5) * 2.0;
        if (d > 1.0) discard;
        // 紧实的亮核 + 一圈宽晕，两层叠出「球」的体积感。
        // 只留 core 会像一张贴纸，只留 halo 会像一团雾。
        // core 的指数给到 5：核球要「小而立」，指数低一点就散成一片糊光
        float core = pow(1.0 - d, 5.0);
        float halo = pow(1.0 - d, 1.6) * 0.5;
        float a = core + halo;
        gl_FragColor = vec4(uColor * a * uIntensity, a * uIntensity);
      }
    `,
  })
  disposables.push(coreGeometry, coreMaterial)

  const core = new THREE.Mesh(coreGeometry, coreMaterial)
  core.rotation.x = -Math.PI / 2
  spinGroup.add(core)

  // ================= 太阳系 =================

  const glowTexture = createGlowTexture(THREE)
  disposables.push(glowTexture)

  const solarGroup = new THREE.Group()
  // 黄道面倾斜：轨道在屏幕上压成椭圆，一眼能看出是「一圈」而不是「一条」
  solarGroup.rotation.x = SOLAR_TILT
  scene.add(solarGroup)

  // 太阳系里所有星球共享的光照参数。太阳就在 group 的局部原点，
  // 所以它的世界位置就是 group 的位置（rotation.x 不影响原点）
  const solarUniforms: SolarUniforms = {
    sunPos: { value: new THREE.Vector3() },
    ambient: { value: SOLAR_AMBIENT },
  }

  // ---- 太阳 ----
  // 段数给到 40x28：球在屏幕上直径五十来像素，段数低了轮廓会出现可见的多边形棱
  const sunGeometry = new THREE.SphereGeometry(SUN_RADIUS, 40, 28)
  const sunMaterial = createSunMaterial(THREE)
  const sun = new THREE.Mesh(sunGeometry, sunMaterial)
  solarGroup.add(sun)
  disposables.push(sunGeometry, sunMaterial)

  const sunGlowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: new THREE.Color('#ffd27a'),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    // 太阳的气场靠光晕撑，但光晕一旦铺开就是整片暖光糊在卡片上 ——
    // 那是典型的光污染。而且光晕过大还会把太阳球自己的轮廓糊掉。
    //
    // 118 那版实测把日面边缘糊出 8~10px 的过渡带（4x MSAA 下球体本该只有 1~2px），
    // 屏幕上量到的光晕在半径 200px 处还把亮度从背景的 8 抬到 21。收到 88、0.58 之后
    // 光晕半径约 3.4 倍日面半径，仍然有「发光」的读感，但球体轮廓是清的。
    opacity: 0.58,
  })
  const sunGlow = new THREE.Sprite(sunGlowMaterial)
  sunGlow.scale.set(88, 88, 1)
  solarGroup.add(sunGlow)
  disposables.push(sunGlowMaterial)

  // ---- 轨道环 ----
  // 六条共用一份几何（单位圆）和一份材质，靠 scale 拉成不同半径。
  // 单独建六份几何纯属浪费 —— 圆环的顶点数不算少。
  // 256 段：最外圈在屏幕上半径三百来像素，128 段时每段弧长近 15px，能看出棱角
  const orbitSegments = 256
  const orbitPoints = new Float32Array(orbitSegments * 3)
  for (let i = 0; i < orbitSegments; i += 1) {
    const a = (i / orbitSegments) * Math.PI * 2
    orbitPoints[i * 3] = Math.cos(a)
    orbitPoints[i * 3 + 1] = 0
    orbitPoints[i * 3 + 2] = Math.sin(a)
  }
  const orbitGeometry = new THREE.BufferGeometry()
  orbitGeometry.setAttribute('position', new THREE.BufferAttribute(orbitPoints, 3))
  const orbitMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color('#6f9fd8'),
    transparent: true,
    // 压得很暗。轨道是「坐标系」不是「装饰」——
    // 0.17 那版在实机上完全读不出来，0.3 那版又反过来比行星还抢眼，0.22 是这两者中间
    opacity: 0.22,
  })
  disposables.push(orbitGeometry, orbitMaterial)

  // 六条轨道共用上面那份单位圆，靠 scale 拉到各自半径。
  // 注意 LineLoop 必须真的 new 出来并挂进场景 —— 只建几何和材质是画不出来的
  for (const spec of PLANETS) {
    const orbit = new THREE.LineLoop(orbitGeometry, orbitMaterial)
    orbit.scale.setScalar(spec.orbit)
    solarGroup.add(orbit)
  }

  // ---- 地球 ----
  // 海陆 + 极冠 + 云 + 大气亮边，具体见文件顶部的 createEarthMaterial
  const earthMaterial = createEarthMaterial(THREE, solarUniforms)
  disposables.push(earthMaterial)

  // ---- 行星 ----
  interface PlanetRuntime {
    mesh: THREE_NS.Mesh
    spec: PlanetSpec
  }

  const planets: PlanetRuntime[] = PLANETS.map((spec, index) => {
    // 段数跟着半径走：小的给 28x20 够用，大的（木星、土星、地球）给 40x28 ——
    // 屏幕上直径四十来像素的球，20 段的经线会出现肉眼可见的棱
    const segments = spec.radius >= 12 ? 40 : 28
    const geometry = new THREE.SphereGeometry(spec.radius, segments, Math.round(segments * 0.7))
    // 地球走带海陆和云的那套，其余是通用行星材质（朗伯光照 + 可选纬度条纹）
    const material =
      index === EARTH_INDEX ? earthMaterial : createPlanetMaterial(THREE, spec, solarUniforms)

    const mesh = new THREE.Mesh(geometry, material)
    solarGroup.add(mesh)
    disposables.push(geometry)
    // 地球的材质在别处已经登记过了，别重复 dispose
    if (index !== EARTH_INDEX) disposables.push(material)

    // 土星环：躺在本星球的赤道面上，稍微歪一点才看得出是环而不是圆盘。
    // 半径给到 2.25 倍 —— 太窄了看不出「环」，太宽了会压到相邻轨道
    if (spec.ring) {
      const inner = spec.radius * 1.28
      const outer = spec.radius * 2.25
      const ringGeometry = new THREE.RingGeometry(inner, outer, 160, 1)
      const ringMaterial = createRingMaterial(THREE, inner, outer)
      const ring = new THREE.Mesh(ringGeometry, ringMaterial)
      ring.rotation.x = -Math.PI / 2 + 0.32
      mesh.add(ring)
      disposables.push(ringGeometry, ringMaterial)
    }

    return { mesh, spec }
  })

  const earth = planets[EARTH_INDEX].mesh

  // 地球的大气光晕。加这一层是因为它在一片蓝白星点里实在太容易淹没了，
  // 面积很小（屏幕上半径二十来像素），对总亮度几乎没贡献。
  // 62/0.7 那版在球外糊出一圈明显的蓝雾，把刚做出来的海陆细节又盖回去了，收到 46/0.5
  const earthGlowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: new THREE.Color('#79c8ff'),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0.5,
  })
  const earthGlow = new THREE.Sprite(earthGlowMaterial)
  earthGlow.scale.set(46, 46, 1)
  earth.add(earthGlow)
  disposables.push(earthGlowMaterial)

  // ---- 月球 ----
  const moonGeometry = new THREE.SphereGeometry(MOON_RADIUS, 24, 17)
  // 月球也吃光照 —— 否则它就是个亮度恒定的灰点，看不出是「被太阳照着的球」
  const moonMaterial = createPlanetMaterial(THREE, { color: '#c6c6cc' }, solarUniforms)
  const moon = new THREE.Mesh(moonGeometry, moonMaterial)
  solarGroup.add(moon)
  disposables.push(moonGeometry, moonMaterial)

  // ================= 滚动 =================

  /**
   * 页面滚动进度 0~1。
   *
   * 在 scroll 事件里读 scrollHeight 会强制同步布局，所以用 rAF 节流成每帧最多一次 ——
   * 这一页底下还跑着 WebGL，在滚动事件里做重排是白送的卡顿。
   */
  let scrollRatio = 0
  let scrollFrame = 0

  const measureScroll = () => {
    scrollFrame = 0
    const max = document.documentElement.scrollHeight - window.innerHeight
    scrollRatio = max > 4 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
  }

  const onScroll = () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(measureScroll)
  }

  measureScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })

  // ================= 每帧 =================

  const lookTarget = new THREE.Vector3()

  return {
    // 阈值 0.36：只有亮星、核球芯部和太阳参与辉光。
    // 星点亮度下限在 0.1 左右，阈值调低会让整片盘蒙上一层灰雾。
    // radius 从 0.6 收到 0.45：辉光的模糊半径直接决定亮部周围那圈「发虚」有多宽，
    // 太阳系里全是几十像素的小球，0.6 会把每个球都罩上一层雾。收窄后光晕还在，边界清了
    bloom: { strength: 0.68, radius: 0.45, threshold: 0.36 },

    update({ time, pointer, renderer }) {
      const pixelRatio = renderer.getPixelRatio()
      const aspect = Math.max(0.2, camera.aspect)

      // ---- 星系盘 ----
      discMaterial.uniforms.uTime.value = time
      discMaterial.uniforms.uPixelRatio.value = pixelRatio

      spinGroup.rotation.y = time * DISC_SPIN

      // 滚动往上、自发浮动叠加。首屏（ratio=0）盘停在 DISC_BASE_Y，滚到底再上移 1700 单位，
      // 在 6800 的深度上约合 195 像素 —— 足够看出「星系在上下滑」，又不会整片滑出画面
      discGroup.position.y =
        DISC_BASE_Y + DISC_SLIDE * scrollRatio + Math.sin(time * DISC_BREATHE_SPEED) * DISC_BREATHE

      // ---- 太阳系 ----
      // 位置锚在屏幕归一化坐标上，任何宽高比都落在同一个相对位置。
      // 用世界坐标写死的话，竖屏下横向可视范围只剩一半，太阳系会直接出画
      const halfHeight = Math.tan((camera.fov * Math.PI) / 360) * SOLAR_DIST
      const halfWidth = halfHeight * aspect

      // 竖屏：把太阳系收小并往中间挪，否则它会溢出右边界。
      // 基准取 1.6（1440×900 的宽高比）而不是 1.78：1440 屏上轨道要占满，
      // 到了 16:9 的 1920 屏再稍微放大一点
      const narrow = aspect < 1.2
      const anchorX = narrow ? 0.2 : SOLAR_ANCHOR_X
      const sizeFactor = Math.min(1.25, Math.max(0.55, aspect / 1.6))

      solarGroup.scale.setScalar(sizeFactor)
      solarGroup.position.set(
        anchorX * halfWidth,
        SOLAR_ANCHOR_Y * halfHeight + SOLAR_SLIDE * scrollRatio,
        -SOLAR_DIST,
      )

      // 太阳就在 group 的局部原点，所以它的世界位置就是 group 的位置。
      // 所有星球的光照方向都从这一个 uniform 推出来，每帧更新一次即可
      solarUniforms.sunPos.value.copy(solarGroup.position)

      for (const planet of planets) {
        const angle = planet.spec.phase + time * ORBIT_BASE * planet.spec.speed
        planet.mesh.position.set(
          Math.cos(angle) * planet.spec.orbit,
          0,
          Math.sin(angle) * planet.spec.orbit,
        )
        // 自转。只有地球和木星土星看得出来（前者有海陆、后两者有纬度条纹），
        // 但转起来整组天体才不像贴在轨道上的静态模型
        planet.mesh.rotation.y = time * SPIN_BASE * planet.spec.spin
      }

      // 月球绕地球：直接算绝对位置，不用嵌套 group —— 少一层变换少一次矩阵乘
      const moonAngle = time * ORBIT_BASE * MOON_SPEED
      moon.position.set(
        earth.position.x + Math.cos(moonAngle) * MOON_ORBIT,
        0,
        earth.position.z + Math.sin(moonAngle) * MOON_ORBIT,
      )

      // ---- 相机 ----
      // 平移而不是旋转：只有平移才能让前景的太阳系和中景的星系盘产生错位，
      // 绕原点旋转等于转整个天球，两层会一起动，纵深就没了
      camera.position.set(pointer.x * 62, pointer.y * 46, 0)
      camera.lookAt(lookTarget.set(pointer.x * 130, pointer.y * 96, -4200))
    },

    dispose() {
      if (scrollFrame) cancelAnimationFrame(scrollFrame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      scene.remove(discGroup)
      scene.remove(solarGroup)
      disposables.forEach((item) => item.dispose())
    },
  }
}
