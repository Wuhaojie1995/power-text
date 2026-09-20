/**
 * 环境变量统一出口。
 *
 * 这些 VITE_* 变量由 vite.config.ts 的 define 在【构建时】直接替换成字面量，
 * 所以这里读到的永远是打包那一刻的值，运行时改 .env 不生效（要重新 build）。
 * 开发/生产分别读 .env / .envProd，由 vite mode 决定。
 */
export interface EnvConfig {
  ENVIRONMENT: string
  TITLE: string
  CODE: string
  PORT: string
  OUTPUT: string
  BASENAME: string
  SERVER: string
  STATIC_SRC: string
  MICRO_ENTRY: string
  MICRO_WINDOW_ENTRY: string
}

export const envConfig: EnvConfig = {
  ENVIRONMENT: import.meta.env.VITE_ENVIRONMENT,
  TITLE: import.meta.env.VITE_TITLE,
  CODE: import.meta.env.VITE_CODE,
  PORT: import.meta.env.VITE_PORT,
  OUTPUT: import.meta.env.VITE_OUTPUT,
  BASENAME: import.meta.env.VITE_BASENAME,
  SERVER: import.meta.env.VITE_SERVER,
  STATIC_SRC: import.meta.env.VITE_STATIC_SRC,
  MICRO_ENTRY: import.meta.env.VITE_MICRO_ENTRY,
  MICRO_WINDOW_ENTRY: import.meta.env.VITE_MICRO_WINDOW_ENTRY,
}

export const isDev = envConfig.ENVIRONMENT === 'development'

/** 环境中文名，顶栏徽标用 */
export const envLabel = isDev ? '开发环境' : '生产环境'
