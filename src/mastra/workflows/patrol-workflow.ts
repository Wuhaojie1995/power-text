import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import type { z as zt } from 'zod'

const userRequestSchema = z.object({
  request: z
    .string()
    .min(1)
    .describe(
      '用户原始自然语言输入，例如「帮我新增 3号楼主体工程 2层梁板 2026-08-15 09:00 到 11:30 现场情况正常」',
    ),
  context: z
    .object({
      threadId: z.string().optional(),
      resourceId: z.string().optional(),
      memory: z.record(z.string(), z.any()).optional(),
    })
    .optional(),
})

// 单个问题的形状（与 patrolTool 的 projectProblemForms 保持一致）
const problemFormSchema = z.object({
  content: z.string().optional().describe('问题描述'),
  discoveryTime: z.string().optional().describe('发现时间（原始相对表达，由 resolve-times 统一换算）'),
  deadlineDate: z.string().optional().describe('整改时限'),
  type: z.string().optional().describe('问题类型，6 选 1：质量问题/安全问题/进度问题/人员问题/程序问题/其它问题'),
  classifyTypeId: z.string().optional().describe('问题分类（二级分类 ID，由问题分类工具查询得到）'),
  rectificationIds: z.array(z.string()).optional().describe('整改人（多选）'),
  reviewIds: z.array(z.string()).optional().describe('复查人（多选）'),
  engineerId: z.string().optional().describe('问题所属单位工程（选填）'),
  part: z.string().optional().describe('问题所在部位（选填）'),
  severity: z.string().optional().describe('问题性质（选填，性质 ID）'),
})

type QueryShape = {
  unitProject: string
  patrolPart: string
  startTime: string
  endTime: string
  siteCondition: string
  projectProblemForms?: zt.infer<typeof problemFormSchema>[]
}

const queryFieldShape = z.object({
  unitProject: z.string().optional().describe('单位工程'),
  patrolPart: z.string().optional().describe('巡视部位（字段名 patrolPart）'),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  siteCondition: z.string().optional(),
  projectProblemForms: z.array(problemFormSchema).optional().describe('问题列表（选填）'),
}) satisfies zt.ZodType<Partial<QueryShape>>

// 本助手只支持新增：create=新增，unsupported=编辑/查看详情等不支持的操作，clarify=信息不足需澄清
const parsedActionSchema = z.object({
  action: z.enum(['create', 'unsupported', 'clarify']),
  reason: z.string().describe('分类原因'),
  payload: queryFieldShape.describe('从用户输入能提取到的任何字段，缺的保持空'),
  missingFields: z
    .array(z.string())
    .describe('缺失的必要字段名；action=clarify 时必须非空，create 缺必填时也列出'),
  confidence: z.number().min(0).max(1).default(1),
})

type ParsedAction = zt.infer<typeof parsedActionSchema>

type ToolCall = ParsedAction & {
  toolInput: Record<string, any>
  shouldClarify: boolean
  confirmText?: string
}

const _toolCallSchemaBase = parsedActionSchema.extend({
  toolInput: z
    .record(z.string(), z.any())
    .describe('传给 patrolTool 的输入；需要澄清或不支持时为 {}'),
  shouldClarify: z.boolean(),
  confirmText: z.string().optional().describe('需要用户确认的结构化字段文本'),
})
const toolCallSchema: zt.ZodType<ToolCall> = _toolCallSchemaBase as any

type ToolResult = ToolCall & { toolResult?: any }

const _toolResultSchemaBase = _toolCallSchemaBase.extend({ toolResult: z.any().optional() })
const toolResultSchema: zt.ZodType<ToolResult> = _toolResultSchemaBase as any

const workflowResultSchema = z.object({
  reply: z.string().describe('给用户展示的最终中文回复'),
  action: z.enum(['create', 'unsupported', 'clarify']),
  toolResult: z.any().optional(),
})

type WorkflowResult = zt.infer<typeof workflowResultSchema>

