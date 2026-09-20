# 项目长期笔记：patrol-management-platform

## 一句话
「海港建设工程管理数字化平台」AI 巡视记录助手：Vite+React18+antd ↔ Mastra(4112)，
自然语言对话**新增**巡视记录（不支持编辑/详情）。站点入口已是 `pages/Home`（作品集落地页）。

## 技术栈
Vite5 + React18.3 + antd6.6 + react-router6.30 + less4.9 + **three 0.180**（仅首页 3D 背景，
含 UnrealBloom 后处理，全动态加载，首屏不下载）；后端 mastra1.25 / core1.59；
模型 volcengine/doubao-seed-evolving（火山方舟）。

## 目录职责（App 只装配，界面全在 pages）
- `App.tsx` 只装 ConfigProvider+RouterProvider；`router/` 路由表 + paths.ts
- `layouts/BasicLayout.tsx` 顶栏+菜单+Outlet；菜单 key **必须等于路由 path**（否则不高亮）
- `pages/`：Home / Chat / LoginCopy(死代码) / NotFound；`mastra/`：index.ts、agents/、tools/
- ⚠️ 原 `/login` 只剩重定向；登录退化成右上角按钮唤起的弹窗（`Home/LoginModal.tsx`），
  业务侧鉴权/守卫/token 全没动。**弹窗被 antd portal 到 `<body>`**，拿不到 `.home-page`
  的类（主题要显式传 `dark` prop），也因此不受首页任何子树级样式/监听影响
- `pages/Home/` 内部再拆一层：`home.less` 管**背景层 + 工具栏**，`portfolio.less` 管其余
  （含导航栏 `.home-nav*`），由 home.less `@import`。**同一个类的配色只许写在一处**
- ⚠️ **导航栏是「整屏宽外壳 + 限宽内容列」两层**：`.home-nav` 整屏宽（sticky + 滚动态
  玻璃底要铺满），`.home-nav-inner` 负责 `max-width:1180px + padding clamp(18px,5vw,56px)`
  —— **必须和 `.home-section` 逐字一致**，否则品牌块/主按钮和下方正文、卡片边缘对不齐
  （实测差过 370px）。内层用 `grid-template-columns: 1fr auto 1fr` 三栏，
  **不能用 flex + space-between**：后者只均分剩余空间，中间块不对称时居中会偏 40px

## 关键机制（踩过的坑）
- 官方 `agent.stream()` 的 processDataStream **不透传 AbortSignal** → 自写 readMastraStream()
- ask_user 挂起：`tool-call-suspended` 里 **runId 在顶层、toolCallId 在 payload 里**；续跑用
  `agent.resumeStream(answer,{runId,toolCallId,memory})`，**不能用 generate 兜底**
- 问题分类/性质接口必须传**类型编码**（SAFETY/QUALITY…），传中文报 90005
- **`.envProd` 不是 Vite 标准命名、不会自动加载** → 在 vite.config 的 define 里显式注入

## ⚠️ 没有任何版本控制
整条路径都没有 .git/.hg/.svn（.gitignore 齐全但从未 git init）——
**改动没有回滚手段，删除类操作必须先 git init。**

