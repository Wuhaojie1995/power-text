import type * as THREE_NS from 'three'
import type { SceneContext, SceneInstance } from '../three-scene'
import { getIntroProgress, INTRO_STAGE_ENDS } from '../../introProgress'
import { CHINA_FRAME, SATELLITE_LEVELS } from '../satellite-map'
import { createPlanetSurfaceTexture, type PlanetSurface } from '../planet-textures'

/**
 * 开场：宇宙缩放。
 *
 * 一段从头看到尾的下坠 —— 星系 → 银河系 → 太阳系 → 地球 → 大气层 →
 * 中国大陆 → 西北 → 西安，落到西安之后由 UniverseIntro 把画面交给下面的首页正文。
 *
 * 它是「开场」，不是「背景」：这里不往 backgrounds/types.ts 的型号表里注册，
 * 切换面板里看不到它，HomeBackground 也不会加载它 —— 由 UniverseIntro.tsx
 * 直接挂载，进度从 introProgress.ts 读（那边的注释说了为什么走模块变量）。
 *
 * 三条必须知道的设计决定：
 *
 * 1) **「放大太阳系 → 视口钉到地球 → 放大地球」三段，靠一根会转的视线完成**。
 *    镜头位置全程只沿 -z 直行（不瞬移、不绕路），变的是**看哪儿**：
 *      p 0.26 → 0.38  视线锁在太阳系上（SOLAR_OFFSET 那个点）→ 镜头每前进一米，
 *                     太阳系就在画面正中放大一点。这一站读出来的是「镜头压进太阳系」
 *      p 0.38 → 0.43  视线平滑交给轨道上的地球 → 太阳系滑出画面，地球落进画面正中
 *      p 0.43 → 0.56  视线锁在地球上 → 只剩「越来越近」，也就是放大地球
 *    地球全程只有一颗（earthGroup 里半径 EARTH_RADIUS 的球，月球作为它的卫星
 *    挂在同一个组里），和太阳系同帧进场
 *    （p 0.30，藏在切口 A 的星流里）起就在场，一直待在自己的轨道上
 *    （第三颗行星，和另外七颗一样公转，只是公转角被折进可见弧段）；
 *    0.40 之前按 EARTH_SCALE_TRACK 里的小尺寸当行星，视线锁上它之后才长满 ——
 *    长大的同时整条轨道也在放大（SOLAR_EXPAND），镜头在逼近、画面里又没有
 *    第二个物体可以对照，观感就是一次连续的放大，而不是一颗球在原地膨胀。
 *
 * 2) **镜头只转视线，不翻滚**。lookAt 保住了「头朝上」，所以整段仍然是
 *    「在往前坠」而不是一次环视；整段也不带指针视差（理由见 update 里那段注释）。
 *
 * 3) **辉光是一条随进度变的曲线，不是一组定值**。宇宙尺度上东西又小又暗，
 *    阈值一低整屏就蒙上一层灰雾（galaxy.ts 里踩过同一个坑）；可落到地面之后
 *    地表本身就亮，同一组参数又反过来把大地糊成一片白。所以阈值和强度按进度插值：
 *    太空段 0.30 / 0.70，高空俯瞰那一段抬到 0.58 / 0.38，收进西安再放回去
 *    （见 update 里的 groundBloom）。
 *
 * 分段（与 content.ts 的 UNIVERSE_STAGES 顺序一一对应，改边界要一起改）：
 *   01 星系     p 0.00 → 0.13
 *   02 银河系   p 0.13 → 0.26   ← 切口 A：扎进星系盘，用星流掩护切到太阳系
 *   03 太阳系   p 0.26 → 0.42   ← 视线在太阳系上，整系持续放大（地球只是颗小行星）
 *   04 地球     p 0.42 → 0.56   ← 无切口：视线已钉在地球上，它长满并填满画面
 *   05 大气层   p 0.56 → 0.65   ← 切口 C（云幕）：地面那组换场，全片唯一剩下的换场
 *   06 中国大陆 p 0.65 → 0.75   ← 以下三站全是真实卫星影像，见 satellite-map.ts
 *   07 西北     p 0.75 → 0.85
 *   08 西安     p 0.85 → 1.00
 *
 * 4) **落地那一段是「卫星影像的连续缩放」，不是程序化地面。**
 *    旧版从大陆往下是自绘的地面：着色器画棋盘路网、实例化楼群、大雁塔、城墙光带。
 *    它有两个绕不过去的问题，所以整组删掉了：
 *      - 它不是真的：镜头每降一档，自绘的「城市」就和真实地表越来越不像，
 *        到「西安」那一站已经是一张凭空捏出来的网格，越看越假；
 *      - 它落不到钟楼。程序化地面没有能力表达「这是西安」，更谈不上落在一座建筑上。
 *    现在换成 satellite-map.ts 里的六层真实卫星影像，围绕钟楼等比放大，
 *    镜头笔直下落（视线全程朝正下方），最后定在钟楼上方约 0.8 公里 ——
 *    画面里能看清钟楼的方形轮廓和外面那圈环岛，再由 UniverseIntro 收场。
 *    六层的语义就是这一段的叙事顺序：全国 → 西北 → 陕西 → 西安 → 城区 → 钟楼。
 *
 * 5) **云幕散开之后第一眼必须是「一整片中国」，而且是从暗到亮地显出来。**
 *    这两件事一件靠时间、一件靠亮度，都在下面落地那一段的两个常量里：
 *      - CHINA_HOLD_TO 把下降起点压到 0.73（云幕 0.712 才散尽）——
 *        镜头要一直停在「一眼装下中国」的高度上，等云开了才开始往下推，
 *        否则云一散镜头早就到了下一层，中国大陆这一站等于不存在；
 *      - GROUND_REVEAL_* 让第一层影像按进度从 0 涨到 1（底衬还比它再早一点），
 *        于是画面是「暗地 → 大陆的轮廓隐隐浮出 → 云开、整片亮起来」，
 *        而不是在云散的那一帧弹出一张全亮的卫星图。
 *
 * 6) **「一眼装下中国」这件事是按宽高比现算的，不是写死一个高度。**
 *    所有层都以钟楼为中心，而钟楼在国土上偏东：光把镜头抬到「装得下」的高度，
 *    画面里中国仍然偏在一侧。所以第 06 站做两件事 ——
 *      - 取景中心先挪到国土包围盒的中心（CHINA_FRAME.offsetX / offsetZ，
 *        在西安的西北方向），再随下坠收回到钟楼（按高度衰减，换第二层前已归零）；
 *      - 高度取 max(半高 / tanV, 半宽 / tanH)，于是任意窗口比例下国土都刚好填满
 *        画面，同时再夹一道「影像边缘别露出来」的上限。
 *    写死高度在这件事上没有可行解：按 16:10 调好之后，竖屏窗口会把国土裁掉东西
 *    两侧，超宽屏则会在左右露出影像之外的虚空。
 */

// ============================================================
// 镜头轨道
// ============================================================

/**
 * 镜头沿 -z 的推进轨迹。全片只前进、从不后退，也不转向。
 *
 * 注意：星系盘的「放大」**不是**靠相机靠近盘心实现的（盘心钉在 SUN_Z，
 * 相机最多走到 -500，离盘心还 10500，靠近读不出放大）。放大靠的是
 * discGroup 自身沿视线射线缩放（见 DISC_ZOOM），盘心永远在屏幕正中。
 * 这条轨迹只负责太空段整体的前进节奏与星流掩护时机，和「星系是否居中」无关 ——
 * 居中是靠盘心与视线落点（SOLAR_OFFSET，z 同为 SUN_Z）重合保证的。
 *
 * 0.26 那一档钉死在 -500：**不能动**。星流掩护体积的中心在 z = -2900
 * （见 WARP_CUTS），相机必须在这个位置、于太阳系进场（SOLAR_ENTER_AT ≈ 0.30）
 * 那一刻正好穿过它，掩护才罩得住「太阳系整组凭空出现」那一下。0.26 之后
 * 0.42 的 -9430 是单调前进的直线，相机一路扎过星流、落进太阳系。
 *
 * 0.42 那一档是**为了钉住后半段**才显式写出来的：它的值就是旧版 0.26 → 0.56
 * 那条直线在 0.42 上的插值结果，于是 0.42 之后（地球长满、大气层、云幕、地面）
 * 的取景与改动前逐帧一致 —— 改 0.26 那一档不会牵连它们。
 * 当年 0.42 上那一档 -10400 是个「跳」，靠切口 B 的星流盖住；这一档不是跳，
 * 它和前后两点共线，镜头仍然是单调前进，节奏依旧由 earthGroup.scale 一起给。
 */
const CAM_Z_TRACK: ReadonlyArray<{ at: number; z: number }> = [
  { at: 0.0, z: 4200 },
  { at: 0.13, z: 0 },
  { at: 0.26, z: -500 },
  { at: 0.42, z: -9430 },
  { at: 0.56, z: -12250 },
  { at: 0.65, z: -12480 },
  { at: 0.75, z: -13400 },
  { at: 0.86, z: -14400 },
  { at: 1.0, z: -15000 },
]

/**
 * 镜头高度。**前面六站必须一直是 0** ——
 * 大地球的球心就在 y=0 上，镜头一旦提前抬起来，地球就会滑到视锥外面去
 * （55° 的视场，抬到两千多高度之后地球的俯角已经接近 70°）。
 *
 * 抬升整段压在云幕（HAZE_CUT）底下完成：0.62 → 0.675 从地面高度升到 6800，
 * 换算成滚动距离大约 40vh。云幕正糊满画面，读起来只是「穿出云层」。
 * 此后一路往城区降，高度收到两百多。
 *
 * 6800 不是随手给的高度，是按「第 06 站要一眼装下中国」倒推的：
 * 55° 视场、俯角约 48°、落点压在国土上时，视距约 9500，
 * 画面横跨约 15000 世界单位（≈ 50 个经度，见 MAP_UNITS_PER_DEG）——
 * 从河西走廊一路到日本海都进得来，海岸线才连得成一条能认出来的轮廓。
 * 矮一半（旧版 3200）就只能看到黄土高原的一角，「中国地图」立刻散架。
 */
const CAM_Y_TRACK: ReadonlyArray<{ at: number; y: number }> = [
  { at: 0.0, y: 0 },
  { at: 0.62, y: 0 },
  { at: 0.675, y: 6800 },
  { at: 0.75, y: 5200 },
  { at: 0.86, y: 1700 },
  { at: 1.0, y: 240 },
]

/**
 * 视线的前下方倾角（俯视角度的正切）。
 *
 * 太空段是 0（平视前方）；「中国大陆」那一站必须一次性压到 1.15（约 49°）——
 * 这一条是整段观感的命门：镜头在三四千的高度**平视**时，地面会被透视压成
 * 地平线附近的一条窄带，远处再叠上雾和辉光，整屏就是一片糊掉的土色
 * （这正是改版前那一站拍出来的样子）。只有真的低头，大地才会铺开成
 * 一张能辨认的地图。
 *
 * 抬头（俯角回落）全部发生在后半段：西北 0.82、西安 0.42 ——
 * 那是从「看一片国土」收束到「看一座城」，视角本来就该越来越平。
 */
const LOOK_DESCEND_TRACK: ReadonlyArray<{ at: number; t: number }> = [
  { at: 0.0, t: 0 },
  { at: 0.62, t: 0 },
  { at: 0.678, t: 1.15 },
  { at: 0.75, t: 1.05 },
  { at: 0.86, t: 0.82 },
  { at: 1.0, t: 0.42 },
]

/**
 * 视线落点距离。
 *
 * 必须和上面的俯角配套：落点落在地面上的条件是 descend × d ≈ camY + 430
 * （430 是 GROUND_Y 的绝对值）。高空那一段取 6300 × 1.15 ≈ 7245，正好对得上
 * 6800 的镜头高度 —— 视线中心压在国土上，而不是指着天空。
 * 对不上的话，画面要么空掉上半屏，要么整屏都是脚底下那几公里。
 */
const LOOK_DIST_TRACK: ReadonlyArray<{ at: number; d: number }> = [
  { at: 0.0, d: 3000 },
  { at: 0.62, d: 3000 },
  { at: 0.678, d: 6300 },
  { at: 0.75, d: 5200 },
  { at: 0.86, d: 2600 },
  { at: 1.0, d: 1800 },
]

/**
 * 视线从太阳系转到地球的进度区间。
 *
 * 这是「视口钉到地球上」那一下的**全部实现**：镜头位置一直沿 -z 直行，
 * 变的只有看哪儿。
 *   p < 0.38  看着太阳系（SOLAR_OFFSET 那个点）→ 镜头越飞越近，太阳系越长越大
 *   0.38→0.43 视线平滑转到轨道上的地球 → 太阳系顺着画面左下方滑出去
 *   p > 0.43  看着地球 → 它待在轨道点上不动，长大的是整条轨道（SOLAR_EXPAND），
 *             太阳和其他行星被推远、甩出画面，之后只剩「越来越近」
 *
 * 区间压在 0.42（太阳系 → 地球 的站点边界）两侧：转向必须在换文案之前完成，
 * 否则「一颗淡蓝色的点」这行字出来时地球还没到画面正中，读起来就是滞后半拍。
 */
const AIM_LOCK_FROM = 0.38
const AIM_LOCK_TO = 0.43
// ============================================================
// 星系盘（第 01 / 02 站）
// ============================================================

/**
 * 盘的尺寸。**这一组数是按「贴到太阳系那一组身上」反推的**（见 createScene 里
 * discGroup 的定位）：盘心与太阳系共用同一个点（z 取 SUN_Z），「放大星系」靠
 * 的是 discGroup 沿视线射线缩放（DISC_ZOOM），不是相机靠近，所以盘心永远在
 * 屏幕正中、不会偏心。半径、核球、厚度按这个尺度取；点数保持原值，
 * 单位面积上的星点密度不变，视觉上「还是那一盘」。
 */
const DISC_RADIUS = 4700
const DISC_POINTS = 32000
/** 核球半径：点云从这外面才开始铺，里面交给一张贴图（点堆在里面必然过曝） */
const DISC_CORE = 580
const DISC_THICKNESS = 207
const DISC_ARMS = 2
const DISC_TWIST = 3.4
const DISC_SPREAD = 0.5
const DISC_ARM_RATIO = 0.74
const DISC_TILT = Math.PI / 3.2
const DISC_SPIN = 0.02
/**
 * 跟着滚动自转的幅度（弧度 / 整段进度）。
 *
 * 底速 0.02 rad/s 只够维持「它是活的」，要读出「在转」得靠滚动：
 * 星系那两站占 0 → 0.26，取 8 就是走完这两站盘面转过去约 120° ——
 * 旋臂的走向明显在变，又不会一甩而过变成电风扇。
 * 两条并存、同向：停着靠底速，一滚就跟着手上走，回滚（introReplay）时同幅倒回来。
 */
const DISC_SPIN_SCROLL = 8
/**
 * 星系盘沿视线射线的「放大」倍率与区间 —— **这才是「星系放大」的实现，不是相机靠近**。
 *
 * 盘心钉在 SUN_Z、与视线落点（SOLAR_OFFSET，z 同为 SUN_Z）重合，所以 discGroup
 * 整体缩放时，放大中心就是屏幕正中、不会偏心。之前那版想靠相机靠近盘心来做放大，
 * 会把盘心推离视线射线、导致画面整体偏移，已废弃。
 *
 *   p 0.0   倍率 1.0 —— 盘是正常尺度的一盘旋臂；
 *   p 0.26  倍率 DISC_ZOOM_MAX —— 盘铺满、溢出视口，读成「已经飞进星系中心」；
 *   之后盘维持在 DISC_ZOOM_MAX、随 discFade 淡出，太阳系在正中接上。
 *
 * 取 3.2：盘原始水平投影半径约 0.17 个半屏宽，×3.2 ≈ 0.55 > 0.52（半屏宽），
 * 即溢出视口；再大只是更满，不再更「进」。
 */
