import * as crypto from 'node:crypto'
import * as https from 'node:https'
import { URL } from 'node:url'

export const DEFAULT_ALIYUN_NLS_ENDPOINT = 'nls-gateway-cn-shanghai.aliyuncs.com'

export const ALIYUN_CHINESE_VOICE_PRESETS = [
  { voiceId: 'xiaoyuan', label: '中文普通话女声 · 小媛（推荐，自然流畅）', gender: 'female' },
  { voiceId: 'xiaoyun', label: '中文普通话女声 · 小云', gender: 'female' },
  { voiceId: 'zhiqiao', label: '中文普通话女声 · 智乔', gender: 'female' },
  { voiceId: 'xiaoyan', label: '中文普通话女声 · 晓燕', gender: 'female' },
  { voiceId: 'zhijia', label: '中文普通话男声 · 知佳', gender: 'male' },
  { voiceId: 'zhiqi', label: '中文普通话男声 · 志强', gender: 'male' },
  { voiceId: 'zhiyong', label: '中文普通话男声 · 智勇', gender: 'male' },
  { voiceId: 'yunjian', label: '中文普通话男声 · 云健（沉稳·新闻播报）', gender: 'male' },
  { voiceId: 'xiaoming', label: '中文普通话童声 · 小明', gender: 'child' },
  { voiceId: 'xiaomei', label: '中文粤语女声 · 小梅', gender: 'female' },
  { voiceId: 'cally', label: 'English Female · Cally', gender: 'female' },
  { voiceId: 'claire', label: 'English Female · Claire', gender: 'female' },
  { voiceId: 'eric', label: 'English Male · Eric', gender: 'male' },
  { voiceId: 'sachiko', label: '日本語女声 · 幸子 Sachiko', gender: 'female' },
  { voiceId: 'takumi', label: '日本語男声 · 拓海 Takumi', gender: 'male' },
]

type SpeakConfig = {
  audioEncoding?: 'MP3' | 'LINEAR16' | 'OGG_OPUS'
  speakingRate?: number
  pitch?: number
  volumeGainDb?: number
}

type ListenConfig = {
  encoding?:
    | 'LINEAR16'
    | 'MP3'
    | 'FLAC'
    | 'MULAW'
    | 'AMR'
    | 'AMR_WB'
    | 'OGG_OPUS'
    | 'WEBM_OPUS'
    | 'M4A'
    | 'AAC'
  sampleRateHertz?: number
  languageCode?: string
  enableAutomaticPunctuation?: boolean
  enableSpeakerDiarization?: boolean
}

const PLACEHOLDER_KEY_RE = /^(your-|xxxx|demo|mock|test|placeholder|$)/i

export class AliyunNlsVoice {
  appkey: string
  endpoint: string
  accessKeyId: string
  accessKeySecret: string
  speaker: string
  private _tokenCache?: { value: string; expireAt: number }

  constructor() {
    this.appkey = (process.env.ALIYUN_NLS_APPKEY ?? '').trim()
    this.endpoint = (process.env.ALIYUN_NLS_ENDPOINT ?? DEFAULT_ALIYUN_NLS_ENDPOINT).trim() || DEFAULT_ALIYUN_NLS_ENDPOINT
    this.accessKeyId = (process.env.ALIYUN_ACCESS_KEY_ID ?? '').trim()
    this.accessKeySecret = (process.env.ALIYUN_ACCESS_KEY_SECRET ?? '').trim()
    this.speaker = 'xiaoyuan'
  }

  isConfigured(): boolean {
    if (!this.appkey || !this.accessKeyId || !this.accessKeySecret) return false
    return (
      !PLACEHOLDER_KEY_RE.test(this.appkey) &&
      !PLACEHOLDER_KEY_RE.test(this.accessKeyId) &&
      !PLACEHOLDER_KEY_RE.test(this.accessKeySecret)
    )
  }

  private _percentEncode(str: string): string {
    return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  }