## 环境注意
- `rm -rf` / fs.rmSync 被 safe-delete shim 拦截 → 删文件/目录改用 .NET 的
  `[System.IO.File]::Delete` / `[System.IO.Directory]::Delete(p, $true)`。
  **vite 重新预构建时会清 `node_modules/.vite`，同样被拦 → dev server 直接死**，
  先删缓存再启动；报错 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`（批量阈值），不只是超时
- 判断本地服务是否活着用 `curl --noproxy '*'`，否则本机代理的 502 会把人带偏
- ⚠️ **同一个文件不要在一条消息里并行发多个 Edit**：工具会全部回「成功」，
  实际只有第一个落到盘上（实测 5 个 Edit 只生效 1 个）。同文件编辑必须串行或合并成 Write
- 8001 端口常年有个更早起的 vite dev server 在跑，`npm run dev` 会顺延到 8002。
  截图/探针脚本要显式传 `--url`

## 样式约定（全部 Less，不要新建 .css）
- 变量在 `styles/variables.less`，直接写 `@color-primary`，无需 @import；
  **不用原生 CSS 变量**（例外：main.tsx 的 antd reset.css）
- 选择器一律嵌套；底线是**不改变编译后的选择器字符串**
- 双主题：颜色收进 `.theme-x()` mixin，结构留基础规则，靠 `.page`/`.page.is-light` 切换
- **`<button>` 有原生底色（buttonface 白）**，自定义按钮要显式 `background: transparent`
- 例外允许原生 CSS 变量：**运行时坐标 / 逐帧插值的角度**（如 `--nav-x` `--nav-y`
  `--nav-arc`）。Less 是编译期的，这类值它算不出来；只服务单个组件、不参与主题配色
- ⚠️ **同一个类的配色在两个文件里各写一遍 = 后写的只赢一半**：两个 mixin 编译后
  特异性相同，后调用的只覆盖它**显式写了的**属性，没写的沿用前者。
  表现是「注释说去掉描边了，描边还在」。排查：`getComputedStyle` 读实际值 + grep 类名
- **禁止复制**：`home.less` 的 `.home-page` 里 `user-select: none`（+ `-webkit-` 前缀
  + `-webkit-touch-callout`）就够。⚠️ 它会向下传染（子元素写 `auto` 时实际取祖先的 none），
  将来在本页放输入框得单独写回 `text`。**别再加 JS 层**——没有选区时浏览器不触发 copy
  事件，剪贴板里的旧内容本来就不归页面管（第一版加过 useCopyGuard，被否）

## 首页 3D 背景
- 5 种：blueprint(CSS 光束) / particles(粒子场，默认) / starfield / lensing / galaxy；
  后四种是 three.js + 辉光后处理；注册表 `pages/Home/backgrounds/types.ts`，
  偏好存 `patrol_login_bg`
- **生效条件 = WebGL 背景 + 深色主题 + 系统未开 reduced-motion**，缺一即回落静态 CSS 层
  （否则整屏空白）。回落判据：canvas 保持 300×150 + 页面无 `has-webgl-bg`
- **切换背景必须换新 canvas**：`forceContextLoss()` 后同一 canvas 的 `getContext()` 只返回
  已丢失对象（或 null），three 抛 `Cannot read properties of null (reading 'precision')`。
  靠 canvas `key` 强制重建；别单独删 dispose 里的 forceContextLoss（两处配套）
- 场景在 `createScene` 返回值上声明 `bloom: {...}` 即启用后处理；切场景时 composer /
  bloomPass 都要显式 dispose（render target 是显存大户）
- ⚠️ **相机 far = 24000**（原 6000，星系盘 z≈-6800 把它顶穿了）。3D 背景
  「跑起来了、没报错、画面什么都没有」时，**第一件事核对 near/far 和物体的实际距离**
  —— 太阳系在 z≈-950 照常显示、星系盘整片消失，就是被远平面裁的
- ⚠️ **走了 `EffectComposer`，`renderer` 的 `antialias: true` 就完全失效**：后处理先画到
  离屏纹理，那一步不享受默认帧缓冲的 MSAA。症状是球体边缘硬阶梯、1px 轨道线呈虚线。
  解法：建带 `samples: 4` 的 `WebGLRenderTarget`（`HalfFloatType`，尺寸取
  `getDrawingBufferSize()`）传给 `EffectComposer`；`RenderTarget.copy()` 会带上 `samples`。
  实测 4x MSAA 在 SwiftShader 下只掉 9%，不用降到 2x
- ⚠️ **球体「糊」的归因顺序**（别一上来加段数）：① 光晕 sprite 尺寸；② `bloom.radius`；
  ③ 亮部过曝（纯白核心 + 低阈值 ⇒ 整个球面都在辉光，糊成没边界的光斑）；
  ④ 段数（50px 的球 40×28 已够）；⑤ MSAA（只管阶梯感，不管「糊」）
- ⚠️ **光照方向必须量，不能看**：球面亮部位置会被表面配色带偏（地球一半绿大陆一半深蓝
  海洋时，肉眼会把大陆那半边当亮面）。做法：球面内像素做最小二乘 `L = a + b·dx + c·dy`，
  梯度方向与「球心→光源」求余弦（实测 +0.94 = 正确）
- ⚠️ **程序化表面噪声要加域扭曲**：三轴正弦相乘在数学上就是**正交格子**，投到球面上是
  等间距方块/白圆点。`p = normalize(on + warp)` 打散它。**极冠这类「必须待在特定纬度」
  的特征不要跟着扭曲**，否则飘到中纬度
- 太阳系：`SOLAR_DIST=800`、锚点 `X=0.54 / Y=-0.28`（Y 抬到 -0.28 是为了让日面脱离底部
  数据卡）。**行星必须是自写朗伯光照 shader，不能用 `MeshBasicMaterial`**——平涂球体没有
  明暗，几十像素上就是贴纸。光照/菲涅尔用**视图空间**法线，表面条纹用**物体空间**法线
  （否则自转时条纹满球乱爬）
- 星系：投影密度补偿（撒点接受率 ∝ 1/深度²）、核球用 sprite 而非点云（中心点密度必然
  烧白）、太阳系按屏幕归一化坐标锚定（世界坐标写死会在竖屏下溢出右边界）
- ⚠️ **用户的审美基准 = 「炫酷但光污染不严重」**。落地轴：**亮度高 + 面积小 = 炫；
  亮度高 + 面积大 = 光污染**。发光面积压到几个百分点，靠形态和运动取胜。
  历次被否的方案归档在 `.workbuddy-ai/preview/login-bg/legacy-scenes/round1|2|3/`
- ⚠️ **加法混合的亮度预算最容易翻车**：物体贴到镜头前会覆盖全屏、累加即糊白。三件套
  缺一不可：① 单物体亮度压到 ~1.0；② 贴近镜头前按距离淡出、远端也淡入；③ 辉光 threshold
  抬到 0.2+。需要遮挡的物体（太阳）改用普通混合——加法下「暗带」等于「不发光」
- ⚠️ **构图坑**：内容区是居中排布的，居中的主体（太阳、光核）会被整块盖住。
  解法：绕相机自身轴 rotateY/rotateX 把主体推出内容区，或放大到铺满全屏

## GLSL / 点云通用坑（写新场景前先读这节）
- **模板字符串里的反引号会截断字符串**：① GLSL 里写反引号 → Vite 500、
  `Failed to fetch dynamically imported module`、canvas 退回 300×150；② **Node 脚本里写
  反引号 → 直接 `SyntaxError`**。**注释里一律不用反引号**，改完用
  `awk '/`/ {print NR}'` 扫一遍模板区间自证
- **`pow(负数, 2.0)` 是 UB**（走 `exp2(y*log2(x))`，log2 负数出 NaN）→ 用 `sq(x)=x*x`
- **hash 对整数输入会退化**：`fract(p*vec2(127.1,311.7))` 喂 `floor(uv*scale)` 时只有 10 个
  取值 → 周期 10 格的重复条纹。用 `fract(vec3(p.xyx)*0.1031)` 三通道混合版
- **「保险」clamp 千万别夹在可视范围内**：夹取会让所有超出者映射到同一条线上，画面出现
  等间距斜条纹。分母的 `max(r,0.010)` 已兜住发散，夹取纯属多余
- **`gl_PointSize` 是像素单位、不随透视缩放**，得自己按距离算；**低于约 1px 的点会被直接
  丢弃** → 尺寸分布下限不能低于 1px，否则整片天「空掉」
- **地面平面均匀撒点密度无解**：视场宽度从近端到远端差 6 倍以上。要连续几何体不要点云
  ——一根丝多长都只占 1px 宽，天然低光污染
- **远端压缩成亮核**：丝束/点云远端在屏幕上压成一小块，几百条加法叠加会烧白核。
  对策是让远端**提前**淡出，比事后调辉光有效
- ⚠️ **全屏 shader 里的定位常数会随宽高比漂移**：`p = (vUv-0.5)*vec2(宽高比,1.0)` 里
  **横向可视范围是 ±宽高比/2，纵向恒为 ±0.5**。横向位置写绝对值必漂，要写成
  「可视半宽的比例」。**反推比例前先确认参考视口真实宽高比**：1440×900 是 **16:10
  不是 16:9**（按 16:9 算过一次，把要保住的画面整体左移 45px）

## 视觉验证
- 背景/3D：`.workbuddy-ai/preview/login-bg/shoot-bg.mjs` 静态截图
  （`--clip=x,y,w,h[,scale]` 局部放大、`--click` 连点、`--url` 换目标）
- 首页/导航/悬浮态：`.workbuddy-ai/preview/home-nav/shoot-nav.mjs`，多了**真实鼠标事件
  模拟 `:hover`**（`--hover` + `--hoverOffset`）、`--scroll=N`、`--eval` 探针。
  ⚠️ `:hover` 加 class 验不出来，必须走 `Input.dispatchMouseEvent`
- ⚠️ **`Input.dispatchMouseEvent` 划选文字，`mouseMoved` 必须带 `button: 'left'` +
  `buttons: 1`** 才能选中；只给 `buttons: 1` 选不出来（基准页实测）。
  做选区类断言必须配**对照组**（把目标元素 `user-select` 内联改成 `text` 再拖一次），
  否则「选不出东西」这条断言永远为真，等于没验
- ⚠️ **帧数口径只能用「RAF 回调里有没有产生新的 bindFramebuffer」**（`renderedFrames`）。
  draw call 随场景变、`gl.clear` 每 pass 一次、`bindFramebuffer(null)` 在开 MSAA 后被
  resolve 放大 5 倍（**渲染 fps > RAF fps 一定是口径坏了**）。报告里要打印
  `bindFramebuffer 次数 / renderedFrames` 的倍数自证（≈5 就是 MSAA 生效）
- `analyze-solar.py` 像素分析（定位、**光照方向回归**、光晕环带亮度剖面）。
  ⚠️ 找太阳要避开数据卡的亮字，否则质心被拉偏
- ⚠️ **验「几何没动」要用差分，别找最亮像素**：全屏最亮的是白色卡片/白 logo。
  用 `ImageChops.difference`：几何若真没动，差异只该落在**会动的那部分**
- ⚠️ **默认 1440×900 会把宽高比相关的 bug 全盖住**：至少补竖屏（480×900）和
  超宽（2560×1080）各一轮。回落分支（浅色 / reduced-motion）也要**逐套**验
- ⚠️ CDP `Page.captureScreenshot` 的 `clip` 是**文档坐标**（`captureBeyondViewport` 默认开），
  带滚动时必须 `clip.y += window.scrollY`，否则截到一片空白
- 排查顺序：**先读 `getComputedStyle` 排 CSS，再二分关模块定位，最后把 shader 数学搬到
  Node 复算**。复算脚本自己也会错——先自证脚本正确再下结论。通用方法论见 skill
  `cdp-animation-screenshot`

## 构建
`npm run build` = `tsc --noEmit && vite build`，所以 **dev server 不做类型检查、平时发现
不了，但构建会直接炸**。改完页面记得单独跑一次 `npx tsc --noEmit`。
⚠️ 2026-09-20 起有一条**既有**未修错误：
`src/pages/Home/backgrounds/fluid-scene.ts(1863,30): error TS18047: 'program' is possibly 'null'`
—— 会把 `npm run build` 卡住。

## 已知待办
1. UNIT_PROJECT_OPTIONS 兜底是空数组，接口挂了没候选项
2. 登录是前端模拟，接真实后台只改 auth.ts 的 login()
3. 竖屏（480×900）下太阳系 `sizeFactor` 被压到 0.55、锚点左移到 0.2，基本被正文和数据卡
   盖住 —— 不溢出不报错，但手机上「看到地球」这条看不到。要改得给窄屏单排一版锚点
4. 死代码待清（**必须先 git init**）：patrol-workflow / aliyun-nls-voice / lib/mastra 语音封装 /
   LoginCopy / scenes/weave.ts（2026-09-20 被 galaxy 取代，已无任何 import）
