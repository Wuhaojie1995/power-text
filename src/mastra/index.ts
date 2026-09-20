import { Mastra } from '@mastra/core/mastra'
import { PinoLogger } from '@mastra/loggers'
import { LibSQLStore } from '@mastra/libsql'
import { DuckDBStore } from '@mastra/duckdb'
import { MastraCompositeStore } from '@mastra/core/storage'
import {
  Observability,
  MastraStorageExporter,
  MastraPlatformExporter,
  SensitiveDataFilter,
} from '@mastra/observability'
import { patrolAgent } from './agents/patrol-agent'
import { patrolTool } from './tools/patrol-tool'
import { dateTimeTool } from './tools/date-time-tool'
import { unitProjectTool } from './tools/unit-project-tool'
import { problemTypeTool } from './tools/problem-type-tool'
import { projectMemberTool } from './tools/project-member-tool'
import { problemClassifyTool } from './tools/problem-classify-tool'
import { problemNatureTool } from './tools/problem-nature-tool'

export const mastra = new Mastra({
  agents: {
    patrolAgent,
  },
  tools: {
    patrolTool,
    dateTimeTool,
    unitProjectTool,
    problemTypeTool,
    projectMemberTool,
    problemClassifyTool,
    problemNatureTool,
  },
  /**
   * 本地持久化：默认 LibSQL（SQLite 文件 mastra.db）落盘 agents / threads / messages /
   * workflows / workingMemory 等数据；observability 域单独走 DuckDB（mastra.duckdb），
   * 与 mastra-study 保持一致。
   * 部署时配置 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 即可切到远端 Turso，无需改代码。
   */
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: process.env.TURSO_DATABASE_URL ?? 'file:./mastra.db',
      authToken: process.env.TURSO_AUTH_TOKEN,
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  // 把 trace / span 写进上面的 storage（DuckDB）；配了 MASTRA_PLATFORM_ACCESS_TOKEN 会额外上报平台
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new MastraStorageExporter(),
          new MastraPlatformExporter(),
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(),
        ],
      },
    },
  }),
  server: {
    port: 4112,
  },
})
