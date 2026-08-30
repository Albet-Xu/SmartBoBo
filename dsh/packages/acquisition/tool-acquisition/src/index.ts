/**
 * 采集工具插件 `tool-acquisition`：智能体请求"采集某个网页"时调用。
 *
 * 实现方式（Node 编排 + Python 采集，浏览器统一为长驻 Camoufox）：
 * - 会话内由本插件按需拉起/常驻 `scripts/browser_server.py`（一个持有 camoufox 的
 *   长驻浏览器服务，排队复用同一 context），智能体/会话关闭（dispose）时关闭它；
 *   服务异常退出后由下一次采集自动重启。代理在服务（每次）启动时注入一次。
 * - 每次采集通过 `child_process` 调用 `BoBo/scripts/run_<engine>.py`
 *   （camoufox 默认 /scrapling/crawl4ai），脚本作为瘦客户端向浏览器服务取"渲染后的
 *   完整文档"，再按 `outputFormat`（支持逗号分隔多格式）派生 html / md / skeleton 落盘
 *   （默认以 站点_标题_时间戳.<格式扩展名> 命名，不生成 .json），并把一行单行 JSON
 *   打到 stdout，这里解析后返回给智能体（`savedTo`/`status`/`preview`/`format`/`outputs`）。
 * - 三引擎共用同一浏览器与同一套 selector 切片 + 格式转换 + 落盘逻辑（crawl_common.py），
 *   engine 仅作为解析/输出方式选项保留。
 * - 默认保存位置为当前工作区的 data 文件夹，除非用户明确指定其他位置。
 *
 * 装配方式见 `BoBo/patch/`（`- insert:` 注入 + `- id: webserver` 固定 7070 端口）。
 * 本类工具包无 build 脚本、无 tsdown.config.ts，由根 `tsc -b` + 根 tsdown 统一构建，
 * 但**必须先把它登记进根 `tsconfig.host.json` 的 references** 才能被构建。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// Proxy support: fold proxy/enabled from session events
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Fold proxy mode from session events (last proxy/enabled wins). */
function foldProxyEnabled(events: readonly SessionEvent[]): boolean {
  let enabled = false
  for (const event of events) {
    if ((event as any).type === 'proxy/enabled') enabled = (event as any).data.enabled
  }
  return enabled
}

const PROXY_POOL_NAMESPACE = 'proxy-pool'

/** ProxyPoolConfig from settings. */
interface ProxyPoolConfig {
  sources: Array<{ name: string; apiUrl: string; apiKey: string; pwd: string; getnum: number; httptype: string; geshi: string; fenge: string; enabled: boolean }>
  fetchStrategy: 'cache' | 'realtime'
  enabled: boolean
  maxRetries: number
  timeoutMs: number
}

const execFileAsync = promisify(execFile)

/**
 * 定位 BoBo 项目根目录（含 `dsh/`、`scripts/`、`.venv`、`data` 的目录）。
 * 从本插件所在目录（lib 或 src）向上逐级查找第一个含 `dsh` 子目录的目录，
 * 从而不依赖启动时的工作目录(cwd)或环境变量——项目克隆到任何路径都能正确定位。
 * 找不到时返回 undefined（回退到相对路径）。
 */
function findProjectRoot(start: string): string | undefined {
  let dir = resolve(start)
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'dsh'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/** 本项目（BoBo 平台）根目录；据此定位 .venv / scripts / data，跨机器、跨平台可移植。 */
const BOBO_ROOT = findProjectRoot(dirname(fileURLToPath(import.meta.url)))

/** Windows 用 .venv/Scripts/python.exe，Linux/macOS 用 .venv/bin/python。 */
const PYTHON_SUBPATH = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python'

/** 支持的输出格式集合，用于把用户选择的 outputFormat 校验后透传给 Python 脚本。 */
const OUTPUT_FORMATS = ['html', 'md', 'skeleton'] as const

export const name = 'tool-acquisition'
export const inject = ['tools']

export interface Config {
  /** 本地 Python 解释器路径（Windows 建议指向 venv 的 python.exe）。 */
  pythonBin?: string
  /** Python 采集脚本目录（默认 `scripts`）。 */
  scriptsDir?: string
  /** 采集结果落盘目录（默认 `data`）。当为空时，使用当前工作区的 data 文件夹。 */
  dataDir?: string
  /** Python 侧执行超时（毫秒）。 */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  // 可不填：未显式配置时由插件自动定位 BoBo 根的 .venv / scripts（可移植）。
  // 注：schemastery 字段默认可省略，此处不加 default/optional。
  pythonBin: z.string(),
  scriptsDir: z.string(),
  dataDir: z.string().default(''),
  timeoutMs: z.natural().min(1000).default(120_000),
})