const parseIntent = createStep({
  id: 'parse-intent',
  description: '把用户自然语言请求解析为 create/unsupported/clarify，抽取可识别字段并列出缺失字段',
  inputSchema: userRequestSchema,
  outputSchema: parsedActionSchema,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra.getAgent('patrolAgent')
    const prompt =
      '你是巡视记录分类器（本助手只支持新增巡视记录）。只返回严格匹配 JSON Schema 的对象，不要 Markdown 包裹。\n\n' +
      '字段规则：\n' +
      '- action=create：用户明确说「新增 / 创建 / 新建 / 登记 / 录入」巡视记录；检查 5 个业务必填是否齐全：unitProject(单位工程)、patrolPart(巡视部位)、startTime(原始文本，如"今天10:30"，不要做换算)、endTime(原始文本，不要做换算，要晚于 start)、siteCondition(现场情况)。缺哪个写到 missingFields。用户提到发现的问题时，追加到 payload.projectProblemForms（每个问题必填 content/discoveryTime/deadlineDate/type/classifyTypeId/rectificationIds/reviewIds，缺的列进 missingFields）。\n' +
      '- action=unsupported：用户明确说「修改 / 编辑 / 改一下 / 调整 / 查看详情 / 查一下记录」等本助手不支持的操作；missingFields 留空数组。\n' +
      '- action=clarify：意图不明确（例如只说「我要做个巡视」），或必要字段缺太多；missingFields 必须非空。\n\n' +
      '⚠️ 非常重要：在本 step 里 payload 的 startTime/endTime/discoveryTime 必须保留用户的原始相对表达（例如"今天上午""昨天18:00"），绝对不要在本 step 直接用 LLM 自己硬编码换算成具体日期，由 workflow 的下一个 step resolve-times 统一调用 dateTimeTool 动态换算。\n\n' +
      `用户原始请求：\n${JSON.stringify(inputData.request)}\n\n` +
      `可选上下文：\n${inputData.context ? JSON.stringify(inputData.context, null, 2) : '（无）'}`

    const result = await agent.generate(prompt, {})
    const text = String(result.text ?? '').trim()
    const jsonStart = text.indexOf('{')
    const jsonEnd = text.lastIndexOf('}')
    const clean = jsonStart >= 0 && jsonEnd > jsonStart ? text.slice(jsonStart, jsonEnd + 1) : text
    const parsed = JSON.parse(clean)
    return parsedActionSchema.parse(parsed) as ParsedAction
  },
})

const resolveTimes = createStep({
  id: 'resolve-times',
  description: '调用 dateTimeTool 把 payload 中的 startTime/endTime（以及问题的 discoveryTime/deadlineDate）相对表达统一换算成东八区绝对时间',
  inputSchema: parsedActionSchema,
  outputSchema: parsedActionSchema,
  execute: async ({ inputData, mastra }) => {
    const tool = mastra.getTool('dateTimeResolver')
    const action = inputData.action
    const payload = inputData.payload ?? {}
    const warnings: string[] = []

    if (!tool || typeof tool.execute !== 'function') {
      return inputData
    }

    const run = async (i: unknown) => {
      if (!tool || typeof tool.execute !== 'function') return null
      return tool.execute(JSON.parse(JSON.stringify(i)), { mastra: mastra as any })
    }

    // 只有新增才需要换算时间
    if (action === 'create') {
      if (payload.startTime || payload.endTime) {
        const res = await run({
          mode: 'start-end',
          startRaw: payload.startTime,
          endRaw: payload.endTime,
          fallbackFullDay: true,
        })
        if (res?.success) {
          if (res.startTime) payload.startTime = res.startTime
          if (res.endTime) payload.endTime = res.endTime
          if (res.warnings && res.warnings.length > 0) warnings.push(...res.warnings)
        }
      }

      // 问题的发现时间（到分）与整改时限（到天）也统一换算
      const problems = Array.isArray(payload.projectProblemForms) ? payload.projectProblemForms : []
      for (const problem of problems as any[]) {
        if (problem?.discoveryTime) {
          const res = await run({ mode: 'start-only', startRaw: problem.discoveryTime })
          if (res?.success && res.startTime) problem.discoveryTime = res.startTime
          if (res?.warnings && res.warnings.length > 0) warnings.push(...res.warnings)
        }
        if (problem?.deadlineDate) {
          const res = await run({ mode: 'date-only', dateRaw: problem.deadlineDate })
          if (res?.success && (res.date ?? res.dateOnly)) problem.deadlineDate = res.date ?? res.dateOnly
        }
      }
    }

    return {
      ...inputData,
      payload,
      missingFields: Array.from(new Set([...(inputData.missingFields || []), ...warnings])),
    } as ParsedAction
  },
})

