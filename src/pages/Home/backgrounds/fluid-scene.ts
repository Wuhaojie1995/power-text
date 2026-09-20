/**
 * GPU 流体模拟背景。
 *
 * 移植自 Pavel Dobryakov 的 WebGL-Fluid-Simulation（MIT License, Copyright (c) 2017），
 * 原版是一个带 dat.GUI 调参面板的独立演示页。这里改了三处：
 *
 *  1. 剥掉与演示页强耦合的部分：App 推广弹窗、Google Analytics 上报、截图下载、
 *     dat.GUI 面板。背景不需要这些，顺带少了两个第三方依赖和一个外部资源
 *     （原版抖动图 LDR_LLL1_0.png 改成本地生成噪声）。
 *  2. 交互按「背景」的语境重写。原版要按住鼠标才有反应、松手几秒后画面就黑掉，
 *     落到作品集首页上就是「一切到这块背景，页面背后一片漆黑」。所以补了自动泼溅。
 *  3. 补上原版没有的资源回收：它在 resize 时会重建整套 FBO 却不解绑旧的，
 *     演示页只 resize 一两次看不出来，背景却会跟着窗口拉伸反复触发。
 *
 * 算法本身没动：速度场与染料场各一张 ping-pong 纹理，每帧按
 * curl → vorticity → divergence → pressure(Jacobi) → gradient subtract → advect 推进，
 * 再叠 bloom 与 sunrays 两道后处理。
 *
 * 它是独立的一条 WebGL 管线，不经过 three.js，所以挂不到 three-scene.ts 上 ——
 * 两者共用的只有 React 侧那层「挂 canvas / 卸载时释放」，见 HomeBackground.tsx。
 */

/* -------------------------------------------------------------------------- */
/* 着色器                                                                      */
/* -------------------------------------------------------------------------- */

/** 全屏四边形的基础顶点着色器。顺带把上下左右四个邻居的 uv 也算出来，省得每个片元着色器各写一遍。 */
const BASE_VERTEX_SHADER = `
    precision highp float;

    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`

/** sunrays 的 1D 模糊专用：只要左右两个邻居，且偏移放大，用一次采样换更大的模糊半径。 */
const BLUR_VERTEX_SHADER = `
    precision highp float;

    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform vec2 texelSize;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        float offset = 1.33333333;
        vL = vUv - texelSize * offset;
        vR = vUv + texelSize * offset;
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`

/** 3 抽头 1D 模糊。配合上面的顶点着色器，横竖各跑一遍就是分离式高斯。 */
const BLUR_FRAGMENT_SHADER = `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform sampler2D uTexture;

    void main () {
        vec4 sum = texture2D(uTexture, vUv) * 0.29411764;
        sum += texture2D(uTexture, vL) * 0.35294117;
        sum += texture2D(uTexture, vR) * 0.35294117;
        gl_FragColor = sum;
    }
`

/** 原样搬运。只在 resize 时用一次：把旧尺寸的纹理内容搬进新尺寸的纹理。 */
const COPY_FRAGMENT_SHADER = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    uniform sampler2D uTexture;

    void main () {
        gl_FragColor = texture2D(uTexture, vUv);
    }
`

/** 乘一个常数。压力场每帧靠它衰减，这是图形化取向的近似，不是严格的物理投影。 */
const CLEAR_FRAGMENT_SHADER = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;

    void main () {
        gl_FragColor = value * texture2D(uTexture, vUv);
    }
`

/** 涂一块纯色。用来铺画布底色。 */
const COLOR_FRAGMENT_SHADER = `
    precision mediump float;

    uniform vec4 color;

    void main () {
        gl_FragColor = color;
    }
`

/**
 * 最终合成。SHADING / BLOOM / SUNRAYS 三个开关靠 #define 在编译期裁掉分支，
 * 所以这里只编译一次（没有调参面板，关键词初始化后就不会再变）。
 */
const DISPLAY_FRAGMENT_SHADER = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform sampler2D uBloom;
    uniform sampler2D uSunrays;
    uniform sampler2D uDithering;
    uniform vec2 ditherScale;
    uniform vec2 texelSize;

    vec3 linearToGamma (vec3 color) {
        color = max(color, vec3(0));
        return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0));
    }

    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;

    #ifdef SHADING
        vec3 lc = texture2D(uTexture, vL).rgb;
        vec3 rc = texture2D(uTexture, vR).rgb;
        vec3 tc = texture2D(uTexture, vT).rgb;
        vec3 bc = texture2D(uTexture, vB).rgb;

        float dx = length(rc) - length(lc);
        float dy = length(tc) - length(bc);

        vec3 n = normalize(vec3(dx, dy, length(texelSize)));
        vec3 l = vec3(0.0, 0.0, 1.0);

        float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
        c *= diffuse;
    #endif

    #ifdef BLOOM
        vec3 bloom = texture2D(uBloom, vUv).rgb;
    #endif

    #ifdef SUNRAYS
        float sunrays = texture2D(uSunrays, vUv).r;
        c *= sunrays;
    #ifdef BLOOM
        bloom *= sunrays;
    #endif
    #endif

    #ifdef BLOOM
        // 抖动：给 bloom 加一点 ±1/255 的噪声再转 gamma，把大面积极淡色的色带打散。
        // 不加就是一圈一圈的同心色阶，在暗色页面上非常显眼。
        float noise = texture2D(uDithering, vUv * ditherScale).r;
        noise = noise * 2.0 - 1.0;
        bloom += noise / 255.0;
        bloom = linearToGamma(bloom);
        c += bloom;
    #endif

        float a = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c, a);
    }
`

/** bloom 第一步：软膝阈值。低于阈值的像素整块丢掉，阈值附近平滑过渡，避免硬边亮斑。 */
const BLOOM_PREFILTER_FRAGMENT_SHADER = `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec3 curve;
    uniform float threshold;

    void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        float br = max(c.r, max(c.g, c.b));
        float rq = clamp(br - curve.x, 0.0, curve.y);
        rq = curve.z * rq * rq;
        c *= max(rq, br - threshold) / max(br, 0.0001);
        gl_FragColor = vec4(c, 0.0);
    }
`

/** bloom 的模糊：四邻居取平均，一路降采样下去。 */
const BLOOM_BLUR_FRAGMENT_SHADER = `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;

    void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, vL);
        sum += texture2D(uTexture, vR);
        sum += texture2D(uTexture, vT);
        sum += texture2D(uTexture, vB);
        sum *= 0.25;
        gl_FragColor = sum;
    }
`

/** bloom 收尾：再模糊一次并乘强度，写回 bloom 主纹理。 */
const BLOOM_FINAL_FRAGMENT_SHADER = `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform float intensity;

    void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, vL);
        sum += texture2D(uTexture, vR);
        sum += texture2D(uTexture, vT);
        sum += texture2D(uTexture, vB);
        sum *= 0.25;
        gl_FragColor = sum * intensity;
    }
`

/** sunrays 第一步：把亮部翻成「遮挡掩码」存进 alpha —— 越亮的地方 alpha 越小。 */
const SUNRAYS_MASK_FRAGMENT_SHADER = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;

    void main () {
        vec4 c = texture2D(uTexture, vUv);
        float br = max(c.r, max(c.g, c.b));
        c.a = 1.0 - min(max(br * 20.0, 0.0), 0.8);
        gl_FragColor = c;
    }
`

