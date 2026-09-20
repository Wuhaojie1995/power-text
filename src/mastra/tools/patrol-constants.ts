/* 业务后台接口的固定参数与凭据。
   这些常量只在 Mastra 服务端（Node）使用，不会进前端产物，
   所以可以放心读 process.env。 */

export const PATROL_COMPANY_ID = '86e150556c29c77a7c97c8b4d4f21c00'
export const PATROL_PROJECT_ID = 'f482c7115bed8b5804ea84fdd9359bae'
export const PATROL_PROJECT_TYPE = 'Build'

/**
 * 调用业务后台接口的 Authorization。
 *
 * 优先读环境变量 PATROL_API_TOKEN；读不到才用下面这个兜底值
 * （它是开发环境调试用的固定 token，仅为了本地能跑通）。
 *
 * 正式环境请在 .env 里配置 PATROL_API_TOKEN —— 凭据写死在代码里，
 * 一旦仓库外泄就等同于把接口暴露出去。
 * 注意：各工具文件请一律 import 这个常量，不要再复制字面量，
 * 否则轮换 token 时会漏掉某一处。
 */
export const AUTHORIZATION_TOKEN = process.env.PATROL_API_TOKEN ?? '6b1efe6d-f3dc-48f8-b01a-aed29d9bd0ed'
