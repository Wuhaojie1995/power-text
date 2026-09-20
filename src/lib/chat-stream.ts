/* =========================================================================
 * SSE 流式响应读取器 + 错误文案处理
 *
 * 为什么自己写解析？
 * Mastra 客户端的 agent.stream() 会返回一个 Response，官方提供了
 * res.processDataStream({ onChunk }) 来解析。但翻源码（client-js/dist/index.js
 * 的 stream 方法）会发现：它内部调用 processMastraStream 时【没有把 signal
 * 透传进去】，所以传 AbortSignal 是无效的，「停止生成」按钮点了没反应。
 * 自己解析 SSE 才能真正做到中断。
 *
 * SSE 格式长这样，每个事件用空行分隔：
 *   data: {"type":"text-delta","payload":{"text":"你"}}\n\n
 *   data: {"type":"text-delta","payload":{"text":"好"}}\n\n
 *   data: [DONE]\n\n
 * ========================================================================= */

/**
 * Mastra 流式响应里每个 SSE 事件（chunk）的形状。
 * 常见 type：text-delta（文本片段）、tool-call（调用工具）、
 * tool-call-suspended（ask_user 挂起，等用户选择）、error（出错）。
 * 这里只做最小定义，用 optional 字段兼容未来新增的事件类型。
 */
export interface StreamChunk {
  type?: string
  /** 注意：runId 在事件顶层，不在 payload 里（已对照 @mastra/core 源码确认） */
  runId?: string
  payload?: Record<string, any>
}

export async function readMastraStream(
  response: Response, // agent.stream() 返回的响应对象
  onChunk: (chunk: StreamChunk) => void, // 每解析出一个事件就回调一次
  signal?: AbortSignal, // 用于「停止生成」：abort 时立刻断开读取
): Promise<void> {
  const body = response.body
  if (!body) throw new Error('响应体为空，无法读取流式数据（请确认 Mastra 服务已启动）')

  const reader = body.getReader() // 拿到底层字节流的读取器
  const decoder = new TextDecoder() // 字节 → 字符串（stream:true 处理被截断的多字节汉字）
  let buffer = '' // 累积未处理完的半包数据

  /** 中断处理：取消读取器，让下面的 while 循环自然结束 */
  const abort = () => {
    try {
      void reader.cancel()
    } catch {
      // ignore：已经取消过就忽略
    }
  }
  // 如果调用前就已经 abort 了，直接取消；否则监听 abort 事件
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })

  /** 解析单个 SSE 事件（一段 data: 内容） */
  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    // 找到 "data:" 开头的那一行，取冒号后面的内容
    const dataLine = trimmed.split('\n').find((l) => l.trim().startsWith('data:'))
    const raw = (dataLine ? dataLine.slice(dataLine.indexOf(':') + 1) : trimmed).trim()
    if (!raw || raw === '[DONE]') return // [DONE] 是流结束哨兵
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') onChunk(parsed as StreamChunk)
    } catch {
      // 兜底：万一服务端回的不是 JSON（比如纯文本），当成文本片段处理，不至于白屏
      onChunk({ type: 'text-delta', payload: { text: raw } })
    }
  }

  try {
    // 持续读取字节流，直到服务端关闭连接或我们主动取消
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // 关键：一次网络包可能包含多个事件，也可能只有半个事件。
      // 按空行切成完整的事件去处理，最后一个（可能不完整）留在 buffer 里等下一包。
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''
      parts.forEach(handleLine)
    }
    // 流结束时 buffer 里可能还有没被空行结尾的最后一段，补处理一次
    if (buffer.trim()) handleLine(buffer)
  } finally {
    // 无论如何都要清理：解绑监听 + 释放锁
    signal?.removeEventListener('abort', abort)
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }
}

/**
 * 把任意形状的错误值转成人类可读的一句话。
 * 流里的 error chunk 的 payload.error 往往不是字符串，而是 AI SDK 的错误对象
 * （比如 AI_APICallError），直接 String() 会得到 "[object Object]"。
 * 提取顺序：message 字段 → name 字段 → JSON 序列化，兜底保证永远有可读文本。
 */
export function describeError(value: unknown): string {
  if (value == null) return '未知错误'
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const obj = value as Record<string, any>
    // AI_APICallError 等对象上 message 最有信息量（比如 "Insufficient Balance"）
    if (obj.message) return String(obj.message)
    if (obj.name) return String(obj.name)
    try {
      return JSON.stringify(obj)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/**
 * 把底层报错翻译成用户能看懂的提示。
 * 常见错误单独给出解决动作，其余走通用文案。
 */
export function friendlyError(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('insufficient balance')) {
    return '模型服务余额不足（Insufficient Balance）：请联系管理员到模型平台充值后重试。'
  }
  if (lower.includes('authentication') || lower.includes('401') || lower.includes('api key')) {
    return '模型服务鉴权失败：请检查 Mastra 服务端配置的模型 API Key 是否正确。'
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return '模型服务限流中：请求太频繁，请稍等几秒再试。'
  }
  if (lower.includes('failed to fetch') || lower.includes('network')) {
    return '连不上 Mastra 服务：请确认已执行 npm run dev:mastra，且服务运行在 4112 端口。'
  }
  return raw
}

/**
 * 生成消息 id。
 * 不直接用 Math.random()，而是 时间戳 + 自增序号：
 * 同一毫秒内连续创建多条消息时也不会撞 id（React 的 key 必须唯一）。
 * chatSeq 是模块级变量，整个页面生命周期内单调递增。
 */
let chatSeq = 0
export function nextChatId(): string {
  chatSeq += 1
  return `chat-${Date.now().toString(36)}-${chatSeq}`
}