/** sunrays 第二步：沿「像素 → 屏幕中心」的方向反向采样累加，得到径向光束。 */
const SUNRAYS_FRAGMENT_SHADER = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float weight;

    #define ITERATIONS 16

    void main () {
        float Density = 0.3;
        float Decay = 0.95;
        float Exposure = 0.7;

        vec2 coord = vUv;
        vec2 dir = vUv - 0.5;

        dir *= 1.0 / float(ITERATIONS) * Density;
        float illuminationDecay = 1.0;

        float color = texture2D(uTexture, vUv).a;

        for (int i = 0; i < ITERATIONS; i++)
        {
            coord -= dir;
            float col = texture2D(uTexture, coord).a;
            color += col * illuminationDecay * weight;
            illuminationDecay *= Decay;
        }

        gl_FragColor = vec4(color * Exposure, 0.0, 0.0, 1.0);
    }
`

/** 泼溅：一个高斯核，中心是 point，强度是 color，半径由 radius 控制。 */
const SPLAT_FRAGMENT_SHADER = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;

    void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
    }
`

/**
 * 平流：整个模拟里最核心的一步 —— 半拉格朗日法，沿速度场回溯「这一点上一帧在哪」，
 * 把那里的值搬过来。dt 被钳过上限，所以这一步无条件稳定（代价是精度，肉眼看不出来）。
 *
 * MANUAL_FILTERING 分支：GPU 不支持浮点纹理线性过滤时，退回手工四点双线性插值。
 * 显式双线性比双线性过滤慢，但总比整块画面糊成马赛克强。
 */
const ADVECTION_FRAGMENT_SHADER = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform vec2 dyeTexelSize;
    uniform float dt;
    uniform float dissipation;

    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5;

        vec2 iuv = floor(st);
        vec2 fuv = fract(st);

        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
        vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
        vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
        vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);

        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }

    void main () {
    #ifdef MANUAL_FILTERING
        vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
        vec4 result = bilerp(uSource, coord, dyeTexelSize);
    #else
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        vec4 result = texture2D(uSource, coord);
    #endif
        float decay = 1.0 + dissipation * dt;
        gl_FragColor = result / decay;
    }
`

/** 散度：速度场的「源」有多大，压力求解拿它当右端项。边界处做墙壁反射，否则流体会贴着边漏出去。 */
const DIVERGENCE_FRAGMENT_SHADER = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;

        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) { L = -C.x; }
        if (vR.x > 1.0) { R = -C.x; }
        if (vT.y > 1.0) { T = -C.y; }
        if (vB.y < 0.0) { B = -C.y; }

        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
`

/** 旋度：速度场的卷曲程度，给下一步的涡度约束当输入。 */
const CURL_FRAGMENT_SHADER = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }
`

/**
 * 涡度约束：数值耗散会把小漩涡磨平，这里按旋度梯度反推一个力补回去，
 * 让画面保持「墨汁搅开」的细节。这是纯视觉补偿，不是物理。
 */
const VORTICITY_FRAGMENT_SHADER = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;

    void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;

        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;

        vec2 vel = texture2D(uVelocity, vUv).xy;
        gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
    }
`

/** 压力求解的一次 Jacobi 迭代：邻域四点平均减去散度。迭代次数见 PRESSURE_ITERATIONS。 */
const PRESSURE_FRAGMENT_SHADER = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;

    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float C = texture2D(uPressure, vUv).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
`

/** 减掉压力梯度：压力求解的收尾，把速度场投影回无散度场。 */
const GRADIENT_SUBTRACT_FRAGMENT_SHADER = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`

/* -------------------------------------------------------------------------- */
/* 参数                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 帧率上限。
 *
 * 这里和另外四套 3D 背景的 30 帧不一样，是有意的：那几套是「慢慢转的星野」，
 * 30 帧看不出差别；流体要跟着指针走，拖动时 30 帧的顿挫感非常明显。
 * 代价靠画质档位（见 QUALITY_TIERS）补回来 —— 先让每帧足够便宜，再谈 60 帧。
 */
const DEFAULT_MAX_FPS = 60
/**
 * 限帧的判定容差（毫秒）。
 *
 * 必须留这个余量，否则会掉进「限 60 帧实际只有 30 帧」的坑：
 * rAF 的时间戳是 16.667ms 的整数倍，而 1000/60 = 16.6667，
 * 于是 `now - lastFrameAt`（16.667）会一直比 frameInterval 大上那么一丝，
 * 逐帧比较时又刚好卡在「小于」那一侧，结果每隔一帧就被丢掉一次。
 * 留 2ms 余量后，60Hz 上稳定 60 帧、120Hz 上稳定 60 帧、30Hz 上稳定 30 帧。
 */
const FRAME_INTERVAL_TOLERANCE = 2
/**
 * 每帧能推进的最长时间。
 *
 * 原版钳的是 1/60（等于「低帧率时画面慢放」）。放到 1/30 是为了让帧率掉下来时
 * 流体仍按接近真实的时间流动，而不是跟着一起变慢 —— 后者会让拖动的手感更黏。
 */
const MAX_DELTA = 1 / 30

/** 自动泼溅的间隔区间（秒）与每次注入的点数。 */
const AUTO_SPLAT_MIN_INTERVAL = 3.5
const AUTO_SPLAT_MAX_INTERVAL = 8
const AUTO_SPLAT_MIN_COUNT = 1
const AUTO_SPLAT_MAX_COUNT = 3
/**
 * 自动泼溅的力度，相对 SPLAT_FORCE 的比例。
 *
 * 调这个数就是在「画面够活」和「文字还能读」之间找平衡：原版那套 6000 的力度是给
 * 满屏演示用的，落在作品集背后会把卡片文字全淹掉。
 */
const AUTO_SPLAT_FORCE = 0.12

/**
 * 帧率撑不住时的判定门槛（秒）。
 *
 * 目标是 60 帧（16.7ms）。超过 26ms 就意味着实际只有 38 帧上下、每帧都在超预算，
 * 与其让它一直卡在中间，不如降一档画质换回流畅。
 * 门槛放宽到 26ms 而不是贴着 16.7ms，是为了不被偶发的一两帧抖动误判 ——
 * 采样窗口取的是平均值，本身就滤掉了个别尖峰。
 */
const TIER_DOWNGRADE_FRAME_TIME = 0.026
/** 每档画质采样多少帧后做一次判断。约等于 60 帧下的 1 秒。 */
const TIER_SAMPLE_FRAMES = 60

/** 画布底色。取首页深色底的起始色 #060b1c，流体在上面晕开时和页面其它部分是一条底色。 */
const BACK_COLOR = { r: 6, g: 11, b: 28 }

/** 抖动噪声图的边长。两处用到（生成、算平铺倍率），必须是同一个数。 */
const DITHER_TEXTURE_SIZE = 64