  async createToken(): Promise<string> {
    const now = Date.now()
    if (this._tokenCache && this._tokenCache.expireAt > now + 60000) {
      return this._tokenCache.value
    }

    const params: Record<string, string> = {
      Format: 'JSON',
      Version: '2019-02-28',
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: String(now) + Math.random().toString(16).slice(2, 8),
      SignatureVersion: '1.0',
      AccessKeyId: this.accessKeyId,
      Timestamp: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      Action: 'CreateToken',
      Domain: this.endpoint,
    }

    const sortedKeys = Object.keys(params).sort((a, b) => a.localeCompare(b))
    const query = sortedKeys
      .map((k) => `${this._percentEncode(k)}=${this._percentEncode(params[k])}`)
      .join('&')

    const stringToSign = `GET&${this._percentEncode('/')}&${this._percentEncode(query)}`
    const signature = crypto
      .createHmac('sha1', (this.accessKeySecret || '') + '&')
      .update(stringToSign)
      .digest('base64')

    const url = `https://nls-meta.cn-shanghai.aliyuncs.com/?${query}&Signature=${this._percentEncode(signature)}`

    return new Promise((resolve, reject) => {
      const req = https.request(new URL(url), { method: 'GET', timeout: 15000 }, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            const json = JSON.parse(data || '{}')
            const token = json?.Token?.Id
            const expireSeconds = Number(json?.Token?.ExpireTime || 86400)
            if (!token) {
              reject(
                new Error(
                  '阿里云 CreateToken 未返回 Token：' +
                    (json?.Message ?? json?.Code ?? JSON.stringify(json).slice(0, 200)),
                ),
              )
              return
            }
            this._tokenCache = { value: token, expireAt: Date.now() + expireSeconds * 1000 }
            resolve(token)
          } catch (err) {
            reject(new Error('解析阿里云 CreateToken 响应失败：' + (err as Error).message + '，原始：' + data.slice(0, 200)))
          }
        })
      })
      req.on('error', (err) => reject(new Error('请求阿里云 CreateToken 失败：' + err.message)))
      req.on('timeout', () => {
        req.destroy(new Error('请求阿里云 CreateToken 超时（15s）'))
      })
      req.end()
    })
  }

  async speak(
    text: string,
    opts: { speaker?: string; languageCode?: string; audioConfig?: SpeakConfig } = {},
  ): Promise<NodeJS.ReadableStream> {
    const token = await this.createToken()
    const {
      audioEncoding = 'MP3',
      speakingRate = 1.0,
      pitch = 0,
      volumeGainDb = 0,
    } = opts.audioConfig ?? {}

    const aliyunFormat = audioEncoding === 'LINEAR16' ? 'wav' : audioEncoding === 'OGG_OPUS' ? 'opus' : 'mp3'
    const speechRate = Math.round(Math.max(-500, Math.min(500, (speakingRate - 1) * 500)))
    const pitchRate = Math.round(Math.max(-500, Math.min(500, pitch * 25)))
    const volume = Math.round(Math.max(0, Math.min(100, 50 + (volumeGainDb || 0) * 5)))

    const body = JSON.stringify({
      appkey: this.appkey,
      text: String(text ?? ''),
      token,
      format: aliyunFormat,
      sample_rate: 16000,
      voice: opts.speaker ?? this.speaker,
      speech_rate: speechRate,
      pitch_rate: pitchRate,
      volume,
    })

    const url = `https://${this.endpoint}/stream/v1/tts`

    return new Promise((resolve, reject) => {
      const req = https.request(
        new URL(url),
        {
          method: 'POST',
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
            Accept:
              aliyunFormat === 'wav'
                ? 'audio/wav'
                : aliyunFormat === 'opus'
                  ? 'audio/ogg'
                  : 'audio/mpeg, audio/*',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            let errText = ''
            res.on('data', (c) => (errText += c))
            res.on('end', () =>
              reject(
                new Error(
                  `阿里云 TTS 接口 HTTP ${res.statusCode}：${(res.statusMessage || '').toString()}${errText ? ' - ' + errText.slice(0, 400) : ''}`,
                ),
              ),
            )
            return
          }
          const pass = new (require('stream').PassThrough)() as NodeJS.ReadWriteStream
          res.pipe(pass)
          resolve(pass)
        },
      )
      req.on('error', (err) => reject(new Error('请求阿里云 TTS 失败：' + err.message)))
      req.on('timeout', () => req.destroy(new Error('请求阿里云 TTS 超时（30s）')))
      req.write(body)
      req.end()
    })
  }

  async listen(
    stream: NodeJS.ReadableStream,
    opts: { filetype?: string; config?: ListenConfig } = {},
  ): Promise<string> {
    const token = await this.createToken()
    const chunks: Buffer[] = []
    for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const buffer = Buffer.concat(chunks)
    const filetype = opts.filetype ?? 'wav'
    const languageCode = opts.config?.languageCode ?? 'zh-CN'
    const langMap: Record<string, string> = {
      'zh-cn': 'zh-CN',
      'zh-hant-hk': 'zh-Hant-HK',
      'yue-hant-hk': 'zh-Hant-HK',
      'cantonese': 'zh-Hant-HK',
      'zh-cantonese': 'zh-Hant-HK',
      'en-us': 'en-US',
      'ja-jp': 'ja-JP',
    }
    const aliyunLang = langMap[languageCode.toLowerCase()] ?? languageCode

    const bodyParams = new URLSearchParams()
    bodyParams.set('appkey', this.appkey)
    bodyParams.set('token', token)
    bodyParams.set('format', filetype === 'mp3' ? 'mp3' : filetype === 'aac' ? 'aac' : filetype === 'opus' ? 'opus' : filetype === 'wav' ? 'wav' : filetype === 'flac' ? 'flac' : 'wav')
    bodyParams.set('sample_rate', String(opts.config?.sampleRateHertz ?? 16000))
    bodyParams.set('enable_intermediate_result', 'false')
    bodyParams.set('enable_punctuation_prediction', opts.config?.enableAutomaticPunctuation === false ? 'false' : 'true')
    bodyParams.set('enable_inverse_text_normalization', opts.config?.enableAutomaticPunctuation === false ? 'false' : 'true')

    const boundary = '----AliyunNlsBoundary' + crypto.randomBytes(8).toString('hex')
    const header = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="meta"; filename="meta.json"\r\n` +
        `Content-Type: application/json\r\n\r\n` +
        `${JSON.stringify({
          appkey: this.appkey,
          token,
          format: filetype === 'mp3' ? 'mp3' : filetype === 'aac' ? 'aac' : filetype === 'opus' ? 'opus' : filetype === 'wav' ? 'wav' : filetype === 'flac' ? 'flac' : 'wav',
          sample_rate: opts.config?.sampleRateHertz ?? 16000,
          language: aliyunLang,
          enable_punctuation_prediction: opts.config?.enableAutomaticPunctuation === false ? false : true,
          enable_inverse_text_normalization: opts.config?.enableAutomaticPunctuation === false ? false : true,
        })}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="audio"; filename="audio.${filetype === 'mp3' ? 'mp3' : filetype === 'aac' ? 'aac' : filetype === 'opus' ? 'opus' : filetype === 'wav' ? 'wav' : filetype === 'flac' ? 'flac' : 'wav'}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
      'utf-8',
    )
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8')
    const body = Buffer.concat([header, buffer, tail])

    const url = `https://${this.endpoint}/stream/v1/asr?${bodyParams.toString()}`

    return new Promise((resolve, reject) => {
      const req = https.request(
        new URL(url),
        {
          method: 'POST',
          timeout: 60000,
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            Accept: 'application/json',
            'Content-Length': body.length,
          },
        },
        (res) => {
          let text = ''
          res.on('data', (c) => (text += c))
          res.on('end', () => {
            try {
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`阿里云 ASR HTTP ${res.statusCode}：${text.slice(0, 500)}`))
                return
              }
              const json = JSON.parse(text || '{}')
              const transcript = json?.result ?? json?.sentence_list?.map((s: any) => s.text).join('') ?? ''
              if (!transcript && !json?.status_code) {
                throw new Error('阿里云 ASR 未返回 result：' + JSON.stringify(json).slice(0, 200))
              }
              resolve(String(transcript))
            } catch (err) {
              reject(
                new Error(
                  '解析阿里云 ASR 响应失败：' + (err as Error).message + '，原始响应：' + text.slice(0, 300),
                ),
              )
            }
          })
        },
      )
      req.on('error', (err) => reject(new Error('请求阿里云 ASR 失败：' + err.message)))
      req.on('timeout', () => req.destroy(new Error('请求阿里云 ASR 超时（60s）')))
      req.write(body)
      req.end()
    })
  }

  async getSpeakers(opts?: { languageCode?: string }): Promise<Array<{ voiceId: string; languageCodes: string[]; name: string }>> {
    const filterLang = opts?.languageCode
    const list = ALIYUN_CHINESE_VOICE_PRESETS.map((v) => {
      const codes = /xiaomei/i.test(String(v.voiceId))
        ? ['zh-Hant-HK', 'yue-Hant-HK']
        : /^(cally|claire|eric)$/i.test(String(v.voiceId))
          ? ['en-US']
          : /^(sachiko|takumi)$/i.test(String(v.voiceId))
            ? ['ja-JP']
            : ['zh-CN']
      return { voiceId: String(v.voiceId), languageCodes: codes, name: String(v.label) }
    })
    if (!filterLang) return list
    return list.filter((s) =>
      s.languageCodes.some(
        (c) =>
          c.toLowerCase() === String(filterLang).toLowerCase() ||
          c.toLowerCase().startsWith(String(filterLang).toLowerCase().split('-')[0] + '-'),
      ),
    )
  }
}

export const aliyunVoice = new AliyunNlsVoice()
