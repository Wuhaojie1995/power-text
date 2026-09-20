import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

const TZ = 'Asia/Shanghai'
const pad2 = (n: number) => String(n).padStart(2, '0')

function getNowParts() {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value
    return acc
  }, {})
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour === '24' ? '00' : parts.hour),
    min: Number(parts.minute),
  }
}

function dayOffsetToDate(offsetDays: number) {
  const { y, m, d } = getNowParts()
  const base = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  base.setUTCDate(base.getUTCDate() + offsetDays)
  return {
    y: base.getUTCFullYear(),
    m: base.getUTCMonth() + 1,
    d: base.getUTCDate(),
  }
}

function mergeTime(date: { y: number; m: number; d: number }, h: number, min: number) {
  return `${date.y}-${pad2(date.m)}-${pad2(date.d)} ${pad2(h)}:${pad2(min)}`
}

const periodDefault: Record<string, { h: number; m: number }> = {
  morning: { h: 9, m: 0 },
  noon: { h: 12, m: 0 },
  afternoon: { h: 14, m: 30 },
  evening: { h: 17, m: 30 },
  night: { h: 19, m: 0 },
  dawn: { h: 6, m: 0 },
}

function parsePeriod(raw: string | undefined): { h: number; m: number } | null {
  if (!raw) return null
  const t = raw.trim()
  if (/早上|早晨|清晨/.test(t)) return periodDefault.morning
  if (/^上午|中午以前/.test(t)) return periodDefault.morning
  if (/^中午/.test(t)) return periodDefault.noon
  if (/^下午/.test(t)) return periodDefault.afternoon
  if (/^傍晚|黄昏/.test(t)) return periodDefault.evening
  if (/^晚上|夜里|晚间|半夜/.test(t)) return periodDefault.night
  return null
}

function parseHhmm(raw: string): { h: number; m: number } | null {
  if (!raw) return null
  const m = raw.match(/(\d{1,2})[:：点](\d{1,2})/)
  if (m) {
    const h = Number(m[1])
    const mm = Number(m[2])
    if (h >= 0 && h <= 23 && mm >= 0 && mm <= 59) return { h, m: mm }
  }
  const m2 = raw.match(/(\d{1,2})点(半|一刻|三刻)?/)
  if (m2) {
    const h = Number(m2[1])
    if (h < 0 || h > 23) return null
    const mm = !m2[2] ? 0 : m2[2] === '半' ? 30 : m2[2] === '一刻' ? 15 : 45
    return { h, m: mm }
  }
  return null
}