/**
 * 画质档位，索引越大越省。挂载后先按起始档跑，量到帧率撑不住就往下走一格。
 *
 * 只降不升：升档会让画面在两种档次之间来回跳，比一直待在低一档更难受。
 *
 * 三个数字各自管什么：
 *   - dyeResolution：平流和显示都要读它，是对帧率影响最大的一项。原版演示页默认 1024，
 *     那是「整屏只有流体」时该有的值；这里是衬在文字后面的背景，512 起看不出差别，
 *     省下来的是四倍的纹理带宽。
 *   - pixelRatio：显示着色器每帧要按屏幕分辨率采 7 次纹理（本体 + 四邻域 + 泛光 + 光束 + 抖动），
 *     降像素比是最直接的减负。流体本来就是软糊的介质，1.25 和 1.6 肉眼分不出来。
 *   - bloom / sunrays：两道好看但可以没有的后处理，最后一档全关。
 */
interface QualityTier {
  dyeResolution: number
  bloom: boolean
  bloomIterations: number
  bloomResolution: number
  sunrays: boolean
  pixelRatio: number
}

const QUALITY_TIERS: readonly QualityTier[] = [
  { dyeResolution: 512, bloom: true, bloomIterations: 6, bloomResolution: 192, sunrays: true, pixelRatio: 1.25 },
  { dyeResolution: 384, bloom: true, bloomIterations: 4, bloomResolution: 128, sunrays: false, pixelRatio: 1 },
  { dyeResolution: 256, bloom: false, bloomIterations: 0, bloomResolution: 128, sunrays: false, pixelRatio: 1 },
]

/* -------------------------------------------------------------------------- */
/* 类型                                                                        */
/* -------------------------------------------------------------------------- */

type GL = WebGLRenderingContext | WebGL2RenderingContext

interface RGB {
  r: number
  g: number
  b: number
}

interface ColorFormat {
  internalFormat: number
  format: number
}

interface GLExtensions {
  formatRGBA: ColorFormat
  formatRG: ColorFormat
  formatR: ColorFormat
  halfFloatTexType: number
  supportLinearFiltering: boolean
}

interface FBO {
  texture: WebGLTexture
  fbo: WebGLFramebuffer
  width: number
  height: number
  texelSizeX: number
  texelSizeY: number
  /** 把纹理绑到指定纹理单元并返回单元号，方便直接塞进 uniform1i */
  attach(id: number): number
}

interface DoubleFBO {
  width: number
  height: number
  texelSizeX: number
  texelSizeY: number
  read: FBO
  write: FBO
  swap(): void
}

export interface FluidBackgroundHandle {
  dispose(): void
}

export interface FluidMountOptions {
  maxFps?: number
  maxPixelRatio?: number
}

/* -------------------------------------------------------------------------- */
/* WebGL 低层封装                                                              */
/* -------------------------------------------------------------------------- */

function compileShader(gl: GL, type: number, source: string, keywords?: string[]): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('创建着色器失败')

  const header = keywords ? keywords.map((keyword) => `#define ${keyword}\n`).join('') : ''
  gl.shaderSource(shader, header + source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`着色器编译失败：${log ?? '未知原因'}`)
  }
  return shader
}

function createProgram(gl: GL, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('创建着色器程序失败')

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`着色器程序链接失败：${log ?? '未知原因'}`)
  }
  return program
}

/**
 * 一个着色器程序。
 *
 * 原版这里是一套 Material + 关键词哈希 + 程序缓存的机制，因为它要支持运行中改开关
 * （改一次就得重编译一组变体）。背景没有调参面板，关键词在初始化时定死，
 * 所以那套机制整个不需要 —— 每个程序建一次，用完删掉。
 */
class FluidProgram {
  private readonly gl: GL
  private readonly program: WebGLProgram
  readonly uniforms: Record<string, WebGLUniformLocation | null>

  constructor(gl: GL, vertexShader: WebGLShader, fragmentSource: string, keywords?: string[]) {
    this.gl = gl
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, keywords)
    this.program = createProgram(gl, vertexShader, fragmentShader)
    // 链接完成后片元着色器就可以丢了，程序已经持有它
    gl.deleteShader(fragmentShader)

    this.uniforms = {}
    const count = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS) as number
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(this.program, i)
      if (!info) continue
      this.uniforms[info.name] = gl.getUniformLocation(this.program, info.name)
    }
  }

  bind(): void {
    this.gl.useProgram(this.program)
  }

  dispose(): void {
    this.gl.deleteProgram(this.program)
  }
}

/** 试探某个 (internalFormat, format) 能不能挂到 FBO 上并渲染。 */
function supportRenderTextureFormat(
  gl: GL,
  internalFormat: number,
  format: number,
  type: number,
): boolean {
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null)

  const fbo = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)

  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.deleteFramebuffer(fbo)
  gl.deleteTexture(texture)
  return complete
}

/**
 * 从高精度格式往下试：R16F → RG16F → RGBA16F。
 *
 * 通道越少越省显存和带宽，但移动端 GPU 对单通道浮点纹理的可渲染性支持很参差，
 * 所以必须一级一级实测，而不是查表。
 */
function getSupportedFormat(gl: GL, internalFormat: number, format: number, type: number): ColorFormat | null {
  if (supportRenderTextureFormat(gl, internalFormat, format, type)) return { internalFormat, format }

  const gl2 = gl as WebGL2RenderingContext
  switch (internalFormat) {
    case gl2.R16F:
      return getSupportedFormat(gl, gl2.RG16F, gl2.RG, type)
    case gl2.RG16F:
      return getSupportedFormat(gl, gl2.RGBA16F, gl2.RGBA, type)
    default:
      return null
  }
}

/** 建上下文，并把「能用哪种浮点纹理 / 支不支持线性过滤」探明白。 */
function getWebGLContext(canvas: HTMLCanvasElement): { gl: GL; ext: GLExtensions } {
  const params: WebGLContextAttributes = {
    // 每帧都会用 BACK_COLOR 铺满整块画布，alpha 通道没有意义，关掉能省掉合成阶段的一次混合。
    // 代价是首帧之前画布是纯黑（CSS 上还有一层 0.7s 的淡入，看不出来）。
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false,
    preserveDrawingBuffer: false,
  }

  // 必须先探 webgl2 再退 webgl1：同一个 canvas 上 getContext 对不同类型只会成功一次，
  // 探失败的那次调用不会留下任何副作用，后面的回退才拿得到上下文
  const webgl2 = canvas.getContext('webgl2', params) as WebGL2RenderingContext | null
  const isWebGL2 = webgl2 !== null
  const gl: GL | null =
    webgl2 ??
    ((canvas.getContext('webgl', params) ||
      canvas.getContext('experimental-webgl', params)) as WebGLRenderingContext | null)
  if (!gl) throw new Error('WebGL 不可用')

  let halfFloatTexType: number
  let supportLinearFiltering: boolean

  if (isWebGL2) {
    // 没有这个扩展就不能渲染到浮点纹理，整套模拟都跑不起来
    const gl2 = gl as WebGL2RenderingContext
    gl2.getExtension('EXT_color_buffer_float')
    supportLinearFiltering = !!gl2.getExtension('OES_texture_float_linear')
    halfFloatTexType = gl2.HALF_FLOAT
  } else {
    const halfFloat = gl.getExtension('OES_texture_half_float')
    supportLinearFiltering = !!gl.getExtension('OES_texture_half_float_linear')
    if (!halfFloat) throw new Error('设备不支持半浮点纹理')
    halfFloatTexType = halfFloat.HALF_FLOAT_OES
  }

  gl.clearColor(0, 0, 0, 1)

  let formatRGBA: ColorFormat | null
  let formatRG: ColorFormat | null
  let formatR: ColorFormat | null

  if (isWebGL2) {
    const gl2 = gl as WebGL2RenderingContext
    formatRGBA = getSupportedFormat(gl, gl2.RGBA16F, gl2.RGBA, halfFloatTexType)
    formatRG = getSupportedFormat(gl, gl2.RG16F, gl2.RG, halfFloatTexType)
    formatR = getSupportedFormat(gl, gl2.R16F, gl2.RED, halfFloatTexType)
  } else {
    // WebGL1 只有 RGBA 一条路，三个格式全退化成同一个
    formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType)
    formatRG = formatRGBA
    formatR = formatRGBA
  }

  if (!formatRGBA) throw new Error('设备不支持渲染到浮点纹理')

  return {
    gl,
    ext: {
      formatRGBA,
      formatRG: formatRG ?? formatRGBA,
      formatR: formatR ?? formatRGBA,
      halfFloatTexType,
      supportLinearFiltering,
    },
  }
}

