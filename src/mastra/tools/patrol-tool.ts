import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { UNIT_PROJECT_OPTION_NAMES, fetchUnitProjectOptions, type UnitProjectOption } from './unit-project-tool'
import { PROBLEM_TYPE_NAMES, fetchProblemTypeOptions, type ProblemTypeOption } from './problem-type-tool'
import { fetchProjectMembers, type ProjectMember } from './project-member-tool'
import { fetchProblemClassifyOptions } from './problem-classify-tool'
import { fetchProblemNatureOptions } from './problem-nature-tool'
export { PATROL_COMPANY_ID, PATROL_PROJECT_ID, PATROL_PROJECT_TYPE, AUTHORIZATION_TOKEN } from './patrol-constants'
import { AUTHORIZATION_TOKEN, PATROL_COMPANY_ID, PATROL_PROJECT_ID } from './patrol-constants'



// 巡视问题 schema
export const patrolProblemSchema = z.object({
  content: z.string().min(1).describe('问题描述（必填，自由文本；要求详细说明问题的具体情况、现象、影响范围等）'),
  sourceType: z.literal('PATROL').default('PATROL').describe('问题来源类型（固定值，始终为 PATROL；由系统自动补齐，无需用户填写）'),
  discoveryTime: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '发现时间格式必须为 YYYY-MM-DD HH:mm')
    .describe('发现时间（必填，格式 YYYY-MM-DD HH:mm；指现场发现该问题的具体日期和时间）'),
  deadlineDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '整改时限格式必须为 YYYY-MM-DD')
    .describe('整改时限（必填，格式 YYYY-MM-DD；要求整改完成的最晚截止日期，必须晚于或等于发现日期）'),
  engineerId: z.string().min(1).optional().describe(`问题所属单位工程（选填，建议从以下可选项中选择：${UNIT_PROJECT_OPTION_NAMES.join(' / ')}；后续将改为通过 unitProjectTool 动态获取。暂允许自由文本输入。`),
  part: z
    .string()
    .min(1)
    .optional()
    .describe('所在部位（选填，自由文本；问题发生的具体位置，如"3层东单元剪力墙"、"基坑北侧边坡"等）'),
  type: z
    // The dictionary is loaded at runtime, so a static enum would reject valid API values.
    .string()
    .min(1)
    .describe(`问题类型（必填，从问题类型字典中选择，建议候选项：${PROBLEM_TYPE_NAMES.join(' / ')}；按问题的归属类别选择）`),
  classifyTypeId: z.string().min(1).describe('问题分类（必填）：提交二级分类的 ID，必须来自 problemClassifyTool 按当前问题类型查询的结果，禁止编造；切换问题类型后需重新查询'),
  rectificationIds: z
    .array(z.union([z.string().min(1), z.object({ id: z.string(), name: z.string(), userId: z.string() })]))
    .optional()
    .describe('整改人（必填，多选；必须从当前项目人员列表匹配，提交完整 {id,name,userId} 对象；不存在或重名时禁止提交并提醒/确认）'),
  reviewIds: z
    .array(z.union([z.string().min(1), z.object({ id: z.string(), name: z.string(), userId: z.string() })]))
    .optional()
    .describe('复查人（必填，多选；必须从当前项目人员列表匹配，提交完整 {id,name,userId} 对象；不存在或重名时禁止提交并提醒/确认）'),
  severity: z
    .string().min(1)
    .optional()
    .describe('问题性质（选填，从问题性质接口按当前问题类型获取；提交时使用性质 ID）'),
})
// 巡视记录 schema
export const patrolRecordSchema = z.object({
  id: z.string().describe('巡视记录 ID（编辑/详情时必填；新增时由系统生成）'),
  companyId: z.literal(PATROL_COMPANY_ID).describe('企业 ID（固定值）'),
  projectId: z.literal(PATROL_PROJECT_ID).describe('项目 ID（固定值）'),
  unitProject: z.string().min(1).describe(`单位工程（必填，建议从以下可选项中选择：${UNIT_PROJECT_OPTION_NAMES.join(' / ')}；后续将改为通过 unitProjectTool 动态获取。暂允许自由文本输入。`),
  patrolPart: z.string().min(1).describe('巡视部位（必填，字段名 patrolPart，）'),
  startTime: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '开始时间格式必须为 YYYY-MM-DD HH:mm')
    .describe('开始时间，格式 YYYY-MM-DD HH:mm（必填）'),
  endTime: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '结束时间格式必须为 YYYY-MM-DD HH:mm')
    .describe('结束时间，格式 YYYY-MM-DD HH:mm（必填，且应晚于 startTime）'),
  siteCondition: z.string().min(1).describe('现场情况（必填，不限制字数，只要非空且如实描述即可，长短均可）'),
  projectProblemForms: z.array(patrolProblemSchema).optional().describe(`问题列表（可选，数组格式；每个问题内部有独立字段，且包含固定来源字段 sourceType=PATROL；问题的 engineerId（单位工程）建议从：${UNIT_PROJECT_OPTION_NAMES.join(' / ')} 中选择）。`),
  createdBy: z.string().optional().describe('创建人（系统字段，输出时返回）'),
  createdAt: z.string().optional().describe('创建时间（系统字段，输出时返回）'),
  updatedBy: z.string().optional().describe('修改人（系统字段，编辑时返回）'),
  updatedAt: z.string().optional().describe('修改时间（系统字段，编辑时返回）'),
})
// 创建巡视记录 payload 校式
const createPayloadSchema = z.object({
  unitProject: z.string().min(1).describe(`单位工程（必填，建议从以下可选项中选择：${UNIT_PROJECT_OPTION_NAMES.join(' / ')}；后续将改为通过 unitProjectTool 动态获取。暂允许自由文本输入。`),
  patrolPart: z.string().min(1).describe('巡视部位（必填，字段名 patrolPart，）'),
  startTime: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '开始时间格式必须为 YYYY-MM-DD HH:mm')
    .describe('开始时间，格式 YYYY-MM-DD HH:mm（必填）'),
  endTime: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '结束时间格式必须为 YYYY-MM-DD HH:mm')
    .describe('结束时间，格式 YYYY-MM-DD HH:mm（必填，且应晚于 startTime）'),
  siteCondition: z.string().min(1).describe('现场情况（必填，不限制字数，只要非空且如实描述即可，长短均可）'),
  projectProblemForms: z
    .array(patrolProblemSchema)
    .optional()
    .describe(
      '问题列表（问题性质和分类按当前 type 动态获取；severity 提交性质 ID）。',
    ),
})

