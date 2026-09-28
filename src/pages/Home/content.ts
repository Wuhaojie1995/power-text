/**
 * 首页的全部文案与数据。
 *
 * 为什么单独成文件：页面结构（index.tsx）和文案是两件独立的事。
 * 想改一个字、换一个项目、调一个技能值，都只该动这个文件，
 * 不用进组件里翻 JSX —— 那种「文案散落在标签之间」的写法，
 * 改三次以后就没人愿意碰了。
 *
 * 组织原则（这一版重整过，按这个顺序读下来就是一条完整的话）：
 *   1. NAV_ITEMS      —— 板块顺序，必须与 index.tsx 里 <section> 的先后一致；
 *   2. PROFILE        —— 首屏：我是谁、在做什么、四个可追溯的数字；
 *   3. PROJECTS       —— 先看东西：五个真实交付过的方向；
 *   4. STRENGTHS      —— 再看人：抽象成四种能力；
 *   5. AGENT_*        —— 拆开旗舰作品：智能体真正的运行链路与工程底座；
 *   6. SKILLS         —— 手上在用的工具；
 *   7. JOURNEY        —— 履历，由近及远；
 *   8. CONTACTS       —— 怎么找我。
 *
 * 写法上的两条纪律：
 *   - 数字与专有名词必须能在 src/mastra、src/pages 的代码里对上，不写「精通 / 资深」这类空词；
 *   - 同一件事只在一个板块讲透，其余地方只引用不重复（比如「十个业务子系统」
 *     只在项目卡片里展开，能力卡和履历里各提一句带过）。
 *
 * ⚠️ 标了 〈待填〉 的字段是当前没有可靠来源、先占位的，需要你替换。
 */

// ============================================================
// 导航
// ============================================================
export interface NavItem {
  /** 锚点 id，必须与页面里 <section> 的 id 一致 */
  id: string
  label: string
}

/**
 * 顺序即页面顺序：先看交付物（项目作品），再看能力抽象（核心能力），
 * 然后用「智能体」把旗舰作品拆开，最后是工具、履历和联络方式。
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'projects', label: '项目作品' },
  { id: 'strengths', label: '核心能力' },
  { id: 'agent', label: '智能体' },
  { id: 'arsenal', label: '技术栈' },
  { id: 'journey', label: '职业履历' },
  { id: 'contact', label: '与我联络' },
] as const

// ============================================================
// 个人信息（首屏）
// ============================================================
export interface ProfileMetric {
  value: string
  label: string
}

export interface Profile {
  /** 导航栏左上角的方块字，取姓名里的一个字 */
  brandMark: string
  brandName: string
  brandSub: string
  /** 首屏大标题 */
  name: string
  /** 大标题下面那行拉开字距的英文 */
  latin: string
  /** 一句话定位 */
  role: string
  /** 首屏顶部状态胶囊 */
  status: string
  tags: readonly string[]
  metrics: readonly ProfileMetric[]
}

export const PROFILE: Profile = {
  brandMark: '武',
  brandName: '武先生',
  brandSub: 'ENGINEERING · AI AGENT',

  name: '武先生',
  // 〈待填〉换成你的英文名或站点域名，风格参照 wohenbang.com 的 "WOHENBANG.COM"
  latin: 'ENGINEERING DIGITALIZATION',
  role: '深耕工程建设管理数字化的前端工程师。做过十个业务子系统、四套驾驶舱大屏和一套跨端公共组件库，现在把大模型接进工地：用 React 与 TypeScript 把工程业务翻译成能长期跑的系统，也翻译成会自己调工具干活的智能体。',
  status: '在职 · 开放技术交流与项目探讨',

  tags: ['React ', 'TypeScript', '数据可视化', 'AI Agent / Mastra', '多端交付'],

  // 四个数字都能在代码里数出来，不是估算：
  // 十个业务模块见 PROJECTS 的 subsystems 卡；四级驾驶舱见 cockpit 卡；
  // 七个领域工具见 src/mastra/tools（工具区注册了 7 个，另有 ask_user 交互工具）；
  // 四项评测器见 src/mastra/scorers/patrol-scorer.ts。
  metrics: [
    { value: '10 个', label: '业务子系统，共用一套业务骨架' },
    { value: '4 级', label: '驾驶舱视图体系（中心 / 企业 / 基地 / 项目）' },
    { value: '7 个', label: '智能体领域工具（分类 / 性质 / 人员 / 时间…）' },
    { value: '4 项', label: '智能体自动评测：准确 / 完整 / 合规 / 安全' },
  ],
}

