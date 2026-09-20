/* 聊天界面用到的数据模型，单独抽出来给页面和组件共用 */

/** 消息角色：用户说的 vs AI 回复的（决定气泡靠左还是靠右） */
export type ChatRole = 'user' | 'assistant'

/**
 * ask_user 选择卡片的数据。
 *
 * 智能体的 prompt 约定：单位工程、问题类型等字段缺失时，AI 会调用内置的
 * ask_user 工具向用户「弹卡片」提问。此时流里会出现一个 tool-call-suspended
 * 事件（AI 运行被挂起，等用户作答），前端必须：
 *   1) 渲染问题 + 选项按钮；
 *   2) 用户点选后，用 agent.resumeStream(答案, { runId, toolCallId }) 续跑，
 *      ask_user 工具会拿到答案返回给模型，AI 接着往下走。
 */
export interface AskUserCard {
  question: string
  /** 选项列表；为空表示自由文本提问（用户直接打字回答） */
  options?: { label: string; description?: string }[]
  /** single_select：点一个立即生效；multi_select：可多选，点「确定」提交 */
  selectionMode?: 'single_select' | 'multi_select'
  /** 续跑必需：本次 AI 运行的 id（来自 tool-call-suspended 事件顶层 runId） */
  runId: string
  /** 续跑必需：被挂起的那次工具调用 id */
  toolCallId: string
  /** 是否已回答（答完卡片变灰禁用） */
  answered?: boolean
  /** 用户最终选了什么（回答后在卡片上回显） */
  selected?: string[]
}

/**
 * 一条聊天消息。
 *
 * 设计：整条消息列表就是界面的唯一数据源，所有状态（生成中 / 出错 / 待选择）
 * 都挂在消息对象上，不另起一套 loading 状态，避免「列表和状态不同步」。
 */
export interface ChatMessage {
  /** 唯一 id：流式回复时要靠它精确找到「正在生成的那条消息」去追加文字 */
  id: string
  role: ChatRole
  /** 消息正文。AI 回复在流式过程中会被反复追加，最终是完整答案（Markdown 格式） */
  content: string
  /** 是否仍在生成中（控制打字光标 / 思考动画） */
  pending?: boolean
  /** 是否请求失败（气泡变红） */
  error?: boolean
  /** AI 调 ask_user 挂起时，这条消息下面要挂一张选择卡片 */
  askUser?: AskUserCard
  createdAt: number
}
