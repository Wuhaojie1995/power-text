import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { AUTHORIZATION_TOKEN } from './patrol-constants'

export const problemTypeOptionSchema = z.object({
  code: z.string().min(1).describe('问题类型编码'),
  name: z.string().min(1).describe('问题类型名称'),
})

export type ProblemTypeOption = z.infer<typeof problemTypeOptionSchema>

// 内置兜底选项：编码必须与字典接口返回一致（PROGRESS / PROGRAM，不是 SCHEDULE / PROCEDURE）
export const PROBLEM_TYPE_OPTIONS: readonly ProblemTypeOption[] = [
  { code: 'QUALITY', name: '质量问题' },
  { code: 'SAFETY', name: '安全问题' },
  { code: 'PROGRESS', name: '进度问题' },
  { code: 'PERSONNEL', name: '人员问题' },
  { code: 'PROGRAM', name: '程序问题' },
  { code: 'OTHER', name: '其它问题' },
] as const

export const PROBLEM_TYPE_NAMES = PROBLEM_TYPE_OPTIONS.map((item) => item.name)

export const PROBLEM_TYPE_API_ENDPOINT =
  'https://dev.p3china.com:7700/nbg.app.dev/api/service-company/dict/PROBLEM_TYPE'

async function fetchProblemTypeOptionsResult(): Promise<{
  options: ProblemTypeOption[]
  source: 'api' | 'fallback'
  error?: string
}> {
  if (!PROBLEM_TYPE_API_ENDPOINT) {
    return { options: [...PROBLEM_TYPE_OPTIONS], source: 'fallback' }
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    headers.Authorization = AUTHORIZATION_TOKEN

    const res = await fetch(PROBLEM_TYPE_API_ENDPOINT, { method: 'GET', headers })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}：${res.statusText}`)
    }

    const data = await res.json()
    const list: unknown =
      data?.data?.data?.list ??
      data?.data?.list ??
      data?.data?.data ??
      data?.data ??
      data?.list ??
      data
    if (Array.isArray(list)) {
      const options = list.map((item, index) => {
        if (typeof item === 'string') {
          const known = PROBLEM_TYPE_OPTIONS.find((p) => p.name === item)
          return known ?? { code: `problem-type-${index + 1}`, name: item }
        }
        return {
          code: String(item?.code ?? item?.value ?? item?.key ?? `problem-type-${index + 1}`),
          name: String(item?.name ?? item?.label ?? item?.title ?? item?.value ?? item),
        }
      })
      return { options, source: 'api' }
    }

    return {
      options: [...PROBLEM_TYPE_OPTIONS],
      source: 'fallback',
      error: '问题类型字典接口返回的不是数组，已回退到内置选项。',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[fetchProblemTypeOptions] 获取问题类型列表失败，回退到内置选项：${msg}`)
    return { options: [...PROBLEM_TYPE_OPTIONS], source: 'fallback', error: msg }
  }
}

export async function fetchProblemTypeOptions(): Promise<ProblemTypeOption[]> {
  const result = await fetchProblemTypeOptionsResult()
  return result.options
}

const problemTypeToolInputSchema = z.object({}).describe('无需输入参数，返回问题类型字典列表。')

const problemTypeToolOutputSchema = z.object({
  success: z.boolean().describe('是否执行成功'),
  options: z.array(problemTypeOptionSchema).describe('问题类型选项列表，格式为 { code, name }'),
  source: z.enum(['api', 'fallback']).describe('数据来源：api=接口返回，fallback=内置回退'),
  message: z.string().optional().describe('辅助说明'),
  error: z.string().optional().describe('错误说明'),
})

export const problemTypeTool = createTool({
  id: 'problem-type-options',
  description:
    '获取问题类型字典列表。优先调用字典接口 PROBLEM_TYPE，失败时自动回退到内置 6 个默认选项，用于新增/编辑问题时给出最新候选项。',
  inputSchema: problemTypeToolInputSchema,
  outputSchema: problemTypeToolOutputSchema,
  execute: async () => {
    const result = await fetchProblemTypeOptionsResult()
    return {
      success: true,
      options: result.options,
      source: result.source,
      message: result.source === 'api' ? '已获取最新问题类型列表。' : '接口不可用，已回退到内置问题类型列表。',
      error: result.error,
    }
  },
})
