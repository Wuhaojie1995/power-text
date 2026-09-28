/**
 * 开场后半段（中国大陆 → 西北 → 陕西 → 西安 → 钟楼）用的卫星影像。
 *
 * 这里是「一层层把真实卫星图铺到地面上」的全部数据与换算，场景文件只负责
 * 把它算出来的平面摆到世界坐标里、按进度交叉淡入淡出。
 *
 * 三条必须知道的决定：
 *
 * 1) **不逐张拉瓦片，而是一次要一整块拼好的影像。**
 *    ArcGIS 的 MapServer 有一个 export 接口：给一个经纬度框 + 输出尺寸，
 *    它直接把范围内的影像拼好作为一张 JPEG 返回（我们实测 2048×2048 完全可用，
 *    响应带 `Access-Control-Allow-Origin: *`，可以直接当 WebGL 贴图用）。
 *    按层拉瓦片的话，每填满一屏 1080p 就要 32 张 256px 的图，五层加起来两百多个
 *    请求；换成 export 之后整段只有 6 个请求，代码也少了一个瓦片调度器。
 *    代价是每一层的分辨率被 export 的尺寸上限锁死在 2048 见方 —— 够用，见下面第 3 条。
 *
 * 2) **世界坐标直接建在墨卡托上，不平铺成经纬度。**
 *    墨卡托在一点上的横竖比例是相等的（局部共形），所以只要把「一个墨卡托
 *    归一化单位对应多少世界单位」定死，影像贴上去就不会被拉扁；而 export 出来的
 *    图正好也是墨卡托投影（imageSR=3857），像素与世界坐标是严格的线性关系。
 *    反过来，用等距圆柱（经纬度线性）去铺墨卡托的图，北边会被压扁四成 ——
 *    在整块大陆的尺度上一眼就能看出来。
 *
 * 3) **每一层按「横跨多少度经度」定义，不是按世界单位。**
 *    层数、每层的语义（全国 / 西北 / 陕西 / 西安 / 城区 / 钟楼）才是要紧的东西，
 *    世界单位只是这套语义在某个尺度常数下的投影。写成度数，改一层就是改一句
 *    「这一层要多大」，不用回头去换算。
 *
 *    相邻层的跨度统一取 5.2 倍左右：这样每一层在画面里停留的行程相等，
 *    下坠读起来是「每一屏放大同样的倍数」，而不是「这一段猛冲、下一段不动」。
 *
 * 4) **所有层都以钟楼为中心。** 于是「换层」在世界坐标里是一次纯粹的缩放，
 *    两层边缘严丝合缝，看不出接缝，也不需要任何位置补偿。
 *
 *    ⚠️ 唯一例外是**第 06 站那一屏**：整片国土的几何中心在西安的西北方向，
 *    要让「全貌中国」真的填满画面，镜头必须先把取景中心挪过去（见 CHINA_FRAME），
 *    再随着下坠收回到钟楼。这个平移按高度衰减，等换到第二层时已经归零，
 *    所以不影响「换层 = 纯缩放」这个几何事实。
 *
 * 5) **世界坐标里的正北是 -z，不是 +z。**
 *    three 的世界是 y-up 的右手系：x 取东、y 取上之后，z 只能是「南」才与
 *    「从上方俯视」这件事相容（俯视时屏幕右 = 东、屏幕上 = 北，这个组合要求
 *    北在 -z）。贴图那边配 flipY = true —— 卫星图第 0 行是北，落在 uv 的 v=1，
 *    也就是世界 -z，两边对上画出来才是「正北朝上、正东朝右」的正射地图。
 *
 *    这里踩过坑：最初把正北放在 +z（把贴图的 v 反过来），单看「贴图对上了局部坐标」
 *    也说得通，可合起来就是一张上下镜像的中国 —— 南海在屏幕上边、中亚在左下、
 *    阿拉伯海占了左上角，看着像中国又不是中国。世界方向只认这一条：北在 -z。
 */

/** 西安钟楼：整段下降的落点，也是所有层级的中心 */
export const BELL_TOWER_LON = 108.9422
export const BELL_TOWER_LAT = 34.2617