// ============================================================
// 项目作品
// ============================================================
export type ProjectCategory = 'agent' | 'visual' | 'platform'

export interface ProjectFilter {
  id: ProjectCategory | 'all'
  label: string
}

export const PROJECT_FILTERS: readonly ProjectFilter[] = [
  { id: 'all', label: '全部作品' },
  { id: 'agent', label: 'AI Agent' },
  { id: 'visual', label: '数据可视化' },
  { id: 'platform', label: '业务平台' },
] as const

export interface Project {
  id: string
  category: ProjectCategory
  tag: string
  title: string
  sub: string
  text: string
  chips: readonly string[]
  stat?: { value: string; label: string }
}

/**
 * 排列顺序 = 推荐阅读顺序：智能体置顶（这一版最想让人看到的交付），
 * 然后是大屏、子系统群、移动端、甘特图。
 */
export const PROJECTS: readonly Project[] = [
  {
    id: 'patrol-agent',
    category: 'agent',
    tag: 'AI AGENT',
    title: 'AI 智能巡视记录助手',
    sub: 'React  · Mastra · 豆包模型 · 语音 + 流式对话',
    text: '面向工程巡视场景的智能体应用。用自然语言描述现场情况，智能体自主拆解任务、调用领域工具完成问题分类、性质判定、类型归集、责任单位与项目成员匹配，最终产出可直接归档的结构化巡视记录。缺字段时用可点击卡片逐项追问，提交前用表格完整复述待确认——它的运行链路和工程底座见下方「智能体」板块。',
    chips: ['React ', 'Mastra', 'Volcengine Ark', 'Function Calling', '流式输出', '阿里云 NLS 语音'],
    stat: { value: '7', label: '个领域工具 + 4 项自动评测' },
  },
  {
    id: 'cockpit',
    category: 'visual',
    tag: 'DATA VISUAL',
    title: '多级数据驾驶舱大屏',
    sub: '中心 / 企业级 / 基地级 / 项目级',
    text: '按管理层级拆成四套视图的数据驾驶舱。同一份指标口径逐级下钻：概览堆叠、基地分布、分类构成、漏斗、立项、变更、投资、资金等十余张图表，配合高德地图呈现项目与基地的空间分布，适配现场大屏长时间无人值守运行。',
    chips: ['ECharts 5.5', '数据大屏', '指标下钻', '高德地图', '响应式适配'],
    stat: { value: '4 级', label: '视图体系' },
  },
  {
    id: 'subsystems',
    category: 'platform',
    tag: 'BUSINESS SYSTEM',
    title: '项目预警 · 审批 · 积分 子系统群',
    sub: '招标前期 → 施工执行 → 数据中心 → 积分评价',
    text: '围绕工程项目全生命周期交付的业务子系统群，10 个核心模块按业务链条组织：前期有招标前期管理与合同管理；施工执行阶段覆盖车辆、安费、分包、现场与农民工工资；全过程管理串联关键节点，项目数据中心汇总指标，项目积分完成评价闭环。前端统一走自研组件库，与平台主框架以微应用方式集成，共用一套登录态与权限。',
    chips: ['React ', 'Vue', 'antd', '自研组件库', '微应用集成', 'MobX', 'react-quill', 'print-js'],
    stat: { value: '10', label: '个业务子系统' },
  },
  {
    id: 'mobile',
    category: 'platform',
    tag: 'MOBILE',
    title: '移动端现场作业应用',
    sub: 'uni-app x · Taro 3 · antd-mobile',
    text: '面向现场作业的移动端应用。两套多端方案都在交付：uni-app x 的 uts / uvue 体系，以及 Taro 3 + antd-mobile 覆盖微信、支付宝、企微与 H5。内置多语言配置、手写签名与原生能力桥接，与 Web 端共用同一套后端接口。',
    chips: ['uni-app x', 'uts / uvue', 'Taro 3', 'antd-mobile', 'i18n 多语言', '原生能力桥接'],
    stat: { value: '1 套', label: '代码多端运行' },
  },
] as const

// ============================================================
// 核心能力
// ============================================================
export interface Strength {
  index: string
  tag: string
  title: string
  sub: string
  text: string
  points: readonly string[]
}

