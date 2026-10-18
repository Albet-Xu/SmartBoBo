/**
 * bobo-ready-probe —— 给桌面壳用的"就绪端点"：`GET /_bobo/ready` 返回本进程的
 * 带 token 认证地址。
 *
 * 为什么需要它：内核把 `dsh web: <url>?token=…` 这一行**推迟到整棵插件树
 * Loader settle 之后**才打印（`bundle/web-app` 的 announceReady），端口早就
 * 在监听了、页面也能服务了，壳却还在等那一行 —— 实测差 2.3s，线上更差时到过
 * 61s（一个坏 MCP 的指数退避拖住了 settle）。这里在 webServer 上挂一个极小的
 * 精确路由，壳在端口一通时就能问到 URL，窗口立刻开始加载，剩下 2 秒的插件
 * 激活与页面加载并行掉。
 *
 * 安全边界：
 *   - 只回答 **loopback** 来源（127.0.0.1 / ::1），非本机直接 403；
 *   - 只允许 GET/HEAD，其它 405；
 *   - `Cache-Control: no-store`，不落任何缓存；
 *   - 返回体只含 URL 与端口，不含凭据库内容（token 本来就是给同机壳用的）。
 *
 * 挂载：宿主层一行（由启动器 profile 收敛保证，全模式可用）：
 *     - insert:
 *       - id: bobo-ready-probe
 *         name: 'file:///<安装目录>/resources/runtime/bobo/plugins/ready-probe.mjs'
 */
export const name = 'bobo-ready-probe'

/** 依赖：拿端口（webServer）与签发认证 URL（connection）。 */
export const inject = ['webServer', 'connection']

/** 端点路径（绝对、无尾斜杠）。 */
const READY_PATH = '/_bobo/ready'

/** 允许访问的本机来源地址。 */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * 判断请求是否来自本机。
 * @param req - Node 请求对象。
 * @returns true = loopback。
 */
function isLoopback(req) {
  const raw = req?.socket?.remoteAddress
  return typeof raw === 'string' && LOOPBACK.has(raw)
}

/**
 * 发送 JSON 响应（自己拥有响应生命周期）。
 * @param res - Node 响应对象。
 * @param status - HTTP 状态码。
 * @param body - 待序列化对象。
 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 0)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Length', Buffer.byteLength(text))
  res.end(text)
}

/**
 * 装载就绪端点。
 * @param ctx - 宿主作用域的 cordis 上下文。
 */
export function apply(ctx) {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: READY_PATH,
      handler: (req, res) => {
        try {
          if (!isLoopback(req)) {
            sendJson(res, 403, { error: 'loopback only' })
            return
          }
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.setHeader('Allow', 'GET, HEAD')
            sendJson(res, 405, { error: 'method not allowed' })
            return
          }
          const port = ctx.get('webServer')?.port
          if (port === undefined) {
            sendJson(res, 503, { error: 'webServer not ready' })
            return
          }
          const base = `http://127.0.0.1:${String(port)}`
          const url = ctx.connection.authenticatedUrl(base)
          if (req.method === 'HEAD') {
            res.statusCode = 200
            res.setHeader('Cache-Control', 'no-store')
            res.end()
            return
          }
          sendJson(res, 200, { url, port, pid: process.pid })
        } catch (error) {
          try {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
          } catch {
            /* 响应已发出或连接已断：无需处理 */
          }
        }
      },
    })
    return () => {
      try {
        dispose()
      } catch {
        /* 卸载期路由已随 fiber 释放：忽略 */
      }
    }
  }, 'bobo-ready-probe endpoint')
}