/**
 * 每度纬度（在西安所在纬度上）折合多少世界单位。
 *
 * 它是整套地面尺度的基准颗粒度：改它等于整体缩放地面那一段，画面比例不变。
 */
export const MAP_UNITS_PER_DEG = 400

const DEG = Math.PI / 180
const LAT0_RAD = BELL_TOWER_LAT * DEG

/**
 * 一个墨卡托归一化单位（经度跨 360° 记作 1）对应多少世界单位。
 *
 * 墨卡托是局部共形的：横竖共用同一个比例，所以只要把这个数定死，影像贴上去
 * 就不会被拉扁 —— 这是「影像不变形」的全部理由。
 *
 * 由「1° 纬度 = MAP_UNITS_PER_DEG 世界单位」反解：墨卡托归一化 y 对纬度的导数
 * 是 1/(360·cos φ) 每度，于是 MERC_UNITS = MAP_UNITS_PER_DEG × 360 × cos(lat0)。
 * 顺带得到 1° 经度 = MAP_UNITS_PER_DEG × cos(lat0) ≈ 331 世界单位 ——
 * 比 1° 纬度短 cos 倍，正是高纬度上经线收敛该有的样子。
 */
const MERC_UNITS = MAP_UNITS_PER_DEG * 360 * Math.cos(LAT0_RAD)

/** 经度 → 墨卡托归一化 x（0~1，西起东经 -180°） */
export function mercX(lon: number): number {
  return (lon + 180) / 360
}

/** 纬度 → 墨卡托归一化 y（0~1，**南增北减**） */
export function mercY(lat: number): number {
  const r = lat * DEG
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2
}

/** 墨卡托归一化 x → 经度（mercX 的反函数） */
function lonAt(mx: number): number {
  return mx * 360 - 180
}

/** 墨卡托归一化 y → 纬度（mercY 的反函数，用 asinh 而不是 ln 是为了在极区也稳） */
function latAt(my: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) / DEG
}

export interface SatelliteLevel {
  /** 层 id，只用于调试与 key */
  id: string
  /**
   * 影像覆盖的半边长（世界单位），中心恒为钟楼。
   * 换算成世界坐标里的边长就是 2 × half。
   */
  half: number
  /** 定义这一层时用的经度半跨度（度）。只用于调试与注释，运行时不用 */
  halfDeg: number
  /** 导出图片的边长（像素），正方形 */
  px: number
  /** 覆盖的经纬度范围 [lonMin, latMin, lonMax, latMax] */
  bbox: readonly [number, number, number, number]
  /** exports 接口的完整地址 */
  url: string
}

const EXPORT_BASE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export'

/**
 * 按「在西安纬度上横跨多少度经度」定义一层。
 *
 * 墨卡托归一化坐标里 1 = 360° 经度，所以半跨度直接就是 halfDeg / 360；
 * 世界坐标再乘 MERC_UNITS。世界单位换算出来的 half 只给场景摆平面用。
 */
function makeLevel(id: string, halfDeg: number, px: number): SatelliteLevel {
  const d = halfDeg / 360
  const half = d * MERC_UNITS

  // 覆盖范围按「墨卡托上的正方形」算：世界坐标是墨卡托线性的，所以这里直接加减即可
  const mx = mercX(BELL_TOWER_LON)
  const my = mercY(BELL_TOWER_LAT)
  const lonMin = lonAt(mx - d)
  const lonMax = lonAt(mx + d)
  // 墨卡托 y 往下（纸上更靠南）对应更小的纬度
  const latMin = latAt(my + d)
  const latMax = latAt(my - d)
  const bbox = [lonMin, latMin, lonMax, latMax] as const

  // bboxSR 给经纬度、imageSR 给墨卡托：让服务端替我们做投影，
  // 出来的图像素与世界坐标严格线性对应（见文件头第 2 条）
  const url =
    `${EXPORT_BASE}?bbox=${bbox.map((v) => v.toFixed(6)).join(',')}` +
    `&bboxSR=4326&imageSR=3857&size=${px},${px}&format=jpg&f=image`

  return { id, half, halfDeg, px, bbox, url }
}