const DISC_ZOOM_FROM = 0.0
const DISC_ZOOM_TO = 0.26
const DISC_ZOOM_MAX = 3.2
/**
 * 核球在逼近过程里额外涨大的倍率（0 = 不涨，实际尺寸 ×(1 + 该值)）。
 *
 * 太阳系那一组就压在核球心上，所以这一涨直接决定「滚进核光里面」那一下读不读得出来：
 * 盘随 DISC_ZOOM 放大、镜头也沿 -z 推进的同时，核光的视半径
 * 从约 8° 涨到约 37° —— 到进场那一刻，暖光的直径已经超过画面高度，
 * 黄白的中心再亮起来，才读得出「太阳系是在核光里长出来的」。
 *
 * 只涨尺寸、不涨亮度 —— 加亮会让核球中心直接过曝成一块白斑，暖色就没了。
 * 幅度也不能再往上加：光的外缘一旦贴住视口四角，画面会变成一块没有方向的雾。
 */
const CORE_SWELL_FROM = 0.16
const CORE_SWELL_TO = 0.3
const CORE_SWELL_MAX = 2.2

// ============================================================
// 太阳系（第 03 站）
// ============================================================

const SUN_Z = -11000

/**
 * 太阳系那一组进场的进度。
 *
 * **压到 0.30：星系先退场、彻底消失，镜头再往前多滚一小段，太阳系才出现。**
 * 这一段要读成「滚进盘里 → 星系淡出、彻底消失 → 再放大一点 → 太阳系出现」：
 *
 *   p 0.26  「太阳系 · 八颗行星」那行字出现，镜头还在往盘里钻、离太阳系那一组
 *           还远（见 CAM_Z_TRACK 的 0.26 档，z = -500），星系盘开始淡出
 *   p 0.28  星系盘已铺满画面、开始淡出（见 update 里的 discFade 0.26→0.31），
 *           旋臂从四周扫过、核光涨到最大 —— 这就是「已经飞进星系、正在穿过它」
 *   p 0.30  **再放大一点之后**，太阳系整组才进场（此时盘还剩约一成残影衬着）
 *
 * 太阳的位置就是盘心，但两组物体不再同屏：进场那一下是整组凭空出现的，
 * 没有「生长」这种说法，全靠切口 A 的星流掩护盖住（half 放宽到 0.07，
 * 0.30 处仍剩约四成强度，见 WARP_CUTS）。
 */
const SOLAR_ENTER_AT = 0.3
/**
 * 太阳的半径。真实比例是地球的 109 倍，这里取 300（地球行星尺寸 35 的约 8.6 倍）。
 *
 * 全真比例用不了：太阳半径 696000 km 对水星轨道 5800 万 km，比值 1.2%，
 * 屏幕上太阳会是一个点、行星全是 0.01 像素。整张表用的是**幂压缩**
 * （真实值开 0.5 次幂，锚定地球半径 35 / 地球轨道 880，见 PLANETS），
 * 太阳按同一条曲线本该是 365。取 300：让太阳在太阳系那一站足够显眼、仍是
 * 画面里最大的一颗，同时给内行星留出可见的余地 —— **内行星轨道已整体外推
 * 到水星 520（近日点约 413）、金星 700、地球 880，全部清出日面（半径 300）之外**，
 * 不再有行星被太阳本体吞掉（旧值水星 230 / 金星 330 就是被吞的那两颗）。
 * 仍保留「太阳是画面里最大的一颗」这个次序。
 */
const SUN_RADIUS = 300
/** 太阳材质里的暖黄：纯白配上辉光阈值会糊成一块没有边界的白斑 */
const SOLAR_TILT = 0.62
/**
 * 公转角速度基准（弧度/秒）。取 0.05：行星的公转要「看得见在走」但不能抢戏 ——
 * 0.16 的旧值下水星 20 秒就绕一圈，太阳系读起来是一台转速表；
 * 0.05 之下水星（speed 2.0）一圈约 63 秒、地球约 126 秒、海王星近乎不动，
 * 各行星的速度差仍在，但节奏退到背景里。
 */
const ORBIT_BASE = 0.05
const SPIN_BASE = 0.5
const SOLAR_AMBIENT = 0.16
/**
 * 行星轨道线的观感。**要深、要看得见、但不能亮**：深钢蓝压到很低的不透明度 ——
 * 在深空底色上刚够读出一条线，再亮一点就抢戏、像坐标网格。
 * 改色改浓淡就改这两个值（两处引用共用）。
 */
const ORBIT_LINE_COLOR = '#26455f'
const ORBIT_LINE_OPACITY = 0.1 

interface PlanetSpec {
  /** 半长轴（世界单位） */
  orbit: number
  /** 离心率。轨道是椭圆，太阳位于焦点上 */
  eccentricity: number
  radius: number
  color: string
  speed: number
  phase: number
  spin: number
  /** 带环行星（土星）：环外径 = 半径 × 该值 */
  ring?: number
  /** 表面贴图种类，见 planet-textures.ts。给了就用贴图，`color` 退化成兜底底色 */
  surface: PlanetSurface
}

/**
 * 太阳系里的行星，按离太阳由近到远排（水金火木土天海）。
 *
 * **地球也不在这张表里，但它不在系外** —— 它有自己的一份轨道参数（EARTH_ORBIT，
 * 就夹在金星和火星之间），earthGroup 每帧按同一套椭圆几何摆到轨道点上，
 * 看起来就是第三颗行星。不直接进这张表，是因为它后面还要「随轨道一起放大、
 * 长成主角」，半径、缩放、日照方向都和这些装饰行星不同路。
 *
 * **半径来自真实数据做幂压缩**（真按比例，行星在这里是 0.01 像素）：
 * radius = 35 × (真实半径/地球半径)^0.5，speed = (真实周期比)^0.5
 * （内行星快、外行星慢的次序严格保持）。
 * 于是：木星 117 > 土星 108 > 天王星 70 ≈ 海王星 69 > 地球 35 ≈ 金星 34 >
 * 火星 26 > 水星 22，与真实大小次序一致；金星不再是那颗比火星还小的黄球。
 *
 * **`color` 现在只是兜底底色，真正决定长相的是 `surface`。** 这几颗球以前是纯色平涂
 * （土星环也只是个半透明圆盘），放大到一百多像素就是一块贴纸 —— 用户说的
 * 「水星、金星、木星、土星都不真实」就是它。现在每颗都按自己的特征烘一张表面贴图
 * （水星环形山、金星浓云、木星纬带加大红斑、土星淡金纬带……见 planet-textures.ts），
 * 由 createPlanetMaterial 按物体空间经纬度采样，跟着球一起自转。
 *
 * **轨道值则是幂压缩之后再手工拉开的**，不再是 340 × (真实轨道/AU)^0.5。
 * 那套公式按真实 AU 出来，内圈挤得没法看：金星和地球只差 51，而两颗球的半径
 * 加起来就有 69 —— 转到同一侧时直接叠成一坨。
 * 后来又冒出第二个毛病：太阳半径取到 300 之后，水星（旧值 230）整颗被包进太阳
 * 本体、金星（330）也只探出一点点，内行星动不动就糊在日面上看不清。
 * 所以**内圈整体外推**：水星 520（近日点约 413，仍清出日面之外）、金星 700、
 * 地球 880、火星 1060，相邻边缘都留出足够身位。
 *
 * **外圈要「不重叠」是被几何逼出来的**：木星半径 117（直径 234）、土星 108
 * （直径 216）—— 两者轨道只差 180 时，木星外缘（1437）会越过土星内缘（1392），
 * **轨道直接叠在一起**；再往外土星外缘和天王星内缘也只差几个单位。所以外圈
 * 必须按「相邻两颗球的边缘留出可见的缝」重排，落到 280 一档：木星 1340 →
 * 土星 1620 → 天王星 1900 → 海王星 2180（边缝约 55 / 100 / 140）。
 * 内圈为此让出一点空间（水星 560→520、地球 960→880），日面余量仍然充足。
 *
 * 取景代价：最外圈到 2180 之后，p≈0.40 镜头压得很近时会有行星贴到画面下边缘
 * （见下面的说明）。这是「外圈够疏」换来的，属可接受的瞬态。
 */
const PLANETS: readonly PlanetSpec[] = [
  //         轨道    离心率   半径   兜底色        公转    相位   自转    表面
  { orbit: 520, eccentricity: 0.206, radius: 22, color: '#b0a69c', speed: 2.0, phase: 0.4, spin: 0.5, surface: 'mercury' },   // 水星 0.38R⊕ 0.39AU 88天
  { orbit: 700, eccentricity: 0.007, radius: 34, color: '#e8c78f', speed: 1.26, phase: 2.1, spin: 0.36, surface: 'venus' },   // 金星 0.95R⊕ 0.72AU 225天
  { orbit: 1060, eccentricity: 0.093, radius: 26, color: '#d05a34', speed: 0.73, phase: 1.2, spin: 0.92, surface: 'mars' },   // 火星 0.53R⊕ 1.52AU 687天
  { orbit: 1340, eccentricity: 0.049, radius: 117, color: '#d8b48a', speed: 0.29, phase: 5.3, spin: 1.4, surface: 'jupiter' }, // 木星 11.2R⊕ 5.2AU 11.9年
  { orbit: 1620, eccentricity: 0.057, radius: 108, color: '#e2d3a4', speed: 0.18, phase: 3.1, spin: 1.2, surface: 'saturn', ring: 2.1 }, // 土星 9.4R⊕ 9.5AU 29.5年
  { orbit: 1900, eccentricity: 0.046, radius: 70, color: '#9fd8dc', speed: 0.11, phase: 0.9, spin: 0.9, surface: 'uranus' },  // 天王星 4.0R⊕ 19.2AU 84年
  { orbit: 2180, eccentricity: 0.010, radius: 69, color: '#5b7fe8', speed: 0.08, phase: 2.7, spin: 0.85, surface: 'neptune' }, // 海王星 3.9R⊕ 30.1AU 165年
]

/** 椭圆轨道的半短轴。太阳在焦点 (a - c, 0) 上，这是开普勒第一定律的几何 */
function orbitAxes(spec: Pick<PlanetSpec, 'orbit' | 'eccentricity'>): { a: number; b: number; c: number } {
  const a = spec.orbit
  const c = a * spec.eccentricity
  const b = Math.sqrt(Math.max(a * a - c * c, 1))
  return { a, b, c }
}

/**
 * 太阳系相对视轴的**固定**偏移（世界 x / y）。整段不动，一次定死。
 *
 * 为什么不是漂移：早先的版本让太阳系从 0.27 起往左下扫出去，观感是
 * 「我们掠过太阳系」—— 而这一站想说的是「镜头压进太阳系」。
 * 一滑出画面，「放大太阳系」这件事就不存在了。
 *
 * 偏移本身仍然必须存在：整组放大后，地球的轨道点要落在视轴上的 (0, 0, EARTH_Z)，
 * 太阳要是也留在视轴上，太阳就会正好待在地球的正后方 —— 镜头越过太阳平面之前
 * 的那一段里，太阳本体（一颗亮球）会糊在正在长大的地球上
 * （镜头一路沿 -z 笔直飞，一前一后）。
 * 把太阳系整体挪到视轴左下方，视线转向地球、镜头掠过太阳时，
 * 整系顺着画面左下方自然滑出去，地球在正中长大。
 *
 * 取值的依据是**屏幕上分开多远**，不是世界坐标好看：
 * 太阳系这一站镜头离太阳约 5000，偏移 1400 横向 ≈ 16°、900 纵向 ≈ 11°，
 * 远到太阳本体不会和地球糊在一起，近到整系（含轨道上的地球）都还在画面里。
 *
 * 这一对数字现在被三处共用：太阳系本体、星系盘的盘心（见 createScene 里 discGroup
 * 的定位）、以及太空段的视线落点。三处对齐是「星系 → 太阳系是一次纯缩放」的前提，
 * 改这里等于同时挪动这三个东西。
 */
const SOLAR_OFFSET_X = -1400
const SOLAR_OFFSET_Y = -900

// ============================================================
// 地球（第 03 站起就在场，一路到第 05 站）
// ============================================================

const EARTH_Z = -13200
const EARTH_RADIUS = 700

/**
 * 地球在太阳系里的轨道参数 —— 它就是第三颗行星，不被拎到系外。
 *
 * 轨道半径夹在金星（700）和火星（1060）之间，离心率取真实值 0.017。
 * 这里只留几何这一件事：半径由 EARTH_RADIUS × scale 给，自转在 update 里单独写，
 * 公转在 update 里驱动（见 EARTH_ORBIT_RATE）。earthGroup 每帧按这份参数、
 * 走和行星完全相同的椭圆几何（update 里的 orbitAxes）摆到轨道点上。
 */
const EARTH_ORBIT = {
  orbit: 880,
  eccentricity: 0.017,
}

/**
 * 地球的公转角速度（弧度/秒），以及它出生时的相位。
 *
 * **整圈公转 —— 老老实实绕着太阳转一圈又一圈。**
 *
 * 这里前后翻过两次车，毛病是同一个：为了让地球「时刻好看」，把运动削成了
 * 看着像公转、其实不是的东西。
 *   - 第一版：折进一段 0.66 rad 的弧里做三角波往返。注释里以为拐弯看不出来，
 *     因为按 126 秒的整圈算觉得够慢 —— 可折进弧段之后往返只剩 26 秒，
 *     屏幕上就是地球在轨道上来回蹭；
 *   - 第二版：改成由滚动进度驱动、单向扫过同一段弧。不折返了，但它压根就不再
 *     是公转，只是在太阳旁边挪了一小段（用户一眼看穿：「地球都没有绕着太阳转」）。
 *
 * 现在就是最朴素的写法：角度按时间连续累加，转满整圈。转到太阳背后被挡住、
 * 或者只剩一弯月牙，那本来就是真实天体该有的样子，不该为了「时刻好看」回避掉。
 *
 * 速度取 70 秒一圈，**比行星表里按幂压缩排出来的值快**（那套算下来地球是
 * 126 秒一圈）：地球在这一站是主角，而「太阳系」只占约 1.2 屏的滚动距离，
 * 按 126 秒滚过去根本看不出它在动。代价是它比金星（0.063 rad/s）还快一点，
 * 严格的开普勒次序让位给「看得见它在绕」。
 */
const EARTH_ORBIT_RATE = (Math.PI * 2) / 70
/** 出生时的相位：太阳左侧、受光且离日面最远的一段，一出生就好认 */
const EARTH_START_ANGLE = Math.PI + 0.35

/**
 * 「整体放大太阳系」的倍率与区间。
 *
 * 地球不脱离轨道，长大的是轨道本身：轨道半径放大到 SOLAR_EXPAND_MAX 倍
 * （880 → 880 × 8.2 ≈ 7220），天体本身只小幅长大（SOLAR_BODY_EXPAND）。
 * 地球始终待在轨道点上，被推远、被甩出画面的是太阳和另外七颗行星。
 *
 * 不这么做不行：满尺寸的地球半径 700，轨道只有 880，留在原尺寸的轨道上长满，
 * 太阳会被整个吞进地球里。
 *
 * 倍率保持 8.2 不动。内行星外推那一轮把地球的轨道从 430 拉到了 880，
 * 放大后的日地距离也就跟着从约 3530 变成约 7220 —— 方向上是好事：
 * 太阳被甩得更开，镜头贴上地球时它更不容易从画面角上探回来。
 * 后面几站用的尺度（EARTH_Z / EARTH_RADIUS）和这个数无关，不用动。
 */