// 更新巡视记录 payload 校式
const updatePayloadSchema = z.object({
  id: z.string().min(1).describe('必填：要编辑的巡视记录 ID'),
  unitProject: z.string().optional().describe(`可选：单位工程（按需覆盖，建议从：${UNIT_PROJECT_OPTION_NAMES.join(' / ')} 中选择）`),
  patrolPart: z.string().optional().describe('可选：巡视部位（按需覆盖，字段名 patrolPart，）'),
  startTime: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '开始时间格式必须为 YYYY-MM-DD HH:mm')
    .optional()
    .describe('可选：开始时间，格式 YYYY-MM-DD HH:mm（按需覆盖）'),
  endTime: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '结束时间格式必须为 YYYY-MM-DD HH:mm')
    .optional()
    .describe('可选：结束时间，格式 YYYY-MM-DD HH:mm（按需覆盖）'),
  siteCondition: z.string().optional().describe('可选：现场情况（按需覆盖，不限制字数，只要非空且如实描述即可）'),
  projectProblemForms: z
    .array(patrolProblemSchema)
    .optional()
    .describe(
      '问题数组（问题性质和分类按当前 type 动态获取；severity 提交性质 ID）。',
    ),
})
// 查询巡视记录 payload 校式
const querySchema = z.object({
  unitProject: z.string().optional().describe(`可选：按单位工程过滤（建议从：${UNIT_PROJECT_OPTION_NAMES.join(' / ')} 中选择）`),
  patrolPart: z.string().optional().describe('可选：按巡视部位过滤（字段名 patrolPart，）'),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '起始日期格式必须为 YYYY-MM-DD')
    .optional()
    .describe('可选：起始日期，格式 YYYY-MM-DD'),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '截止日期格式必须为 YYYY-MM-DD')
    .optional()
    .describe('可选：截止日期，格式 YYYY-MM-DD'),
  last: z.enum(['1', '5', '10', '全部']).optional().describe('可选：最近 N 条或全部'),
})
// 巡具输入 schema
const toolInputSchema = z.object({
  action: z.enum(['create', 'update', 'detail']).describe('必填：操作类型 = create / update / detail'),
  id: z
    .string()
    .optional()
    .describe('detail / update 时必填：巡视记录 ID。create 时留空，由系统生成。'),
  createPayload: createPayloadSchema
    .optional()
    .describe('当 action=create 时必填：新增巡视的 7 个业务字段。不要填 id / createdBy 等系统字段。'),
  updatePayload: updatePayloadSchema
    .optional()
    .describe('当 action=update 时必填：要变更的字段；id 必填，其他 7 个业务字段按需覆盖。系统维护字段无需传入。'),
  query: querySchema.optional().describe('当 action=detail 且没有 id 时可选：按条件筛选（query 各字段均为可选）。'),
})
// 巡具输出 schema
const toolOutputSchema = z.object({
  success: z.boolean().describe('是否执行成功'),
  action: z.enum(['create', 'update', 'detail']).describe('实际执行的操作类型'),
  record: patrolRecordSchema.optional().describe('单条巡视详情（create/update 成功后返回）'),
  records: z.array(patrolRecordSchema).optional().describe('多条巡视列表（detail 按条件筛选时返回）'),
  message: z.string().optional().describe('成功/失败时的辅助说明文字'),
  error: z.string().optional().describe('错误信息（当 success=false 时填充）'),
})