/**
 * 六层阶梯，跨度相邻约 5.2 倍，语义依次是「全国 → 西北 → 陕西 → 西安 → 城区 → 钟楼」。
 *
 * 第一层（china）的跨度不是按 5.2 定的，而是按**第 06 站要一眼装下整片国土**倒推的：
 * 国土包围盒的东西跨度约 61.5°，而钟楼偏东（108.94°E），往西要够到 73.5°E 就是
 * 35.4°，再给画面留出「按宽高比算出来会比国土更宽」的那一部分，取 52°。
 * 于是这一层的影像西到里海、东到日本海、南到中南半岛、北到西伯利亚 ——
 * 屏幕四角都落在影像里面，不会露出影像之外的虚空。
 * 分辨率：104° 摊在 2048px 上约 0.051°/px，略细于第 06 站屏幕本身的
 * 0.052°/px，放大看不会糊。
 */
export const SATELLITE_LEVELS: readonly SatelliteLevel[] = [
  makeLevel('china', 52, 2048), //     经度 57°E ~ 161°E   纬度 -15° ~ 66°
  makeLevel('northwest', 7.98, 2048), // 经度 101°E ~ 117°E  纬度 27° ~ 41°：西北 + 关中平原
  makeLevel('shaanxi', 1.535, 2048), //  经度 107.4°E ~ 110.5°E 纬度 32.9° ~ 35.7°：陕西省
  makeLevel('xian', 0.295, 2048), //     经度 108.65°E ~ 109.24°E：西安城区
  makeLevel('downtown', 0.0568, 2048), // 约 10.4 km 见方：城墙以内
  makeLevel('belltower', 0.01023, 2048), // 约 1.9 km 见方：钟楼与环岛
]

/** 「全中国」取景框（世界单位，相对钟楼） */
export interface ChinaFrame {
  /** 取景中心相对钟楼的偏移：x 向东为正、z 向南为正（正北在 -z，见文件头第 5 条） */
  offsetX: number
  offsetZ: number
  /** 取景框的半宽 / 半高（世界单位），已含留白 */
  halfW: number
  halfH: number
}

/**
 * 国土包围盒。
 *
 * 取值就是通常说的「四至」：西到帕米尔（约 73.5°E）、东到黑龙江与乌苏里江
 * 汇口（约 135°E）、南到曾母暗沙以北的海南岛（约 18.15°N）、北到漠河以北
 * 的黑龙江主航道（约 53.55°N）。
 */
const CHINA_BOUNDS = { lonMin: 73.5, lonMax: 135.05, latMin: 18.15, latMax: 53.55 }
/** 留白：国土四周留一点余地，边线不贴着屏幕边缘 */
const CHINA_MARGIN = 1.04

/**
 * 第 06 站那一屏的取景框。
 *
 * 为什么必须有它：所有层都以钟楼为中心，而钟楼在国土上偏东 —— 光是把镜头抬到
 * 「装得下国土」的高度，画面里国土仍是偏在一侧的，四周空出大半屏邻国与海。
 * 先把取景中心挪到国土包围盒的中心（在西安的西北方向约 600 公里处），
 * 再按宽高比算高度，屏幕上才是「一整片中国」。
 */
export const CHINA_FRAME: ChinaFrame = (() => {
  const mx0 = mercX(BELL_TOWER_LON)
  const my0 = mercY(BELL_TOWER_LAT)
  const mxWest = mercX(CHINA_BOUNDS.lonMin)
  const mxEast = mercX(CHINA_BOUNDS.lonMax)
  const myNorth = mercY(CHINA_BOUNDS.latMax)
  const mySouth = mercY(CHINA_BOUNDS.latMin)

  return {
    // 世界 x 向东为正，与墨卡托 x 同向
    offsetX: ((mxEast + mxWest) / 2 - mx0) * MERC_UNITS,
    // 墨卡托 y 南增北减，世界 z 与它同向（南为正），所以这里是中心减 my0：
    // 国土中心比钟楼更靠北，算出来是负值，落在世界的北侧
    offsetZ: ((myNorth + mySouth) / 2 - my0) * MERC_UNITS,
    halfW: ((mxEast - mxWest) / 2) * MERC_UNITS * CHINA_MARGIN,
    halfH: ((mySouth - myNorth) / 2) * MERC_UNITS * CHINA_MARGIN,
  }
})()