/**
 * 采集结果落盘目录：
 * 1) 显式配置的 dataDir；
 * 2) 当前会话的工作区（session cwd）下的 data——没有则自动创建（用户要求优先）；
 * 3) BoBo 项目根 data 仅作兜底（会话无工作区时）；
 * 4) 最终相对 data。
 */
function getDataDir(config: Config, workspacePath?: string): string {
  // 1) 显式配置
  if (config.dataDir && config.dataDir.trim() !== '') {
    return config.dataDir
  }

  // 2) 当前会话的工作区 data（优先；没有就创建 data 文件夹）
  if (workspacePath && workspacePath.trim() !== '') {
    const dataDir = join(workspacePath, 'data')
    try {
      mkdirSync(dataDir, { recursive: true })
    } catch {
      // 创建失败则在脚本写入时再尝试
    }
    return dataDir
  }

  // 3) 兜底：BoBo 项目根 data（仅在会话无工作区时）
  if (BOBO_ROOT) {
    return join(BOBO_ROOT, 'data')
  }

  // 4) 最终兜底
  return 'data'
}

export function apply(ctx: Context, config: Config): void {
  // ── 长驻 Camoufox 浏览器服务（browser_server.py）生命周期管理 ────────────
  // 采集不再由每次子进程各自拉起浏览器，而是向本服务排队取"渲染后的完整文档"。
  // 服务随插件/会话 teardown 关闭（dispose）；异常退出后由下一次采集自动重启。
  let serverChild: ChildProcess | null = null
  let serverPort: number | null = null
  let serverStarting: Promise<number> | null = null

  const killServer = (): void => {
    const child = serverChild
    serverChild = null
    serverPort = null
    serverStarting = null
    if (child && child.exitCode === null && !child.killed) {
      try {
        child.kill()
      } catch {
        /* 已退出则忽略 */
      }
      // Windows 下 kill 只终止 python 直接子进程，需递归清掉 camoufox firefox 子进程避免残留
      if (process.platform === 'win32' && child.pid) {
        execFileAsync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {})
      }
    }
  }

  // 确保长驻浏览器服务在跑；未启动或已退出则拉起，返回连接端点端口。
  const ensureServer = async (pythonBin: string, scriptsDir: string, proxy?: string): Promise<number> => {
    if (serverChild && serverChild.exitCode === null && serverPort != null) return serverPort
    if (serverStarting) return serverStarting
    serverStarting = (async () => {
      const child = spawn(pythonBin, [
        join(scriptsDir, 'browser_server.py'),
        ...(proxy ? ['--proxy', proxy] : []),
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      serverChild = child
      const port = await new Promise<number>((resolve, reject) => {
        let buf = ''
        let settled = false
        const timer = setTimeout(() => {
          if (!settled) { settled = true; reject(new Error('浏览器服务启动超时（60s）')) }
        }, 60_000)
        const onData = (chunk: Buffer | string): void => {
          buf += chunk.toString()
          const m = buf.match(/READY (\d+)/)
          if (m && !settled) {
            settled = true
            clearTimeout(timer)
            child.stdout?.off('data', onData)
            resolve(Number(m[1]))
          }
        }
        child.stdout?.on('data', onData)
        child.stderr?.on('data', () => { /* 仅排空，不拼到 READY 解析，避免错序 */ })
        child.once('exit', (code) => {
          if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`浏览器服务异常退出(code=${code})`)) }
        })
      })
      serverPort = port
      child.on('exit', () => {
        if (serverChild === child) { serverChild = null; serverPort = null }
        serverStarting = null
      })
      return port
    })()
    try {
      return await serverStarting
    } catch (err) {
      serverStarting = null
      serverChild = null
      serverPort = null
      throw err
    }
  }

  // 插件/会话 teardown（fiber 释放）时关闭浏览器：智能体关闭 → 会话结束 → 关闭浏览器。
  // 用 ctx.effect 注册 disposer（dsh 惯例，替代未入事件表的 'dispose' 事件）。
  ctx.effect(() => killServer)

  ctx.tools.register(defineTool({
    name: 'crawl_fetch',
    description:
      'Fetch a webpage with the local Python engine, convert the rendered content to one or more ' +
      'chosen output formats, and save them to the local data directory. A single crawl can produce ' +
      'multiple formats (each derived from the same rendered HTML). By default, saves to the current ' +
      'workspace\'s data folder. Returns the saved path(s), HTTP status, chosen format(s) and a short text preview.',
    parameters: {
      url: {
        type: 'string',
        required: true,
        description: 'The target webpage URL to crawl, e.g. https://example.com.',
      },
      engine: {
        type: 'string',
        // 可选：省略 required（required 只能为 true 或省略，不能写 false）
        description: 'engine to use: "camoufox" (default, anti-detect browser) or "scrapling" / "crawl4ai".',
      },
      selector: {
        type: 'string',
        description: 'Optional CSS selector to narrow extraction (Scrapling). When present, only the first match is returned.',
      },
      outputFormat: {
        type: 'string',
        description: 'One or more output formats, comma-separated: "html" (raw rendered HTML), "md" (Markdown, default), "skeleton" (block-level webpage skeleton). E.g. "html,md,skeleton" returns all three from a single crawl. Extensions: html -> .html, md -> .md, skeleton -> .skeleton.txt.',
      },
      outFile: {
        type: 'string',
        description: 'Optional target filename; default is auto-generated as 站点_标题_时间戳.<ext>. Extension is appended per outputFormat when missing.',
      },
      saveDir: {
        type: 'string',
        description: 'Optional directory to save the file; default is the current workspace\'s data folder.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          savedTo: { type: 'string', required: true },
          status: { type: 'number', required: true },
          contentPreview: { type: 'string', required: true },
          format: { type: 'string', required: true },
          outputs: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                format: { type: 'string', required: true },
                path: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const files = Array.isArray(value.outputs) && value.outputs.length > 0
          ? value.outputs.map((o) => `- ${o.format}: ${o.path}`).join('\n')
          : `- 已保存: ${value.savedTo}`
        return [{
          type: 'text',
          text: `采集完成:\n${files}\n- HTTP状态: ${value.status}\n- 格式: ${value.format}\n- 预览: ${value.contentPreview}`,
        }]
      },
    },
    async execute(args, exec) {
      const engine = args.engine ?? 'camoufox'
      // 先校验再使用：outputFormat 支持逗号分隔多格式；剔除非预期值与重复项，空则回退 md
      const requested = args.outputFormat ?? 'md'
      const formats = requested.split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((f) => (OUTPUT_FORMATS as readonly string[]).includes(f))
      const safeFormats = Array.from(new Set(formats))
      const format = safeFormats.length > 0 ? safeFormats.join(',') : 'md'
      // 优先用配置显式值；否则自动定位到 BoBo 根对应的 .venv / scripts（跨机器可移植）
      const pythonBin = config.pythonBin
        ?? (BOBO_ROOT ? join(BOBO_ROOT, PYTHON_SUBPATH) : 'python')
      const scriptsDir = config.scriptsDir
        ?? (BOBO_ROOT ? join(BOBO_ROOT, 'scripts') : 'scripts')

      // 确定保存目录：优先用户指定 saveDir；否则由 getDataDir 决定——
      // 显式 config.dataDir > 当前会话工作区 <cwd>/data(自动创建) > BoBo根/data(兜底)
      let dataDir: string
      if (args.saveDir) {
        dataDir = args.saveDir
      } else {
        // 从当前会话获取工作区路径
        const sessionCwd = exec.agent?.session.header.cwd
        if (sessionCwd) {
          dataDir = getDataDir(config, sessionCwd)
        } else {
          dataDir = getDataDir(config)
        }
      }

      // 由脚本决定落盘文件名：默认 --auto-name（站点_标题_时间戳.<各格式扩展名>）；
      // 若调用方指定了 outFile，则作为目标文件名基座（缺失的格式扩展名由脚本补全）。
      const outBase = args.outFile ?? 'crawl_auto'

      // ── Proxy support ──────────────────────────────────────────────────
      // 代理统一由长驻 browser_server 在服务启动时承载一次（引擎脚本不再各自带 proxy）。
      const agent = exec.agent
      const proxyEnabled = agent ? foldProxyEnabled(agent.session.events) : false
      let proxyConfig: ProxyPoolConfig | null = null
      if (proxyEnabled) {
        // Read proxy pool config from settings
        try {
          const settingsApi = (ctx as any).get?.('settings')
          if (settingsApi?.describe) {
            const resp = await settingsApi.describe({})
            if (resp.result?.ok) {
              const ns = resp.result.value.namespaces.find((n: any) => n.ns === PROXY_POOL_NAMESPACE)
              if (ns) proxyConfig = ns.value as ProxyPoolConfig
            }
          }
        } catch {
          // Settings not available, continue without proxy
        }
      }

      // 会话启用代理且配置有可用源时，取一个代理地址注入到浏览器服务（每次（重）启动取一次）。
      let proxyAddr: string | undefined
      if (proxyEnabled && proxyConfig?.enabled !== false && proxyConfig?.sources?.length) {
        const getProxyArgs = [
          join(scriptsDir, 'proxy_pool.py'),
          '--action', 'get',
          '--config-json', JSON.stringify({
            sources: proxyConfig.sources.filter((s: any) => s.enabled),
            fetchStrategy: proxyConfig.fetchStrategy,
            timeoutMs: proxyConfig.timeoutMs,
          }),
          '--target-url', args.url,
        ]
        const proxyRes = await execFileAsync(pythonBin, getProxyArgs,
          { timeout: 15000, encoding: 'utf-8', windowsHide: true })
        const proxyData = JSON.parse(proxyRes.stdout)
        if (proxyData?.failed === true) {
          // 代理池内部已跑满 3 轮筛选仍无可用代理；直接询问用户，避免放大重试
          throw new Error('代理失效，是否走本地网络进行访问网页？')
        }
        if (!proxyData?.proxy) {
          throw new Error('代理池无可用代理，是否走本地网络进行访问网页？')
        }
        proxyAddr = String(proxyData.proxy)
      }

      // 确保长驻浏览器服务在跑，采集脚本统一连它取渲染结果
      const serverAddr = `127.0.0.1:${await ensureServer(pythonBin, scriptsDir, proxyAddr)}`

      const buildScriptArgs = (addr: string): string[] => [
        join(scriptsDir, `run_${engine}.py`),
        '--url', args.url,
        '--out', join(dataDir, outBase),
        '--format', format,
        '--server', addr,
        ...(args.outFile ? [] : ['--auto-name']),
        ...(args.selector ? ['--selector', args.selector] : []),
      ]

      // 执行采集。若浏览器服务不可达（客户端退出码 2），自动重启服务并重试一次。
      let stdout: string
      try {
        const res = await execFileAsync(pythonBin, buildScriptArgs(serverAddr),
          { timeout: config.timeoutMs ?? 180_000, encoding: 'utf-8', windowsHide: true })
        stdout = res.stdout
      } catch (err: any) {
        const msg = String(err?.stderr ?? err?.message ?? err)
        if (Number(err?.code) !== 2) {
          // 非"服务不可达"：仅把错误信息返回给智能体，不写任何本地文件
          throw new Error(`crawl_fetch 后台脚本执行失败: ${msg}`)
        }
        // 服务不可达：关掉坏实例，重启后重试一次
        killServer()
        const newAddr = `127.0.0.1:${await ensureServer(pythonBin, scriptsDir, proxyAddr)}`
        try {
          const res = await execFileAsync(pythonBin, buildScriptArgs(newAddr),
            { timeout: config.timeoutMs ?? 180_000, encoding: 'utf-8', windowsHide: true })
          stdout = res.stdout
        } catch (err2: any) {
          const msg2 = String((err2 as any)?.stderr ?? (err2 as any)?.message ?? err2)
          throw new Error(`crawl_fetch 后台脚本执行失败（浏览器服务已重启仍不可用）: ${msg2}`)
        }
      }

      let result: any = {}
      try { result = JSON.parse(stdout) } catch { /* stdout 非 JSON 时忽略 */ }

      const outputs = Array.isArray(result.outputs)
        ? result.outputs.map((o: any) => ({ format: String(o?.format ?? ''), path: String(o?.path ?? '') }))
        : []

      return {
        savedTo: String(result.savedTo ?? ''),
        status: result.status ?? 0,
        contentPreview: String(result.preview ?? '').slice(0, 2000),
        format: String(result.format ?? format),
        outputs,
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `采集: ${args.url}`,
      rawInput: args.url,
      kind: 'fetch',
    }),
    presentResult: (_args, _result) => ({ card: 'generic' }),
  }))
}