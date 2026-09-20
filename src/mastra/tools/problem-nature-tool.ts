import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

import { AUTHORIZATION_TOKEN, PATROL_PROJECT_TYPE, PATROL_COMPANY_ID } from './patrol-constants'
import { resolveProblemType } from './problem-classify-tool'

export const problemNatureOptionSchema = z.object({ id: z.string().min(1), name: z.string().min(1) })
export type ProblemNatureOption = z.infer<typeof problemNatureOptionSchema>
export const PROBLEM_NATURE_API_BASE = 'https://dev.p3china.com:7700/nbg.web.dev/api/service-company/specialExamination/company-problem-base-nature/getList'

/** 调用问题性质接口。注意：problemType 必须传问题类型编码（如 SAFETY），传中文名接口会报错。 */
export async function fetchProblemNatureOptions(problemTypeCode: string): Promise<ProblemNatureOption[]> {
  if (!problemTypeCode) return []
  const url = `${PROBLEM_NATURE_API_BASE}?companyId=${PATROL_COMPANY_ID}&problemType=${encodeURIComponent(problemTypeCode)}&projectType=${PATROL_PROJECT_TYPE}`
  try {
    const res = await fetch(url, { headers: { Authorization: AUTHORIZATION_TOKEN } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (data?.code && data.code !== 200) throw new Error(`接口错误 ${data.code}：${data.msg ?? '未知错误'}`)
    const list = Array.isArray(data?.data) ? data?.data : []
    return (Array.isArray(list) ? list : []).map((item: any) => ({ id: String(item.id), name: String(item.problemNature) }))
  } catch (err) {
    console.warn(`[fetchProblemNatureOptions] ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

const inputSchema = z.object({
  problemType: z.string().min(1).describe('问题类型，支持编码（如 SAFETY）、全名（如 安全问题）或简称（如 安全），工具会自动解析为标准类型'),
})

export const problemNatureTool = createTool({
  id: 'problem-nature-options',
  description:
    '按问题类型查询问题性质选项，提交时使用性质 ID。入参支持问题类型的中文名、编码或简称，工具会先解析成标准问题类型（编码）再调用接口。解析不到标准类型时返回 success=false 和可选类型列表，此时应先让用户确认问题类型。',
  inputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    options: z.array(problemNatureOptionSchema),
    resolvedType: z.string().optional().describe('实际解析出的标准问题类型名称'),
    availableTypes: z.array(z.string()).optional().describe('解析失败时返回的标准问题类型列表'),
    message: z.string().optional(),
  }),
  execute: async ({ problemType }) => {
    // 第一步：先确定问题类型
    const resolved = await resolveProblemType(problemType)
    if (!resolved) {
      const { fetchProblemTypeOptions } = await import('./problem-type-tool')
      const typeOptions = await fetchProblemTypeOptions()
      return {
        success: false,
        options: [],
        availableTypes: typeOptions.map((o) => o.name),
        message: `未能将「${problemType}」匹配到标准问题类型，请先通过问题类型字典确认类型后再查询性质。`,
      }
    }
    // 第二步：类型确定后，用编码调用问题性质接口
    const options = await fetchProblemNatureOptions(resolved.code)
    return {
      success: options.length > 0,
      options,
      resolvedType: resolved.name,
      message:
        options.length > 0
          ? `已按「${resolved.name}」查询到 ${options.length} 个问题性质选项。`
          : `「${resolved.name}」下暂无问题性质数据，可能后台未配置。`,
    }
  },
})