const SOLAR_EXPAND_MAX = 8.2
const SOLAR_EXPAND_FROM = AIM_LOCK_FROM
const SOLAR_EXPAND_TO = 0.48
/** **太阳本体**跟随放大的指数：取 0.8，比轨道的同比（1）略小 —— 放大时太阳涨得比
 *  轨道慢一点，满打满算约 m^0.8（m 满程 ≈ 8.2，故约 10.7 倍、半径 ≈ 1600）。
 *  真实太阳本就远大于地球，0.8 仍让它明显长大、压得住画面；放大结束时太阳
 *  已被 SOLAR_EXPAND 推到画面外、且按 SOLAR_PLANET_CLEAR_* 同档收掉让位给地球，
 *  镜头贴近地球时不会糊在前面。 */
const SOLAR_BODY_EXPAND = 0.8
/**
 * 行星本体跟随放大的指数：取 0.7，比轨道的同比（1）小 —— 放大时行星自己涨得慢、
 * 同时被 m 倍轨道推远，于是**屏幕上越放越小**（角尺寸 ∝ m^0.7 / m = m^-0.3），
 * 和「太阳放大（0.8）」对比更强，太阳这一站压过其它行星。
 */
const SOLAR_PLANET_EXPAND = 0.7
/**
 * 其余七颗行星清场的进度区间。
 *
 * 视线 0.43 锁上地球之后，那一站要读的是「只剩下越来越近的地球」（设计原话）。
 * 但行星同比放大到 m 倍是几倍体量，而它们被甩出去的轨道半径最大到约 15200
 * （海王星 2180 × 8.2 ≈ 17880）—— 太阳到地球约 7220，木星那一圈（1340 × 8.2 ≈ 10990）
 * 早被甩到地球之外很远处。为保险起见，锁上地球之后仍主动把它们缩到 0：
 * 反正都已经在画面外，收掉看不出接缝。
 */
const SOLAR_PLANET_CLEAR_FROM = 0.43
const SOLAR_PLANET_CLEAR_TO = 0.49
/** 云层壳：比地表高一点，镜头最后会从这里穿过去（切口 C 的掩护就是它） */
const CLOUD_RADIUS = 726
/** 大气壳：外面那层淡蓝的边 */
const ATMO_RADIUS = 782

/**
 * 地球的出场时刻，以及它整段的缩放轨迹。
 *
 * 满尺寸（scale = 1）时地球半径 700，对应后面大陆 / 城市 / 西安那几站的整套尺度，
 * 不能动。所以「在太阳系里当一颗行星」只能靠小尺寸出现 —— 这里的关键是
 * **长大这件事必须晚到视线已经锁住它之后**：
 *
 *   scale 0.053  出生（p 0.28），半径 37 —— 约为木星（117）的三成、和金星（34）
 *                相当（**已经回到行星表里地球该有的那个量级**）。再往下就只剩
 *                几个像素、看不出是个球了
 *                也不能再往上太多：地球轨道半径 880、太阳本体半径 300，
 *                中间留 580 —— 内行星外推之后这条限制宽松了很多，
 *                地球半径涨到一百多仍和日面分得开
 *   scale 0.06   p 0.40，太阳系那一站走完，半径 42 —— 仍然只是轨道上一颗小行星
 *   scale 1.0    p 0.52，长满，此时画面里只剩它一个
 *
 * 出生时刻为什么是 0.28，**比太阳系进场（0.30）早 0.02**：整组是 0.30 才挂上去的，
 * 所以这段生长发生在还看不见的时候。它在这里不是为了「长出来」，而是保证
 * 0.30 那一帧地球**已经是全尺寸的小行星**。
 * （出生点和进场点曾经是同一个数，于是进场那一瞬间地球上只有一个几像素的点，
 * 得再往下滚才慢慢长大 —— 看上去就是「地球被缩没了」。）
 * 进场那一下仍然压在星流掩护里（掩护窗 0.19 → 0.33，见 WARP_CUTS 的 half），
 * 与另外七颗行星同帧，不会各露各的。
 *
 * 早先的版本让它 0.22→0.42 就长满，于是「太阳系」那一站里是**地球在画面正中膨胀**，
 * 太阳系被挤到一边滑出去 —— 那是「放大地球」，不是「放大太阳系」。
 * 现在 0.40 之前它一直是一颗小行星，长大全部发生在视线锁上它之后：
 * 镜头在逼近、它同时变大，而画面里没有第二个物体可以对照，
 * 观感就是一次连续的放大，而不是一颗球在膨胀。
 *
 * 0.40→0.52 这一段叠了「镜头从 4300 单位压到 1200 单位」（3.6 倍）和
 * 「半径从 42 长到 700」（16.7 倍），合起来约 60 倍 —— 一步到位的推镜。
 */
const EARTH_BIRTH_AT = 0.28
/** 长满尺寸的时刻。大气壳的淡入也挂在这附近 */
const EARTH_FULL_AT = 0.52

const EARTH_SCALE_TRACK: ReadonlyArray<{ at: number; s: number }> = [
  { at: 0.28, s: 0.053 },
  { at: 0.4, s: 0.06 },
  { at: 0.52, s: 1 },
]

/**
 * 地球在云幕（切口 C）里退场。
 *
 * 仍然压在云幕底下换场 —— 这一刀切的是「球面 → 地面平面」两组不同量级的物体，
 * 掩盖物是镜头此刻正穿着的云层，不是硬切。但太阳系那一段的切口已经没有了。
 */
const EARTH_VISIBLE_UNTIL = 0.645

/**
 * 大地球的日照方向（世界系，指向太阳）。**只是初值**。
 *
 * update 每帧按「地球 → 太阳」的实际世界向量重写它：整组放大之后太阳的位置
 * 一直在变，写死一个方向，画面上地球的晨昏线就会和唯一那个光源错开 ——
 * 那种错位在球面上一眼就看得出。
 *
 * 方向本身仍然是「偏左、偏前下」：正对镜头的这一面被照亮，
 * 上方留下一条夜弧，夜面上的城市灯光才出得来 —— 它同时是最后两站的预告。
 */
const EARTH_SUN_DIR = { x: -0.51, y: -0.33, z: 0.8 }

// ============================================================
// 地面（第 06 / 07 / 08 站）：卫星影像的垂直下降
// ============================================================

/** 卫星影像所在的高度 */
const GROUND_Y = -430
/**
 * 影像的中心：西安钟楼。
 *
 * 六层影像全部以它为心，所以「换层」在世界坐标里是一次纯粹的缩放，
 * 两层边缘严丝合缝 —— 这也是整段下降唯一需要守住的几何事实。
 * 世界坐标与经纬度的换算见 satellite-map.ts。
 */
const GROUND_Z = -16600

/**
 * 第 06 站「一眼装下中国」的高度。**每帧按视口宽高比现算**，不是常量。
 *
 * 两道约束取交集：
 *   - 下界（装得下）：高度要让取景框（CHINA_FRAME）整个落进画面，
 *     即 ≥ 半高 / tanV 且 ≥ 半宽 / tanH；
 *   - 上界（盖得住）：再高下去，画面四角就会超出第一层影像的范围、露出影像之外
 *     的虚空，所以还要 ≤（影像半边长 − 取景偏移）/ tan。
 *
 * 上界在常见的 1.3~2.0 窗口比例上碰不到（影像留了富余），只在极窄的窗口上生效 ——
 * 那时宁可让国土裁掉一点边，也不要露出一圈虚空。
 */
function chinaStageAltitude(tanV: number, tanH: number): number {
  const fit = Math.max(CHINA_FRAME.halfH / tanV, CHINA_FRAME.halfW / tanH)
  const chinaHalf = SATELLITE_LEVELS[0].half
  const cover = Math.min(
    (chinaHalf - Math.abs(CHINA_FRAME.offsetX)) / tanH,
    (chinaHalf - Math.abs(CHINA_FRAME.offsetZ)) / tanV,
  )
  return Math.min(fit, cover)
}

/**
 * 某一层影像「刚好铺满画面、四角也盖住」的高度。
 *
 * 画面打到地面的最远点是四角，距离 = 高度 × hypot(tanV, tanH)；影像是正方形、
 * 半边长 half，所以 half ≥ 高度 × hypot(tanV, tanH) 才盖得住。取 1.04 留一点余量。
 * 旧版写死的 `half / 1.1` 就是这一条在 55° 视场、16:9 下的特例 ——
 * 换成现算之后 60° 视场、任意宽高比都对。
 */
function levelShowAltitude(half: number, tanV: number, tanH: number): number {
  return half / (Math.hypot(tanV, tanH) * 1.04)
}

/**
 * 下降的起点。**压在 0.73 是「大气层进来先看见中国大陆」这条要求的关键。**
 *
 * 云幕到 0.712 才散尽、第一层影像到 0.728 才亮满。早早就往下推的话，云一开
 * 镜头已经落到下一层的尺度上，屏幕上第一眼就是「西北」那一层，
 * 中国大陆这一层从头到尾没露过面 —— 三站里第一站等于不存在。
 */
const CHINA_HOLD_TO = 0.73
/** 从「装下中国」降到第一层（西北）引入高度的行程终点 */
const CHINA_DESCEND_TO = 0.7723

/**
 * 之后的下降行程：**相对第一层（西北）引入高度的倍率（log10）**，不是绝对高度。
 *
 * 为什么写倍率：各层的引入高度都随视口宽高比整体缩放（见 levelShowAltitude），
 * 写死绝对高度的话，换个窗口比例就和影像的尺度对不上了；而相邻两层的比值
 * 只由层级比决定，与宽高比无关。
 *
 * **按对数取值**：「每滚同样一段距离，画面放大同样倍数」才是连续缩放该有的手感，
 * 线性插值会让前段几乎不动、后段一路猛冲。相邻档差值 ≈ log10(5.2)，
 * 与 satellite-map.ts 的层级比一致，所以每档耗掉的进度也相等 ——
 * 不会出现「这一段猛冲、下一段不动」的顿挫。
 */
const GROUND_DROP_TRACK: ReadonlyArray<{ at: number; drop: number }> = [
  { at: CHINA_DESCEND_TO, drop: 0 }, //    西北
  { at: 0.8121, drop: -0.7159 }, //        陕西
  { at: 0.8519, drop: -1.4323 }, //        西安
  { at: 0.8916, drop: -2.1478 }, //        城区
  { at: 0.933, drop: -2.8915 }, //         钟楼
  // 最后几个百分点几乎不再下降：钟楼在 0.93 之后就基本定格了，
  // 收场（画面淡出、交给首页）压在 0.97 之后 —— 「先看清钟楼，再切首页」这条要求
  // 兑现的全部地方就是这两个数，别再往前挪
  { at: 0.955, drop: -3.0681 },
  { at: 1.0, drop: -3.1655 },
]

/**
 * 俯视时的轻微前倾：镜头停在目标点正南 `tilt × 高度` 处，视线落到目标点。
 *
 * 满值 0.18 ≈ 离天底 10° —— 够给画面一点纵深和方向感，又不至于把钟楼挤到画面下缘。
 *
 * 为什么是**正南**（世界 +z，见文件头第 5 条）：镜头偏在目标点南侧时，画面里
 * 「近」的是北、「远」的是南，正北仍然朝屏幕上方，和天底视角那一站方向一致；
 * 偏到北侧就反过来了 —— 远处变成南，整张地图跟着翻个身。
 *
 * **第 06 站必须回到 0**：那一站看的是一整片国土，镜头一旦偏出天底，画面就是一张
 * 被透视压扁、上下不对称的地图，「全貌中国」立刻散架。抬头全部发生在往下那两站里
 * —— 从「看一张地图」变成「看一座城」，视角本来就该越来越斜。
 */
const GROUND_TILT_MAX = 0.18
const GROUND_TILT_FROM = 0.76
const GROUND_TILT_TO = 0.88
/**
 * 从太空段交接到地面段的进度区间。
 *
 * 镜头位置在这两帧之间整体交接（太空段沿 -z 直行 + 抬升，地面段变成「钟楼上方垂直下落」），
 * 两者差着几千单位，位移不小；整段压在云幕最厚的那几帧里，屏幕上只是一片糊白。
 */
const GROUND_HANDOFF_FROM = 0.645
const GROUND_HANDOFF_TO = 0.678
/**
 * 底衬与第一层影像（中国大陆）各自淡入的进度区间。
 *
 * 两段刻意错开，先后关系就是「从暗到亮」这条要求的全部兑现：
 *   底衬先到（0.635 → 0.675）—— 云幕开始变薄时，先看见的是一块暗地，
 *   而不是页面底色或者「云一散就跳出一块亮地」；
 *   影像后到（0.658 → 0.728）—— 卫星图压在底衬上由 0 涨到 1。它压在云幕散开
 *   （0.712）两侧：雾里先是一层隐约的灰影，云一开正好走到「明显变亮」的那一段，
 *   读完就是「大陆从暗里显影、一点点亮起来」，而不是弹出一张全亮的图。
 *
 * 结束点 0.728 卡在下降起点（CHINA_HOLD_TO = 0.73）之前、换层开始（约 0.76）之前：
 * 中国大陆全亮的这一帧，是它在整段里唯一被完整看清的位置。
 */
const GROUND_BASE_REVEAL_FROM = 0.635
const GROUND_BASE_REVEAL_TO = 0.675
const GROUND_REVEAL_FROM = 0.658
const GROUND_REVEAL_TO = 0.728
/**
 * 兜底底板的半边长（基准值，运行时按画面需要缩放）。
 *
 * 卫星图是异步来的，第一层没到位时下面得有一层东西垫着（否则云幕散开是一块黑）；
 * 它同时盖住影像边缘之外的虚空。
 *
 * 它是**纯色平面、没有贴图**，所以尺寸可以每帧按「画面四角打到哪里」重算
 * （见 update 里的 groundBase.scale）—— 不必担心地理对齐，这是它和卫星层唯一的
 * 区别，也是它可以比第一层影像还大的原因。
 */
const GROUND_BASE_HALF = 12000

// ============================================================
// 掩护（切口）
// ============================================================

/**
 * 需要掩护的切口位置与半宽（进度单位）。半宽越小切得越干脆，也越考验掩护。
 *
 * 位置一律取 INTRO_STAGE_ENDS 上的站点边界，不写字面量：切口和「换文案」必须
 * 是同一时刻，各写一份数字迟早会错开（错开的表现是文案已经讲到下一站了，
 * 画面还在上一站的景物里）。
 */
const WARP_CUTS = [
  // 星系 → 太阳系：扎进星系盘，用星流掩护（这一刀仍然需要：星系盘和太阳系是两组
  // 完全不同的物体，而我们此刻正落在盘内部、画面全被星点占着，掩护是现成的）。
  //
  // z 是星流那团体积的中心，它前后各铺着两千多。镜头在 0.26 的 z 是 -500
  // （见 CAM_Z_TRACK），中心压在 -2900 上正好让镜头仍落在体积前半段 ——
  // 相对位置（镜头在星流中心前方约 2400）和旧版一致，前方星流的密度不变，
  // 才盖得住「太阳系整组凭空出现」那一下。
  //
  // half 从 0.06 再放宽到 0.07：太阳系进场压到了 0.30（SOLAR_ENTER_AT），
  // 且星系盘 0.28 就已彻底消失、没有核光再替它挡「凭空出现」那一下。
  // 放宽之后掩护窗是 0.19 → 0.33，0.30 那里仍剩约四成强度，
  // 是星系退场到太阳系进场之间唯一的掩护，必须罩满整个空档。
  { at: INTRO_STAGE_ENDS[1], half: 0.07, z: -2900 },
]
/**
 * 云幕（地球 → 大陆那刀）的中心与半宽。镜头这时正在穿云层，掩护是现成的。
 *
 * 半宽 0.062 是「够盖住换场」和「别把第 06 站也糊上」之间的折中：
 * 这一段底下要藏的东西很多（换掉整个片场、镜头从 y=0 抬到 4600、地面组淡入），
 * 但镜头抬完之后那一屏「中国大陆·高空俯视」必须立刻干净 ——
 * 云幕要是拖到 0.72 才散，这一屏的上半部就蒙着一层灰白，
 * 正好糊掉海岸线和山地（旧版 0.072 就卡在这个位置）。
 */
