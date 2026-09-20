import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

export default defineConfig(({ mode }) => {
  let envFile = '.env'
  if (mode === 'production') {
    envFile = '.envProd'
  }

  const envDir = process.cwd()
  const envPath = path.join(envDir, envFile)

  let envConfig: Record<string, string> = {}
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    const lines = envContent.split('\n')
    lines.forEach((line) => {
      const trimmedLine = line.trim()
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const match = trimmedLine.match(/^VITE_([^=]+)=(.*)$/)
        if (match) {
          const [, key, value] = match
          let cleanValue = value.trim()
          if (
            (cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
            (cleanValue.startsWith("'") && cleanValue.endsWith("'"))
          ) {
            cleanValue = cleanValue.slice(1, -1)
          }
          envConfig[key] = cleanValue
        }
      }
    })
  }

  const env = loadEnv(mode, process.cwd(), '')

  const port = Number(envConfig.PORT || env.VITE_PORT || '5173')
  const outputDir = envConfig.OUTPUT || env.VITE_OUTPUT || 'dist'
  const basename = envConfig.BASENAME || env.VITE_BASENAME || ''

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    css: {
      preprocessorOptions: {
        less: {
          // 自动给每个 .less 文件注入主题变量（@color-primary / @shadow-md ...），
          // 业务样式里直接写变量名即可，不用逐个文件 @import。
          // 这里必须用绝对路径 + 正斜杠：相对路径会以「引用它的 less 文件」为基准解析，
          // Windows 的 \ 也会让 less 解析失败。
          additionalData: `@import "${path
            .resolve(__dirname, './src/styles/variables.less')
            .replace(/\\/g, '/')}";\n`,
          javascriptEnabled: true,
        },
      },
    },
    define: {
      'import.meta.env.VITE_ENVIRONMENT': JSON.stringify(envConfig.ENVIRONMENT || env.VITE_ENVIRONMENT || 'development'),
      'import.meta.env.VITE_TITLE': JSON.stringify(envConfig.TITLE || env.VITE_TITLE || ''),
      'import.meta.env.VITE_CODE': JSON.stringify(envConfig.CODE || env.VITE_CODE || ''),
      'import.meta.env.VITE_PORT': JSON.stringify(envConfig.PORT || env.VITE_PORT || '5173'),
      'import.meta.env.VITE_OUTPUT': JSON.stringify(envConfig.OUTPUT || env.VITE_OUTPUT || 'dist'),
      'import.meta.env.VITE_BASENAME': JSON.stringify(envConfig.BASENAME || env.VITE_BASENAME || ''),
      'import.meta.env.VITE_SERVER': JSON.stringify(envConfig.SERVER || env.VITE_SERVER || ''),
      'import.meta.env.VITE_STATIC_SRC': JSON.stringify(envConfig.STATIC_SRC || env.VITE_STATIC_SRC || ''),
      'import.meta.env.VITE_MICRO_ENTRY': JSON.stringify(envConfig.MICRO_ENTRY || env.VITE_MICRO_ENTRY || ''),
      'import.meta.env.VITE_MICRO_WINDOW_ENTRY': JSON.stringify(envConfig.MICRO_WINDOW_ENTRY || env.VITE_MICRO_WINDOW_ENTRY || ''),
      // Mastra 服务地址：用 ?? 而不是 ||，这样在 .envProd 里显式写空字符串
      // 才会被当成「不配置」，交给前端的同源兜底逻辑处理；
      // 用 || 会被 .env 里的 localhost:4112 顶掉，导致生产构建连不上。
      'import.meta.env.VITE_MASTRA_API_URL': JSON.stringify(
        envConfig.MASTRA_API_URL ?? env.VITE_MASTRA_API_URL ?? '',
      ),
    },
    server: {
      port: port,
      host: true,
    },
    base: basename,
    build: {
      outDir: outputDir,
      sourcemap: false,
      rollupOptions: {
        output: {
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
        },
      },
    },
  }
})