/* -------------------------------------------------------------------------- */
/* 杂项                                                                        */
/* -------------------------------------------------------------------------- */

function isMobileUA(): boolean {
  return /Mobi|Android/i.test(navigator.userAgent)
}

function HSVtoRGB(h: number, s: number, v: number): RGB {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)

  let r = v
  let g = v
  let b = v
  switch (i % 6) {
    case 0:
      r = v
      g = t
      b = p
      break
    case 1:
      r = q
      g = v
      b = p
      break
    case 2:
      r = p
      g = v
      b = t
      break
    case 3:
      r = p
      g = q
      b = v
      break
    case 4:
      r = t
      g = p
      b = v
      break
    default:
      r = v
      g = p
      b = q
      break
  }
  return { r, g, b }
}

/**
 * 随机染料颜色。
 *
 * 饱和度、亮度拉满再整体乘 0.15：直接输出 1.0 的颜色叠几层就过曝成一片白，
 * 0.15 是留出「同一个位置被反复泼溅」的余量。
 */
function generateColor(): RGB {
  const c = HSVtoRGB(Math.random(), 1, 1)
  c.r *= 0.15
  c.g *= 0.15
  c.b *= 0.15
  return c
}

function normalizeColor(input: RGB): RGB {
  return { r: input.r / 255, g: input.g / 255, b: input.b / 255 }
}

/**
 * 运行时生成一张噪声图，顶替原版外链的蓝噪声 PNG。
 *
 * 用途只有一个：给 bloom 做抖动，把大面积极暗区域的色带打散。
 * 白噪声的抖动效果略逊于蓝噪声，但省掉一个静态资源和一次异步加载 ——
 * 对背景来说这笔交换划算，而且它铺在 64×64 的重复纹理上，肉眼分辨不出来。
 * 只填红通道：显示着色器里只取 .r。
 */
function createNoiseTexture(gl: GL, size = DITHER_TEXTURE_SIZE): { texture: WebGLTexture; attach(id: number): number } {
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < data.length; i += 4) {
    const value = Math.floor(Math.random() * 256)
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
    data[i + 3] = 255
  }

  const texture = gl.createTexture()
  if (!texture) throw new Error('创建噪声纹理失败')

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  // REPEAT 是必须的：显示着色器按 ditherScale 平铺采样，不是拉伸
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)

  // 形状和 FBO 对齐，调用处才能和其它纹理一样直接 attach(id) 塞进 texture unit
  return {
    texture,
    attach(id: number) {
      gl.activeTexture(gl.TEXTURE0 + id)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      return id
    },
  }
}

/* -------------------------------------------------------------------------- */
/* 主入口                                                                      */
/* -------------------------------------------------------------------------- */

/** 用户指针状态。原版支持多指，背景用不上，只要一路主指针。 */
interface FluidPointer {
  texcoordX: number
  texcoordY: number
  prevTexcoordX: number
  prevTexcoordY: number
  deltaX: number
  deltaY: number
  down: boolean
  moved: boolean
  color: RGB
}