const HAZE_CUT = { at: INTRO_STAGE_ENDS[4], half: 0.062 }
/** 云幕的脉冲指数。比 1 略大：峰值仍然要压到全遮，但两侧不能收成一根针 */
const HAZE_POWER = 1.1
/** 云幕平面挂在相机前面的距离。太近会被近平面裁掉，太远就看不出「糊了一脸」 */
const VEIL_DIST = 40

// ============================================================
// 小工具
// ============================================================

/** 高斯近似：三个均匀随机数相加。比 Box-Muller 省事，形状够用 */
function gauss(): number {
  return (Math.random() + Math.random() + Math.random()) / 1.5 - 1
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** 在一条 { at, v } 关键帧轴上取值，段内用 smoothstep 过渡 */
function trackAt<T extends Record<string, number>>(
  p: number,
  keys: ReadonlyArray<T>,
  key: keyof T,
): number {
  if (p <= keys[0].at) return keys[0][key]
  for (let i = 1; i < keys.length; i += 1) {
    const prev = keys[i - 1]
    const next = keys[i]
    if (p <= next.at) {
      const span = next.at - prev.at
      const t = span <= 0 ? 0 : (p - prev.at) / span
      return prev[key] + (next[key] - prev[key]) * (t * t * (3 - 2 * t))
    }
  }
  return keys[keys.length - 1][key]
}

/** 三角脉冲：用来算某个切口的掩护强度。指数大于 1 时收得紧、峰值更尖 */
function cutPulse(p: number, at: number, half: number, power = 1.6): number {
  const t = Math.abs(p - at) / half
  return t >= 1 ? 0 : (1 - t) ** power
}

/** 生成一张纯色 1×1 贴图：异步纹理加载完成前的占位，避免采样到未初始化的 uniform */
function createSolidTexture(THREE: typeof THREE_NS, r: number, g: number, b: number): THREE_NS.DataTexture {
  const data = new Uint8Array([r, g, b, 255])
  const texture = new THREE.DataTexture(data, 1, 1)
  texture.needsUpdate = true
  return texture
}

/**
 * 程序化生成的云图（一次性烘进 CanvasTexture，运行时只做采样）。
 *
 * 为什么不再在着色器里现算 fbm：云幕那段此前是全屏逐像素噪声，
 * 而且峰值时接近全白 —— 观感是「闪一下白屏」。烘成贴图后运行时开销近零，
 * 颜色可以压成偏灰的蓝白，过渡读起来是「穿云」而不是「白屏」。
 *
 * **噪声必须可无缝平铺**。这一条踩过两次坑，别改回去：
 *   1) 最早噪声不缝合、只用 wrapS 镜像兜接缝。但云幕是按 `uv * 3.2` 采样的，
 *      v 一过 1 就落进默认的 ClampToEdge —— 画面上方一大片区域全在采样贴图
 *      最后一行，那一行的 alpha 只随 u 变化，于是整屏变成一道道**竖条光柱**，
 *      穿云读起来像一次硬切（正是「像切换界面」的观感来源之一）；
 *   2) 改成两个方向都镜像重复之后，竖条没了，但镜像本身带来强烈的**左右 / 上下
 *      对称**，一眼是万花筒，更假。
 * 所以这里的做法是真正把它做成周期噪声：每一层 fbm 的格点周期 = 该层的频率，
 * 采样时按周期取模，于是横向纵向都严丝合缝，可以直接用 RepeatWrapping。
 */
function createCloudTexture(THREE: typeof THREE_NS): THREE_NS.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const painter = canvas.getContext('2d')
  const image = painter?.createImageData(size, size)

  if (image) {
    /** 格点哈希。坐标先按 period 取模，这是「无缝」的全部秘密 */
    const hash = (x: number, y: number, period: number): number => {
      const xi = ((x % period) + period) % period
      const yi = ((y % period) + period) % period
      const s = Math.sin(xi * 127.1 + yi * 311.7) * 43758.5453
      return s - Math.floor(s)
    }
    const vnoise = (x: number, y: number, period: number): number => {
      const ix = Math.floor(x)
      const iy = Math.floor(y)
      const fx = x - ix
      const fy = y - iy
      const ux = fx * fx * (3 - 2 * fx)
      const uy = fy * fy * (3 - 2 * fy)
      const a = hash(ix, iy, period)
      const b = hash(ix + 1, iy, period)
      const c = hash(ix, iy + 1, period)
      const d = hash(ix + 1, iy + 1, period)
      return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
    }
    /**
     * 分形噪声。u / v 是 0~1 的贴图坐标，freq 是基频（= 贴图内铺几个噪声格）。
     * 每层频率翻倍、周期同步翻倍，所以整条 fbm 与贴图同周期 —— 平铺无接缝。
     * 归一化到 0~1：各层振幅之和正好是 1 - 0.5^5。
     */
    const OCTAVES = 5
    const SUM = 1 - 0.5 ** OCTAVES
    const fbm = (u: number, v: number, freq: number): number => {
      let value = 0
      let amp = 0.5
      let f = freq
      for (let i = 0; i < OCTAVES; i += 1) {
        value += amp * vnoise(u * f, v * f, f)
        f *= 2
        amp *= 0.5
      }
      return value / SUM
    }

    const data = image.data
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = x / size
        const v = y / size
        // 大团 + 细絮两层，比例与原来一致（原来等价于基频 512/58 ≈ 8.8 与 512/17 ≈ 30）
        const n = (fbm(u, v, 9) + 0.24 * fbm(u, v, 30)) / 1.24
        // 两档门槛：低于下限完全透明，之间快速爬升，高于上限压满
        const t = Math.min(1, Math.max(0, (n - 0.52) / 0.34))
        const a = t * t * (3 - 2 * t)
        const i = (y * size + x) * 4
        data[i] = 255
        data[i + 1] = 255
        data[i + 2] = 255
        data[i + 3] = Math.round(a * 255)
      }
    }
    painter?.putImageData(image, 0, 0)
  }

  const texture = new THREE.CanvasTexture(canvas)
  // 上面把它做成了周期噪声，两个方向都能直接平铺 —— 既不用镜像（会对称），
  // 也不能 clamp（会出现竖条）。云幕按 uv*3.2 采样、云层壳按球面 uv 采样，都靠它。
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

