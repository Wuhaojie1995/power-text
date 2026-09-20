import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { AUTHORIZATION_TOKEN, PATROL_PROJECT_TYPE, PATROL_COMPANY_ID } from './patrol-constants'
import { fetchProblemTypeOptions, type ProblemTypeOption } from './problem-type-tool'

export const problemClassifyOptionSchema = z.object({ id: z.string().min(1), name: z.string().min(1), parentName: z.string().optional() })
export type ProblemClassifyOption = z.infer<typeof problemClassifyOptionSchema>
export const PROBLEM_CLASSIFY_API_BASE = 'https://dev.p3china.com:7700/nbg.web.dev/api/service-company/specialExamination/company-problem-base-classify/cascade'

/**
 * 把任意形式的问题类型输入（中文名 / 编码 / 口语简称，如「安全」）
 * 解析为标准问题类型 { code, name }。
 * 逻辑：编码精确匹配 → 名称精确匹配 → 去「问题」后缀模糊匹配。
 * 解析不到返回 null，由调用方决定是否让用户先确认问题类型。
 */
export async function resolveProblemType(input: string): Promise<ProblemTypeOption | null> {
  const raw = (input ?? '').trim()
  if (!raw) return null
  const options = await fetchProblemTypeOptions()
  if (options.length === 0) return null

  // 1. 编码精确匹配（忽略大小写）
  const byCode = options.find((o) => o.code.toLowerCase() === raw.toLowerCase())
  if (byCode) return byCode

  // 2. 名称精确匹配
  const byName = options.find((o) => o.name === raw)
  if (byName) return byName

  // 3. 去「问题」后缀后的包含匹配（如「安全」→「安全问题」）
  const strip = (s: string) => s.replace(/问题$/, '')
  const fuzzy = options.find((o) => {
    const a = strip(o.name)
    const b = strip(raw)
    return a === b || a.includes(b) || b.includes(a)
  })
  return fuzzy ?? null
}

/** 调用问题分类级联接口。注意：problemType 必须传问题类型编码（如 SAFETY），传中文名接口会报 90005。 */
export async function fetchProblemClassifyOptions(problemTypeCode: string): Promise<ProblemClassifyOption[]> {
  if (!problemTypeCode) return []
  const url = `${PROBLEM_CLASSIFY_API_BASE}?companyId=${PATROL_COMPANY_ID}&problemType=${encodeURIComponent(problemTypeCode)}&projectType=${PATROL_PROJECT_TYPE}`
  try {
    const res = await fetch(url, { headers: { Authorization: AUTHORIZATION_TOKEN } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (data?.code && data.code !== 200) throw new Error(`接口错误 ${data.code}：${data.msg ?? '未知错误'}`)
    const roots = Array.isArray(data?.data) ? data?.data : []
    return roots.flatMap((root: any) => Array.isArray(root?.typeList) ? root.typeList.map((item: any) => ({ id: String(item.id), name: `${String(root.problemClassify)} / ${String(item.problemType)}`, parentName: String(root.problemClassify) })) : [])
  } catch (err) {
    console.warn(`[fetchProblemClassifyOptions] ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

const inputSchema = z.object({
  problemType: z.string().min(1).describe('问题类型，支持编码（如 SAFETY）、全名（如 安全问题）或简称（如 安全），工具会自动解析为标准类型'),
})

export const problemClassifyTool = createTool({
  id: 'problem-classify-options',
  description:
    '按问题类型查询问题分类二级选项，只能选择二级分类。入参支持问题类型的中文名、编码或简称，工具会先调用问题类型字典接口解析成标准类型，确定类型后再调用分类接口。解析不到标准类型时返回 success=false 和可选类型列表，此时应先让用户确认问题类型，不要直接传参重试。',
  inputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    options: z.array(problemClassifyOptionSchema),
    resolvedType: z.string().optional().describe('实际解析出的标准问题类型名称'),
    availableTypes: z.array(z.string()).optional().describe('解析失败时返回的标准问题类型列表'),
    message: z.string().optional(),
  }),
  execute: async ({ problemType }) => {
    // 第一步：先确定问题类型（内部会调问题类型字典接口）
    const resolved = await resolveProblemType(problemType)
    if (!resolved) {
      const typeOptions = await fetchProblemTypeOptions()
      return {
        success: false,
        options: [],
        availableTypes: typeOptions.map((o) => o.name),
        message: `未能将「${problemType}」匹配到标准问题类型，请先通过问题类型字典确认类型后再查询分类。`,
      }
    }
    // 第二步：类型确定后，用编码调用问题分类接口
    const options = await fetchProblemClassifyOptions(resolved.code)
    return {
      success: options.length > 0,
      options,
      resolvedType: resolved.name,
      message:
        options.length > 0
          ? `已按「${resolved.name}」查询到 ${options.length} 个二级分类，请从中选择。`
          : `「${resolved.name}」下暂无问题分类数据，可能后台未配置该类型的分类。`,
    }
  },
})
