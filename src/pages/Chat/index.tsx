import { useEffect, useMemo, useRef, useState } from 'react'
// 必须起别名：直接写 KeyboardEvent 会解析到 DOM 的全局类型（它不是泛型），
// 导致 ReactKeyboardEvent<HTMLTextAreaElement> 报 "Type 'KeyboardEvent' is not generic"
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Alert, Button, Input, Space, Tooltip } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import { ClearOutlined, PauseCircleOutlined, SendOutlined, VerticalAlignBottomOutlined, VerticalAlignTopOutlined } from '@ant-design/icons'
// Markdown 渲染：react-markdown 负责把 AI 输出的 Markdown 转成 React 元素，
// remark-gfm 是插件，让它支持表格、删除线、任务列表等「GitHub 风格 Markdown」
// （智能体的表单/确认表格都是 GFM 表格语法，没有这个插件表格只会显示成原始文本）
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { mastraClient, PATROL_AGENT_ID } from '../../lib/mastra'
import { describeError, friendlyError, nextChatId, readMastraStream, type StreamChunk } from '../../lib/chat-stream'
import type { ChatMessage } from '../../types/chat'
import AskUserChoices from './AskUserChoices'
import './chat.less'

/* =========================================================================
 * 聊天页（原 App.tsx 的全部对话逻辑都搬到了这里）
 * 页面自身不关心「外面是谁」：只要父容器给了高度，它就 flex:1 撑满，
 * 内部按「工具栏 / 消息列表 / 输入区」三段分配，滚动只发生在列表内部。
 * ========================================================================= */

/** 会话线程 id 存在 localStorage 的键名 */
const THREAD_STORAGE_KEY = 'patrol_chat_thread'