const buildToolCall = createStep({
  id: 'build-tool-call',
  description: '把 parsedAction 转换成 patrolTool 的 create 输入；若字段缺失或操作不支持则标记需要澄清',
  inputSchema: parsedActionSchema,
  outputSchema: toolCallSchema,
  execute: async ({ inputData }) => {
    const { action, payload, missingFields } = inputData
    const base: ToolCall = { ...inputData, toolInput: {}, shouldClarify: false, confirmText: undefined }

    // 不支持的操作（编辑/查看详情）或意图不明 → 交给 compose-reply 说明边界/澄清
    if (action === 'unsupported' || action === 'clarify' || (missingFields && missingFields.length > 3)) {
      return { ...base, toolInput: {}, shouldClarify: true }
    }

    // action === 'create'：校验 5 个业务必填
    const requiredForCreate: (keyof QueryShape)[] = [
      'unitProject',
      'patrolPart',
      'startTime',
      'endTime',
      'siteCondition',
    ]
    const absent = requiredForCreate.filter((k) => !(payload as any)?.[k])
    if (absent.length > 0) {
      return {
        ...base,
        toolInput: {},
        shouldClarify: true,
        missingFields: Array.from(new Set([...(missingFields || []), ...absent])),
      }
    }

    // 问题数组：过滤掉空对象，确保每个问题都带固定来源 sourceType=PATROL
    const problems = (Array.isArray(payload.projectProblemForms) ? payload.projectProblemForms : [])
      .filter((p: any) => p && Object.keys(p).length > 0)
      .map((p: any) => ({ ...p, sourceType: 'PATROL' }))

    const createPayload = {
      unitProject: payload.unitProject!,
      patrolPart: payload.patrolPart!,
      startTime: payload.startTime!,
      endTime: payload.endTime!,
      siteCondition: payload.siteCondition!,
      ...(problems.length > 0 ? { projectProblemForms: problems } : {}),
    }

    const confirmText =
      `确认新增巡视记录（请核对）：\n` +
      Object.entries(createPayload)
        .filter(([, v]) => !Array.isArray(v))
        .map(([k, v]) => `  - ${k}：${v}`)
        .join('\n') +
      (problems.length > 0
        ? `\n  - 问题记录：共 ${problems.length} 条\n` +
          problems.map((p: any, i: number) => `      #${i + 1} ${p.content ?? ''}（类型：${p.type ?? '待补充'}）`).join('\n')
        : '\n  - 问题记录：无')

    return {
      ...base,
      toolInput: { action: 'create' as const, createPayload },
      shouldClarify: false,
      confirmText,
    }
  },
})

const maybeCallPatrolTool = createStep({
  id: 'maybe-call-patrol-tool',
  description: 'shouldClarify=false 时调用 patrolTool 执行 create；否则跳过',
  inputSchema: toolCallSchema,
  outputSchema: toolResultSchema,
  execute: async ({ inputData, mastra }) => {
    if (inputData.shouldClarify) return { ...inputData, toolResult: null }
    const tool = mastra.getTool('patrolTool')
    if (!tool || typeof tool.execute !== 'function') throw new Error('patrolTool 未注册或缺少 execute 方法')
    const toolInput = JSON.parse(JSON.stringify(inputData.toolInput ?? {}))
    const toolResult = await tool.execute(toolInput, { mastra: mastra as any })
    return { ...inputData, toolResult }
  },
})