function parseDate(raw: string): { offset: number; dd?: number } | null {
  if (!raw) return { offset: 0 }
  const t = raw.trim()

  if (/大前天/.test(t)) return { offset: -3 }
  if (/前天/.test(t)) return { offset: -2 }
  if (/昨天|昨日|前一天/.test(t)) return { offset: -1 }
  if (/今天|今日|这天/.test(t)) return { offset: 0 }
  if (/明天|明日|次日|下一天/.test(t)) return { offset: 1 }
  if (/后天/.test(t)) return { offset: 2 }
  if (/大后天/.test(t)) return { offset: 3 }

  const dd = t.match(/(?:^|[\s，,、（(])(\d{1,2})\s*(?:号|日|th|st|nd|rd)/)
  if (dd) return { offset: 0, dd: Number(dd[1]) }

  const mmdd = t.match(/(\d{1,2})[-/月](\d{1,2})(?:号|日)?/)
  if (mmdd) {
    const { y } = getNowParts()
    const date = new Date(Date.UTC(y, Number(mmdd[1]) - 1, Number(mmdd[2])))
    const { y: ny, m: nm, d: nd } = getNowParts()
    const today = new Date(Date.UTC(ny, nm - 1, nd))
    const diffDays = Math.round((date.getTime() - today.getTime()) / 86400000)
    return { offset: diffDays }
  }

  const m3 = t.match(/(\d+)天(?:前|以后|之后|后)/)
  if (m3) {
    const n = Number(m3[1])
    return { offset: /前/.test(t) ? -n : n }
  }

  return null
}

const inputSchema = z.object({
  mode: z
    .enum(['start-end', 'start-only', 'end-only', 'date-only'])
    .describe('必填：start-end=同时解析开始+结束；start-only=只有开始；end-only=只有结束；date-only=只解析到日期（如整改时限 deadlineDate，输出 YYYY-MM-DD）'),
  startRaw: z
    .string()
    .optional()
    .describe('start-only / start-end 时必填：开始时间原始文本，支持"今天 10:30""昨天下午""16号上午"等'),
  endRaw: z
    .string()
    .optional()
    .describe('end-only / start-end 时可选：结束时间原始文本，支持同格式；也支持"到 12 点""直到 18:00"这种省略日期写法'),
  dateRaw: z
    .string()
    .optional()
    .describe('date-only 时可选：日期原始表达（如"明天""3天后""16号"），只取日期 YYYY-MM-DD；不传则默认今天'),
  fallbackFullDay: z
    .boolean()
    .default(true)
    .describe('mode=start-end 且只有日期没有时刻时，是否自动补 08:00-18:00；默认 true'),
})

const outputSchema = z.object({
  success: z.boolean(),
  today: z.string().describe('东八区当前日期，YYYY-MM-DD（按真实系统时间，动态生成）'),
  now: z.string().describe('东八区当前完整时间，YYYY-MM-DD HH:mm'),
  startTime: z.string().optional().describe('解析后的开始时间 YYYY-MM-DD HH:mm'),
  endTime: z.string().optional().describe('解析后的结束时间 YYYY-MM-DD HH:mm'),
  dateOnly: z.string().optional().describe('解析后的单日期 YYYY-MM-DD（date-only，如整改时限 deadlineDate）'),
  warnings: z.array(z.string()).default([]).describe('当原始文本不完整或无法解析时给出的中文警告，供上层追问'),
  error: z.string().optional().describe('致命错误信息（success=false 时填充）'),
})

type In = z.infer<typeof inputSchema>

function resolveOneTime(
  raw: string | undefined,
  opts: {
    defaultDayOffset?: number
    fallback?: 'startOfDay' | 'endOfDay' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night'
  } = {},
): { ts: string; warn?: string } {
  const input = (raw ?? '').trim()
  const fallback = opts.fallback ?? 'startOfDay'
  const defaultOffset = opts.defaultDayOffset ?? 0

  if (!input) {
    const date = dayOffsetToDate(defaultOffset)
    if (fallback === 'startOfDay') return { ts: mergeTime(date, 0, 0) }
    if (fallback === 'endOfDay') return { ts: mergeTime(date, 23, 59) }
    const p = periodDefault[fallback]
    return { ts: mergeTime(date, p.h, p.m) }
  }

  let dateSpec = input
  const hhmmMatch = input.match(/(\d{1,2}[:：点]\d{0,2}|[上下中早午晚傍夜]\S*)/)
  if (hhmmMatch?.index !== undefined) {
    dateSpec = (input.slice(0, hhmmMatch.index) + input.slice(hhmmMatch.index + hhmmMatch[0].length)).trim()
  }

  const parsedDate = parseDate(dateSpec)
  let dateObj = parsedDate ? dayOffsetToDate(parsedDate.offset) : dayOffsetToDate(defaultOffset)

  if (parsedDate?.dd !== undefined) {
    const { y, m } = dateObj
    dateObj = { y, m, d: parsedDate.dd }
    if (dateObj.d < 1 || dateObj.d > 31) {
      return { ts: mergeTime(dayOffsetToDate(0), 0, 0), warn: `日期不合法：${parsedDate.dd}号` }
    }
  }

  const hm = parseHhmm(input)
  if (hm) {
    return { ts: mergeTime(dateObj, hm.h, hm.m) }
  }

  const period = parsePeriod(input)
  if (period) {
    return { ts: mergeTime(dateObj, period.h, period.m) }
  }

  if (fallback === 'startOfDay') return { ts: mergeTime(dateObj, 0, 0) }
  if (fallback === 'endOfDay') return { ts: mergeTime(dateObj, 23, 59) }
  const p = periodDefault[fallback]
  return { ts: mergeTime(dateObj, p.h, p.m) }
}

function resolveDateOnly(raw: string | undefined, defaultOffsetDays: number): { ds: string; warn?: string } {
  if (!raw) {
    const d = dayOffsetToDate(defaultOffsetDays)
    return { ds: `${d.y}-${pad2(d.m)}-${pad2(d.d)}` }
  }
  const r = resolveOneTime(raw + ' 00:00', { defaultDayOffset: defaultOffsetDays, fallback: 'morning' })
  return { ds: r.ts.slice(0, 10), warn: r.warn }
}

export const dateTimeTool = createTool({
  id: 'date-time-resolver',
  description:
    '把中文相对时间/不完整时间解析为东八区（Asia/Shanghai）绝对时间，格式 YYYY-MM-DD HH:mm 或 YYYY-MM-DD。\n' +
    '- 支持相对日期：今天、昨天、前天、大前天、明天、后天、大后天、N 天前/后、16 号、上月 1 号、2026-08-14 等。\n' +
    '- 支持时段：上午=09:00、中午=12:00、下午=14:30、傍晚=17:30、晚上=19:00。\n' +
    '- 支持中文时刻：10:30 / 10点半 / 14点一刻 / 9点。\n' +
    '- 注意：此工具给出的 today/now 是按服务器系统时间 + 东八区动态计算，每天自动变化，永远正确。\n' +
    '- mode=date-only 时只输出 dateOnly（YYYY-MM-DD，不带时分），适合整改时限 deadlineDate；dateRaw 不传默认今天。',
  inputSchema,
  outputSchema,
  execute: async (input: In) => {
    const np = getNowParts()
    const today = `${np.y}-${pad2(np.m)}-${pad2(np.d)}`
    const now = `${np.y}-${pad2(np.m)}-${pad2(np.d)} ${pad2(np.h)}:${pad2(np.min)}`
    const warnings: string[] = []

    try {
      if (input.mode === 'start-only' || input.mode === 'start-end') {
        if (!input.startRaw) {
          const out: z.infer<typeof outputSchema> = {
            success: false,
            today,
            now,
            warnings: [],
            error: 'mode=start-only 或 start-end 时 startRaw 必填。',
          }
          return out
        }
      }
      if (input.mode === 'end-only' && !input.endRaw) {
        const out: z.infer<typeof outputSchema> = {
          success: false,
          today,
          now,
          warnings: [],
          error: 'mode=end-only 时 endRaw 必填。',
        }
        return out
      }

      let startTime: string | undefined
      let endTime: string | undefined
      let dateOnly: string | undefined

      if (input.mode === 'start-end') {
        const s = resolveOneTime(input.startRaw, { fallback: 'morning' })
        if (s.warn) warnings.push(s.warn)
        startTime = s.ts

        if (input.endRaw) {
          const e = resolveOneTime(input.endRaw, {
            fallback: 'evening',
            defaultDayOffset: startTime.slice(0, 10) === today ? 0 : 0,
          })
          if (e.warn) warnings.push(e.warn)
          let endTs = e.ts
          if (endTs <= startTime) {
            const baseDate = {
              y: Number(startTime.slice(0, 4)),
              m: Number(startTime.slice(5, 7)),
              d: Number(startTime.slice(8, 10)),
            }
            endTs = mergeTime(baseDate, 18, 0)
            warnings.push('结束时间早于开始时间，已自动兜底为 18:00；请用户确认后手动覆盖。')
          }
          endTime = endTs
        } else if (input.fallbackFullDay) {
          const baseDate = {
            y: Number(startTime.slice(0, 4)),
            m: Number(startTime.slice(5, 7)),
            d: Number(startTime.slice(8, 10)),
          }
          const fallbackEnd = mergeTime(baseDate, 18, 0)
          warnings.push('未提供结束时间，已按「全天巡视」兜底为 18:00；请向用户确认是否需要修改。')
          endTime = fallbackEnd
        }
      } else if (input.mode === 'start-only') {
        const s = resolveOneTime(input.startRaw, { fallback: 'morning' })
        if (s.warn) warnings.push(s.warn)
        startTime = s.ts
      } else if (input.mode === 'end-only') {
        const e = resolveOneTime(input.endRaw, { fallback: 'evening' })
        if (e.warn) warnings.push(e.warn)
        endTime = e.ts
      } else {
        // mode === 'date-only'：只到日期，不带时分（整改时限 deadlineDate 用）
        const r = resolveDateOnly(input.dateRaw ?? input.startRaw, 0)
        if (r.warn) warnings.push(r.warn)
        dateOnly = r.ds
      }

      const out: z.infer<typeof outputSchema> = {
        success: true,
        today,
        now,
        startTime,
        endTime,
        dateOnly,
        warnings,
      }
      return out
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const out: z.infer<typeof outputSchema> = {
        success: false,
        today,
        now,
        error: msg,
        warnings,
      }
      return out
    }
  },
})
