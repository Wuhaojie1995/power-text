import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { PATROL_PROJECT_ID, AUTHORIZATION_TOKEN } from './patrol-constants';

export const unitProjectOptionSchema = z.object({
  id: z.string().min(1).describe('单位工程 ID'),
  name: z.string().min(1).describe('单位工程名称'),
})

export type UnitProjectOption = z.infer<typeof unitProjectOptionSchema>

export const UNIT_PROJECT_OPTIONS: readonly UnitProjectOption[] = []
export const UNIT_PROJECT_OPTION_NAMES = UNIT_PROJECT_OPTIONS.map((item) => item.name)

export const UNIT_PROJECT_API_ENDPOINT =
  `https://dev.p3china.com:7700/nbg.app.dev/api/service-project/org/engineer/getMyOrgUnitEngineers?projectId=${PATROL_PROJECT_ID}`

async function fetchUnitProjectOptionsResult(): Promise<{
  options: UnitProjectOption[]
  source: 'api' | 'fallback'
  error?: string
}> {
  if (!UNIT_PROJECT_API_ENDPOINT) {
    return { options: [...UNIT_PROJECT_OPTIONS], source: 'fallback' }
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    headers.Authorization = AUTHORIZATION_TOKEN



    const res = await fetch(UNIT_PROJECT_API_ENDPOINT, { method: 'GET', headers })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}：${res.statusText}`)
    }

    const data = await res.json()
    const list: unknown = data?.data ?? data?.data ?? data
    if (Array.isArray(list)) {
      const options = list.map((item, index) => {
        if (typeof item === 'string') {
          return { id: item, name: item }
        }
        return {
          id: String(item?.id ?? item?.value ?? item?.key ?? item?.orgUnitId ?? `unit-project-${index + 1}`),
          name: String(item?.name ?? item?.label ?? item?.title ?? item?.value ?? item),
        }
      })
      return { options, source: 'api' }
    }

    return {
      options: [...UNIT_PROJECT_OPTIONS],
      source: 'fallback',
      error: '单位工程接口返回的不是数组，已回退到内置选项。',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[fetchUnitProjectOptions] 获取单位工程列表失败，回退到临时内置选项：${msg}`)
    return { options: [...UNIT_PROJECT_OPTIONS], source: 'fallback', error: msg }
  }
}

export async function fetchUnitProjectOptions(): Promise<UnitProjectOption[]> {
  const result = await fetchUnitProjectOptionsResult()
  return result.options
}

const unitProjectToolInputSchema = z.object({}).describe('无需输入参数，返回当前用户可用的单位工程列表。')

const unitProjectToolOutputSchema = z.object({
  success: z.boolean().describe('是否执行成功'),
  options: z.array(unitProjectOptionSchema).describe('单位工程选项列表，格式为 { id, name }'),
  source: z.enum(['api', 'fallback']).describe('数据来源：api=接口返回，fallback=内置回退'),
  message: z.string().optional().describe('辅助说明'),
  error: z.string().optional().describe('错误说明'),
})

export const unitProjectTool = createTool({
  id: 'unit-project-options',
  description:
    '获取当前可用的单位工程列表。优先请求单位工程接口，失败时自动回退到内置选项，可用于新增/编辑巡视记录时给出最新候选项。',
  inputSchema: unitProjectToolInputSchema,
  outputSchema: unitProjectToolOutputSchema,
  execute: async () => {
    const result = await fetchUnitProjectOptionsResult()
    return {
      success: true,
      options: result.options,
      source: result.source,
      message: result.source === 'api' ? '已获取最新单位工程列表。' : '接口不可用，已回退到内置单位工程列表。',
      error: result.error,
    }
  },
})