/** 生成一个新线程 id */
function createThreadId(): string {
  return `web-thread-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 取当前会话的线程 id：优先复用上次的，没有才新建。
 *
 * 为什么要存 localStorage？Mastra 的记忆是按 thread 维度存的，
 * thread 一变服务端就认不出旧上下文，等于强制开新会话。
 * 之前每次刷新都新建 thread，刷新后 AI 就「失忆」了，所以这里做持久化。
 */
function getOrCreateThreadId(): string {
  const saved = localStorage.getItem(THREAD_STORAGE_KEY)
  if (saved) return saved
  const id = createThreadId()
  localStorage.setItem(THREAD_STORAGE_KEY, id)
  return id
}

export default function ChatPage() {
  /** 消息列表：整个聊天界面的唯一数据源 */
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  /** 输入框内容（受控组件） */
  const [chatInput, setChatInput] = useState('')
  /** 是否正在等待/生成回复：用来禁用输入框、把「发送」按钮切成「停止」 */
  const [chatBusy, setChatBusy] = useState(false)
  /** 全局错误提示（显示在输入框上方，和单条消息的红色气泡区分开） */
  const [chatError, setChatError] = useState('')

  /**
   * 会话线程 id：Mastra 的 memory 靠 thread + resource 定位历史消息。
   *
   * 用 useState 传初始化函数的写法：函数只在首次挂载时执行一次，
   * 之后靠 setChatThreadId 显式更换（目前只有「清空会话」会换）。
   * 值从 localStorage 恢复，所以刷新页面也能接着上一轮聊。
   */
  const [chatThreadId, setChatThreadId] = useState(getOrCreateThreadId)
  /** 资源 id：可以理解为「用户 id」，暂时写死成 web-user，后续可换成真实登录用户 */
  const chatResourceId = useMemo(() => 'web-user', [])

  /** 当前的中断控制器：点「停止」时调用它的 abort() */
  const chatAbortRef = useRef<AbortController | null>(null)
  /** 消息列表 DOM：用于自动滚到底部 */
  const chatListRef = useRef<HTMLDivElement | null>(null)
  /** 输入框 ref（antd TextAreaRef）：清空会话后自动聚焦 */
  const chatInputRef = useRef<TextAreaRef | null>(null)
  /** 是否自动跟随最新消息（用户没往上翻历史时为 true） */
  const [autoFollow, setAutoFollow] = useState(true)
  /** 「回到顶部」悬浮按钮的显隐：往下滚超过 200px 才出现 */
  const [showBackTop, setShowBackTop] = useState(false)
  /** 程序滚动保护期：JS 自己拉滚动条也会触发 onScroll，
      在这个时间戳之前到达的 scroll 事件一律忽略，避免把「代码在滚」
      误判成「用户在翻历史」而暂停跟随 */
  const programmaticScrollUntilRef = useRef(0)

  /**
   * 自动滚动：消息列表一变化（新消息、AI 逐字输出）就把滚动条拉到最底部。
   * 依赖 chatMessages，因为流式输出时 content 每次变化都会产生新数组引用。
   * 只在 autoFollow（用户没往上翻）时才强制跟随；用户翻看历史时不打扰。
   */
  useEffect(() => {
    if (!autoFollow) return
    const el = chatListRef.current
    if (el) {
      // 标记「这次滚动是代码干的」，随后触发的 scroll 事件不参与用户意图判断
      programmaticScrollUntilRef.current = Date.now() + 150
      el.scrollTop = el.scrollHeight
    }
  }, [chatMessages, autoFollow])

  /**
   * 用户滚动列表时的状态感知：
   * - 距底部 < 40px 视为「正在跟随最新」，否则认为用户在翻历史，暂停自动跟随；
   * - 离顶部 > 200px 时显示「回到顶部」悬浮按钮。
   * 程序滚动保护期内的事件直接跳过（见 programmaticScrollUntilRef）。
   */
  const handleChatListScroll = () => {
    if (Date.now() < programmaticScrollUntilRef.current) return
    const el = chatListRef.current
    if (!el) return
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setAutoFollow(distanceToBottom < 40)
    setShowBackTop(el.scrollTop > 200)
  }

  /** 平滑滚动到列表的某个位置（top = 顶部，bottom = 底部并恢复跟随） */
  const scrollChatList = (target: 'top' | 'bottom') => {
    const el = chatListRef.current
    if (!el) return
    // 平滑滚动期间触发的 scroll 事件同样要屏蔽，动画约 300~500ms，保护期给足
    programmaticScrollUntilRef.current = Date.now() + 600
    if (target === 'bottom') {
      el.scrollTop = el.scrollHeight
      setAutoFollow(true)
    } else {
      el.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  /**
   * 按 id 局部更新某条消息。
   * 流式输出时会高频调用它，所以用 map 生成新数组（不可变更新），
   * 保证 React 能检测到变化并重新渲染。
   */
  const patchChatMessage = (id: string, patch: Partial<ChatMessage>) => {
    setChatMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  /* =======================================================================
   * 执行一轮 Agent 请求（核心流程）
   * 整体思路：
   *   1) 先把「用户消息」和一条空的「AI 占位消息」一起塞进列表 → 界面立刻有反馈
   *   2) 请求 Mastra 的流式接口，每拿到一个文本片段就追加到那条占位消息上
   *       → 实现打字机效果，用户不用干等
   *   3) 结束后把占位消息标记为完成；中途出错/中断则标记错误或保留已生成内容
   *
   * 为什么要抽 executeAgentTurn？
   * 「普通发送」和「回答 ask_user 卡片后续跑」的差异只在【怎么建立连接】
   * （agent.stream vs agent.resumeStream），之后的读流、渲染、错误处理完全一样，
   * 所以把公共部分抽成下面的函数，两个入口各自传入建连方式即可。
   * ======================================================================= */
  const executeAgentTurn = async (
    botId: string, // 本轮 AI 回复对应的占位消息 id
    makeRequest: (memoryOpt: { thread: string; resource: string }) => Promise<Response>,
    options?: {
      /** 普通发送时传入用户的原话：流式通道一个字都没回时用它做 generate 兜底 */
      fallbackText?: string
    },
  ) => {
    // 每次都新建中断控制器，存到 ref 里给「停止」按钮用
    const controller = new AbortController()
    chatAbortRef.current = controller
    setChatBusy(true) // 生成中：输入框锁定、「发送」切成「停止」

    let acc = '' // 累积已收到的完整文本（acc 是唯一真源，界面只是它的投影）
    let toolNoteShown = false // 「正在调用工具」提示只插一次，避免刷屏

    /** 追加一小段文本并同步到界面 */
    const pushDelta = (delta: string) => {
      if (!delta) return
      acc += delta
      patchChatMessage(botId, { content: acc })
    }

    try {
      // 1) 建立连接（stream 或 resumeStream 由调用方决定）
      const response = await makeRequest({ thread: chatThreadId, resource: chatResourceId })

      // 2) 逐块读取 SSE，根据事件类型做不同处理
      await readMastraStream(
        response,
        (chunk: StreamChunk) => {
          if (controller.signal.aborted) return // 已停止：丢弃后续内容
          switch (chunk?.type) {
            case 'text-delta':
              // 最常见：一小段回复文本（可能是一个字，也可能是几个字）
              pushDelta(String(chunk.payload?.text ?? ''))
              break
            case 'tool-call': {
              // AI 决定调用工具（比如 unitProjectTool 查单位工程列表）时给个可见反馈。
              // ask_user 例外：它有专属的选择卡片，用文字提示反而多余。
              const toolName = String(chunk.payload?.toolName ?? '未知工具')
              if (toolName === 'ask_user') break
              if (!toolNoteShown) {
                toolNoteShown = true
                pushDelta(`> 正在调用工具：${toolName}\n\n`)
              }
              break
            }
            case 'tool-call-suspended': {
              // AI 调 ask_user 后运行被挂起，等用户作答。
              // 事件结构（已对照 @mastra/core 源码）：
              //   顶层 runId —— 续跑时必传
              //   payload.toolCallId —— 被挂起的工具调用 id，续跑时必传
              //   payload.suspendPayload —— { question, options, selectionMode }
              const sp = (chunk.payload?.suspendPayload ?? {}) as Record<string, any>
              patchChatMessage(botId, {
                askUser: {
                  question: String(sp?.question ?? '请选择'),
                  options: Array.isArray(sp?.options)
                    ? sp.options.map((o: any) => ({
                      label: String(o?.label ?? ''),
                      description: o?.description ? String(o.description) : undefined,
                    }))
                    : undefined,
                  selectionMode: sp?.selectionMode === 'multi_select' ? 'multi_select' : 'single_select',
                  runId: String(chunk.runId ?? ''),
                  toolCallId: String(chunk.payload?.toolCallId ?? ''),
                },
              })
              break
            }
            case 'error': {
              // 服务端在流里推送的错误。payload.error 可能是错误对象（AI_APICallError 等），
              // 不能直接 String()（会变成 "[object Object]"），要先用 describeError 提取。
              const raw = describeError(chunk.payload?.error)
              const hint = friendlyError(raw)
              // 余额不足这类「服务端配置问题」，不走气泡正文，直接给全局红色提示条更醒目
              if (hint !== raw) {
                setChatError(hint)
                pushDelta(`\n\n⚠️ ${hint}`)
              } else {
                pushDelta(`\n\n⚠️ ${raw}`)
              }
              break
            }
            default:
              break // 其他事件（步骤开始、完成标记等）暂不关心
          }
        },
        controller.signal, // 传入 signal，「停止生成」才能生效
      )

      // 3) 兜底：某些情况下流里一个文本片段都没有（比如模型只调了工具没说话），
      //    这时退化成一次性 generate，保证界面上一定有结果，而不是空白气泡。
      //    注意：ask_user 续跑不能这么兜底（generate 会开新运行，挂起的运行就废了），
      //    所以只有传了 fallbackText（普通发送）才启用。
      if (options?.fallbackText && !acc.trim()) {
        const fallback = await mastraClient
          .getAgent(PATROL_AGENT_ID)
          .generate(options.fallbackText, { memory: { thread: chatThreadId, resource: chatResourceId } })
        acc = String((fallback as unknown as { text?: string })?.text ?? '')
      }
      patchChatMessage(botId, { content: acc || '（本次没有返回文本内容，请查看 Mastra 服务端日志）' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (controller.signal.aborted) {
        // 用户主动停止：保留已经生成的部分，没内容就给个提示
        patchChatMessage(botId, { content: acc || '（已停止生成）' })
      } else {
        // 真正的请求失败：控制台留日志 + 顶部红色提示条 + 该条气泡标红
        console.error('AI 对话失败：', err)
        // 常见错误（余额不足/鉴权失败/限流）翻译成用户能看懂的提示，其余原样展示
        setChatError(friendlyError(msg))
        patchChatMessage(botId, { content: `请求失败：${friendlyError(msg)}`, error: true })
      }
    } finally {
      // 无论成功/失败/中断，都要收尾：关掉 pending 光标、清掉控制器、恢复可输入
      patchChatMessage(botId, { pending: false })
      chatAbortRef.current = null
      setChatBusy(false)
    }
  }

  /** 普通发送：把输入框内容作为新一轮提问发给智能体 */
  const handleChatSend = async () => {
    const text = chatInput.trim()
    // 空内容 或 上一次还没回完，就不允许重复发送（避免并发把消息顺序搞乱）
    if (!text || chatBusy) return
    // 用户主动发消息 → 立即恢复「跟随最新」，否则刚发的话可能不在视野里
    setAutoFollow(true)

    // 如果最新一条 AI 消息上挂着「未回答」的 ask_user 卡片，
    // 那么这次输入不是新问题，而是对卡片的【自由文本回答】→ 走续跑流程。
    const pendingAsk = [...chatMessages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.askUser && !m.askUser.answered)
    if (pendingAsk?.askUser) {
      await handleAskUserAnswer(pendingAsk, text)
      setChatInput('')
      return
    }

    // 提前把 AI 消息的 id 定下来，后面流式追加时才能精准找到它
    const botId = nextChatId()
    setChatError('')
    setChatMessages((prev) => [
      ...prev,
      { id: nextChatId(), role: 'user', content: text, createdAt: Date.now() },
      // 占位消息：content 为空时界面显示「思考中」动画，pending 控制打字光标
      { id: botId, role: 'assistant', content: '', pending: true, createdAt: Date.now() },
    ])
    setChatInput('') // 清空输入框，方便接着问下一句
    await executeAgentTurn(
      botId,
      // 只传这句话，历史上下文由 Mastra 服务端根据 thread 自己取
      (memoryOpt) => mastraClient.getAgent(PATROL_AGENT_ID).stream(text, { memory: memoryOpt }),
      { fallbackText: text },
    )
  }

  /**
   * 回答 ask_user 卡片：用 resumeStream 续跑被挂起的那次运行。
   * answer 是 string（单选 / 自由文本）或 string[]（多选）。
   */
  const handleAskUserAnswer = async (msg: ChatMessage, answer: string | string[]) => {
    const card = msg.askUser
    if (!card || card.answered || chatBusy) return

    const labels = Array.isArray(answer) ? answer : [answer]
    setChatError('')
    // 1) 卡片标记为已回答：按钮变灰禁用，并回显用户的选择
    patchChatMessage(msg.id, { askUser: { ...card, answered: true, selected: labels } })

    // 2) 把用户的回答记录成一条用户消息（视觉上和普通聊天保持一致）
    const botId = nextChatId()
    setChatMessages((prev) => [
      ...prev,
      { id: nextChatId(), role: 'user', content: labels.join('、'), createdAt: Date.now() },
      { id: botId, role: 'assistant', content: '', pending: true, createdAt: Date.now() },
    ])

    // 3) resumeStream 续跑：ask_user 工具拿到答案返回给模型，AI 接着处理后续字段
    await executeAgentTurn(botId, (memoryOpt) =>
      mastraClient.getAgent(PATROL_AGENT_ID).resumeStream(answer, {
        runId: card.runId, // 挂起事件顶层带回来的运行 id
        toolCallId: card.toolCallId, // 被挂起的工具调用 id
        memory: memoryOpt,
      }),
    )
  }

  /** 多选卡片：记录每个卡片当前勾选了哪些选项（key = 消息 id） */
  const [multiPicks, setMultiPicks] = useState<Record<string, string[]>>({})

  /** 停止生成：abort 后 readMastraStream 会取消读取器，流程走到 catch 分支收尾 */
  const handleChatStop = () => {
    chatAbortRef.current?.abort()
  }

  /**
   * 清空会话：清前端列表，同时换一个新线程。
   *
   * 必须换线程：服务端的记忆是按 thread 存的，不换的话继续问会接着上次的话题，
   * 用户看到的就是「明明清空了，AI 却还记得」，像是没清干净。
   */
  const handleClearChat = () => {
    if (chatBusy) return
    setChatMessages([])
    setChatError('')
    const nextThread = createThreadId()
    localStorage.setItem(THREAD_STORAGE_KEY, nextThread)
    setChatThreadId(nextThread)
    chatInputRef.current?.focus()
  }

  /**
   * 键盘事件：Enter 发送，Shift + Enter 换行。
   * 关键点是 isComposing —— 中文输入法打字时按 Enter 是「确认候选词」，
   * 如果不判断，选词时会误触发发送。
   */
  const handleChatKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault() // 阻止 textarea 默认的换行
      void handleChatSend()
    }
  }

  return (
    <div className="chat-page page-fade-in">
      <main className="chat-panel">
        {/* 工具栏：标题 + 当前线程 id（方便排查记忆是否生效）+ 清空按钮 */}
        <div className="chat-toolbar">
          <div className="chat-toolbar-left">
            <span className="chat-title">AI 智能巡视助手</span>
            <span className="chat-thread" title={chatThreadId}>
              线程：{chatThreadId}
            </span>
          </div>
          <div className="chat-toolbar-right">
            <Space>
              {/* 生成中或本来就没消息时禁止清空 */}
              <Button icon={<ClearOutlined />} onClick={handleClearChat} disabled={chatBusy || chatMessages.length === 0}>
                清空会话
              </Button>
            </Space>
          </div>
        </div>

        {/* 消息列表：固定高度区域，滚动只发生在内部。
            wrap 是定位锚点，「回到顶部 / 回到底部」悬浮按钮挂在它上面，
            不会跟着列表内容一起滚动。 */}
        <div className="chat-list-wrap">
          <div className="chat-list" ref={chatListRef} onScroll={handleChatListScroll}>
            {chatMessages.length === 0 ? (
              /* 空态：给三个示例问题，点击直接填入输入框，降低用户上手成本 */
              <div className="chat-empty">
                <p className="chat-empty-title">还没有对话，试着问一句吧</p>
                <div className="chat-suggestions">
                  {['你好，请介绍一下你自己', '帮我查询今天的巡视任务', '今天的天气适合现场巡视吗'].map((item) => (
                    <Button key={item} onClick={() => setChatInput(item)}>
                      {item}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              chatMessages.map((msg) => (
                /* 一行消息 = 头像 + 气泡；className 带 role，CSS 用 .user 做反向排列（靠右） */
                <div key={msg.id} className={`chat-row ${msg.role}`}>
                  <div className="chat-avatar">{msg.role === 'user' ? '我' : 'AI'}</div>
                  <div className={`chat-bubble${msg.error ? ' is-error' : ''}`}>
                    {msg.content ? (
                      /* 用 react-markdown 渲染：智能体输出的表单/确认信息都是
                         GFM 表格 + 加粗 + 引用语法，纯文本展示会出现 |---| 这类原始符号。
                         remark-gfm 插件让表格语法生效。 */
                      <div className="chat-text chat-md">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      /* 还没收到第一个字：显示三点「思考中」动画 */
                      <span className="chat-typing" aria-label="正在思考">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}

                    {/* ask_user 选择卡片：AI 挂起等待用户选择时展示。
                    单选点一下直接回答；多选先勾选再点「确定」；
                    没有选项的自由文本提问则提示用户在输入框里回答。 */}
                    {msg.askUser ? (
                      <div className={`ask-card${msg.askUser.answered ? ' is-answered' : ''}`}>
                        <div className="ask-question">{msg.askUser.question}</div>
                        {msg.askUser.answered ? (
                          <div className="ask-answered">已选择：{(msg.askUser.selected ?? []).join('、')}</div>
                        ) : msg.askUser.options?.length ? (
                          <AskUserChoices
                            card={msg.askUser}
                            picks={multiPicks[msg.id] ?? []}
                            onChangePicks={(labels) => setMultiPicks((prev) => ({ ...prev, [msg.id]: labels }))}
                            onPick={(answer) => void handleAskUserAnswer(msg, answer)}
                            onConfirm={() => void handleAskUserAnswer(msg, multiPicks[msg.id] ?? [])}
                          />
                        ) : (
                          // 自由文本提问：没有选项，引导用户在输入框回答
                          // （handleChatSend 里会检测到未回答卡片，自动走 resumeStream）
                          <div className="ask-hint">请在下方输入框直接输入回答，发送后 AI 会继续</div>
                        )}
                      </div>
                    ) : null}

                    {/* 已经开始出字且还没结束：末尾跟一个闪烁光标，表示还在写 */}
                    {msg.pending && msg.content ? <span className="chat-caret" /> : null}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 「回到顶部」悬浮按钮：下滚超过 200px 才出现，点击平滑滚回第一条消息 */}
          {showBackTop ? (
            <Tooltip title="回到顶部">
              <Button
                className="chat-float-btn chat-back-top"
                shape="circle"
                icon={<VerticalAlignTopOutlined />}
                onClick={() => scrollChatList('top')}
              />
            </Tooltip>
          ) : null}

          {/* 「回到底部」悬浮提示：用户翻历史时出现，点击恢复自动跟随最新消息 */}
          {!autoFollow ? (
            <Button
              className="chat-float-btn chat-to-bottom"
              size="small"
              shape="round"
              icon={<VerticalAlignBottomOutlined />}
              onClick={() => scrollChatList('bottom')}
            >
              回到最新
            </Button>
          ) : null}
        </div>

        {/* 全局错误提示条（请求失败时显示，和单条红色气泡互补）。
            antd Alert 自带图标和关闭按钮，所以这里多传一个 onClose 清掉错误状态 */}
        {chatError ? (
          <Alert className="chat-error" type="error" showIcon closable message={chatError} onClose={() => setChatError('')} />
        ) : null}

        {/* 输入区：antd Input.TextArea + 发送/停止按钮 */}
        <div className="chat-composer">
          {/*
            autoSize={{ minRows: 1, maxRows: 6 }} 由 antd 自己算高度，
            所以之前手写 textarea + 用 useEffect 改 scrollHeight 的那段逻辑可以删掉了。
            onKeyDown 仍然自己处理：要判断 Shift（换行）和输入法 composing 状态。
          */}
          <Input.TextArea
            ref={chatInputRef}
            className="chat-input"
            autoSize={{ minRows: 1, maxRows: 6 }}
            value={chatInput}
            placeholder="输入你的问题，Enter 发送，Shift + Enter 换行"
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleChatKeyDown}
            disabled={chatBusy} /* 生成中锁住输入，避免一次发多句 */
          />
          {/* 一个按钮两种形态：空闲时是「发送」，生成中变成「停止」 */}
          {chatBusy ? (
            <Button danger icon={<PauseCircleOutlined />} onClick={handleChatStop}>
              停止
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => void handleChatSend()}
              disabled={!chatInput.trim()} /* 空白内容不允许发送 */
            >
              发送
            </Button>
          )}
        </div>
      </main>
    </div>
  )
}
