/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENVIRONMENT: string
  readonly VITE_TITLE: string
  readonly VITE_CODE: string
  readonly VITE_PORT: string
  readonly VITE_OUTPUT: string
  readonly VITE_BASENAME: string
  readonly VITE_SERVER: string
  readonly VITE_STATIC_SRC: string
  readonly VITE_MICRO_ENTRY: string
  readonly VITE_MICRO_WINDOW_ENTRY: string
  readonly VITE_MASTRA_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
