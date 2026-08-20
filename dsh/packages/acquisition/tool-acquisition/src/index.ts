/**
 * 采集工具插件 `tool-acquisition`：智能体请求“采集某个网页”时调用。
 *
 * 实现方式（本阶段：Node 编排 + Python 采集双栈）：
 * - 通过 `child_process` 调用本地 Python 脚本（`BoBo/scripts/run_camoufox.py`
 *   （默认）/run_scrapling.py/run_crawl4ai.py），脚本真正抓取网页。
 * - 脚本把**渲染后的完整 HTML** 落盘到本地 `BoBo/data/`（默认以 站点_标题_时间戳.html
 *   命名，不生成 .json）；同时把一行单行 JSON 打到 stdout，这里解析后返回给智能体
 *   （`savedTo`/`status`/`preview`，仅作告知，AI 不读 HTML 内容）。
 *
 * 装配方式见 `BoBo/patch/`（`- insert:` 注入 + `- id: webserver` 固定 7070 端口）。
 * 本类工具包无 build 脚本、无 tsdown.config.ts，由根 `tsc -b` + 根 tsdown 统一构建，
 * 但**必须先把它登记进根 `tsconfig.host.json` 的 references** 才能被构建。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

export const name = 'tool-acquisition'
export const inject = ['tools']

export interface Config {
  /** 本地 Python 解释器路径（Windows 建议指向 venv 的 python.exe）。 */
  pythonBin?: string
  /** Python 采集脚本目录（默认 `scripts`）。 */
  scriptsDir?: string
  /** 采集结果落盘目录（默认 `data`）。 */
  dataDir?: string
  /** Python 侧执行超时（毫秒）。 */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  pythonBin: z.string().default('python'),
  scriptsDir: z.string().default('scripts'),
  dataDir: z.string().default('data'),
  timeoutMs: z.natural().min(1000).default(120_000),
})

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'crawl_fetch',
    description:
      'Fetch a webpage with the local Python engine and save the full rendered HTML to the ' +
      'local data directory (default BoBo/data) as a .html file. Returns the saved path, HTTP ' +
      'status and a short text preview; the original HTML is the raw data kept on disk.',
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
      outFile: {
        type: 'string',
        description: 'Optional target .html filename under dataDir; default is auto-generated as 站点_标题_时间戳.html.',
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
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `采集完成:\n- 已保存: ${value.savedTo}\n- HTTP状态: ${value.status}\n- 预览: ${value.contentPreview}`,
      }],
    },
    async execute(args, _exec) {
      const engine = args.engine ?? 'camoufox'
      const pythonBin = config.pythonBin ?? 'python'
      const scriptsDir = config.scriptsDir ?? 'scripts'
      const dataDir = config.dataDir ?? 'data'
      // 由脚本决定落盘文件名：默认 --auto-name（站点_标题_时间戳.html）；
      // 若调用方指定了 outFile，则作为目标 .html 文件名（其下 .html 扩展名由脚本补全）。
      const outBase = args.outFile ?? 'crawl_auto'

      const scriptArgs = [
        join(scriptsDir, `run_${engine}.py`),
        '--url', args.url,
        '--out', join(dataDir, outBase),
      ]
      if (!args.outFile) scriptArgs.push('--auto-name')
      if (args.selector) scriptArgs.push('--selector', args.selector)

      let stdout: string
      try {
        const res = await execFileAsync(pythonBin, scriptArgs,
          { timeout: config.timeoutMs ?? 180_000, encoding: 'utf-8', windowsHide: true })
        stdout = res.stdout
      } catch (err: any) {
        // 脚本失败：仅把错误信息返回给智能体，不写任何本地文件
        const msg = String(err?.stderr ?? err?.message ?? err)
        throw new Error(`crawl_fetch 后台脚本执行失败: ${msg}`)
      }

      let result: any = {}
      try { result = JSON.parse(stdout) } catch { /* stdout 非 JSON 时忽略 */ }

      return {
        savedTo: String(result.savedTo ?? ''),
        status: result.status ?? 0,
        contentPreview: String(result.preview ?? '').slice(0, 2000),
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