const INTERNAL_API_BASE =
  process.env.PATROL_INTERNAL_API_BASE ?? 'https://dev.p3china.com:7700/nbg.app.dev/api'

type ToolInput = z.infer<typeof toolInputSchema>

type Mappers = {
  unitProjectNameToId: Map<string, string>
  unitProjectIdToName: Map<string, string>
  problemTypeNameToCode: Map<string, string>
  problemTypeCodeToName: Map<string, string>
  members: ProjectMember[]
  classifyNameToId: Map<string, string>
  classifyIdToName: Map<string, string>
  natureNameToId: Map<string, string>
  natureIdToName: Map<string, string>
}

function buildMappers(unitProjects: UnitProjectOption[], problemTypes: ProblemTypeOption[]): Mappers {
  const unitProjectNameToId = new Map<string, string>()
  const unitProjectIdToName = new Map<string, string>()
  for (const opt of unitProjects) {
    if (opt.id) unitProjectIdToName.set(opt.id, opt.name)
    if (opt.name) unitProjectNameToId.set(opt.name, opt.id)
  }

  const problemTypeNameToCode = new Map<string, string>()
  const problemTypeCodeToName = new Map<string, string>()
  for (const opt of problemTypes) {
    if (opt.code) problemTypeCodeToName.set(opt.code, opt.name)
    if (opt.name) problemTypeNameToCode.set(opt.name, opt.code)
  }

  return { unitProjectNameToId, unitProjectIdToName, problemTypeNameToCode, problemTypeCodeToName, members: [], classifyNameToId: new Map(), classifyIdToName: new Map(), natureNameToId: new Map(), natureIdToName: new Map() }
}