export function mountFluidBackground(
  canvas: HTMLCanvasElement,
  options: FluidMountOptions = {},
): FluidBackgroundHandle {
  const maxFps = options.maxFps ?? DEFAULT_MAX_FPS
  const frameInterval = maxFps > 0 ? 1000 / maxFps : 0
  /** 外部给的像素比上限，作为天花板；实际值再取档位里更严格的那个 */
  const pixelRatioCeiling = options.maxPixelRatio ?? Number.POSITIVE_INFINITY

  const { gl, ext } = getWebGLContext(canvas)

  /* -------------------- 参数 -------------------- */

  // 这里的 DYE_RESOLUTION / BLOOM* / SUNRAYS 只是初始值，落到第 0 档的数字上；
  // 挂载尾声的 applyTier 会用选中档位的值覆盖它们。
  const config = {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: QUALITY_TIERS[0].dyeResolution,
    DENSITY_DISSIPATION: 1,
    VELOCITY_DISSIPATION: 0.2,
    PRESSURE: 0.8,
    PRESSURE_ITERATIONS: 16,
    CURL: 30,
    SPLAT_RADIUS: 0.25,
    SPLAT_FORCE: 6000,
    // 伪 3D 光照依赖邻域采样，不支持线性过滤的 GPU 上会满屏颗粒，直接关掉
    SHADING: ext.supportLinearFiltering,
    BLOOM: QUALITY_TIERS[0].bloom,
    BLOOM_ITERATIONS: QUALITY_TIERS[0].bloomIterations,
    BLOOM_RESOLUTION: QUALITY_TIERS[0].bloomResolution,
    BLOOM_INTENSITY: 0.8,
    BLOOM_THRESHOLD: 0.6,
    BLOOM_SOFT_KNEE: 0.7,
    SUNRAYS: QUALITY_TIERS[0].sunrays,
    SUNRAYS_RESOLUTION: 160,
    SUNRAYS_WEIGHT: 1,
  }

  /**
   * 起始档位。
   *
   * 手机上直接从中档起步：移动 GPU 和桌面核显不是一个量级，先省下来比先好看重要。
   * 不支持线性过滤的老 GPU 则钉死在最低档 —— 泛光、光束全依赖平滑采样，留着只会更难看。
   */
  let tierIndex = ext.supportLinearFiltering ? (isMobileUA() ? 1 : 0) : QUALITY_TIERS.length - 1
  let pixelRatioCap = Math.min(pixelRatioCeiling, QUALITY_TIERS[tierIndex].pixelRatio)

  /* -------------------- 着色器程序 -------------------- */

  const baseVertexShader = compileShader(gl, gl.VERTEX_SHADER, BASE_VERTEX_SHADER)
  // 两个顶点着色器共用同一个 program，靠 gl.attachShader 分别挂各自的片元着色器
  const blurVertexShader = compileShader(gl, gl.VERTEX_SHADER, BLUR_VERTEX_SHADER)

  const blurProgram = new FluidProgram(gl, blurVertexShader, BLUR_FRAGMENT_SHADER)
  const copyProgram = new FluidProgram(gl, baseVertexShader, COPY_FRAGMENT_SHADER)
  const clearProgram = new FluidProgram(gl, baseVertexShader, CLEAR_FRAGMENT_SHADER)
  const colorProgram = new FluidProgram(gl, baseVertexShader, COLOR_FRAGMENT_SHADER)
  const bloomPrefilterProgram = new FluidProgram(gl, baseVertexShader, BLOOM_PREFILTER_FRAGMENT_SHADER)
  const bloomBlurProgram = new FluidProgram(gl, baseVertexShader, BLOOM_BLUR_FRAGMENT_SHADER)
  const bloomFinalProgram = new FluidProgram(gl, baseVertexShader, BLOOM_FINAL_FRAGMENT_SHADER)
  const sunraysMaskProgram = new FluidProgram(gl, baseVertexShader, SUNRAYS_MASK_FRAGMENT_SHADER)
  const sunraysProgram = new FluidProgram(gl, baseVertexShader, SUNRAYS_FRAGMENT_SHADER)
  const splatProgram = new FluidProgram(gl, baseVertexShader, SPLAT_FRAGMENT_SHADER)
  const divergenceProgram = new FluidProgram(gl, baseVertexShader, DIVERGENCE_FRAGMENT_SHADER)
  const curlProgram = new FluidProgram(gl, baseVertexShader, CURL_FRAGMENT_SHADER)
  const vorticityProgram = new FluidProgram(gl, baseVertexShader, VORTICITY_FRAGMENT_SHADER)
  const pressureProgram = new FluidProgram(gl, baseVertexShader, PRESSURE_FRAGMENT_SHADER)
  const gradientSubtractProgram = new FluidProgram(gl, baseVertexShader, GRADIENT_SUBTRACT_FRAGMENT_SHADER)

  const advectionKeywords = ext.supportLinearFiltering ? [] : ['MANUAL_FILTERING']
  const advectionProgram = new FluidProgram(gl, baseVertexShader, ADVECTION_FRAGMENT_SHADER, advectionKeywords)

  /**
   * 显示着色器的三个开关都是 #define，改一次就得换一个编译好的程序。
   *
   * 原版为此做了一整套 Material + 关键词哈希 + 程序缓存，因为它要在运行中反复开关。
   * 这里只有一个触发点（降档），换个程序再把旧的删掉就够了，那套机制不需要。
   */
  const buildDisplayProgram = () => {
    const keywords: string[] = []
    if (config.SHADING) keywords.push('SHADING')
    if (config.BLOOM) keywords.push('BLOOM')
    if (config.SUNRAYS) keywords.push('SUNRAYS')
    return new FluidProgram(gl, baseVertexShader, DISPLAY_FRAGMENT_SHADER, keywords)
  }

  /** 由 applyTier 在挂载尾声填上，在那之前 drawDisplay 不会被执行 */
  let displayProgram: FluidProgram | null = null

  /* -------------------- 全屏四边形 -------------------- */

  /**
   * 所有渲染都是一次「画满全屏的四边形」，所以顶点缓冲和顶点属性全局只配一次。
   * 属性槽固定用 0，着色器里 aPosition 是唯一的 attribute，链接时会被分到 0。
   */
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW)
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.enableVertexAttribArray(0)

  const blit = (destination: FBO | null) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination ? destination.fbo : null)
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
  }

  /* -------------------- FBO 管理 -------------------- */

  const ditheringTexture = createNoiseTexture(gl)

  let dye: DoubleFBO | null = null
  let velocity: DoubleFBO | null = null
  let divergence: FBO | null = null
  let curl: FBO | null = null
  let pressure: DoubleFBO | null = null
  let bloom: FBO | null = null
  let bloomFramebuffers: FBO[] = []
  let sunrays: FBO | null = null
  let sunraysTemp: FBO | null = null

  const createFBO = (
    w: number,
    h: number,
    internalFormat: number,
    format: number,
    type: number,
    param: number,
  ): FBO => {
    gl.activeTexture(gl.TEXTURE0)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null)

    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.viewport(0, 0, w, h)
    gl.clear(gl.COLOR_BUFFER_BIT)

    return {
      texture,
      fbo,
      width: w,
      height: h,
      texelSizeX: 1 / w,
      texelSizeY: 1 / h,
      attach(id: number) {
        gl.activeTexture(gl.TEXTURE0 + id)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        return id
      },
    }
  }

  const deleteFBO = (target: FBO | null) => {
    if (!target) return
    gl.deleteTexture(target.texture)
    gl.deleteFramebuffer(target.fbo)
  }

  const createDoubleFBO = (
    w: number,
    h: number,
    internalFormat: number,
    format: number,
    type: number,
    param: number,
  ): DoubleFBO => {
    let read = createFBO(w, h, internalFormat, format, type, param)
    let write = createFBO(w, h, internalFormat, format, type, param)
    return {
      width: w,
      height: h,
      texelSizeX: 1 / w,
      texelSizeY: 1 / h,
      get read() {
        return read
      },
      set read(value: FBO) {
        read = value
      },
      get write() {
        return write
      },
      set write(value: FBO) {
        write = value
      },
      swap() {
        const temp = read
        read = write
        write = temp
      },
    }
  }

  /**
   * 换尺寸时重建整套 FBO。
   *
   * 和原版最大的差别在这里：原版每次都直接建新的、旧的随手丢掉，演示页只在
   * 打开和改画质时各走一次，泄漏看不出来；背景会跟着窗口拖拽反复触发，
   * 所以每个被替换掉的 FBO 都显式删掉。
   */
  const resizeFBO = (
    target: FBO,
    w: number,
    h: number,
    internalFormat: number,
    format: number,
    type: number,
    param: number,
  ): FBO => {
    const next = createFBO(w, h, internalFormat, format, type, param)
    copyProgram.bind()
    gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0))
    gl.viewport(0, 0, w, h)
    blit(next)
    deleteFBO(target)
    return next
  }

  const resizeDoubleFBO = (
    target: DoubleFBO,
    w: number,
    h: number,
    internalFormat: number,
    format: number,
    type: number,
    param: number,
  ): DoubleFBO => {
    if (target.width === w && target.height === h) return target

    const nextRead = resizeFBO(target.read, w, h, internalFormat, format, type, param)
    const nextWrite = createFBO(w, h, internalFormat, format, type, param)
    deleteFBO(target.write)

    target.read = nextRead
    target.write = nextWrite
    target.width = w
    target.height = h
    target.texelSizeX = 1 / w
    target.texelSizeY = 1 / h
    return target
  }

  /**
   * 以绘制缓冲的宽高比为基准算纹理尺寸：短边等于 resolution，长边按比例放大。
   * 这样不同画幅下的「模拟精度」是一致的 —— 否则竖屏手机上横向就会糊掉。
   */
  const getResolution = (resolution: number) => {
    let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight
    if (aspectRatio < 1) aspectRatio = 1 / aspectRatio

    const min = Math.round(resolution)
    const max = Math.round(resolution * aspectRatio)

    if (gl.drawingBufferWidth > gl.drawingBufferHeight) return { width: max, height: min }
    return { width: min, height: max }
  }

  const initBloomFramebuffers = () => {
    bloomFramebuffers.forEach(deleteFBO)
    bloomFramebuffers = []
    deleteFBO(bloom)

    const res = getResolution(config.BLOOM_RESOLUTION)
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST
    const rgba = ext.formatRGBA

    bloom = createFBO(res.width, res.height, rgba.internalFormat, rgba.format, ext.halfFloatTexType, filtering)

    for (let i = 0; i < config.BLOOM_ITERATIONS; i++) {
      const width = res.width >> (i + 1)
      const height = res.height >> (i + 1)
      // 降采样到小于 2px 就没意义了，再往下只会白占一张纹理
      if (width < 2 || height < 2) break
      bloomFramebuffers.push(
        createFBO(width, height, rgba.internalFormat, rgba.format, ext.halfFloatTexType, filtering),
      )
    }
  }

  const initSunraysFramebuffers = () => {
    deleteFBO(sunrays)
    deleteFBO(sunraysTemp)

    const res = getResolution(config.SUNRAYS_RESOLUTION)
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST
    const r = ext.formatR

    sunrays = createFBO(res.width, res.height, r.internalFormat, r.format, ext.halfFloatTexType, filtering)
    sunraysTemp = createFBO(res.width, res.height, r.internalFormat, r.format, ext.halfFloatTexType, filtering)
  }

  const initFramebuffers = () => {
    const simRes = getResolution(config.SIM_RESOLUTION)
    const dyeRes = getResolution(config.DYE_RESOLUTION)

    const texType = ext.halfFloatTexType
    const rgba = ext.formatRGBA
    const rg = ext.formatRG
    const r = ext.formatR
    // 速度场和染料场必须能线性插值（平流靠它做回溯采样），其余单通道场一律 NEAREST 省带宽
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST

    dye = dye
      ? resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering)
      : createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering)

    velocity = velocity
      ? resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)
      : createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)

    deleteFBO(divergence)
    deleteFBO(curl)
    divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST)
    curl = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST)

    pressure = pressure
      ? resizeDoubleFBO(pressure, simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST)
      : createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST)

    initBloomFramebuffers()
    initSunraysFramebuffers()
  }

  /* -------------------- 画布尺寸 -------------------- */

  const resizeCanvas = (): boolean => {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, pixelRatioCap)
    const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio))
    const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio))
    if (canvas.width === width && canvas.height === height) return false

    canvas.width = width
    canvas.height = height
    return true
  }

  const getAspectRatio = () => canvas.clientWidth / Math.max(1, canvas.clientHeight)

  /**
   * 切到某一档画质：改掉数字和开关，然后重建显示程序与整套 FBO。
   *
   * 三步的顺序不能反：显示程序要先按新的 BLOOM / SUNRAYS 重新编译，
   * 画布要先按新的像素比重新定尺寸，最后重建 FBO —— 因为纹理分辨率是照着
   * drawingBuffer 算出来的，尺寸没更新的话 DYE_RESOLUTION 的改动落不到实处。
   */
  const applyTier = (index: number) => {
    const tier = QUALITY_TIERS[index]
    tierIndex = index
    config.DYE_RESOLUTION = tier.dyeResolution
    config.BLOOM = tier.bloom
    config.BLOOM_ITERATIONS = tier.bloomIterations
    config.BLOOM_RESOLUTION = tier.bloomResolution
    config.SUNRAYS = tier.sunrays
    pixelRatioCap = Math.min(pixelRatioCeiling, tier.pixelRatio)

    const nextDisplayProgram = buildDisplayProgram()
    displayProgram?.dispose()
    displayProgram = nextDisplayProgram

    resizeCanvas()
    initFramebuffers()
  }

  /* -------------------- 输入 -------------------- */

  const pointer: FluidPointer = {
    texcoordX: 0,
    texcoordY: 0,
    prevTexcoordX: 0,
    prevTexcoordY: 0,
    deltaX: 0,
    deltaY: 0,
    down: false,
    moved: false,
    color: generateColor(),
  }

  /** 指针位移要做宽高比修正，否则横向和纵向的「手感」不一样：屏幕上同样是 100px，横向在纹理坐标里更短。 */
  const correctDeltaX = (delta: number) => {
    const aspectRatio = getAspectRatio()
    return aspectRatio < 1 ? delta * aspectRatio : delta
  }

  const correctDeltaY = (delta: number) => {
    const aspectRatio = getAspectRatio()
    return aspectRatio > 1 ? delta / aspectRatio : delta
  }

  /** 同理，横屏时半径要横向拉长，落在屏幕上才是正圆。 */
  const correctRadius = (radius: number) => {
    const aspectRatio = getAspectRatio()
    return aspectRatio > 1 ? radius * aspectRatio : radius
  }

  const updatePointerDownData = (event: PointerEvent) => {
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    // uv 的 y 轴和屏幕相反：纹理坐标原点在左下
    pointer.texcoordX = event.clientX / width
    pointer.texcoordY = 1 - event.clientY / height
    pointer.prevTexcoordX = pointer.texcoordX
    pointer.prevTexcoordY = pointer.texcoordY
    pointer.deltaX = 0
    pointer.deltaY = 0
    pointer.down = true
    pointer.moved = false
    pointer.color = generateColor()
  }

  const updatePointerMoveData = (event: PointerEvent) => {
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    pointer.prevTexcoordX = pointer.texcoordX
    pointer.prevTexcoordY = pointer.texcoordY
    pointer.texcoordX = event.clientX / width
    pointer.texcoordY = 1 - event.clientY / height
    pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX)
    pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY)
    pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0
  }

  /*
   * 事件挂在 window 上而不是 canvas 上：canvas 是 pointer-events: none 的装饰层，
   * 收不到任何事件。挂在 window 上也意味着指针划过卡片、链接时照样能搅动流体 ——
   * 这正是想要的「背景在响应你」，但因此绝不能 preventDefault，
   * 那会顺手废掉文本选中和链接点击。
   */
  const onPointerDown = (event: PointerEvent) => {
    // 只认主指针 + 左键，右键菜单和中键不参与
    if (!event.isPrimary || event.button !== 0) return
    updatePointerDownData(event)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!pointer.down || !event.isPrimary) return
    updatePointerMoveData(event)
  }

  const onPointerUp = () => {
    pointer.down = false
  }

  /* -------------------- 模拟 -------------------- */

  const splat = (x: number, y: number, dx: number, dy: number, color: RGB) => {
    if (!velocity || !dye) return

    gl.viewport(0, 0, velocity.width, velocity.height)
    splatProgram.bind()
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0))
    gl.uniform1f(splatProgram.uniforms.aspectRatio, getAspectRatio())
    gl.uniform2f(splatProgram.uniforms.point, x, y)
    // 速度的 splat 里 color 通道装的是 x/y 方向的冲量，第三位补 0（速度场只有两个分量）
    gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0)
    gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100))
    blit(velocity.write)
    velocity.swap()

    gl.viewport(0, 0, dye.width, dye.height)
    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0))
    gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b)
    blit(dye.write)
    dye.swap()
  }

  const splatPointer = () => {
    splat(
      pointer.texcoordX,
      pointer.texcoordY,
      pointer.deltaX * config.SPLAT_FORCE,
      pointer.deltaY * config.SPLAT_FORCE,
      pointer.color,
    )
  }

  /**
   * 随机泼溅一批。
   *
   * forceScale 是这次移植加的：原版只有「满力」一种，用在演示页很爽，
   * 当作背景则会把整屏打成一片彩色。自动泼溅按 0.12 的力度走。
   */
  const multipleSplats = (amount: number, forceScale = 1) => {
    for (let i = 0; i < amount; i++) {
      const color = generateColor()
      // 一次性泼溅要比连续拖拽亮一个数量级才看得见，所以乘 10
      color.r *= 10
      color.g *= 10
      color.b *= 10
      const x = Math.random()
      const y = Math.random()
      const dx = 1000 * (Math.random() - 0.5) * forceScale
      const dy = 1000 * (Math.random() - 0.5) * forceScale
      splat(x, y, dx, dy, color)
    }
  }

  const step = (dt: number) => {
    if (!velocity || !dye || !divergence || !curl || !pressure) return

    gl.disable(gl.BLEND)
    gl.viewport(0, 0, velocity.width, velocity.height)

    curlProgram.bind()
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0))
    blit(curl)

    vorticityProgram.bind()
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0))
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1))
    gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL)
    gl.uniform1f(vorticityProgram.uniforms.dt, dt)
    blit(velocity.write)
    velocity.swap()

    divergenceProgram.bind()
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0))
    blit(divergence)

    clearProgram.bind()
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0))
    gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE)
    blit(pressure.write)
    pressure.swap()

    // 压力求解：迭代次数越多越接近真实的无散度场，20 次是画质和开销的常见折中
    pressureProgram.bind()
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0))
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1))
      blit(pressure.write)
      pressure.swap()
    }

    gradientSubtractProgram.bind()
    gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0))
    gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1))
    blit(velocity.write)
    velocity.swap()

    // 速度场平流：自己带着自己走
    advectionProgram.bind()
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    if (!ext.supportLinearFiltering) {
      gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY)
    }
    const velocityId = velocity.read.attach(0)
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId)
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId)
    gl.uniform1f(advectionProgram.uniforms.dt, dt)
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION)
    blit(velocity.write)
    velocity.swap()

    // 染料场平流：被速度场带着走。分辨率不同，viewport 和 texelSize 都要换一套
    gl.viewport(0, 0, dye.width, dye.height)
    if (!ext.supportLinearFiltering) {
      gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY)
    }
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0))
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1))
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION)
    blit(dye.write)
    dye.swap()
  }

  /* -------------------- 后处理 -------------------- */

  const blur = (target: FBO, temp: FBO, iterations: number) => {
    blurProgram.bind()
    for (let i = 0; i < iterations; i++) {
      gl.uniform2f(blurProgram.uniforms.texelSize, target.texelSizeX, 0)
      gl.uniform1i(blurProgram.uniforms.uTexture, target.attach(0))
      blit(temp)

      gl.uniform2f(blurProgram.uniforms.texelSize, 0, target.texelSizeY)
      gl.uniform1i(blurProgram.uniforms.uTexture, temp.attach(0))
      blit(target)
    }
  }

  const applyBloom = (source: FBO, destination: FBO) => {
    if (bloomFramebuffers.length < 2) return

    let last = destination

    gl.disable(gl.BLEND)
    bloomPrefilterProgram.bind()
    const knee = config.BLOOM_THRESHOLD * config.BLOOM_SOFT_KNEE + 0.0001
    gl.uniform3f(bloomPrefilterProgram.uniforms.curve, config.BLOOM_THRESHOLD - knee, knee * 2, 0.25 / knee)
    gl.uniform1f(bloomPrefilterProgram.uniforms.threshold, config.BLOOM_THRESHOLD)
    gl.uniform1i(bloomPrefilterProgram.uniforms.uTexture, source.attach(0))
    gl.viewport(0, 0, last.width, last.height)
    blit(last)

    // 正向：一路降采样模糊下去
    bloomBlurProgram.bind()
    for (const dest of bloomFramebuffers) {
      gl.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY)
      gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0))
      gl.viewport(0, 0, dest.width, dest.height)
      blit(dest)
      last = dest
    }

    // 反向：把模糊结果逐级叠回去，得到跨度很大的柔和光晕
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.enable(gl.BLEND)
    for (let i = bloomFramebuffers.length - 2; i >= 0; i--) {
      const baseTex = bloomFramebuffers[i]
      gl.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY)
      gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0))
      gl.viewport(0, 0, baseTex.width, baseTex.height)
      blit(baseTex)
      last = baseTex
    }

    gl.disable(gl.BLEND)
    bloomFinalProgram.bind()
    gl.uniform2f(bloomFinalProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY)
    gl.uniform1i(bloomFinalProgram.uniforms.uTexture, last.attach(0))
    gl.uniform1f(bloomFinalProgram.uniforms.intensity, config.BLOOM_INTENSITY)
    gl.viewport(0, 0, destination.width, destination.height)
    blit(destination)
  }

  const applySunrays = (source: FBO, mask: FBO, destination: FBO) => {
    gl.disable(gl.BLEND)
    sunraysMaskProgram.bind()
    gl.uniform1i(sunraysMaskProgram.uniforms.uTexture, source.attach(0))
    gl.viewport(0, 0, mask.width, mask.height)
    blit(mask)

    sunraysProgram.bind()
    gl.uniform1f(sunraysProgram.uniforms.weight, config.SUNRAYS_WEIGHT)
    gl.uniform1i(sunraysProgram.uniforms.uTexture, mask.attach(0))
    gl.viewport(0, 0, destination.width, destination.height)
    blit(destination)
  }

  const drawColor = (color: RGB) => {
    colorProgram.bind()
    gl.uniform4f(colorProgram.uniforms.color, color.r, color.g, color.b, 1)
    blit(null)
  }

  const drawDisplay = (width: number, height: number) => {
    // 关掉泛光/光束时那几张纹理仍然存在（都是很小的尺寸），用不用只看开关
    if (!displayProgram || !dye || !bloom || !sunrays) return

    displayProgram.bind()
    if (config.SHADING) {
      gl.uniform2f(displayProgram.uniforms.texelSize, 1 / width, 1 / height)
    }
    gl.uniform1i(displayProgram.uniforms.uTexture, dye.read.attach(0))
    if (config.BLOOM) {
      gl.uniform1i(displayProgram.uniforms.uBloom, bloom.attach(1))
      gl.uniform1i(displayProgram.uniforms.uDithering, ditheringTexture.attach(2))
      gl.uniform2f(
        displayProgram.uniforms.ditherScale,
        width / DITHER_TEXTURE_SIZE,
        height / DITHER_TEXTURE_SIZE,
      )
    }
    if (config.SUNRAYS) {
      gl.uniform1i(displayProgram.uniforms.uSunrays, sunrays.attach(3))
    }
    blit(null)
  }

  const render = () => {
    if (!dye || !bloom || !sunrays || !sunraysTemp) return

    // 泛光和光束都把 dye 当输入、写到别的纹理上，所以必须在 step 之后、显示之前跑
    if (config.BLOOM) applyBloom(dye.read, bloom)
    if (config.SUNRAYS) {
      applySunrays(dye.read, dye.write, sunrays)
      blur(sunrays, sunraysTemp, 1)
    }

    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.BLEND)

    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    gl.viewport(0, 0, width, height)

    drawColor(normalizeColor(BACK_COLOR))
    drawDisplay(width, height)
  }

  /* -------------------- 主循环 -------------------- */

  let autoSplatTimer = AUTO_SPLAT_MIN_INTERVAL * Math.random() + 1.5
  let lastFrameAt = 0
  let rafId = 0
  let disposed = false

  /**
   * 无人操作时按随机间隔补一次泼溅。
   *
   * 没有这一步会很难看：染料耗散设成 1，静止约两秒后整屏就退化成一片纯黑，
   * 背景等于没有。力度压到 0.12，让它是「远处有东西在缓慢流动」而不是「一直有人在戳屏幕」。
   */
  const updateAmbient = (dt: number) => {
    autoSplatTimer -= dt
    if (autoSplatTimer > 0) return

    autoSplatTimer = AUTO_SPLAT_MIN_INTERVAL + Math.random() * (AUTO_SPLAT_MAX_INTERVAL - AUTO_SPLAT_MIN_INTERVAL)
    const count =
      AUTO_SPLAT_MIN_COUNT + Math.floor(Math.random() * (AUTO_SPLAT_MAX_COUNT - AUTO_SPLAT_MIN_COUNT + 1))
    multipleSplats(count, AUTO_SPLAT_FORCE)
  }

  let sampleCount = 0
  let sampleSum = 0
  let tierSettled = false

  /**
   * 量若干个真实帧间隔，超预算就降一档画质。
   *
   * 为什么要有这个：流体的开销和 GPU 强相关，同一套参数在独显上 60 帧、
   * 在老核显上可能只有 15 帧。静态参数只能在「都跑得动」和「都好看」之间二选一，
   * 而背景是要发给别人看的，所以让它在低端机上自己退一步。
   *
   * 只降不升，且降完继续量（最多降到最后一档）——目标是「能流畅跑」，不是「尽量用高画质」。
   */
  const sampleFrameTime = (rawDelta: number) => {
    if (tierSettled || !rawDelta) return

    sampleCount++
    sampleSum += rawDelta
    if (sampleCount < TIER_SAMPLE_FRAMES) return

    const average = sampleSum / sampleCount
    sampleCount = 0
    sampleSum = 0

    if (average > TIER_DOWNGRADE_FRAME_TIME && tierIndex < QUALITY_TIERS.length - 1) {
      applyTier(tierIndex + 1)
      return
    }
    // 已经跑得动，或已经到底了：不再量
    tierSettled = true
  }

  const frame = (now: number) => {
    rafId = requestAnimationFrame(frame)

    // 限帧：不足一帧的间隔跳过渲染，但调度不停，时间轴保持连续。
    // 那个容差是必须的，原因见 FRAME_INTERVAL_TOLERANCE。
    if (lastFrameAt && frameInterval && now - lastFrameAt < frameInterval - FRAME_INTERVAL_TOLERANCE) return

    const rawDelta = lastFrameAt ? (now - lastFrameAt) / 1000 : 0
    const dt = lastFrameAt ? Math.min(rawDelta, MAX_DELTA) : MAX_DELTA
    lastFrameAt = now

    updateAmbient(dt)
    if (pointer.moved) {
      pointer.moved = false
      splatPointer()
    }
    step(dt)
    render()

    sampleFrameTime(rawDelta)
    /*
     * 画布尺寸不在这里量。
     * 读 clientWidth 会强制一次布局计算，而这一层是 fixed inset:0，尺寸只可能
     * 因为窗口变化而变 —— 交给下面的 ResizeObserver 就够了，没必要每帧问一次 DOM。
     */
  }

  const start = () => {
    if (rafId || disposed) return
    // 重置基准时间，否则恢复后的第一帧会算出一个巨大的 dt
    lastFrameAt = 0
    rafId = requestAnimationFrame(frame)
  }

  const stop = () => {
    if (!rafId) return
    cancelAnimationFrame(rafId)
    rafId = 0
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') stop()
    else start()
  }

  const onContextLost = (event: Event) => {
    // 不 preventDefault 浏览器不会尝试恢复；这里主动停掉，免得控制台一直刷错误
    event.preventDefault()
    stop()
  }

  /* -------------------- 启动 -------------------- */

  // applyTier 里会依次做：重建显示程序 → 定画布尺寸 → 建整套 FBO。
  // 尺寸必须在建 FBO 之前定好，因为所有纹理分辨率都是照着 drawingBuffer 的宽高比算的。
  applyTier(tierIndex)
  // 开局先来一批：不然头几秒画面是全黑的
  multipleSplats(5 + Math.floor(Math.random() * 6))

  window.addEventListener('pointerdown', onPointerDown, { passive: true })
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerup', onPointerUp, { passive: true })
  window.addEventListener('pointercancel', onPointerUp, { passive: true })
  document.addEventListener('visibilitychange', onVisibilityChange)
  canvas.addEventListener('webglcontextlost', onContextLost)

  const resizeObserver = new ResizeObserver(() => {
    if (resizeCanvas()) initFramebuffers()
  })
  resizeObserver.observe(canvas)

  if (document.visibilityState !== 'hidden') start()

  return {
    dispose() {
      if (disposed) return
      disposed = true
      stop()

      resizeObserver.disconnect()
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      canvas.removeEventListener('webglcontextlost', onContextLost)

      deleteFBO(dye?.read ?? null)
      deleteFBO(dye?.write ?? null)
      deleteFBO(velocity?.read ?? null)
      deleteFBO(velocity?.write ?? null)
      deleteFBO(divergence)
      deleteFBO(curl)
      deleteFBO(pressure?.read ?? null)
      deleteFBO(pressure?.write ?? null)
      deleteFBO(bloom)
      bloomFramebuffers.forEach(deleteFBO)
      bloomFramebuffers = []
      deleteFBO(sunrays)
      deleteFBO(sunraysTemp)

      dye = null
      velocity = null
      divergence = null
      curl = null
      pressure = null
      bloom = null
      sunrays = null
      sunraysTemp = null

      gl.deleteTexture(ditheringTexture.texture)

      ;[
        blurProgram,
        copyProgram,
        clearProgram,
        colorProgram,
        bloomPrefilterProgram,
        bloomBlurProgram,
        bloomFinalProgram,
        sunraysMaskProgram,
        sunraysProgram,
        splatProgram,
        divergenceProgram,
        curlProgram,
        vorticityProgram,
        pressureProgram,
        gradientSubtractProgram,
        advectionProgram,
      ].forEach((program) => program.dispose())

      // 显示程序会因为降档被换掉，当前这个单独回收（applyTier 里已经删过它替换掉的那些）
      displayProgram?.dispose()
      displayProgram = null

      gl.deleteShader(baseVertexShader)
      gl.deleteShader(blurVertexShader)

      // 主动丢上下文，让浏览器尽快回收显存。丢过上下文的 canvas 不能再用来建新的
      // WebGL 上下文（规范规定 getContext 永远返回首次创建的那个），
      // 所以 HomeBackground.tsx 每次挂载都换一个新 canvas 元素，两处配套，别单独删。
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