const composeReply = createStep({
  id: 'compose-reply',
  description: '把澄清/边界说明文本或工具执行结果合成最终中文回复',
  inputSchema: toolResultSchema,
  outputSchema: workflowResultSchema,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra.getAgent('patrolAgent')
    const action: WorkflowResult['action'] =
      inputData.action === 'create' || inputData.action === 'unsupported' || inputData.action === 'clarify'
        ? inputData.action
        : 'clarify'

    // 不支持的操作：明确说明本助手只支持新增，并引导用户发起新增
    if (inputData.action === 'unsupported') {
      return {
        reply:
          '抱歉，我目前只支持新增巡视记录，暂时无法编辑或查看详情 🙇\n\n' +
          '你可以直接照着下面的格式发起新增：\n' +
          '「新增 3号楼主体 2层梁板 今天上午9点到11点半 模板支设符合方案要求，发现一处钢筋间距偏大，张工整改，王监理复查」',
        action: 'unsupported' as const,
      }
    }

    if (inputData.shouldClarify) {
      const prompt =
        '基于以下解析结果，用简洁中文对用户澄清：\n\n' +
        `缺失字段：${JSON.stringify(inputData.missingFields ?? [])}\n` +
        `已提取字段：${JSON.stringify(inputData.payload ?? {})}\n` +
        `推断动作：${action}\n` +
        `推断原因：${inputData.reason}\n\n` +
        '要求：\n' +
        '1. 自然中文告诉用户你还需要哪些信息才能继续，最多列出 5 条最重要的。\n' +
        '2. 给出 1-2 个引导示例，例如：\n' +
        '   「例如，你可以回复：新增 3号楼主体 2层梁板 2026-08-15 09:00 2026-08-15 11:30 模板支设符合方案要求」。\n' +
        '3. 说明 5 个必填业务字段：单位工程、巡视部位、开始时间、结束时间、现场情况；\n' +
        '   如果用户提到了问题，还要补齐每个问题的：问题描述、发现时间、整改时限、问题类型、问题分类、整改人、复查人。'
      const r = await agent.generate(prompt, {})
      return { reply: String(r.text ?? ''), action: 'clarify' as const }
    }

    const resultText =
      typeof inputData.toolResult === 'string'
        ? inputData.toolResult
        : JSON.stringify(inputData.toolResult ?? {}, null, 2)

    const prompt =
      '把巡视新增操作的结构化最终结果翻译成简洁友好的中文回复。\n\n' +
      `执行动作：${action}\n` +
      `确认文本（如有）：\n${inputData.confirmText ?? '（无）'}\n\n` +
      `工具返回结果：\n${resultText}\n\n` +
      '要求：\n' +
      '1. create 成功：用「已创建 ✅」开头，用 Markdown 两列表格列出关键字段（记录 ID、单位工程、巡视部位、开始/结束时间、现场情况、创建人、创建时间）；有问题时每个问题单独一张表。\n' +
      '2. 失败/error 非空：不要堆原始堆栈，翻成一句人话，提示检查 PATROL_INTERNAL_API_BASE 和内网连通性，或稍后重试。'

    const r = await agent.generate(prompt, {})
    return {
      reply: String(r.text ?? ''),
      action,
      toolResult: inputData.toolResult,
    }
  },
})

export const patrolWorkflow = createWorkflow({
  id: 'patrol-workflow',
  inputSchema: userRequestSchema,
  outputSchema: workflowResultSchema,
})
  .then(parseIntent)
  .then(resolveTimes)
  .then(buildToolCall)
  .then(maybeCallPatrolTool)
  .then(composeReply)

patrolWorkflow.commit()