export function createScene(ctx: SceneContext): SceneInstance {
  const { THREE, scene, camera } = ctx

  /**
   * 本场景所有贴图都走 three 的全局图片缓存（按 url 存已解码的 Image）。
   *
   * **为什么必须开：回滚会把整个场景重新挂一遍，而重挂时进度从收场那一侧起步**
   * （UniverseIntro 的 FADE_FROM = 0.97）—— 那一刻镜头就在钟楼上方一两个世界单位的
   * 高度上，画面里**只有第五层影像**（钟楼 ~1.9 km 见方）撑着：其它层的引入高度
   * 都比这高几个数量级，透明度是 0。贴图 async 不来，这一屏就只剩底衬那块
   * 纯色暗地（#131a28）铺满整屏 —— 看上去就是一块黑屏，而用户一秒前刚看过钟楼。
   *
   * 更麻烦的是这个接口**明说了不许用缓存**：
   *   Cache-Control: max-age=0,must-revalidate
   * 每张 2048×2048 的图每次都得回源过一次 ETag（第 0 层单张就有 1.1 MB），
   * 六张一起来，本机也要上百毫秒，网络一差就是几秒的黑屏。
   *
   * 开了之后图片按 url 常驻在同一次会话里，重挂时 ImageLoader 直接拿缓存里的
   * 那张回到 onLoad，第一帧画出来就已经是钟楼 —— 不依赖网络，也不重复解码。
   * 缓存只留 CPU 侧的 Image 元素；GPU 上那份显存照旧由卸载时的 dispose 释放，
   * 不会把 WebGL 上下文或者显存拖住（那是这套「卸载即还」设计最在意的东西）。
   */
  THREE.Cache.enabled = true

  camera.fov = 55
  camera.updateProjectionMatrix()
  // 云幕挂在相机下面，相机自己必须先入场景图，否则它的子节点不会被渲染
  scene.add(camera)

  const disposables: Array<{ dispose(): void }> = []
  const lookTarget = new THREE.Vector3()
  /** 日照方向每帧重算用的临时向量 */
  const earthSunDirTmp = new THREE.Vector3()
  /** 太阳系离场方向的临时向量（见 update 里的 slideOut） */
  const solarOutDir = new THREE.Vector3()
  /**
   * 地球当前的公转相位（弧度）。按帧累加，是场景自己的状态。
   *
   * 为什么是「累加」而不是「角度 = 速率 × 时间」：速率要在大局放大那一段
   * 平滑收到 0（不收的话，轨道被放大 8 倍之后「太阳绕着地球转一圈」会非常扎眼），
   * 而拿一个随时间变化的系数去乘绝对时间，收速的过程会把角度**往回拽** ——
   * 看起来是地球倒着转。累加角速度就没有这个问题：只会减速，不会倒退。
   */
  let earthAngle = EARTH_START_ANGLE

  // ============================================================
  // 第 01 / 02 站：星系盘
  // ============================================================

  const discGroup = new THREE.Group()
  const discSpin = new THREE.Group()
  discGroup.add(discSpin)
  discGroup.rotation.x = DISC_TILT
  /**
   * 盘心**就是太阳系那一组的中心**：x / y 取 SOLAR_OFFSET，深度取 SUN_Z。
   *
   * 这一条是「星系 → 太阳系」那段读起来顺不顺的关键。两处景物完全重合在视线射线上：
   *
   *   - 视线落点从头到尾就钉在同一点 SOLAR_OFFSET 上（见 update 里的 lookAt，
   *     其 z 也正是 SUN_Z），镜头沿 -z 直行，画面中心一直是它 —— **全程没有横移**，
   *     横移哪怕一两度，滚动时整幅画面就会平移过去，像被谁从侧面推了一把；
   *   - 盘心落在视线射线上，于是「放大星系」是靠 discGroup 自身沿射线缩放
   *     （见 update 里的 DISC_ZOOM），缩放中心就是屏幕中心，不会偏心；
   *   - 盘面越大越近，暖黄的核球一直在长，太阳和行星就是从核球里「长出来」的，
   *     整段读成一次纯缩放。
   *
   * 严格说太阳系在猎户臂、不在银心 —— 这里换的是「落点一路不动」的连续性。
   */
  discGroup.position.set(SOLAR_OFFSET_X, SOLAR_OFFSET_Y, SUN_Z)
  scene.add(discGroup)

  // 投影密度补偿的基准深度：盘面上离相机最近的那条边（盘心在 SUN_Z）
  const nearDepth = -SUN_Z - DISC_RADIUS * Math.cos(DISC_TILT)

  const discPositions: number[] = []
  const discColors: number[] = []
  const discSizes: number[] = []
  const discSeeds: number[] = []
  const tint = new THREE.Color()

  let guard = 0
  while (discPositions.length / 3 < DISC_POINTS && guard < DISC_POINTS * 8) {
    guard += 1

    const u = Math.random()
    const rNorm = Math.min(1, -Math.log(1 - u * 0.985) / 2.4)
    const radius = DISC_CORE + rNorm * (DISC_RADIUS - DISC_CORE)

    const onArm = Math.random() < DISC_ARM_RATIO
    let angle: number
    if (onArm) {
      const spiral = Math.log(1 + rNorm * 6.5) * DISC_TWIST
      const spread = DISC_SPREAD * (0.28 + rNorm * 0.85)
      const arm = Math.floor(Math.random() * DISC_ARMS)
      angle = spiral + (arm / DISC_ARMS) * Math.PI * 2 + gauss() * spread
    } else {
      angle = Math.random() * Math.PI * 2
    }

    const localX = Math.cos(angle) * radius
    const localZ = Math.sin(angle) * radius
    const thickness = DISC_THICKNESS * (1 - rNorm * 0.62)
    const localY = gauss() * thickness * (0.6 + Math.random() * 0.8)

    const worldZ = SUN_Z + localY * Math.sin(DISC_TILT) + localZ * Math.cos(DISC_TILT)
    const depth = -worldZ
    if (depth <= 60) continue
    if (Math.random() > Math.min(1, (nearDepth / depth) ** 2)) continue

    discPositions.push(localX, localY, localZ)

    const warmth = Math.max(0, 1 - rNorm * 2.4)
    let cr = 0.62 + 0.38 * warmth
    let cg = 0.76 + 0.2 * warmth
    let cb = 1.0 - 0.24 * warmth
    if (onArm && Math.random() < 0.055) {
      cr = 1.0
      cg = 0.5
      cb = 0.66
    }

    let bright = 0.1 + Math.pow(Math.random(), 2.1) * 0.55
    if (onArm) bright *= 1.45
    // 中心区压暗：那里点密，同样亮度叠起来就是过曝。这条是整套亮度的命门
    bright *= 0.34 + 0.66 * Math.min(1, rNorm / 0.26)

    tint.setRGB(cr * bright, cg * bright, cb * bright)
    discColors.push(tint.r, tint.g, tint.b)
    discSizes.push(1.2 + Math.pow(Math.random(), 1.9) * 2.2)
    discSeeds.push(Math.random())
  }

  const discGeometry = new THREE.BufferGeometry()
  discGeometry.setAttribute('position', new THREE.Float32BufferAttribute(discPositions, 3))
  discGeometry.setAttribute('color', new THREE.Float32BufferAttribute(discColors, 3))
  discGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(discSizes, 1))
  discGeometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(discSeeds, 1))

  const discMaterial = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uOpacity: { value: 1 },
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
        vAlpha = 0.82 + 0.18 * sin(uTime * 0.7 + aSeed * 6.283);
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core = pow(1.0 - d, 2.2);
        gl_FragColor = vec4(vColor, core * vAlpha * uOpacity);
      }
    `,
  })
  disposables.push(discGeometry, discMaterial)

  const discPoints = new THREE.Points(discGeometry, discMaterial)
  discPoints.frustumCulled = false
  discSpin.add(discPoints)

  // 核球：躺在盘面里的一个面片，随盘倾斜后自然变成椭圆
  const coreSize = DISC_CORE * 2.8
  const coreGeometry = new THREE.PlaneGeometry(coreSize, coreSize)
  const coreMaterial = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color('#ffd9a0') },
      uIntensity: { value: 0.42 },
      uOpacity: { value: 1 },
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
      uniform float uOpacity;
      varying vec2 vUv;

      void main() {
        float d = length(vUv - 0.5) * 2.0;
        if (d > 1.0) discard;
        // 紧实的亮核 + 一圈宽晕：只留核会像贴纸，只留晕会像一团雾
        float glow = pow(1.0 - d, 5.0) + pow(1.0 - d, 1.6) * 0.5;
        float a = glow * uIntensity * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  })
  disposables.push(coreGeometry, coreMaterial)

  const discCore = new THREE.Mesh(coreGeometry, coreMaterial)
  discCore.rotation.x = -Math.PI / 2
  discSpin.add(discCore)

  // ---- 深空星点：贯穿前三站的底噪，看得见「在动」全靠它 ----
  const starCount = 3200
  const starPositions: number[] = []
  const starColors: number[] = []
  const starSizes: number[] = []
  for (let i = 0; i < starCount; i += 1) {
    // 铺在一个扁圆柱里：横向铺得开，纵深拉得长，镜头前进时才有前后错动的视差
    const angle = Math.random() * Math.PI * 2
    const radius = 400 + Math.pow(Math.random(), 0.6) * 9000
    starPositions.push(Math.cos(angle) * radius, gauss() * 3200, 4000 - Math.random() * 20000)
    const bright = 0.2 + Math.pow(Math.random(), 2.4) * 0.8
    tint.setRGB(bright * 0.86, bright * 0.92, bright)
    starColors.push(tint.r, tint.g, tint.b)
    starSizes.push(1.0 + Math.pow(Math.random(), 2.2) * 2.4)
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3))
  starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3))
  starGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(starSizes, 1))

  const starMaterial = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
    uniforms: {
      uPixelRatio: { value: 1 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      uniform float uPixelRatio;
      varying vec3 vColor;

      void main() {
        vColor = color;
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;

      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        gl_FragColor = vec4(vColor, pow(1.0 - d, 2.0) * uOpacity);
      }
    `,
  })
  disposables.push(starGeometry, starMaterial)

  const starPoints = new THREE.Points(starGeometry, starMaterial)
  starPoints.frustumCulled = false
  scene.add(starPoints)

  // ============================================================
  // 掩护 A / B：星流
  // ============================================================

  /**
   * 每一处切口一团星流。
   *
   * 实现是 LineSegments：每个星点两个端点，一端是本体、一端是拖尾。
   * 拖尾的长度由 uniform 给，顶点着色器里把第二个端点沿 +z（朝相机来的方向）拉出去，
   * 于是屏幕上得到一条条从中心向外发散的射线 —— 也就是「以极高速前进」的读感。
   * 拖尾的透明度按端点位置线性衰减，不然线是硬邦邦的一段。
   */
  function createWarpLines(zCenter: number, count: number): {
    object: THREE_NS.LineSegments
    material: THREE_NS.ShaderMaterial
  } {
    const positions = new Float32Array(count * 2 * 3)
    const sides = new Float32Array(count * 2)
    const seeds = new Float32Array(count * 2)

    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2
      // 半径往外铺：贴着中轴的星流在屏幕上没有长度，长度正比于离轴距离
      const radius = 120 + Math.pow(Math.random(), 0.7) * 2600
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius
      const z = zCenter + (Math.random() - 0.35) * 5200
      const seed = Math.random()

      positions[i * 6 + 0] = x
      positions[i * 6 + 1] = y
      positions[i * 6 + 2] = z
      positions[i * 6 + 3] = x
      positions[i * 6 + 4] = y
      positions[i * 6 + 5] = z

      sides[i * 2 + 0] = 0
      sides[i * 2 + 1] = 1
      seeds[i * 2 + 0] = seed
      seeds[i * 2 + 1] = seed
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))

    const material = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: {
        uStretch: { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aSide;
        attribute float aSeed;
        uniform float uStretch;
        uniform float uOpacity;
        varying float vAlpha;
        varying float vWarm;

        void main() {
          vec3 p = position;
          p.z += aSide * uStretch;

          // 拖尾端点淡出。加上每颗星的随机相位抖动，线才不会齐刷刷一样长
          vAlpha = mix(1.0, 0.0, aSide) * uOpacity * (0.6 + aSeed * 0.4);
          vWarm = aSeed;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying float vWarm;

        void main() {
          // 偏冷白的星流，掺一点暖色，看着像高速掠过的恒星而不是激光
          vec3 col = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.88, 0.72), vWarm * 0.45);
          gl_FragColor = vec4(col * vAlpha, vAlpha);
        }
      `,
    })

    const object = new THREE.LineSegments(geometry, material)
    object.frustumCulled = false
    object.visible = false
    scene.add(object)
    disposables.push(geometry, material)

    return { object, material }
  }

  const warps = WARP_CUTS.map((cut) => ({ cut, ...createWarpLines(cut.z, 900) }))

  // ============================================================
  // 第 03 站：太阳系
  // ============================================================

  /**
   * 「不参与辉光」的图层号。
   *
   * 这一站只有太阳该有光晕。行星的向阳面本来就亮过辉光阈值（木星、土星尤其），
   * 不隔出来就会被后处理一颗颗罩上一层雾 —— 那不是谁外挂的贴图，是 UnrealBloomPass
   * 按全屏亮度算出来的，删不掉，只能不让它们进提亮那一步（机制见 three-scene.ts
   * 里 BloomOptions.excludeLayer 的注释）。
   *
   * 归到这一层的：八颗行星、土星环、轨道线，以及地球和它的月亮。
   * 太阳留在默认图层（0），照常发光。
   */
  const SOLAR_NO_BLOOM_LAYER = 2

  const solarGroup = new THREE.Group()
  solarGroup.rotation.x = SOLAR_TILT
  // 整组定死在飞行轴线（x = y = 0）的左下方，不再逐帧漂移（理由见 SOLAR_OFFSET_X 的注释）
  solarGroup.position.set(SOLAR_OFFSET_X, SOLAR_OFFSET_Y, SUN_Z)
  solarGroup.visible = false
  scene.add(solarGroup)

  // 行星材质按这个点做光照。它和 solarGroup 的位移是同一个值，
  // 分开写但必须一致 —— 球体的明暗方向全看它
  const solarSunPos = { value: new THREE.Vector3(SOLAR_OFFSET_X, SOLAR_OFFSET_Y, SUN_Z) }

  const sunGeometry = new THREE.SphereGeometry(SUN_RADIUS, 64, 48)
  const sunMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCore: { value: new THREE.Color('#ffb15a') },
      uMid: { value: new THREE.Color('#ff6a1e') },
      uEdge: { value: new THREE.Color('#e02a05') },
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
      uniform float uTime;
      uniform vec3 uCore;
      uniform vec3 uMid;
      uniform vec3 uEdge;
      varying vec3 vNormal;
      varying vec3 vObjNormal;
      varying vec3 vViewDir;

      // 3D 值噪声 + fbm：在球面方向上采样，天然无接缝（不会出现赤道那道缝）
      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float vnoise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                       mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                       mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          v += a * vnoise(p);
          p *= 2.02;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 n = normalize(vNormal);
        vec3 dir = normalize(vObjNormal);
        vec3 viewDir = normalize(vViewDir);

        // 临边昏暗：真实恒星边缘比中心暗、且偏红。μ 取软次幂，边缘留约 0.4 的亮度，
        // 不会黑成一圈边
        float mu = max(0.0, dot(n, viewDir));
        float limb = pow(mu, 0.45);

        // 米粒组织（对流元胞）：两层不同频率的 fbm 叠出细密亮斑，随时间缓慢翻涌
        float g1 = fbm(dir * 16.0 + vec3(0.0, uTime * 0.04, uTime * 0.02));
        float g2 = fbm(dir * 48.0 - vec3(uTime * 0.025, 0.0, uTime * 0.015));
        float gran = g1 * 0.7 + g2 * 0.3;

        // 黑子：低频噪声越过阈值的区域整体压暗，带一点本影 / 半影的层次
        float spotN = fbm(dir * 3.5 + vec3(21.3, 7.1, 4.7));
        float spot = smoothstep(0.60, 0.72, spotN) * 0.85;

        // 由临边亮度决定的光球底色：边缘深橙红 → 中段橙 → 中心黄白
        vec3 base = mix(uEdge, uMid, smoothstep(0.0, 0.55, limb));
        base = mix(base, uCore, smoothstep(0.55, 1.0, limb));

        // 整体亮度：临边略暗但不黑；米粒让表面有起伏；黑子压暗
        float bright = mix(0.55, 1.12, limb);
        bright *= 0.82 + 0.40 * gran;
        bright *= 1.0 - spot;

        // 极轻微的全局闪烁，让日面「活」起来
        bright *= 0.97 + 0.03 * sin(uTime * 1.7 + dir.x * 6.0 + dir.y * 4.0);

        gl_FragColor = vec4(base * bright, 1.0);
      }
    `,
  })
  const sun = new THREE.Mesh(sunGeometry, sunMaterial)
  solarGroup.add(sun)
  disposables.push(sunGeometry, sunMaterial)

  // 太阳的辉光（sunGlow 精灵）已按需求移除 —— 太阳只保留本体球面，不再外挂一圈暖光。
  // 连带只用在这里的 glowTexture、createGlowTexture()、SUN_GLOW_FACTOR 也一并删掉，
  // 不留死代码。太阳自身的亮度靠 sunMaterial 的米粒/临边着色撑住（见上方材质）。

  // 行星轨道线：按开普勒椭圆几何（太阳在焦点上）画出来。
  // 原版刻意没画，因为一像素细线在深空里像坐标网格；现在按需求放出来，
  // 用很淡的蓝灰、低不透明度，只作「行星各走各的圈」的提示，不抢戏。
  // 线挂在 solarGroup 下，跟着整系一起被 SOLAR_TILT 倾斜、随放大倍率 m 一起长大；
  // 行星位置本来就是 ×m，所以轨道按 m 放大后行星始终贴在线圈上。
  const ORBIT_SEGMENTS = 256
  const orbitMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(ORBIT_LINE_COLOR),
    transparent: true,
    opacity: ORBIT_LINE_OPACITY,
    depthWrite: false,
  })
  const orbitLines: THREE_NS.LineLoop[] = []
  for (const spec of [...PLANETS, EARTH_ORBIT]) {
    const a = spec.orbit
    const e = spec.eccentricity
    const b = a * Math.sqrt(1 - e * e)
    const c = a * e
    const pts = new Float32Array(ORBIT_SEGMENTS * 3)
    for (let i = 0; i < ORBIT_SEGMENTS; i += 1) {
      const phi = (i / ORBIT_SEGMENTS) * Math.PI * 2
      // 与 update 里行星定位同一套椭圆：x = a·cosφ − c，z = b·sinφ，y = 0
      pts[i * 3] = Math.cos(phi) * a - c
      pts[i * 3 + 1] = 0
      pts[i * 3 + 2] = Math.sin(phi) * b
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(pts, 3))
    const loop = new THREE.LineLoop(geom, orbitMaterial)
    loop.frustumCulled = false
    // 轨道线也排除在辉光之外：它很淡，但贴着行星走，泛光会跟着亮起来
    loop.layers.set(SOLAR_NO_BLOOM_LAYER)
    solarGroup.add(loop)
    disposables.push(geom)
    orbitLines.push(loop)
  }
  disposables.push(orbitMaterial)

  /**
   * 行星材质：表面贴图 + 朗伯光照 + 明暗交界柔化。
   *
   * 三层缺一不可：
   *   1. **表面贴图**。球面 UV 用**物体空间**的经纬度算（和地球那份是同一套公式），
   *      所以贴图跟着球自转，而不是跟着相机跑。贴图是 sRGB 的，采样时由 GPU 解到线性。
   *   2. **朗伯光照**，光源是太阳。太阳方向由 uSunPos 每帧传入，行星公转到不同位置时
   *      被照亮的那一半会跟着转。
   *   3. **明暗交界柔化**。指数 0.85 把交界附近稍微提亮，否则在几十像素的尺寸上，
   *      暗面会「吃掉」大半个球。
   *
   * 贴图拿不到时（画布没有 2D 上下文，见 planet-textures.ts）退化成纯色球：
   * uHasMap 归零，uColor 原样输出，就是原来的平涂色。
   */
  function createPlanetMaterial(
    spec: Pick<PlanetSpec, 'color'>,
    map: THREE_NS.Texture | null,
  ): THREE_NS.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        // 有贴图时底色让位给白色，颜色全部由贴图给；uColor 只当兜底
        uColor: { value: new THREE.Color(map ? '#ffffff' : spec.color) },
        uMap: { value: map },
        uHasMap: { value: map ? 1 : 0 },
        uSunPos: solarSunPos,
        uAmbient: { value: SOLAR_AMBIENT },
      },
      vertexShader: /* glsl */ `
        uniform vec3 uSunPos;
        varying vec3 vNormal;
        varying vec3 vObj;
        varying vec3 vToSun;

        void main() {
          vNormal = normalize(normalMatrix * normal);
          // 经纬度要跟着球走、不能跟着相机走，所以另存一份物体空间坐标
          vObj = normalize(position);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vToSun = (viewMatrix * vec4(uSunPos - worldPos.xyz, 0.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform sampler2D uMap;
        uniform float uHasMap;
        uniform float uAmbient;
        varying vec3 vNormal;
        varying vec3 vObj;
        varying vec3 vToSun;

        void main() {
          vec3 on = normalize(vObj);
          // 等距圆柱投影，和地球那张贴图同一个约定：经度从 -180° 起算
          vec2 uv = vec2(atan(on.z, on.x) / 6.2831853 + 0.5, on.y * 0.5 + 0.5);
          vec3 base = uColor * mix(vec3(1.0), texture2D(uMap, uv).rgb, uHasMap);

          float lambert = max(0.0, dot(normalize(vNormal), normalize(vToSun)));
          float shade = uAmbient + pow(lambert, 0.85) * (1.0 - uAmbient);
          gl_FragColor = vec4(base * shade, 1.0);
        }
      `,
    })
  }

  const planets = PLANETS.map((spec) => {
    const segments = spec.radius >= 24 ? 36 : 24
    const geometry = new THREE.SphereGeometry(spec.radius, segments, Math.round(segments * 0.7))
    const texture = createPlanetSurfaceTexture(THREE, spec.surface)
    const material = createPlanetMaterial(spec, texture)
    const mesh = new THREE.Mesh(geometry, material)
    // 行星本体排除在辉光之外（理由见 SOLAR_NO_BLOOM_LAYER）
    mesh.layers.set(SOLAR_NO_BLOOM_LAYER)
    solarGroup.add(mesh)
    disposables.push(geometry, material)
    if (texture) disposables.push(texture)
    return { mesh, spec }
  })

  // 土星环：一圈半透明的扁平环面，跟着行星本体走（挂在 mesh 下）。
  // 用着色器按半径画环纹，而不是一张贴图 —— 环在屏幕上只有百来像素宽，
  // 贴图会被采样糊掉，程序化的条纹反而更锐（galaxy.ts 里是同一套写法）。
  for (const { mesh, spec } of planets) {
    if (!spec.ring) continue
    const inner = spec.radius * 1.35
    const outer = spec.radius * spec.ring
    const ringGeometry = new THREE.RingGeometry(inner, outer, 128, 1)
    const ringMaterial = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color('#e6d6a8') },
        uInner: { value: inner },
        uOuter: { value: outer },
        uOpacity: { value: 0.62 },
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
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.x = -Math.PI / 2 + 0.32
    // 环是行星的子对象，但图层不跟着父对象走 —— 不单独设的话它会留在默认层里泛光
    ring.layers.set(SOLAR_NO_BLOOM_LAYER)
    mesh.add(ring)
    disposables.push(ringGeometry, ringMaterial)
  }

  // 这里原来给「太阳系里那颗小地球」挂过一层淡蓝光晕，让它在一片星点里不被淹没。
  // 小地球删掉后，这层光晕一度由地球自己的 earthHalo 承担；按需求，太阳系里除太阳
  // 外不再保留任何星球表面的光晕，earthHalo 也已一并移除。大气壳 atmoShell 是真正
  // 的大气层（要到 0.43 之后才淡入），不在此列。

  // ============================================================
  // 第 04 / 05 站：大地球
  // ============================================================

  const earthGroup = new THREE.Group()
  earthGroup.position.set(0, 0, EARTH_Z)
  earthGroup.visible = false
  scene.add(earthGroup)

  // 初值按 EARTH_SUN_DIR 给，update 每帧按实际日地方位覆写（见该常量的注释）
  const earthSunDirVec = { value: new THREE.Vector3(EARTH_SUN_DIR.x, EARTH_SUN_DIR.y, EARTH_SUN_DIR.z).normalize() }

  const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 96, 64)
  const earthMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uDay: { value: createSolidTexture(THREE, 8, 34, 78) },
      uNight: { value: createSolidTexture(THREE, 0, 0, 0) },
      uSunDir: earthSunDirVec,
      /**
       * 夜面的「地照」强度（0~1）。**只在小地球阶段给值**，长满之后必须归零（见 update）。
       *
       * 为什么需要：地球现在是整圈公转，绕到背光面时夜面本来就该黑 ——
       * 但这一站它只有几十像素，夜光图上的城市灯等于没有，屏幕上就成了
       * 「一个黑球加一圈蓝边」甚至「地球凭空消失」。垫一层暗蓝天光之后，
       * 它始终是一个能看见球体、能看出海陆的深蓝小球。
       *
       * 长满之后必须收掉：那时地球是主角、镜头贴着它，夜面该黑就黑，
       * 亮起来的是城市灯 —— 再垫地照就全毁了。
       */
      uNightFloor: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vObj;
      varying vec3 vViewDir;

      void main() {
        // 法线 / 视线统一到**世界空间**：uSunDir 是世界系方向，两边必须同系。
        // 之前法线留在视图空间，相机一转（太阳系站十几度、放大段最大四十度），
        // 晨昏线就跟着视角偏，看起来就是「光照面跑到背光侧去了」。
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormal = normalize(mat3(modelMatrix) * normal);
        vObj = normalize(position);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uDay;
      uniform sampler2D uNight;
      uniform vec3 uSunDir;
      uniform float uNightFloor;

      varying vec3 vNormal;
      varying vec3 vObj;
      varying vec3 vViewDir;

      void main() {
        vec3 n = normalize(vNormal);
        vec3 on = normalize(vObj);

        // 等距圆柱投影的 uv：真实卫星图就是这个投影，经度从 -180° 起算
        vec2 uv = vec2(atan(on.z, on.x) / 6.2831853 + 0.5, on.y * 0.5 + 0.5);

        vec3 day = texture2D(uDay, uv).rgb;
        vec3 night = texture2D(uNight, uv).rgb;

        // 昼夜交界的过渡带放宽一点：硬切会沿晨昏线出现一圈锯齿
        float lambert = dot(n, normalize(uSunDir));
        float dayness = smoothstep(-0.08, 0.3, lambert);

        // 夜面直接用夜光图（城市灯已经烘在图里），只做一点暖色增益；
        // 日面按光照衰减，交界两侧各保留一点对方的成分，过渡才不突兀
        vec3 dayCol = day * (0.18 + 0.92 * max(0.0, lambert));
        // uNightFloor 是小地球阶段的「地照」强度（0~1），长满后由 update 归零。
        // 注意它是**加**上去的：城市灯之外再垫一层暗蓝天光，并乘一份白天贴图，
        // 于是夜面上仍然看得出海陆轮廓。不能写成 day * uNightFloor ——
        // 白天贴图过完 sRGB→线性的值本来就只有 0.01 量级，乘多大的系数都是黑的。
        vec3 nightCol =
          night * vec3(1.0, 0.84, 0.62) * 1.6 + uNightFloor * (vec3(0.05, 0.10, 0.20) + day * 1.5);
        vec3 col = mix(nightCol, dayCol, dayness);

        // 大气亮边。加在光照之后：大气是散射层，背光面的边缘同样会亮。
        // 但太阳系那一站要求「没有任何星球表面的光晕」，所以这一圈用
        // (1 - uNightFloor) 收住 —— 小地球阶段（地照开着，uNightFloor = 1）它
        // 整个为 0，长满之后（地照归零）才恢复成正常的大气亮边。
        float rim = pow(1.0 - max(0.0, dot(n, normalize(vViewDir))), 3.2);
        col += vec3(0.36, 0.66, 1.0) * rim * 0.55 * (1.0 - uNightFloor);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
  const earth = new THREE.Mesh(earthGeometry, earthMaterial)
  // 地球也是行星，同样排除在辉光之外（理由见 SOLAR_NO_BLOOM_LAYER）。
  // 它在「大地球」那两站仍不泛光 —— 行星本来就不该发光，那一站的大气亮边
  // 由 atmoShell 单独承担，不靠辉光。
  earth.layers.set(SOLAR_NO_BLOOM_LAYER)
  earthGroup.add(earth)
  disposables.push(earthGeometry, earthMaterial)

  // 按需求，太阳系里不再保留任何星球表面的光晕 —— 地球那层淡蓝光晕（原 earthHalo）
  // 早已移除，太阳的辉光（sunGlow）也一并删了；这一站的地球直接靠球体本身的昼夜贴图呈现。

  // 昼 / 夜贴图异步加载。加载完成前用上面那两张纯色占位 ——
  // 失败也只退化成深蓝球体，开场不会被一张图卡死
  const earthTextureLoader = new THREE.TextureLoader()
  const loadEarthTexture = (url: string, slot: 'uDay' | 'uNight'): void => {
    earthTextureLoader
      .loadAsync(url)
      .then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = 4
        earthMaterial.uniforms[slot].value = texture
        disposables.push(texture)
      })
      .catch(() => {
        // 静默降级：占位色本来就是合理的深蓝球
      })
  }
  loadEarthTexture(`${import.meta.env.BASE_URL}textures/earth-day.jpg`, 'uDay')
  loadEarthTexture(`${import.meta.env.BASE_URL}textures/earth-night.jpg`, 'uNight')

  /**
   * 云层壳。
   *
   * 它有两个身份：远景里是地球外面那层薄云，近景里就是切口 C 的掩护本体 ——
   * 镜头穿进去、画面被糊满的那一刻，地面那组物体在下面完成切换。
   */
  const cloudGeometry = new THREE.SphereGeometry(CLOUD_RADIUS, 72, 48)
  const cloudTexture = createCloudTexture(THREE)
  disposables.push(cloudTexture)
  const cloudMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: {
      uMap: { value: cloudTexture },
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uSunDir: earthSunDirVec,
    },
    vertexShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vNormal;

      void main() {
        vObj = normalize(position);
        // 与 uSunDir（世界系）同系，理由见地球表面材质
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uSunDir;
      varying vec3 vObj;
      varying vec3 vNormal;

      void main() {
        vec3 on = normalize(vObj);

        // 从球面坐标取 uv，随时间沿经度漂一点：云在飘，而不是一张静止的壳
        vec2 uv = vec2(atan(on.z, on.x) / 6.2831853 + 0.5 + uTime * 0.004, on.y * 0.5 + 0.5);
        float a = texture2D(uMap, uv).a;

        // 云也吃光照：向阳那面亮、背光那面几乎看不见，整片均匀的云会盖掉海陆
        float lit = dot(normalize(vNormal), normalize(uSunDir));
        a *= 0.24 + 0.76 * smoothstep(-0.4, 0.6, lit);

        vec3 col = vec3(0.94, 0.97, 1.0);
        gl_FragColor = vec4(col * a, a * uOpacity);
      }
    `,
  })
  const cloudShell = new THREE.Mesh(cloudGeometry, cloudMaterial)
  cloudShell.visible = false
  earthGroup.add(cloudShell)
  disposables.push(cloudGeometry, cloudMaterial)

  // 大气壳：外面那层淡蓝的边。用背面渲染 + 加法混合，只留边不遮地表
  const atmoGeometry = new THREE.SphereGeometry(ATMO_RADIUS, 64, 44)
  const atmoMaterial = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: {
      uSunDir: earthSunDirVec,
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        // 世界空间法线 / 视线，与 uSunDir 同系（理由见地球表面材质）
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormal = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vViewDir;

      void main() {
        vec3 n = normalize(vNormal);
        // 背面渲染时法线朝里，取反才是「这一层朝外的方向」
        float rim = pow(1.0 - max(0.0, dot(-n, normalize(vViewDir))), 3.0);
        float lit = 0.35 + 0.65 * smoothstep(-0.5, 0.7, dot(-n, normalize(uSunDir)));
        float a = rim * lit * 0.7 * uOpacity;
        gl_FragColor = vec4(vec3(0.32, 0.6, 1.0) * a, a);
      }
    `,
  })
  const atmoShell = new THREE.Mesh(atmoGeometry, atmoMaterial)
  atmoShell.visible = false
  earthGroup.add(atmoShell)
  disposables.push(atmoGeometry, atmoMaterial)

  // ---- 月球：地球唯一的卫星，挂在 earthGroup 下，随地球一起出生 / 缩放 / 退场 ----
  // 半径取真实比例（0.273 × 地球半径）；轨道半径真实是 60 个地球半径，
  // 画面上远到根本看不见，压到 3.2 个 —— 够开，不会贴着大气壳（782），
  // 又近到「绕着地球转」这件事在小地球阶段也读得出来。
  // 光照复用行星材质（uSunPos 指向太阳的世界坐标），晨昏方向和行星一致。
  const MOON_RADIUS_RATIO = 0.273
  const MOON_ORBIT_RATIO = 3.2
  // 公转角速度按同一套幂压缩：(365.25 / 27.3)^0.5 ≈ 3.66 倍地球公转
  const MOON_SPEED = 3.66
  // 白道倾角 5.1°，稍抬一点，轨道面才不和地球赤道面重合
  const MOON_TILT = 0.09
  const moonOrbitRadius = EARTH_RADIUS * MOON_ORBIT_RATIO
  const moonGeometry = new THREE.SphereGeometry(EARTH_RADIUS * MOON_RADIUS_RATIO, 32, 24)
  // 月球也是贴图球：灰白底色 + 月海 + 环形山（见 planet-textures.ts）
  const moonTexture = createPlanetSurfaceTexture(THREE, 'moon')
  const moonMaterial = createPlanetMaterial({ color: '#c9c5bd' }, moonTexture)
  const moon = new THREE.Mesh(moonGeometry, moonMaterial)
  // 月亮同理，不参与辉光
  moon.layers.set(SOLAR_NO_BLOOM_LAYER)
  earthGroup.add(moon)
  disposables.push(moonGeometry, moonMaterial)
  if (moonTexture) disposables.push(moonTexture)

  // ============================================================
  // 云幕：挂在相机前面的一层，专门用来盖住切口
  // ============================================================

  const veilGeometry = new THREE.PlaneGeometry(1, 1)
  const veilMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uMap: { value: cloudTexture },
      uTime: { value: 0 },
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vUv;

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);

        // 贴图采样 + 缓慢漂移。烘好的云图省掉逐像素 fbm，也不会出现整屏同值
        vec4 tex = texture2D(uMap, vUv * 3.2 + vec2(uTime * 0.008, uTime * 0.005));

        // 云絮之上还要有一层保底，不能被云絮的洞穿透。
        //
        // 这一条是云图变成真正无缝的噪声之后才暴露出来的问题：原来的 alpha 是
        // tex.a 乘一个径向系数，即整层完全由云絮的浓淡决定 —— 云图能平铺之后
        // 洞是真的洞，换场峰值（p=0.65）时地面的省界会从洞里透出来，等于没盖住。
        // 所以改成「底 + 云絮」：底负责把换场盖严实，云絮只负责让这层灰蓝有形状。
        //
        // 越靠外越厚：镜头扎进云里时中间先透、四周先糊。可见区域大约只用到
        // r ∈ [0, 0.52]（云幕是视口的 2.7 倍大），所以过渡必须压在 0.6 以内才看得见。
        float base = 0.80 + 0.16 * smoothstep(0.0, 0.6, r);
        float a = min(base + 0.14 * tex.a, 0.97);

        vec3 col = mix(vec3(0.56, 0.64, 0.8), vec3(0.94, 0.95, 1.0), tex.a);
        gl_FragColor = vec4(col, a * uOpacity);
      }
    `,
  })
  const veil = new THREE.Mesh(veilGeometry, veilMaterial)
  // renderOrder 拉高：它是不透明遮蔽物，必须画在所有东西之后
  veil.renderOrder = 999
  veil.visible = false
  veil.frustumCulled = false
  camera.add(veil)
  disposables.push(veilGeometry, veilMaterial)

  // ============================================================
  // 第 06 / 07 / 08 站：卫星影像的垂直下降
  // ============================================================

  const groundGroup = new THREE.Group()
  groundGroup.visible = false
  scene.add(groundGroup)

  /**
   * 底衬：一块纯色平面，压在五层影像下面。
   *
   * 影像要联网去取，第一层到位之前云幕一散就是一块黑；底衬保证那几帧是「一片暗地」，
   * 而不是页面的底色。它同时盖住影像边缘之外的虚空。
   *
   * 整组地面都不参与深度测试（depthTest: false）：它们是贴在镜头前方的一叠全屏贴图，
   * 谁盖谁完全由 renderOrder 决定 —— 五个同高度、边长差几千倍的大平面如果走深度排序，
   * 光是 z-fighting 就够毁掉整段下降。
   */
  const baseGeometry = new THREE.PlaneGeometry(GROUND_BASE_HALF * 2, GROUND_BASE_HALF * 2)
  const baseMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#131a28'),
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  })
  const groundBase = new THREE.Mesh(baseGeometry, baseMaterial)
  groundBase.rotation.x = -Math.PI / 2
  groundBase.position.set(0, GROUND_Y, GROUND_Z)
  groundBase.renderOrder = 1
  groundGroup.add(groundBase)
  disposables.push(baseGeometry, baseMaterial)

  /** 一层卫星影像的运行时状态 */
  interface GroundLevel {
    /** 影像的半边长（世界单位）。引入高度每帧由它现算，见 update 里的 showAlt */
    half: number
    material: THREE_NS.MeshBasicMaterial
    mesh: THREE_NS.Mesh
    /** 影像到没到。没到就一直是透明的，也不参与换层 */
    loaded: boolean
    /** 请求发出去了没有，避免同层重复发 */
    started: boolean
  }

  /**
   * 五层影像，**全部以钟楼为中心**。
   *
   * 这是整段唯一要守住的几何事实：同一中心、不同边长，于是换层在世界坐标里
   * 就是一次纯粹的缩放，两层边缘严丝合缝，看不出接缝，也不需要任何位置补偿。
   *
   * 平面绕 x 转 -90°：局部 +y 落到世界 -z，局部 -y 落到世界 +z。
   * 贴图那边配 flipY = true（默认值）—— 图像第 0 行是北，uv 的 v=1 落在局部 +y、
   * 也就是世界 -z，正北于是朝 -z。
   *
   * 这一对必须同进同退，而且是**两个独立选择里唯一正确的那一对**：v 反过来、
   * 把正北放到 +z 也能自圆其说（贴图和局部坐标确实对上了），但那等于让世界坐标
   * 变成物理地球的镜像 —— 俯视时画出来就是一张上下翻过来的中国：南海在屏幕上边、
   * 中亚在左下、阿拉伯海占了左上角，怎么看都不像中国。镜像转镜头是救不回来的，
   * 只能在贴图这一层改对（世界方向只认「北在 -z」，见 satellite-map.ts 文件头第 5 条）。
   */
  const groundLevels: GroundLevel[] = SATELLITE_LEVELS.map((level, index) => {
    const geometry = new THREE.PlaneGeometry(level.half * 2, level.half * 2)
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(0, GROUND_Y, GROUND_Z)
    // 大层先画、小层后画：交叉淡化时小层盖在大层上，不会互相挖洞
    mesh.renderOrder = 2 + index
    mesh.visible = false
    groundGroup.add(mesh)
    disposables.push(geometry, material)
    return {
      half: level.half,
      material,
      mesh,
      loaded: false,
      started: false,
    }
  })

  const groundTextureLoader = new THREE.TextureLoader()
  groundTextureLoader.setCrossOrigin('anonymous')

  /**
   * 取某一层的影像。
   *
   * **开场一挂上场景就把六层全提前取**，不卡进度阈值：六层本就是开场必到之物，
   * 早发才能在网络慢时也有整段下降的时间去加载，避免落到西安那几屏时，
   * 最深的钟楼 / 城区层还没到位，画面只剩纯色底衬（黑屏）。
   *
   * **失败带有限次重试**：这个接口明令 `Cache-Control: max-age=0`，浏览器不缓存，
   * 弱网下抖动或 ArcGIS 偶发 5xx 都会让一次请求挂掉；不重试的话这一层就永久缺席，
   * 而深缩放时正好只有它在撑画面 —— 于是黑屏。退避重试能把这种瞬时失败救回来。
   * 底衬保证了即便六层全拿不到，落到地面也只是一块可读的暗场，不会卡住开场。
   */
  const MAX_TEXTURE_RETRY = 3
  const loadGroundLevel = (index: number): void => {
    const level = groundLevels[index]
    if (!level || level.started) return
    level.started = true
    requestGroundLevel(index, level, 1)
  }

  const requestGroundLevel = (index: number, level: GroundLevel, attempt: number): void => {
    groundTextureLoader
      .loadAsync(SATELLITE_LEVELS[index].url)
      .then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        // 保持默认的 flipY（true）：图像第 0 行是北，落在 uv 的 v=1、也就是世界 -z。
        // 正北必须是 -z —— 理由见 groundLevels 上面那段，别再翻回去
        texture.flipY = true
        // 越靠画面边缘越斜，各向异性开着，远处的海岸线和街区才不成一团糊
        texture.anisotropy = 4
        level.material.map = texture
        level.material.needsUpdate = true
        level.loaded = true
        disposables.push(texture)
      })
      .catch((error: unknown) => {
        if (attempt < MAX_TEXTURE_RETRY) {
          // 指数退避重试（300ms / 600ms）：把弱网抖动、ArcGIS 偶发 5xx 挡在黑屏之前
          window.setTimeout(() => requestGroundLevel(index, level, attempt + 1), 300 * attempt)
        } else {
          console.warn('[home-intro] 卫星影像加载失败：', SATELLITE_LEVELS[index].id, error)
        }
      })
  }

  /**
   * 场景一创建就把六层影像全部发出去（见上面 loadGroundLevel 的注释）。
   * `started` 去重，重挂时走 THREE.Cache 从缓存秒回，不会再黑屏。
   */
  for (let i = 0; i < groundLevels.length; i += 1) loadGroundLevel(i)

  // ============================================================
  // 每帧
  // ============================================================

  return {
    // 阈值 0.3：宇宙里的亮部本来就集中（星点芯、太阳、核球、城市灯），
    // 再低一点整屏就会蒙上一层灰。radius 收在 0.5，亮部周围那圈雾才不至于发虚
    //
    // excludeLayer：太阳系那一站，八颗行星的向阳面同样亮过 0.3 —— 阈值是全屏的，
    // 拦不住它们，于是每颗都被罩上一层雾。所以把行星（连同环、轨道线、地球、月亮）
    // 单独放一层，提辉光时整层跳过，只留太阳发光。其它站（星系盘、大地球、地面）
    // 不在这一层，照常参与，观感不变。
    bloom: { strength: 0.7, radius: 0.1, threshold: 0.3, excludeLayer: SOLAR_NO_BLOOM_LAYER },

    update({ time, renderer, bloom, delta }) {
      const pixelRatio = renderer.getPixelRatio()
      const p = clamp01(getIntroProgress())

      /**
       * 辉光跟着尺度走。
       *
       * 高空俯瞰那一段地表是荒漠和云，本身就亮，阈值压在 0.3 会把整片大地当成
       * 高光糊开 —— 画面发白、地形层次全丢（这也是改版前那一屏「糊」的来源之一）。
       * 所以这一段把阈值抬到 0.58、强度收到 0.38。
       *
       * **一直抬到收场，中途不再放回去**：落地那三站现在是白天的卫星影像，
       * 不是过去的夜灯路网 —— 屋顶、广场、水面全是高光，阈值一降就整片发白。
       * （旧版在 0.78→0.9 放回夜灯参数，那条曲线是配自绘城市用的，已经删掉。）
       */
      const groundBloom = smoothstep01(0.6, 0.7, p)
      if (bloom) {
        bloom.threshold = 0.3 + 0.28 * groundBloom
        bloom.strength = 0.7 - 0.32 * groundBloom
      }

      // ---- 镜头 ----
      // 太空段：沿 -z 直行 + 抬升，与地球 / 太阳系那几站配套（这一段到云幕为止）
      const camZ = trackAt(p, CAM_Z_TRACK, 'z')
      const camY = trackAt(p, CAM_Y_TRACK, 'y')
      const lookDist = trackAt(p, LOOK_DIST_TRACK, 'd')
      const descend = trackAt(p, LOOK_DESCEND_TRACK, 't')

      /**
       * 地面段：**相对落点的垂直下落**。
       *
       * 高度按对数走（见 CHINA_HOLD_TO / GROUND_DROP_TRACK）；落点在 CHINA_HOLD_TO
       * 之前是「整片国土的中心」，之后收回到钟楼 —— 于是整段读出来是
       * 「先看清一整片中国，再一路往西北收进西安，最后定在钟楼上」。
       *
       * 这个高度同时决定哪一层影像清晰（换层点就是各层的引入高度），
       * 下面算透明度时直接用它。
       */
      const tanV = Math.tan((camera.fov * Math.PI) / 360)
      const tanH = tanV * Math.max(0.2, camera.aspect)

      // 第 06 站的高度按宽高比现算（见 chinaStageAltitude 的注释）
      const chinaAlt = chinaStageAltitude(tanV, tanH)
      // 第一层（西北）之后的所有引入高度都随宽高比整体缩放，所以行程写成倍率
      const firstAlt = levelShowAltitude(groundLevels[1].half, tanV, tanH)

      let alt: number
      if (p <= CHINA_HOLD_TO) alt = chinaAlt
      else if (p < CHINA_DESCEND_TO) {
        // 从「装下中国」降到第一层的引入高度，与后面那段同一个速率
        const t = smoothstep01(CHINA_HOLD_TO, CHINA_DESCEND_TO, p)
        alt = chinaAlt * Math.pow(firstAlt / chinaAlt, t)
      } else alt = firstAlt * Math.pow(10, trackAt(p, GROUND_DROP_TRACK, 'drop'))

      /**
       * 各层的引入高度：镜头落到这里时它刚好 1:1 清晰。
       * 每帧现算（随视口宽高比变），不能建场景时定死 —— 那时 camera.aspect 还是 1。
       */
      const showAlt = (half: number) => levelShowAltitude(half, tanV, tanH)

      /**
       * 取景中心的平移（世界单位）。
       *
       * 只在第 06 站存在：整片国土的几何中心在西安的西北方向约 600 公里处，
       * 不挪过去，画面里中国就偏在一侧。按高度衰减，落到第一层（西北）的
       * 尺度之前已经归零 —— 换层必须仍然是「纯缩放」，两层影像错开一点都会穿帮。
       */
      const panFade = smoothstep01(chinaAlt * 0.3, chinaAlt * 0.95, alt)
      const panX = CHINA_FRAME.offsetX * panFade
      const panZ = CHINA_FRAME.offsetZ * panFade
      const tilt = GROUND_TILT_MAX * smoothstep01(GROUND_TILT_FROM, GROUND_TILT_TO, p)

      const groundBlend = smoothstep01(GROUND_HANDOFF_FROM, GROUND_HANDOFF_TO, p)
      const groundCamY = GROUND_Y + alt
      const groundCamZ = GROUND_Z + panZ + alt * tilt

      /**
       * 远平面跟着地面段的高度走。
       *
       * 外壳给的是 24000（星系那一站定的），而「一眼装下中国」这一屏的高度就有
       * 一万五千，画面四角打到地面已经两万多 —— 沿用 24000 会把影像的四角整片裁掉，
       * 屏幕上出现一条生硬的直边。1.6 是「四角斜距 / 高度」在 55° 视场下的保守值。
       *
       * 只在地面段抬高：太空段的东西都在两万四以内，抬了没好处只有深度精度损失。
       * 而这一段的几何体（影像层、底衬）全关了 depthTest，靠 renderOrder 排序，
       * 远近比再大也不会 z-fighting。
       */
      const wantedFar = groundBlend > 0 ? Math.max(24000, alt * 1.6 + 8000) : 24000
      if (Math.abs(camera.far - wantedFar) > 20) {
        camera.far = wantedFar
        camera.updateProjectionMatrix()
      }

      /**
       * 两套镜头在云幕底下交接（GROUND_HANDOFF_*）。
       *
       * 太空段是「沿 -z 直行」的绝对坐标，地面段是「相对落点」的坐标，两者差着几千单位；
       * 交接整段压在云幕最厚的那几帧里，屏幕上只是一片糊白，看不出来。
       *
       * 这里**不带指针视差**（曾经带，太空段固定几十单位、地面段按高度缩放）。
       * 开场是一段锁定滚动的叙事，整屏都是「讲给你看」的内容：镜头跟着鼠标偏一点，
       * 星系、太阳系和地表就会一起晃，读文案时像坐在一条不稳的船上。
       * 首页的其它背景仍然跟鼠标走 —— 那些是常态下挂在正文背后的装饰，不是主角。
       *
       * 镜头没有单独设 up，用的是外壳默认的 +y。于地面段那几站（tilt = 0，正对天底）
       * 视线与 +y 平行，lookAt 会掉进退化分支自己挑一个「上」—— 这里**挑出来正好是正北**
       * （-z），所以天底视角是对的，不要去「修」它：把 up 改成 +y 之外的东西反而会让
       * 地图横过来。真要在正对天底时说话，也只有 -z 这一个正确答案。
       */
      camera.position.set(
        panX * groundBlend,
        camY * (1 - groundBlend) + groundCamY * groundBlend,
        camZ * (1 - groundBlend) + groundCamZ * groundBlend,
      )

      /**
       * 视线落点。太空段和落地段是两套：
       *
       *   - 落地段（SOLAR_WEIGHT = 0）：正前方 + 俯角，即原来的那套；
       *   - 太空段（SOLAR_WEIGHT = 1）：先钉在星系盘心，再滑到太阳系那个偏移点上。
       *
       * 为什么太空段不能「看正前方」：太阳系和地球都在 -z 方向上，
       * 看正前方就只能看到离镜头近的那个（还没锁定时是太阳），
       * 而这一站要的是「镜头压着太阳系放大它」。
       * 视线锁在太阳系上之后，镜头沿 -z 直行的每一米都变成太阳系的放大；
       * 到 0.38→0.43 之间再把这根视线平滑交给地球 ——
       * 就是「视口从太阳系移到地球上并钉住」那一下。
       *
       * 还有一点：这个落点从第一帧到交给地球之前**一直没换过**，也不横移 ——
       * 星系盘的盘心就定位在同一个点上，于是「盘心」和「太阳系」在屏幕上永远重合，
       * 星系段到太阳系段是一次纯缩放（见 createScene 里 discGroup 的定位）。
       *
       * camera.lookAt 只改朝向、不产生翻滚：镜头始终「头朝上」，
       * 所以整段读起来仍然是「在往前坠」，不会变成一次转弯环视。
       */
      const solarWeight = 1 - smoothstep01(AIM_LOCK_FROM, AIM_LOCK_TO, p)
      const groundWeight = 1 - solarWeight

      // ---- 地球：始终在自己的轨道上；长大的是整条轨道 ----
      // 地球不脱离轨道（地球半径 700 + 太阳半径 300，而轨道只有 960，比两者之和还小，
      // 留在原尺寸轨道上长满会把太阳吞掉），
      // 长大的是轨道本身：轨道半径 × m，太阳和另外七颗被推远、甩出画面。
      // 于是地球从头到尾都在轨道点上，从画面上看就是「镜头压进太阳系、
      // 视口落到第三颗行星上、整系继续放大」。
      const { a, b, c } = orbitAxes(EARTH_ORBIT)
      // 公转：整圈、连续，按时间累加（理由见 EARTH_ORBIT_RATE）。
      // 唯一要收的是大局放大那一段的角速度 —— 轨道被放大 8.2 倍之后，
      // 地球要是还在轨道上走，「太阳绕着地球转一圈」会立刻穿帮。
      // 收的方式是乘一个 (1 - expand)，所以只会减速到停，不会倒退。
      const expand = smoothstep01(SOLAR_EXPAND_FROM, SOLAR_EXPAND_TO, p)
      // 整圈公转，**全程不停** —— 放大那一段也照转，不再收角速度。
      //
      // 于是镜头钉上地球之后，画面里会看到「太阳绕着地球走」。那不是 bug，
      // 是相对运动的正确表现：镜头跟着地球走，太阳当然就是动的。
      // 早先为了防止这一点，把公转在放大前刹停，代价是地球到了太阳系最该
      // 被看清的时候反而不转了 —— 那个取舍是错的，现在按「一直转」来。
      //
      // 出生之前不累加：让「出生那一刻站在哪儿」是确定的（EARTH_START_ANGLE），
      // 不会因为用户在星系那两站多停了几秒，地球就换了个地方冒出来。
      if (p >= EARTH_BIRTH_AT) earthAngle += delta * EARTH_ORBIT_RATE
      const angle = earthAngle
      // 轨道点的局部坐标 → 未缩放的世界方向：过 solarGroup 的倾斜（rotation.x = SOLAR_TILT）
      const offsetX = Math.cos(angle) * a - c
      const offsetY = -Math.sin(angle) * b * Math.sin(SOLAR_TILT)
      const offsetZ = Math.sin(angle) * b * Math.cos(SOLAR_TILT)

      // 地球这一帧的位置：放大前就是轨道点本身，放大后随轨道一起长到视轴上
      earthGroup.position.set(
        (SOLAR_OFFSET_X + offsetX) * (1 - expand),
        (SOLAR_OFFSET_Y + offsetY) * (1 - expand),
        (SUN_Z + offsetZ) * (1 - expand) + EARTH_Z * expand,
      )

      // 整条轨道放大 m 倍（轨道半径 × m），并平移到「地球轨道点正好落在
      // earthGroup.position 上」—— 地球因此始终在自己的轨道上
      const m = 1 + (SOLAR_EXPAND_MAX - 1) * expand
      solarGroup.position.set(
        earthGroup.position.x - m * offsetX,
        earthGroup.position.y - m * offsetY,
        earthGroup.position.z - m * offsetZ,
      )
      /**
       * 放大完成后把整系沿「地球 → 太阳」方向再推远一段（0.48→0.56 共 4200）。
       *
       * m 倍轨道把太阳甩到 7870 之外：镜头贴近地球的那一段里，它那颗亮球
       * 仍会探回画面角上，读起来是「太阳系还没走」。
       * 再推 4200 之后太阳在 12000 开外、离视轴 70° 以上，0.56 前彻底离场，
       * 「太阳系滑出画面」这句话才算兑现。
       */
      const slideOut = smoothstep01(SOLAR_EXPAND_TO, 0.56, p) * 4200
      if (slideOut > 0.0001) {
        // 方向是「地球 → 太阳」，也就是 -offset：offset 是「太阳 → 地球」那根向量
        // （见上面 solarGroup.position 的算法），照原样（+offset）推就成了把太阳
        // **往地球这边**推、甚至推到地球背后，糊成一块贴在地球边上的巨亮盘 ——
        // 这一笔曾经写反过，别只改数字不看符号。现在是 -offset，把太阳继续推远。
        solarOutDir.set(-m * offsetX, -m * offsetY, -m * offsetZ).normalize()
        solarGroup.position.addScaledVector(solarOutDir, slideOut)
      }
      // 行星的光照是按太阳的世界坐标算的，太阳被推远了，这个点必须跟着走
      solarSunPos.value.copy(solarGroup.position)

      /**
       * 太阳本体放大（m^0.8，比轨道的同比 1 略小，满打满算约 10.7 倍、半径 ≈ 1600），
       * 这一条只约束太阳，行星按 SOLAR_PLANET_EXPAND 与轨道不同比。
       *
       * 放大途中太阳明显长大、压得住画面；放大结束时太阳已被推到画面外、
       * 且按 SOLAR_PLANET_CLEAR_* 让位给地球，镜头贴近地球时不会糊在前面
       * （真实太阳本就远大于地球）。
       */
      const bodyScale = Math.pow(m, SOLAR_BODY_EXPAND)
      sun.scale.setScalar(bodyScale)
      // 日面噪声随时间翻涌，让太阳「活」着（米粒组织、黑子缓慢移动）
      sunMaterial.uniforms.uTime.value = time
      // 太阳已无外挂辉光，这里不再需要同步 sunGlow 的尺寸

      /**
       * z 方向要交回「正前方」：地球回到视轴上之后，看它和看正前方是同一个方向，
       * 但镜头 0.72 前后要穿过地球继续飞（云幕正盖着这一段），
       * 目标点要是钉在地球球心上，球心落到镜头背后那一下视线就会翻过去。
       * 放大一完成（0.48→0.52）就把 z 交回 camZ - lookDist，方向连续、无感。
       */
      const aimHandoff = smoothstep01(SOLAR_EXPAND_TO, 0.52, p)
      const aimZ = earthGroup.position.z * (1 - aimHandoff) + (camZ - lookDist) * aimHandoff
      /**
       * 太空段的落点：**从头到尾钉在太阳系那一组的心上**（SOLAR_OFFSET 那一对
       * x / y，加上 solarGroup 的 z）。
       *
       * 星系盘的盘心也定位在同一个点上，所以这两个景物在屏幕上永远重合 ——
       * 镜头沿 -z 直行，画面中心一直是它，全程没有横移、中途也不换目标，
       * 「星系 → 太阳系」读成一次纯缩放（对照 createScene 里 discGroup 的定位）。
       */
      lookTarget.set(
        SOLAR_OFFSET_X * solarWeight + earthGroup.position.x * groundWeight,
        SOLAR_OFFSET_Y * solarWeight + earthGroup.position.y * groundWeight
          - descend * lookDist * groundWeight,
        // 放大之后太阳已经不在 SOLAR_OFFSET 上了，视线落点跟着 solarGroup 走
        solarGroup.position.z * solarWeight + aimZ * groundWeight,
      )

      /**
       * 地面段的落点：钟楼本尊（第 06 站加上 panX / panZ 那段平移）。
       *
       * 与上面那套按 groundBlend 混合（交接同样藏在云幕底下）。落点钉在钟楼的世界坐标上，
       * 于是「镜头一路下落」在画面上读出来就是：钟楼不动，四周的街巷一层层放大。
       * 只在真正进入地面段之后才动这个点 —— 那之前它是太空段的落点，别去动它。
       */
      if (groundBlend > 0) {
        lookTarget.set(
          lookTarget.x * (1 - groundBlend) + panX * groundBlend,
          lookTarget.y * (1 - groundBlend) + GROUND_Y * groundBlend,
          lookTarget.z * (1 - groundBlend) + (GROUND_Z + panZ) * groundBlend,
        )
      }
      camera.lookAt(lookTarget)

      // ---- 星系盘 ----
      discMaterial.uniforms.uTime.value = time
      discMaterial.uniforms.uPixelRatio.value = pixelRatio
      starMaterial.uniforms.uPixelRatio.value = pixelRatio
      // 自转 = 极慢的底速漂移 + 跟着滚动转的那一份（见 DISC_SPIN_SCROLL）
      discSpin.rotation.y = time * DISC_SPIN + p * DISC_SPIN_SCROLL
      // 沿视线射线的放大：盘心在屏幕正中，所以放大中心就是正中、不会偏心
      // （这才是「星系放大」的实现，见 DISC_ZOOM_*）
      const discZoom = 1 + (DISC_ZOOM_MAX - 1) * smoothstep01(DISC_ZOOM_FROM, DISC_ZOOM_TO, p)
      discGroup.scale.setScalar(discZoom)

      // 盘在 DISC_ZOOM 放大到铺满画面之后才淡出：0.26 前后盘已溢出视口、旋臂扫过，
      // 那是「已经放大到星系中心」；现在让它再淡出 0.26 → 0.31，太阳系 0.30 进场时
      // 盘还剩约一成（核光残影），正好衬着太阳「从星系里长出来」—— 星系是淡出、
      // 不是硬关，读起来是「星系放大、淡出、太阳在正中亮起」，而不是「啪」地少掉。
      // 收在 0.31 也保证星系彻底消失于太阳系站稳之前（SOLAR_ENTER_AT = 0.30）。
      const discFade = 1 - smoothstep01(0.26, 0.31, p)
      discMaterial.uniforms.uOpacity.value = discFade
      coreMaterial.uniforms.uOpacity.value = discFade
      // 核球一边被镜头逼近、一边自己涨大（理由见 CORE_SWELL_*）
      discCore.scale.setScalar(1 + CORE_SWELL_MAX * smoothstep01(CORE_SWELL_FROM, CORE_SWELL_TO, p))
      discGroup.visible = discFade > 0.002

      const starFade = 1 - smoothstep01(0.56, 0.68, p)
      starMaterial.uniforms.uOpacity.value = starFade
      starPoints.visible = starFade > 0.002

      // ---- 掩护：星流 ----
      for (const warp of warps) {
        const intensity = cutPulse(p, warp.cut.at, warp.cut.half)
        warp.object.visible = intensity > 0.002
        warp.material.uniforms.uOpacity.value = intensity * 0.9
        // 拖尾长度也跟着强度走：一开始只是拉长，中段才是整片射线
        warp.material.uniforms.uStretch.value = intensity * 1500
      }

      // ---- 太阳系 ----
      // 一路留到云幕（切口 C）里才收：地球就是系里第三颗行星，两组物体必须同时在场
      // 才能读成「从太阳系里飞出来」。整组定死在飞行轴线的左下方（SOLAR_OFFSET），
      // 视线在 0.38 → 0.43 交给地球之后，它就顺着画面左下方滑出去 ——
      // 不必再靠星流掩护换场。
      //
      // 进场时刻见 SOLAR_ENTER_AT：星系彻底退场（0.28）、镜头再放大一小段之后才挂上，
      // 且仍在切口 A 的星流掩护里 ——
      // 太阳系是整组凭空出现的，没有「生长」这种说法，只能靠星流盖住那一下
      solarGroup.visible = p >= SOLAR_ENTER_AT && p < EARTH_VISIBLE_UNTIL
      if (solarGroup.visible) {
        // 视线锁上地球之后按 SOLAR_PLANET_CLEAR_* 收干净，把画面让给地球
        const clear = 1 - smoothstep01(SOLAR_PLANET_CLEAR_FROM, SOLAR_PLANET_CLEAR_TO, p)
        // 轨道随放大倍率 m 一起长大，行星位置本来就是 ×m，于是始终贴在线圈上
        for (const loop of orbitLines) loop.scale.setScalar(m)
        orbitMaterial.opacity = ORBIT_LINE_OPACITY * clear
        for (const planet of planets) {
          // 椭圆轨道：太阳在焦点上，x 方向整体偏移半个焦距。
          // a / b / c 乘上轨道放大倍率 m —— 轨道在长大，行星只是被推远
          const { a, b, c } = orbitAxes(planet.spec)
          const angle = planet.spec.phase + time * ORBIT_BASE * planet.spec.speed
          planet.mesh.position.set(Math.cos(angle) * a * m - c * m, 0, Math.sin(angle) * b * m)
          // 本体放大（SOLAR_PLANET_EXPAND = 0.7，小于轨道的同比 1）：行星自己涨得慢、
          // 又被 m 倍轨道推远，于是屏幕上越放越小，和「太阳放大（0.8）」形成强对比。
          planet.mesh.scale.setScalar(Math.pow(m, SOLAR_PLANET_EXPAND) * clear)
          planet.mesh.visible = clear > 0.002
          planet.mesh.rotation.y = time * SPIN_BASE * planet.spec.spin
        }
      }

      // ---- 地球（全程唯一的一颗）----
      // 出场时 scale 由 0 连续长起来，所以「出现」这一下本身也是连续的：从无到有是
      // 一段生长，不是一次 visible 硬开关。之后按 EARTH_SCALE_TRACK 走：
      // 0.40 之前一直是待在自己轨道上的小行星（那一站的镜头归太阳系），
      // 视线锁上它之后才长满 —— 长大和镜头逼近叠在一起，就是「放大地球」
      // 地球与太阳系同帧进出（见 EARTH_BIRTH_AT 的注释）：它是系里第三颗行星，
      // 比系早一帧，星系盘还没退场时画面里就会先多出一颗抢眼的蓝色光点
      earthGroup.visible = solarGroup.visible
      if (earthGroup.visible) {
        // 0.28 → 0.30：这段生长整个发生在「整组还没挂上」的时候（见 EARTH_BIRTH_AT），
        // 于是进场第一帧地球就是全尺寸的小行星，不会是几像素的点
        const born = smoothstep01(EARTH_BIRTH_AT, EARTH_BIRTH_AT + 0.02, p)
        earthGroup.scale.setScalar(born * trackAt(p, EARTH_SCALE_TRACK, 's'))

        // 地照：整圈公转必然有半圈看到的是夜面，小地球阶段不垫一层就是「凭空消失」；
        // 开始长满（视线已经锁上它）时收掉，把夜面还给城市灯
        earthMaterial.uniforms.uNightFloor.value = 1 - smoothstep01(AIM_LOCK_TO, EARTH_FULL_AT, p)

        // 日照方向：每帧按「地球 → 太阳」的实际世界向量算。整组放大之后
        // 太阳一直在被推远，写死一个方向，晨昏线就会和唯一那个光源错开
        earthSunDirTmp
          .set(
            solarGroup.position.x - earthGroup.position.x,
            solarGroup.position.y - earthGroup.position.y,
            solarGroup.position.z - earthGroup.position.z,
          )
          .normalize()
        earthSunDirVec.value.copy(earthSunDirTmp)

        earth.rotation.y = time * 0.02
        // 云跟着地表一起转，但稍快一点：两层错开才看得出「云在飘」而不是一张壳
        cloudShell.rotation.y = time * 0.027

        // 月球绕地球：圆轨道近似（偏心率 0.055 肉眼看不出，不值得算），
        // 位置在 earthGroup 局部系里给，缩放随地球一起走
        const moonAngle = time * ORBIT_BASE * MOON_SPEED + 1.2
        moon.position.set(
          Math.cos(moonAngle) * moonOrbitRadius,
          -Math.sin(moonAngle) * moonOrbitRadius * Math.sin(MOON_TILT),
          Math.sin(moonAngle) * moonOrbitRadius * Math.cos(MOON_TILT),
        )

        // 云壳的浓度：越接近切口越厚。它同时是第 05 站的主角和第 06 站的掩护
        cloudShell.visible = p >= 0.5
        cloudMaterial.uniforms.uTime.value = time
        cloudMaterial.uniforms.uOpacity.value = 0.55 + 0.45 * smoothstep01(0.54, 0.65, p)

        // 大气亮边和「长满」同步淡入：0.40 之前它还是一颗小行星，
        // 那圈蓝边提前亮出来会暴露「这颗球马上要变大」
        atmoShell.visible = true
        atmoMaterial.uniforms.uOpacity.value = smoothstep01(AIM_LOCK_TO, EARTH_FULL_AT, p)
      }

      // ---- 云幕（切口 C）----
      const haze = cutPulse(p, HAZE_CUT.at, HAZE_CUT.half, HAZE_POWER)
      veil.visible = haze > 0.004
      veilMaterial.uniforms.uOpacity.value = haze
      veilMaterial.uniforms.uTime.value = time
      if (veil.visible) {
        // 云幕挂在相机下、距离固定，尺寸必须按视锥重算，否则窗口一变就露出边
        const halfHeight = Math.tan((camera.fov * Math.PI) / 360) * VEIL_DIST
        const halfWidth = halfHeight * Math.max(0.2, camera.aspect)
        // 留 1.35 倍余量：给噪声留出糊满画面之外的过渡区
        veil.scale.set(halfWidth * 2.7, halfHeight * 2.7, 1)
        veil.position.set(0, 0, -VEIL_DIST)
      }

      // ---- 卫星影像（第 06 / 07 / 08 站）----
      // 63% 就挂上（此时透明度还是 0，什么都看不见）—— 早一点挂是为了让
      // 云幕一散开时它已经在场，不会出现「先空一帧再浮出地面」
      groundGroup.visible = p >= 0.63
      if (groundGroup.visible) {
        // 底衬在云幕最厚的那几帧里就铺好（比第一层影像早），于是云一开始变薄，
        // 看见的是一块暗地而不是页面底色；随后第一层影像压在它上面亮起来。
        // 两段区间以及「从暗到亮」为什么必须这样错开，见 GROUND_BASE_REVEAL_*
        baseMaterial.opacity = smoothstep01(GROUND_BASE_REVEAL_FROM, GROUND_BASE_REVEAL_TO, p)
        // 底衬是纯色平面，尺寸按「这一屏的四角打到哪里」重算：它得盖住整个画面，
        // 包括第一层影像之外那一圈（超宽窗口上那一圈可能有好几度经度）
        const baseHalf =
          Math.max(
            Math.abs(panX) + tanH * alt,
            Math.abs(panZ) + tanV * alt,
          ) * 1.05
        groundBase.scale.setScalar(baseHalf / GROUND_BASE_HALF)

        /**
         * 换层判断用的是**高度，不是进度**。
         *
         * 每一层的引入高度（showAlt）就是它刚好 1:1 清晰的位置；高度落到它的 2.4 倍时
         * 该层开始淡入、落到 0.6 倍时淡满，同一段区间里上一层淡出
         * （两层的系数相加恒为 1，中间不会透底）。
         * 两端取值的依据是**两层同时在场时谁在撑画面**：
         * 2.4 让新层进来时已经比屏幕还清楚（0.46 倍），这一侧不存在糊的问题；
         * 0.6 让新层收尾时是 1.8 倍（还能看），而旧层此刻正好退到 2.75 倍 ——
         * 再往外就是「凑近看马赛克」，所以淡出的窗口不能再短。
         */
        for (let i = 0; i < groundLevels.length; i += 1) {
          const level = groundLevels[i]
          // 第一层（中国大陆）是唯一不按高度换的一层：它压在底衬上按进度从暗到亮地
          // 浮出来（区间见 GROUND_REVEAL_*）。反过来按高度让它一进场就全亮，
          // 云幕散开的那一帧会「啪」地弹出一张高对比的卫星图，正是要避免的
          let opacity = i === 0
            ? smoothstep01(GROUND_REVEAL_FROM, GROUND_REVEAL_TO, p)
            : riseByAltitude(alt, showAlt(level.half))
          const next = groundLevels[i + 1]
          if (next) {
            if (next.loaded) {
              // 下一层已到位：两层交叉淡化，中间不露底
              opacity *= 1 - riseByAltitude(alt, showAlt(next.half))
            } else {
              // 下一层还没来：当前层先撑着画面（保持可见），等它加载完再做交叉淡化，
              // 否则深缩放时下一层缺席会直接露出纯色底衬（黑屏）。这一条让未到位的
              // 层级逐级回退到「上一个已加载的层」，整段下降永远有卫星影像兜底。
              opacity = Math.max(opacity, level.loaded ? 1 : 0)
            }
          }

          const show = level.loaded && opacity > 0.002
          level.mesh.visible = show
          if (show) level.material.opacity = opacity
        }
      }

      // 六层影像已在场景创建时一次性预取（见 loadGroundLevel 上方的注释），
      // 这里不再按进度触发；loaded 之后交叉淡化逻辑见上面的 for 循环。
    },

    dispose() {
      scene.remove(discGroup)
      scene.remove(starPoints)
      scene.remove(solarGroup)
      scene.remove(earthGroup)
      scene.remove(groundGroup)
      for (const warp of warps) scene.remove(warp.object)
      camera.remove(veil)
      scene.remove(camera)
      disposables.forEach((item) => item.dispose())
    },
  }
}

/** 与 GLSL 的 smoothstep 同名的 JS 版，纯为可读性 */
function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1))
  return t * t * (3 - 2 * t)
}

/**
 * 某一层卫星影像在高度 alt 上的淡入系数（0~1）。
 *
 * 高度从 handover × 2.4 降到 handover × 0.6 的区间里从 0 升到 1 ——
 * 两端取值的理由见 update 里那段注释。它同样被用来算上一层的淡出（取 1 减），
 * 所以两层的交叉淡化天然是互补的，不会出现「都半透明」的灰雾帧。
 */
function riseByAltitude(alt: number, handover: number): number {
  const hi = handover * 2.4
  const lo = handover * 0.6
  const t = clamp01((hi - alt) / (hi - lo || 1))
  return t * t * (3 - 2 * t)
}
