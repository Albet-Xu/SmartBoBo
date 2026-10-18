import { cloakRuntime } from './service.js'
import { cloakFetchTool } from './tools/cloak-fetch.js'
import { browserReadTool } from './tools/browser-read.js'
import { normalizeTool } from './tools/schema.js'
import { SessionProxyMode } from './proxy.js'

export const name = 'dsh-cloakbrowser'

export const inject = ['tools']

export function apply(ctx, config = {}) {
  const runtime = cloakRuntime(config)
  const proxyMode = new SessionProxyMode(ctx)
  const settings = () => ctx.get('settings')
  // 裸注册不会像 defineTool 那样把参数规格转成 JSON Schema，
  // 所以注册前统一兜底一次，防止扁平参数表让上游整条请求 400。
  ctx.tools.register(normalizeTool(cloakFetchTool(runtime, { proxyMode, settings })))
  ctx.tools.register(normalizeTool(browserReadTool(runtime)))
  ctx.effect(() => () => runtime.dispose(), 'dsh-cloakbrowser: service')
  console.log(`[dsh-cloakbrowser] cloak_fetch + browser_read_current registered, endpoint ${runtime.endpoint}, data ${runtime.dataDir}`)
}
