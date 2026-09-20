import { MastraClient } from '@mastra/client-js'

/**
 * 解析 Mastra 服务地址，优先级从高到低：
 *   1) 环境变量 VITE_MASTRA_API_URL（.env / .envProd 里显式配置）
 *   2) 生产构建且没配置 → 当前页面同源（假设 Mastra 与前端一起部署）
 *   3) 兜底 localhost:4112（本地开发）
 *
 * 第 2 条很重要：以前 .envProd 里写死 localhost:4112，生产构建必然连不上；
 * 现在留空就自动走同源，不会一上线就白屏。
 */
function resolveMastraBaseUrl(): string {
  const configured = import.meta.env.VITE_MASTRA_API_URL?.trim()
  if (configured) return configured
  // import.meta.env.PROD 由 Vite 在构建时注入，生产构建为 true
  return import.meta.env.PROD ? window.location.origin : 'http://localhost:4112'
}

export const mastraClient = new MastraClient({
  baseUrl: resolveMastraBaseUrl(),
})

export const PATROL_AGENT_ID = 'patrol-agent'

export const VOICE_TOOL_IDS = {
  TEXT_TO_SPEECH: 'text-to-speech',
  SPEECH_TO_TEXT: 'speech-to-text',
  LIST_VOICE_SPEAKERS: 'list-voice-speakers',
  PATROL_CRUD: 'patrol-crud',
  DATE_TIME_RESOLVER: 'date-time-resolver',
} as const


export type SimpleTtsInput = {
  text: string
  voiceId?: string
  languageCode?: string
  speakingRate?: number
  pitch?: number
  volumeGainDb?: number
  format?: 'mp3' | 'wav' | 'ogg'
}

export type SimpleTtsOutput = {
  success?: boolean
  error?: string
  audioBase64?: string
  audioMime?: string
  languageCode?: string
  speaker?: string
  textLength?: number
  mode?: 'MOCK' | 'REAL'
}

export type SimpleSttInput = {
  audioBase64: string
  languageCode?: string
  encoding?: 'LINEAR16' | 'MP3' | 'WEBM_OPUS' | 'FLAC' | 'MULAW' | 'AMR' | 'AMR_WB' | 'M4A' | 'AAC'
  sampleRateHertz?: number
  enablePunctuation?: boolean
}

export type SimpleSttOutput = {
  success?: boolean
  error?: string
  transcript?: string
  languageCode?: string
  audioKb?: number
  mode?: 'MOCK' | 'REAL'
}

async function readJSONSafe(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch (_) {
    return { _rawText: text }
  }
}


type MastraToolExecuteRequest<Data = any> = {
  data?: Data
  threadId?: string
  resourceId?: string
}

type MastraToolExecuteResponse<Result = any> = {
  success?: boolean
  error?: string
  result?: Result
} & Record<string, any>

const TOOL_NAME_ALIAS: Record<string, string> = {
  textToSpeechTool: VOICE_TOOL_IDS.TEXT_TO_SPEECH,
  'text-to-speech': VOICE_TOOL_IDS.TEXT_TO_SPEECH,
  speechToTextTool: VOICE_TOOL_IDS.SPEECH_TO_TEXT,
  'speech-to-text': VOICE_TOOL_IDS.SPEECH_TO_TEXT,
  listVoiceSpeakersTool: VOICE_TOOL_IDS.LIST_VOICE_SPEAKERS,
  'list-voice-speakers': VOICE_TOOL_IDS.LIST_VOICE_SPEAKERS,
  patrolTool: VOICE_TOOL_IDS.PATROL_CRUD,
  'patrol-crud': VOICE_TOOL_IDS.PATROL_CRUD,
  dateTimeTool: VOICE_TOOL_IDS.DATE_TIME_RESOLVER,
  'date-time-resolver': VOICE_TOOL_IDS.DATE_TIME_RESOLVER,
}

function normalizeToolName(name: string): string {
  const t = String(name || '').trim()
  return TOOL_NAME_ALIAS[t] ?? t
}

async function postJson(
  url: string,
  payload: any,
): Promise<{ res: Response; json: MastraToolExecuteResponse }> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify(payload ?? {}),
    })
  } catch (err) {
    throw new Error('连接 Mastra 服务失败（请确认已运行 npm run dev:mastra）：' + (err instanceof Error ? err.message : String(err)))
  }
  const json = (await readJSONSafe(res)) as MastraToolExecuteResponse
  return { res, json }
}

export async function mastraExecuteAgentTool<Data = any, Result = any>(
  agentId: string,
  toolName: string,
  payload: MastraToolExecuteRequest<Data>,
): Promise<Result> {
  // 与 mastraClient 用同一套地址解析规则，避免「客户端连 A、工具直连环 B」这种不一致
  const baseNoSlash = resolveMastraBaseUrl().replace(/\/$/, '')
  const realToolName = normalizeToolName(toolName)
  const instanceUrl = `${baseNoSlash}/api/tools/${encodeURIComponent(realToolName)}/execute`
  const agentUrl = `${baseNoSlash}/api/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(realToolName)}/execute`

  const first = await postJson(instanceUrl, payload)
  if (first.res.ok) {
    const result = (first.json?.result ?? first.json ?? {}) as Result
    if (result && typeof result === 'object' && 'error' in (result as any) && !(result as any).success) {
      throw new Error((result as any).error ?? '工具执行失败')
    }
    return result
  }
  if (first.res.status !== 404) {
    const httpMsg = `HTTP ${first.res.status}`
    const errorMsg =
      first.json?.error ??
      first.json?.message ??
      (typeof first.json?._rawText === 'string' ? first.json._rawText.slice(0, 300) : '')
    throw new Error(`${httpMsg}${errorMsg ? ' - ' + errorMsg : ''}`)
  }

  const second = await postJson(agentUrl, payload)
  if (!second.res.ok) {
    const httpMsg = `HTTP ${second.res.status}`
    const errorMsg =
      second.json?.error ??
      second.json?.message ??
      (typeof second.json?._rawText === 'string' ? second.json._rawText.slice(0, 300) : '')
    throw new Error(`${httpMsg}${errorMsg ? ' - ' + errorMsg : ''}`)
  }
  const result = (second.json?.result ?? second.json ?? {}) as Result
  if (result && typeof result === 'object' && 'error' in (result as any) && !(result as any).success) {
    throw new Error((result as any).error ?? '工具执行失败')
  }
  return result
}