function resolveMembers(value: unknown, members: ProjectMember[], field: string): { value?: ProjectMember[]; error?: string } {
  if (value === undefined) return {}
  if (!Array.isArray(value)) return { error: `${field} 必须是人员数组。` }
  const resolved: ProjectMember[] = []
  for (const entry of value) {
    if (entry && typeof entry === 'object' && 'id' in entry && 'name' in entry && 'userId' in entry) {
      resolved.push(entry as ProjectMember)
      continue
    }
    const name = String(entry).trim()
    const matches = members.filter((member) => member.name === name)
    if (matches.length === 0) return { error: `${field}“${name}”未匹配到项目人员，请重新输入。` }
    if (matches.length > 1) return { error: `${field}“${name}”存在重名，请确认具体人员：${matches.map((member) => `${member.name}(id=${member.id})`).join('、')}。` }
    resolved.push(matches[0])
  }
  return { value: resolved }
}

function resolveUnitProjectId(nameOrId: string | undefined, mappers: Mappers): string | undefined {
  if (nameOrId === undefined || nameOrId === null || nameOrId === '') return nameOrId
  return mappers.unitProjectNameToId.get(nameOrId) ?? nameOrId
}

function resolveUnitProjectName(idOrName: string | undefined, mappers: Mappers): string | undefined {
  if (idOrName === undefined || idOrName === null || idOrName === '') return idOrName
  return mappers.unitProjectIdToName.get(idOrName) ?? idOrName
}

function resolveProblemTypeCode(nameOrCode: string | undefined, mappers: Mappers): string | undefined {
  if (nameOrCode === undefined || nameOrCode === null || nameOrCode === '') return nameOrCode
  return mappers.problemTypeNameToCode.get(nameOrCode) ?? nameOrCode
}

function resolveProblemTypeName(codeOrName: string | undefined, mappers: Mappers): string | undefined {
  if (codeOrName === undefined || codeOrName === null || codeOrName === '') return codeOrName
  return mappers.problemTypeCodeToName.get(codeOrName) ?? codeOrName
}

function mapProblemFieldsForBackend(problem: Record<string, any>, mappers: Mappers): Record<string, any> {
  if (!problem || typeof problem !== 'object') return problem
  const result = { ...problem }
  if (result.engineerId !== undefined) {
    result.engineerId = resolveUnitProjectId(result.engineerId, mappers)
  }
  if (result.type !== undefined) {
    result.type = resolveProblemTypeCode(result.type, mappers)
  }
  if (result.classifyTypeId !== undefined) result.classifyTypeId = mappers.classifyNameToId.get(result.classifyTypeId) ?? result.classifyTypeId
  if (result.severity !== undefined) result.severity = mappers.natureNameToId.get(result.severity) ?? result.severity
  for (const field of ['rectificationIds', 'reviewIds']) {
    if (result[field] !== undefined) {
      const resolved = resolveMembers(result[field], mappers.members, field === 'rectificationIds' ? '整改人' : '复查人')
      if (resolved.error) throw new Error(resolved.error)
      result[field] = resolved.value
    }
  }
  return result
}

function mapProblemFieldsFromBackend(problem: Record<string, any>, mappers: Mappers): Record<string, any> {
  if (!problem || typeof problem !== 'object') return problem
  const result = { ...problem }
  if (result.engineerId !== undefined) {
    result.engineerId = resolveUnitProjectName(result.engineerId, mappers)
  }
  if (result.type !== undefined) {
    result.type = resolveProblemTypeName(result.type, mappers)
  }
  if (result.classifyTypeId !== undefined) result.classifyTypeId = mappers.classifyIdToName.get(result.classifyTypeId) ?? result.classifyTypeId
  if (result.severity !== undefined) result.severity = mappers.natureIdToName.get(result.severity) ?? result.severity
  for (const field of ['rectificationIds', 'reviewIds']) {
    if (Array.isArray(result[field])) result[field] = result[field].map((entry: any) => typeof entry === 'string' ? entry : entry?.name ?? entry)
  }
  return result
}