/**
 * 四张卡各说一件事，互不重叠：
 * 业务纵深（懂什么）→ 全栈多端（能落几端）→ 可视化（难做的地方怎么做）→ 智能体工程（新增的能力线）。
 * 交付物细节放在 PROJECTS 里，这里只写「做法」。
 */
export const STRENGTHS: readonly Strength[] = [
  {
    index: '01',
    tag: '业务纵深',
    title: '把业务口径翻译成数据结构',
    sub: 'ENGINEERING DOMAIN',
    text: '长期扎根工程建设与项目管理信息化，熟悉进度、预警、审批、巡视、积分等核心业务域。真正的活是先问清「这个字段在业务上算不算数」，再决定它进哪张表、以什么形态出现在界面上。',
    points: [
      '多级指标体系的口径统一：中心 / 企业 / 基地 / 项目',
      '巡视、预警、审批、积分等业务规则的建模',
      '工程进度计划与 WBS 任务分解',
    ],
  },
  {
    index: '02',
    tag: '全栈多端',
    title: '一套模型，多端落地',
    sub: 'FULL-STACK & MULTI-TARGET',
    text: '从 Web 管理端到大屏可视化、移动端与小程序，同一套业务模型在多端交付；重复出现的交互抽成独立组件库，改一处全端生效——这是十个子系统能不散架的原因。',
    points: [
      'React  + TypeScript + Vite 前端工程化',
      'Web / 大屏 / 移动端多端并行交付',
      '通用业务骨架：列表 / 表单 / 审批流 / 导入导出 / 权限',
    ],
  },
  {
    index: '03',
    tag: '可视化',
    title: '重交互场景的工程实现',
    sub: 'VISUALIZATION & INTERACTION',
    text: '甘特图、拓扑图、三维粒子场这类重交互场景，衡量标准不是「画出来了」，而是帧率、内存和连续运行几小时之后还稳不稳。',
    points: [
      'ECharts 多图表驾驶舱与指标下钻',
      'Three.js / WebGL 着色器与动效（本页背景也是这套）',
    ],
  },
  {
    index: '04',
    tag: '智能体工程',
    title: '把大模型接进真实业务',
    sub: 'AI AGENT ENGINEERING',
    text: '不是套一层聊天框：把业务规则写成工具、把追问写成流程、把质量标准写成评测器。让模型只在「理解自然语言」这件事上发挥，其余环节全部用可校验的代码兜住。',
    points: [
      'Mastra 智能体、工具与多步工作流编排',
      '缺字段引导式追问与提交前人工确认闸门',
      '评测器 + trace 全链路观测，质量不靠肉眼抽查',
    ],
  },
] as const

// ============================================================
// 智能体：运行链路 + 工程底座
// ============================================================
/**
 * 这一板块是「AI 智能巡视记录助手」的展开。
 * 数据全部取自 src/mastra：
 *   - patrol-workflow.ts 的五个 step（顺序即数组顺序，用时间轴样式渲染）；
 *   - tools/ 下注册的七个工具（+ core 的 ask_user）；
 *   - scorers/patrol-scorer.ts 的四项评分器；
 *   - agents/patrol-agent.ts 的 workingMemory 与模型配置；
 *   - index.ts 的存储与可观测配置。
 */
export interface AgentStep {
  /** 左侧序号（时间轴的 period 位） */
  period: string
  /** 步骤名（时间轴主标题位） */
  role: string
  /** 对应的 workflow step id 与模型（时间轴的弱化副标题位） */
  org: string
  text: string
  chips: readonly string[]
}

