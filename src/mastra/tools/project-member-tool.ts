import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { PATROL_PROJECT_ID, AUTHORIZATION_TOKEN } from './patrol-constants';

export const projectMemberSchema = z.object({
  id: z.string().min(1).describe('项目人员记录 ID'),
  name: z.string().min(1).describe('项目人员姓名'),
  userId: z.string().min(1).describe('用户 ID'),
})

export type ProjectMember = z.infer<typeof projectMemberSchema>

export const PROJECT_MEMBER_API_ENDPOINT =
  `https://dev.p3china.com:7700/nbg.web.dev/api/service-project/org/member/list?projectId=${PATROL_PROJECT_ID}`

async function fetchProjectMembersResult(): Promise<{ options: ProjectMember[]; source: 'api' | 'fallback'; error?: string }> {
  try {
    const res = await fetch(PROJECT_MEMBER_API_ENDPOINT, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: AUTHORIZATION_TOKEN },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const data = await res.json()
    const list: unknown = data?.data?.data?.list ?? data?.data?.list ?? data?.data?.data ?? data?.data ?? data?.list ?? data
    if (!Array.isArray(list)) throw new Error('项目人员接口返回的不是数组')
    const options = list.map((item, index) => ({
      id: String(item?.id ?? item?.memberId ?? item?.value ?? `project-member-${index + 1}`),
      name: String(item?.name ?? item?.realName ?? item?.userName ?? item?.label ?? item),
      userId: String(item?.userId ?? item?.user_id ?? item?.uid ?? item?.id ?? item?.memberId ?? `project-user-${index + 1}`),
    }))
    return { options, source: 'api' }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.warn(`[fetchProjectMembers] 获取项目人员列表失败：${error}`)
    return { options: [], source: 'fallback', error }
  }
}

export async function fetchProjectMembers(): Promise<ProjectMember[]> {
  return (await fetchProjectMembersResult()).options
}

const inputSchema = z.object({}).describe('无需输入参数，返回当前项目人员列表。')
const outputSchema = z.object({
  success: z.boolean(),
  options: z.array(projectMemberSchema),
  source: z.enum(['api', 'fallback']),
  message: z.string().optional(),
  error: z.string().optional(),
})

export const projectMemberTool = createTool({
  id: 'project-member-options',
  description: '查询当前项目人员列表，用于匹配巡视问题的整改人和复查人。',
  inputSchema,
  outputSchema,
  execute: async () => {
    const result = await fetchProjectMembersResult()
    return {
      success: result.source === 'api',
      options: result.options,
      source: result.source,
      message: result.source === 'api' ? '已获取项目人员列表。' : '项目人员接口不可用。',
      error: result.error,
    }
  },
})