function mapRecordFieldsForBackend(payload: Record<string, any>, mappers: Mappers): Record<string, any> {
  if (!payload || typeof payload !== 'object') return payload
  const result = { ...payload }
  if (result.unitProject !== undefined) {
    result.unitProject = resolveUnitProjectId(result.unitProject, mappers)
  }
  if (Array.isArray(result.projectProblemForms)) {
    result.projectProblemForms = result.projectProblemForms.map((p) => mapProblemFieldsForBackend(p, mappers))
  }
  return result
}

function enrichPatrolRecord<T extends Record<string, any> | undefined>(record: T, mappers: Mappers): T {
  if (!record || typeof record !== 'object') return record
  const base = { ...record }
  if (base.unitProject !== undefined) {
    base.unitProject = resolveUnitProjectName(base.unitProject, mappers)
  }
  if (Array.isArray(base.projectProblemForms)) {
    base.projectProblemForms = base.projectProblemForms.map((p) => mapProblemFieldsFromBackend(p, mappers))
  }
  return {
    id: base.id,
    companyId: PATROL_COMPANY_ID,
    projectId: PATROL_PROJECT_ID,
    ...base,
  } as T
}

async function httpCall(action: 'create' | 'update' | 'detail', input: ToolInput, mappers: Mappers) {
  let endpoint = INTERNAL_API_BASE
  let method = 'GET'
  let body: unknown = undefined

  if (action === 'create') {
    endpoint = `${INTERNAL_API_BASE}/service-project/fieldwork/fieldwork-patrol/addPatrolInfo`
    method = 'POST'
    const payload = mapRecordFieldsForBackend({ ...input.createPayload } as Record<string, any>, mappers)
    body = payload
  } else if (action === 'update') {
    const pid = input.updatePayload?.id ?? input.id ?? ''
    endpoint = `${INTERNAL_API_BASE}/service-project/fieldwork/fieldwork-patrol/editPatrolInfo/${encodeURIComponent(pid)}`
    method = 'PATCH'
    const payload = mapRecordFieldsForBackend({ ...input.updatePayload } as Record<string, any>, mappers)
    body = payload
  } else {
    if (input.id) {
      endpoint = `${INTERNAL_API_BASE}/service-project/fieldwork/fieldwork-patrol/getDetailById?patrolId=${encodeURIComponent(input.id)}`
    } else {
      const qs = new URLSearchParams()
      const rawQuery = input.query ?? {}
      const mappedQuery: Record<string, any> = { ...rawQuery }
      if (mappedQuery.unitProject !== undefined) {
        mappedQuery.unitProject = resolveUnitProjectId(mappedQuery.unitProject, mappers)
      }
      Object.entries(mappedQuery).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          qs.append(k, String(v))
        }
      })
      endpoint = `${INTERNAL_API_BASE}/patrols${qs.toString() ? `?${qs.toString()}` : ''}`
    }
    method = 'GET'
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    headers.Authorization = AUTHORIZATION_TOKEN
    const res = await fetch(endpoint, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body),
    })

    if (!res.ok) {
      throw new Error(`内部 API HTTP ${res.status}：${res.statusText}`)
    }
    return await res.json()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `连接内部巡视系统失败（${method} ${endpoint}）：${msg}。` +
      `未接入真实 API 时，请先配置 PATROL_INTERNAL_API_BASE 指向 Mock 服务，` +
      `或由工程师替换本文件内 httpCall 的实现。`,
    )
  }
}
// 巡视工具
export const patrolTool = createTool({
  id: 'patrol-crud',
  description:
    '与内部巡视系统 API 交互，支持三类 action：\n' +
    `- action=create：新增巡视记录。问题分类和问题性质按当前问题类型动态获取，classifyTypeId 使用二级分类 ID，severity 使用性质 ID。\n` +
    `- action=update：编辑已有记录。必填：updatePayload.id；其余业务字段按需覆盖（unitProject 建议从 ${UNIT_PROJECT_OPTION_NAMES.join(' / ')} 中选择；巡视部位=patrolPart，）；projectProblemForms 传了就整组替换原有问题，不传则保持不变；每个问题固定带 sourceType=PATROL，由系统自动补齐；type 必须是问题类型字典候选项之一，severity 若填必须是 problemNatureTool 按当前问题类型返回的选项 ID；rectificationIds/reviewIds 总是以数组形式提交；系统维护字段（createdBy 等）无需传入。\n` +
    '- action=detail：查看详情。优先按 id 精确查；没有 id 时再按 query 条件筛选（query 所有字段均为可选；unitProject 建议从 ' + UNIT_PROJECT_OPTION_NAMES.join(' / ') + ' 中选择；巡视部位=patrolPart，）。返回 record/records 都包含 projectProblemForms 数组（含固定值 sourceType=PATROL、rectificationIds/reviewIds 多选数组和 type 枚举、severity 枚举；问题内单位工程对外字段名为 engineerId，所在部位对外字段名为 part）。',
  inputSchema: toolInputSchema,
  outputSchema: toolOutputSchema,
  execute: async (input, _context) => {
    type Out = z.infer<typeof toolOutputSchema>

    const [unitProjectOptions, problemTypeOptions, members] = await Promise.all([
      fetchUnitProjectOptions(),
      fetchProblemTypeOptions(),
      fetchProjectMembers(),
    ])
    const mappers = buildMappers(unitProjectOptions, problemTypeOptions)
    mappers.members = members
    const types = problemTypeOptions.map((item) => item.code)
    const dictionaries = await Promise.all(types.flatMap((type) => [fetchProblemClassifyOptions(type), fetchProblemNatureOptions(type)]))
    for (let i = 0; i < dictionaries.length; i += 2) {
      for (const item of dictionaries[i]) { mappers.classifyNameToId.set(item.name, item.id); mappers.classifyIdToName.set(item.id, item.name) }
      for (const item of dictionaries[i + 1]) { mappers.natureNameToId.set(item.name, item.id); mappers.natureIdToName.set(item.id, item.name) }
    }

    if (input.action === 'create') {
      if (!input.createPayload) {
        const out: Out = {
          success: false,
          action: 'create',
          error: 'action=create 时 createPayload 必填（5 个业务字段）。',
        }
        return out
      }
      let data
      try { data = await httpCall('create', input, mappers) } catch (err) {
        const out: Out = { success: false, action: 'create', error: err instanceof Error ? err.message : String(err) }
        return out
      }
      const out: Out = {
        success: true,
        action: 'create',
        record: enrichPatrolRecord(data?.record ?? data, mappers),
        message: data?.message,
      }
      return out
    }

    if (input.action === 'update') {
      if (!input.updatePayload || !input.updatePayload.id) {
        const out: Out = {
          success: false,
          action: 'update',
          error: 'action=update 时 updatePayload.id 必填。',
        }
        return out
      }
      let data
      try { data = await httpCall('update', input, mappers) } catch (err) {
        const out: Out = { success: false, action: 'update', error: err instanceof Error ? err.message : String(err) }
        return out
      }
      const out: Out = {
        success: true,
        action: 'update',
        record: enrichPatrolRecord(data?.record ?? data, mappers),
        message: data?.message,
      }
      return out
    }

    // detail
    if (!input.id && !input.query) {
      const out: Out = {
        success: false,
        action: 'detail',
        error: 'action=detail 时 id 和 query 至少填一个。',
      }
      return out
    }
    const data = await httpCall('detail', input, mappers)
    const out: Out = Array.isArray(data?.records ?? data?.list)
      ? { success: true, action: 'detail', records: (data.records ?? data.list).map((item: Record<string, any>) => enrichPatrolRecord(item, mappers)) }
      : { success: true, action: 'detail', record: enrichPatrolRecord(data?.record ?? data, mappers) }
    return out
  },
})