export const AGENT_STEPS: readonly AgentStep[] = [
  {
    period: 'STEP 01',
    role: '解析意图',
    org: 'parse-intent',
    text: '把「新增 3号楼主体 2层梁板 今天上午9点到11点半，模板支设符合方案要求」这类口语，解析成 create / clarify / unsupported 三种动作，抽出可识别的字段并列出还缺哪些。这一步刻意不做时间换算——相对表达原样带下去，交给下一步统一处理。',
    chips: ['意图三分类', '字段抽取', '缺失清单'],
  },
  {
    period: 'STEP 02',
    role: '时间归一',
    org: 'resolve-times · date-time-resolver',
    text: '把「今天下午」「16 号」「大后天」这类相对表达统一换算成东八区绝对时间：巡视起止到分钟、问题发现时间到分钟、整改时限只到天。算不出确切时刻就返回 warning 让助手继续追问，绝不替用户兜底一个默认值。',
    chips: ['东八区换算', '相对时间', '不擅自补默认值'],
  },
  {
    period: 'STEP 03',
    role: '组装工具调用',
    org: 'build-tool-call',
    text: '校验 5 个业务必填字段，把问题数组统一补上固定来源 sourceType=PATROL，并生成结构化确认文本。字段没齐就转进澄清分支——不带着半截数据去调接口。',
    chips: ['5 个业务必填', '确认文本', '闸门校验'],
  },
  {
    period: 'STEP 04',
    role: '写入业务系统',
    org: 'maybe-call-patrol-tool · patrol-crud',
    text: '调用内部巡视接口新增记录。动手前先把字典查全：单位工程、问题类型、二级分类、问题性质、项目人员并行拉取，把中文名映射成后端 ID；整改人 / 复查人匹配不到就报错要求重新确认，不猜、不替换。',
    chips: ['action=create', '字典映射', '人员重名校验'],
  },
  {
    period: 'STEP 05',
    role: '结果成文',
    org: 'compose-reply',
    text: '把工具返回的结构化结果翻译回中文：成功就输出「已创建 ✅」和关键字段表格，失败就把错误翻成一句人话并提示检查内网连通性——堆栈和密钥永远不进对话。',
    chips: ['Markdown 表格', '错误翻译', '不泄露内部信息'],
  },
]

export interface AgentFoundation {
  index: string
  tag: string
  title: string
  sub: string
  text: string
  points: readonly string[]
}

export const AGENT_FOUNDATIONS: readonly AgentFoundation[] = [
  {
    index: '01',
    tag: '工具层',
    title: '七个领域工具',
    sub: 'TOOL LAYER',
    text: '智能体不靠「背下来的知识」答题，而是现场调工具取真实数据。工具查不到就如实返回失败，让它去问用户，而不是编一个看起来合理的值。',
    points: [
      'unitProjectTool 单位工程 · problemTypeTool 问题类型',
      'problemClassifyTool 二级分类 · problemNatureTool 问题性质',
      'projectMemberTool 项目人员 · dateTimeTool 时间换算 · patrolTool 记录读写',
    ],
  },
  {
    index: '02',
    tag: '追问层',
    title: '缺什么问什么，不猜',
    sub: 'GUIDED SLOTS',
    text: '字段缺失时用可点击的选择卡片一次只问一项，覆盖所有必填与选填项；用户明确说「跳过」才留空。提交前用 Markdown 表格完整复述，等一句「确认」才写库。',
    points: [
      'ask_user 选择卡片：单选项 + 整改人 / 复查人多选项',
      '问题类型固定 6 选 1，口语说法自动映射后复述确认',
      '编辑、查看详情等超出职责的请求明确说明边界并引导新增',
    ],
  },
  {
    index: '03',
    tag: '记忆层',
    title: '记住你的常用值',
    sub: 'WORKING MEMORY',
    text: '按用户维度持久化工作记忆。下次开工先展示「已为你预填以下常用值，如需修改请告诉我」，而不是让人把同样的信息再念一遍。',
    points: [
      '常用单位工程 / 巡视部位 / 时段 / 现场情况模板 / 整改人',
      '写入必须先征得用户同意，不从一次临时请求推断长期偏好',
      'resource 级作用域，跨会话保留',
    ],
  },
  {
    index: '04',
    tag: '评测与观测',
    title: '四项自动评测 + 全链路 trace',
    sub: 'EVALS & OBSERVABILITY',
    text: '输出质量不靠肉眼抽查：每次运行都按 100% 采样打分，执行链路落盘可回放。改一句指令会不会把格式带崩，跑一轮评测就知道。',
    points: [
      '操作准确性 / 完整性 / 格式合规 / 敏感信息四项评分器',
      '格式合规覆盖时间格式、6 选 1 枚举、分类来源、人员多选',
      'LibSQL 落业务数据，DuckDB 落 trace 与观测，可切远端 Turso',
    ],
  },
] as const

// ============================================================
// 技术栈
// ============================================================
export interface Skill {
  name: string
  /** 0~100。⚠️ 下面这些百分比是按项目密度估的，不是任何官方口径，请按你自己的判断改 */
  level: number
  note: string
}

