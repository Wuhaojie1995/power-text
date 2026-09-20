/**
 * 首页的全部文案与数据。
 *
 * 为什么单独成文件：页面结构（index.tsx）和文案是两件独立的事。
 * 想改一个字、换一个项目、调一个技能值，都只该动这个文件，
 * 不用进组件里翻 JSX —— 那种「文案散落在标签之间」的写法，
 * 改三次以后就没人愿意碰了。
 *
 * ⚠️ 标了 〈待填〉 的字段是当前没有可靠来源、先占位的，需要你替换。
 * 其余字段（项目名、技术栈、版本号、包名）都取自你本机 D:\puhua 与桌面
 * 「西安分公司-大屏」「发布文件」「甘特图」下的真实工程，可以直接用。
 */

// ============================================================
// 导航
// ============================================================
export interface NavItem {
  /** 锚点 id，必须与页面里 <section> 的 id 一致 */
  id: string
  label: string
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'strengths', label: '核心能力' },
  { id: 'projects', label: '项目作品' },
  { id: 'arsenal', label: '技术栈' },
  { id: 'journey', label: '职业履历' },
  { id: 'contact', label: '与我联络' },
] as const

// ============================================================
// 个人信息
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
  role: '深耕工程建设管理数字化的前端工程师 —— 从多级数据驾驶舱、项目业务子系统，到大模型驱动的 AI 智能体，把业务语言翻译成能跑起来的系统。',
  status: '在职 · 开放技术交流与项目探讨',

  tags: ['React 生态', 'TypeScript', '数据可视化', 'AI Agent', '多端交付'],

  // 四组数字全部可溯源：项目数按 D:\puhua 下真实工程统计，
  // 驾驶舱四级、7 个 Agent 工具、3 个公共包都能在代码里数出来
  metrics: [
    { value: '10+', label: '企业级业务系统交付' },
    { value: '4 级', label: '驾驶舱视图体系（中心 / 企业 / 基地 / 项目）' },
    { value: '7 项', label: 'AI Agent 领域工具与工作流' },
    { value: '3 套', label: '跨端公共组件库（m-ui / p-ui / public）' },
  ],
}

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

export const STRENGTHS: readonly Strength[] = [
  {
    index: '01',
    tag: '业务纵深',
    title: '工程建设管理数字化',
    sub: 'ENGINEERING DOMAIN',
    text: '长期扎根工程建设与项目管理信息化，熟悉进度、预警、审批、巡视等核心业务域，能把业务口径翻译成数据结构与交互模型。',
    points: [
      '多级驾驶舱指标体系：中心 / 企业级 / 基地级 / 项目级',
      '项目预警、审批、积分等业务子系统',
      '工程进度计划与 WBS 任务分解',
    ],
  },
  {
    index: '02',
    tag: '全栈多端',
    title: '一套模型，多端落地',
    sub: 'FULL-STACK & MULTI-TARGET',
    text: '从 Web 管理端到大屏可视化、移动端与小程序，同一套业务模型在多端交付；重复出现的交互抽成独立 npm 包，改一处全端生效。',
    points: [
      'React 18 + TypeScript + Vite 前端工程化',
      '大屏 / Web / 移动端多端并行交付',
      '@power-xa/m-ui、@power-xa/p-ui 自研组件库',
    ],
  },
  {
    index: '03',
    tag: 'AI 落地',
    title: '把大模型接进真实业务',
    sub: 'AI AGENT & LLM',
    text: '不是做一个聊天框。让智能体自己拆解任务、调用领域工具、查数据、出结论，最终产出业务系统认的结构化结果。',
    points: [
      'Mastra 智能体框架 + 领域工具链（Function Calling）',
      '流式对话、结构化追问与选项式交互',
      '语音输入（阿里云 NLS）与输出评分器（Scorer）',
    ],
  },
  {
    index: '04',
    tag: '可视化',
    title: '重交互场景的工程实现',
    sub: 'VISUALIZATION & INTERACTION',
    text: '甘特图、拓扑图、三维粒子场这类重交互场景，关注的是帧率、内存和长时间运行稳定性，而不只是「画出来」。',
    points: [
      'ECharts 多图表驾驶舱与指标下钻',
      'dhtmlx-gantt 进度计划视图定制',
      'Three.js / WebGL 自定义着色器与动效',
    ],
  },
] as const