/** 按「主线 → 可视化 → 智能体 → 多端 → 老项目」排，不按数值排 */
export const SKILLS: readonly Skill[] = [
  { name: 'React 生态', level: 92, note: '业务系统主力技术栈' },
  { name: 'TypeScript', level: 88, note: '全项目强类型约束' },
  { name: 'antd / 自研组件库', level: 90, note: '十个子系统共用一套组件' },
  { name: 'Webpack 5 / Vite 工程化', level: 86, note: '多环境构建与分包' },
  { name: 'ECharts 数据可视化', level: 88, note: '多级驾驶舱与指标下钻' },
  { name: 'Three.js / WebGL', level: 74, note: '着色器与粒子动效' },
  { name: 'Mastra / AI Agent', level: 80, note: '智能体、工具与工作流' },
  { name: 'uni-app x 多端', level: 78, note: 'uts / uvue 移动端' },
  { name: 'Taro / antd-mobile 多端', level: 76, note: '小程序与 H5 交付' },
  { name: 'Vue 生态', level: 45, note: '早期子系统的开发与维护' },
] as const

// ============================================================
// 职业履历
// ============================================================
export interface JourneyItem {
  period: string
  role: string
  org: string
  text: string
  chips: readonly string[]
}

/**
 * 数组顺序即时间轴顺序：由近及远往下排。
 * ⚠️ period 现在用的是阶段词（现在 / 近几年 / 早期）。想放真实年份区间就换成
 *    形如 '2023 — 至今'、'2021 — 2023' 的写法，样式不用动。
 */
export const JOURNEY: readonly JourneyItem[] = [
  {
    period: '现在',
    role: 'AI Agent 与智能业务落地',
    org: '上海普华科技发展股份有限公司（西安分公司）',
    text: '把大模型接进真实的巡视业务流程：Mastra 智能体负责任务拆解与工具调用，流式对话负责过程反馈，最终产出业务系统可直接归档的结构化记录。这条线上不只有提示词——工具、工作流、评测器、可观测都在这一阶段补齐。',
    chips: ['Mastra', 'AI Agent', 'Function Calling', '流式输出', '阿里云语音'],
  },
  {
    period: '近几年',
    role: '工程建设管理数字化 · 多端与可视化',
    org: '上海普华科技发展股份有限公司（西安分公司）',
    text: '负责工程项目管理平台的前端交付：多级数据驾驶舱大屏、跨端公共组件库，以及以 React  + TypeScript 重写的业务子系统群——按微应用方式集成进平台主框架，共用一套登录态与权限。',
    chips: ['React ', 'TypeScript', 'ECharts', 'antd', 'Webpack 5', 'Taro 3'],
  },
  {
    period: '早期',
    role: '业务子系统 · React 与原生 JavaScript 阶段',
    org: '上海普华科技发展股份有限公司（西安分公司）',
    text: '平台早期以 React  为主的建设阶段：车辆、合同、安费、分包、现场等业务模块的首版开发与长期维护，老项目的改造与迁移，以及通用列表、表单、审批、导入导出这套交互的沉淀——后来成为自研组件库和「十个模块一套骨架」的底子。',
    chips: ['React', 'JavaScript', '老项目维护', '组件库沉淀'],
  },
] as const

// ============================================================
// 联系方式
// ============================================================
export interface ContactItem {
  label: string
  value: string
  note: string
  /** 有值就渲染成可点链接 */
  href?: string
  /** 复制按钮写进剪贴板的内容；不给就退回 value */
  copy?: string
}

export const CONTACTS: readonly ContactItem[] = [
  {
    label: '电子邮箱',
    value: 'q383250515@126.com',
    note: '技术交流、项目合作，通常 24 小时内回复。',
    href: 'mailto:q383250515@126.com',
  },
  {
    label: '微信',
    value: 'q383250515',
    note: '添加时请简要注明来意，方便快速通过。',
  },
  {
    label: '代码仓库',
    value: 'github.com/Wuhaojie1995/power-text',
    note: '开源项目与日常练习的代码。',
    href: 'https://github.com/Wuhaojie1995/power-text',
    // 卡片上省掉协议头更好读，但粘到地址栏里得能直接打开，所以复制的是完整链接
    copy: 'https://github.com/Wuhaojie1995/power-text',
  },
] as const

/** 页脚署名 */
export const FOOTER_TEXT = '武先生 · 工程建设数字化 · AI Agent'