// ============================================================
// 项目作品
// ============================================================
export type ProjectCategory = 'agent' | 'visual' | 'platform' | 'infra'

export interface ProjectFilter {
  id: ProjectCategory | 'all'
  label: string
}

export const PROJECT_FILTERS: readonly ProjectFilter[] = [
  { id: 'all', label: '全部作品' },
  { id: 'agent', label: 'AI Agent' },
  { id: 'visual', label: '数据可视化' },
  { id: 'platform', label: '业务平台' },
  { id: 'infra', label: '工程基建' },
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

export const PROJECTS: readonly Project[] = [
  {
    id: 'patrol-agent',
    category: 'agent',
    tag: 'AI AGENT',
    title: 'AI 智能巡视记录助手',
    sub: 'React 18 · Mastra · 语音 + 流式对话',
    text: '面向工程巡视场景的智能体应用。用自然语言描述现场情况，智能体自主拆解任务、调用领域工具完成问题分类、性质判定、类型归集、责任单位与项目成员匹配，最终产出结构化的巡视记录。',
    chips: ['React 18', 'Mastra', 'AI Agent', 'Function Calling', '流式输出', '阿里云 NLS'],
    stat: { value: '7', label: '个领域工具' },
  },
  {
    id: 'cockpit',
    category: 'visual',
    tag: 'DATA VISUAL',
    title: '多级数据驾驶舱大屏',
    sub: '中心 / 企业级 / 基地级 / 项目级',
    text: '按管理层级拆成四套视图的数据驾驶舱。同一份指标口径逐级下钻：概览堆叠、基地分布、分类构成、漏斗、立项、变更、投资、资金等十余张图表，适配现场大屏长时间无人值守运行。',
    chips: ['ECharts 5.4.3', '数据大屏', '指标下钻', '响应式适配'],
    stat: { value: '4 级', label: '视图体系' },
  },
  {
    id: 'subsystems',
    category: 'platform',
    tag: 'BUSINESS SYSTEM',
    title: '项目预警 · 审批 · 积分 子系统群',
    sub: '围绕工程项目的多个独立业务子系统',
    text: '围绕工程项目的预警、审批、积分等核心业务域交付的子系统群。前端基于自研组件库统一交互与视觉，与平台主框架以微应用方式集成，共用一套登录态与权限。',
    chips: ['React 18', 'antd', '自研组件库', '微应用集成'],
    stat: { value: '4', label: '个子系统' },
  },
  {
    id: 'components',
    category: 'infra',
    tag: 'COMPONENT LIB',
    title: '跨端公共组件库',
    sub: '@power-xa/m-ui · @power-xa/p-ui · power-public',
    text: '把各业务线反复重写的表格、表单、选择器等沉淀成独立发布的 npm 包，用 peerDependencies 约束 React 版本，业务项目按需引入 —— 组件修一次，所有子系统一起受益。',
    chips: ['React', 'antd 5', 'npm 私有包', 'peerDependencies'],
    stat: { value: '138', label: 'p-ui 迭代版本数' },
  },
  {
    id: 'mobile',
    category: 'platform',
    tag: 'MOBILE',
    title: '移动端现场作业应用',
    sub: 'uni-app x · uts / uvue 体系',
    text: '面向现场作业的移动端应用，基于 uni-app x 的 uts / uvue 体系开发，内置多语言配置与原生能力桥接，与 Web 端共用同一套后端接口，一套代码覆盖多个端。',
    chips: ['uni-app x', 'uts / uvue', 'i18n 多语言', '原生能力桥接'],
    stat: { value: '1 套', label: '代码多端运行' },
  },
  {
    id: 'gantt',
    category: 'visual',
    tag: 'SCHEDULE',
    title: '工程进度甘特图',
    sub: 'dhtmlx-gantt 8.0.6 深度定制',
    text: '基于 dhtmlx-gantt 8 的工程进度计划视图定制：WBS 任务树、任务依赖关系、拖拽调整与工期联动，配合后端接口完成进度数据的读写闭环。',
    chips: ['dhtmlx-gantt 8', 'WBS 任务树', '依赖关系', '拖拽调整'],
    stat: { value: '8.0.6', label: '甘特图内核版本' },
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

export const SKILLS: readonly Skill[] = [
  { name: 'React 生态', level: 92, note: '业务系统主力技术栈' },
  { name: 'TypeScript', level: 88, note: '全项目强类型约束' },
  { name: 'Vite / 前端工程化', level: 86, note: '多环境构建与分包' },
  { name: 'antd / 组件库设计', level: 90, note: '自研组件库维护' },
  { name: 'ECharts 数据可视化', level: 88, note: '多级驾驶舱图表' },
  { name: 'Three.js / WebGL', level: 74, note: '着色器与动效' },
  { name: 'Mastra / AI Agent', level: 80, note: '智能体与工具链' },
  { name: 'uni-app x 多端', level: 78, note: 'uts / uvue 移动端' },
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

export const JOURNEY: readonly JourneyItem[] = [
  {
    period: '近期',
    role: 'AI Agent 与智能业务落地',
    org: '工程建设管理数字化平台 · 智能巡视',
    text: '把大模型接进真实的巡视业务流程：Mastra 智能体负责任务拆解与工具调用，语音识别负责现场录入，流式对话负责过程反馈，最终产出业务系统可直接归档的结构化记录。',
    chips: ['Mastra', 'AI Agent', 'Function Calling', '流式输出', '语音识别'],
  },
  {
    period: '当前',
    role: '工程建设管理数字化 · 多端与可视化',
    org: '上海普华科技发展股份有限公司（西安分公司）',
    text: '负责工程项目管理平台的前端交付：多级数据驾驶舱大屏、项目预警 / 审批 / 积分等业务子系统、跨端公共组件库，以及基于 dhtmlx-gantt 的进度计划视图。',
    chips: ['React 18', 'TypeScript', 'ECharts', 'antd', 'dhtmlx-gantt', 'uni-app x'],
  },
  {
    // 〈待填〉这一段是占位。把你更早的经历按同样的结构补进来，
    // 条目数量不限，时间轴会自动往下排。
    period: '〈待填〉',
    role: '〈待填〉更早的经历',
    org: '〈待填〉公司 / 团队',
    text: '〈待填〉这一段是占位内容。把时间区间、职位、公司、做了什么按上面的格式补进来即可；不需要这段的话，直接把它从数组里删掉。',
    chips: ['〈待填〉'],
  },
] as const

// ============================================================
// 联系方式
// ============================================================
export interface ContactItem {
  label: string
  /** 〈待填〉换成真实值 */
  value: string
  note: string
  /** 有值就渲染成可点链接 */
  href?: string
}

export const CONTACTS: readonly ContactItem[] = [
  {
    label: '电子邮箱',
    value: '〈待填〉@example.com',
    note: '技术交流、项目合作，通常 24 小时内回复。',
  },
  {
    label: '微信',
    value: '〈待填〉',
    note: '添加时请简要注明来意，方便快速通过。',
  },
  {
    label: '代码仓库',
    value: '〈待填〉github.com/yourname',
    note: '开源项目与日常练习的代码。',
    href: 'https://github.com/',
  },
] as const

/** 页脚署名 */
export const FOOTER_TEXT = '武先生 · 工程建设数字化 · AI Agent'

/**
 * 首页的浏览器标签页标题。
 *
 * index.html 里的静态 <title> 是给业务系统用的（「海港建设工程管理数字化平台」），
 * 站点入口换成作品集之后，标签页和分享卡片上该显示的是这一版。
 * 由 HomePage 挂载时接管、卸载时还原，业务页面不受影响。
 */
export const SITE_TITLE = '武先生 · 工程建设数字化 · AI Agent'