// ============================================================
// 开场：宇宙缩放
// ============================================================
/**
 * 站点开场那段「从星系一路落到一座城」的下坠叙事。
 *
 * 每一站的 id 同时是 3D 场景里切换「片场」的依据，改 id 要连
 * background/scenes/universe-zoom.ts 里的分段边界一起改（那里的注释标了对应关系）。
 *
 * 城市定的是西安 —— 履历里那条「西安分公司」就是它。所以最后两站的地理描述
 * 不是泛泛的「一座城」：秦岭横在南边、渭河从西边流过，这两句一写出来，
 * 在这儿待过的人才认得出是自己那儿。
 *
 * 从「大气层」往下的三站（中国大陆 → 西北 → 西安），画面换成真实的卫星影像，
 * 镜头一路落到城墙正中的钟楼上。顺序不能调换：先给出整块国土，再收进西北与关中，
 * 最后落进西安 —— 中国大陆那一站是「云散之后先看见什么」的答案，
 * 它在画面上是不是真的先出现、有没有从暗到亮地显影，由
 * backgrounds/scenes/universe-zoom.ts 的 CHINA_HOLD_TO 与 GROUND_REVEAL_* 决定。
 * 影像一共六层（全国 → 西北 → 陕西 → 西安 → 城区 → 钟楼），按经度跨度定义，
 * 层级、范围与换算都在 backgrounds/satellite-map.ts。
 */
export interface UniverseStage {
  /** 阶段 id，与 3D 场景的分段一一对应 */
  id: string
  /** 阶段上方的小字（英文，和整页其它板块的 eyebrow 一个调子） */
  eyebrow: string
  title: string
  text: string
}

/**
 * 顺序即滚动顺序。数组长度决定整段的滚动长度：
 * UniverseIntro 用它算「一站占多少滚动距离」。
 */
export const UNIVERSE_STAGES: readonly UniverseStage[] = [
  {
    id: 'galaxy',
    eyebrow: 'Galaxy',
    title: '亿万星系之中',
    text: '先把镜头拉到最远。在无数星系与星云之间，先看清我们大概站在哪儿。',
  },
  {
    id: 'milkyway',
    eyebrow: 'Milky Way',
    title: '银河系 · 猎户臂',
    text: '一个拥有两千亿颗恒星的螺旋星系，我们住在其中一条旋臂的外侧，靠近边缘的位置。',
  },
  {
    id: 'solar',
    eyebrow: 'Solar System',
    title: '太阳系 · 八颗行星',
    text: '一颗恒星、八颗行星、一圈圈几乎正圆的轨道。所有故事都发生在这里面。',
  },
  {
    id: 'earth',
    eyebrow: 'Earth',
    title: '一颗淡蓝色的点',
    text: '覆盖着海洋，裹着云层，是目前已知唯一有人在上面写代码的地方。',
  },
  {
    id: 'atmosphere',
    eyebrow: 'Atmosphere',
    title: '穿越大气层',
    text: '再往下，云层散开，大陆从蓝色里浮出来 —— 落地之前最后一段路。',
  },
  {
    id: 'continent',
    eyebrow: 'China',
    title: '中国大陆',
    text: '冲出云层，脚下铺开一整片真实的卫星影像：群山、高原与海岸线连成一片，先在暗处显出轮廓，再随着下坠一点点亮起来。',
  },
  {
    id: 'region',
    eyebrow: 'Northwest',
    title: '西北 · 关中',
    text: '镜头收进西北：北边是千沟万壑的黄土高原，南边一道秦岭把南北分开；再往下收，中间渭河冲出的那块平地，就是八百里秦川。',
  },
  {
    id: 'xian',
    eyebrow: "Xi'an",
    title: '西安 · 钟楼',
    text: '镜头落进城墙正中，那座方形建筑就是钟楼。下面的这些，都是在这座城里做出来的。',
  },
] as const

/** 首屏的滚动提示。第一站才显示，用户一动就走 */
export const UNIVERSE_SCROLL_HINT = '滚动浏览'
/** 右下角常驻的跳过按钮。八屏的路，不该强迫任何人走完 */
export const UNIVERSE_SKIP_LABEL = '跳过开场'

/**
 * 首页的浏览器标签页标题。
 *
 * index.html 里的静态 <title> 是给业务系统用的（「海港建设工程管理数字化平台」），
 * 站点入口换成作品集之后，标签页和分享卡片上该显示的是这一版。
 * 由 HomePage 挂载时接管、卸载时还原，业务页面不受影响。
 */
export const SITE_TITLE = '武先生 · 工程建设数字化 · AI Agent'
