/**
 * at-workspace —— "@工作区引用"插件（host 侧注入核心）。
 *
 * 用户在输入框输入 `@路径`（如 `@data/xx.md`、`@scraped`）后，本插件在
 * `agent/pre-step` 扫描真实用户消息，把能解析到的引用展开成注入内容：
 *   · @文件   → 注入该文件内容（带大小/二进制上限保护）
 *   · @目录   → 注入该目录的相对路径文件清单树（限深/限量）
 * 原始 `@路径` 文本保留在用户消息里；注入内容以 source.kind='plugin' 的额外
 * 消息追加到模型请求，保证"模型输入可从日志还原"（dsh 模型可见⟺可记录约束）。
 *
 * 找不到的引用（文件不在工作区 / 越权目录 / 二进制 / 超限）保持原文不注入，
 * 不静默丢字；一次性注入数量受 maxReferences 限制，避免刷屏。
 *
 * 挂载：所有 `agent-presets/<预设名>/agent.cordis.yml` 各挂一行（相对路径按预设文件目录解析）。
 * 纯逻辑函数已导出，可直接用 node 验证。
 */
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep, isAbsolute } from 'node:path'

export const name = 'at-workspace'

const DEFAULT_CONFIG = {
  /** @引用 解析的根目录。不设则用进程 cwd()。 */
  workspaceRoot: '',
  /** 目录清单树的最大深度。 */
  maxDepth: 8,
  /** 单文件内容注入上限（字节）；超过则不注入正文，仅给路径+大小提示。 */
  maxBytes: 65536,
  /** 单条用户消息最多展开几个引用。 */
  maxReferences: 8,
  /** 目录清单树最多列出的条目数。 */
  maxTreeRows: 800,
  /** 永不索引/注入的目录名（小写匹配）。 */
  skipDirectories: ['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '__pycache__', '.venv', '.idea', '.vscode', '.dsh'],
  /** 视作文本、允许注入内容的扩展名（小写）；其余一律当作二进制只给元数据。 */
  textExtensions: [
    '.txt', '.md', '.markdown', '.json', '.jsonl', '.yml', '.yaml', '.toml',
    '.csv', '.tsv', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
    '.py', '.rs', '.go', '.java', '.c', '.h', '.cpp', '.hpp',
    '.html', '.htm', '.css', '.scss', '.xml', '.sql', '.log', '.ini', '.cfg',
  ],
}

const AT_TOKEN = /(?<![\w@./-])@([A-Za-z0-9_][A-Za-z0-9_./-]*)/g

/** 一条插件来源的 user 消息（与 dsh 内建注入同形）。 */
function injectedMessage(text) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name },
  })
}

/** 提取用户消息的纯文本（与 xujianbo-persona 一致）。 */
export function textOf(message) {
  const content = Array.isArray(message?.content) ? message.content : []
  return content.filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

/** 收集一条消息文本里的全部 @token（去空、去重、保序）。 */
export function collectTokens(text) {
  const tokens = []
  for (const m of String(text ?? '').matchAll(AT_TOKEN)) tokens.push(m[1])
  return [...new Set(tokens.filter(Boolean))]
}

function rootOf(cfg) {
  return cfg.workspaceRoot ? cfg.workspaceRoot : process.cwd()
}

function resolveIn(root, token) {
  // token 以 @ 之后的内容为准；拒绝绝对路径逃逸与 '..' 越界
  if (token.includes('..')) return undefined
  if (isAbsolute(token)) return undefined
  const segments = token.split('/').filter(Boolean)
  if (segments.length === 0) return undefined
  // 直接引用跳过目录（node_modules/.git 等）内的东西也不放行，避免把依赖/产物灌进上下文
  if (isSkipped(segments[0])) return undefined
  const resolved = join(root, ...segments)
  if (!join(resolved).startsWith(resolveRoot(root))) return undefined
  return resolved
}

function resolveRoot(root) {
  const abs = join(root) + sep
  return abs
}

function isSkipped(entryName) {
  const n = `${entryName}`.toLowerCase()
  return DEFAULT_CONFIG.skipDirectories.some((d) => d.toLowerCase() === n)
}

const MAX_BINARY_PREVIEW = 1024

/** 构造一段文件的注入文本；返回 null 表示不该注入（越界/二进制过大等）。 */
export function fileBlock(root, absPath, fileBytes) {
  const rel = relative(root, absPath).split(sep).join('/')
  if (fileBytes > 0 && fileBytes > DEFAULT_CONFIG.maxBytes) {
    return `<at-file path="${rel}" note="文件过大(${fileBytes} 字节)，超过 ${DEFAULT_CONFIG.maxBytes} 上限，未注入正文。" />`
  }
  const ext = (absPath.slice(absPath.lastIndexOf('.')).toLowerCase())
  const isText = DEFAULT_CONFIG.textExtensions.includes(ext)
  let body
  try {
    const raw = readFileSync(absPath)
    if (!isText) {
      if (raw.length > MAX_BINARY_PREVIEW) {
        return `<at-file path="${rel}" note="二进制文件(${raw.length} 字节)，仅列元数据。" />`
      }
      body = raw.length === 0 ? '' : raw.toString('utf8')
    } else {
      body = raw.toString('utf8')
    }
  } catch (e) {
    return `<at-file path="${rel}" note="读取失败：${e && e.message ? e.message : e}" />`
  }
  body = truncateBody(body)
  return `<at-file path="${rel}">\n${body}\n</at-file>`
}

/** 目录清单树（相对路径，限深限量），不注入文件正文。 */
export function treeBlock(root, absPath) {
  const rel = resolveRoot(root)
  const out = []
  const skipSymlinks = true
  const walk = (dir, depth) => {
    if (depth > DEFAULT_CONFIG.maxDepth) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? (a.name < b.name ? -1 : 1) : a.isDirectory() ? -1 : 1))
    for (const ent of entries) {
      if (out.length >= DEFAULT_CONFIG.maxTreeRows) return
      if (isSkipped(ent.name) || (skipSymlinks && ent.isSymbolicLink())) continue
      const child = join(dir, ent.name)
      const childRel = relative(root, child).split(sep).join('/')
      if (ent.isDirectory()) {
        out.push(`${childRel}/`)
        walk(child, depth + 1)
      } else if (ent.isFile()) {
        out.push(childRel)
      }
    }
  }
  walk(absPath, 0)
  return `<at-directory path="${relative(root, absPath).split(sep).join('/') || '.'}">\n${out.join('\n')}\n</at-directory>`
}

function truncateBody(body) {
  if (body.length <= 40000) return body
  return `${body.slice(0, 40000)}\n…(正文超长已截断，可用读取/搜索工具继续)`
}

/**
 * 展开一条用户消息文本里的 @引用，返回追加的注入消息列表。
 * @param root - 工作区根目录。
 * @param text - 用户消息文本。
 * @param log - `{ info(m) }`。
 * @returns 注入消息数组（可能为空）。
 */
export function expandReferences(root, text, log = {}) {
  const info = typeof log.info === 'function' ? log.info : () => {}
  const tokens = collectTokens(text).slice(0, DEFAULT_CONFIG.maxReferences)
  const blocks = []
  for (const token of tokens) {
    const abs = resolveIn(root, token)
    if (abs === undefined) {
      info(`[at-workspace] 引用 "${token}" 越界/不合法，跳过`)
      continue
    }
    let st
    try {
      st = statSync(abs)
    } catch {
      info(`[at-workspace] 引用 "${token}" 不存在，保持原文`)
      continue
    }
    if (st.isFile()) {
      const b = fileBlock(root, abs, st.size)
      if (b) blocks.push(b)
    } else if (st.isDirectory()) {
      blocks.push(treeBlock(root, abs))
    } else {
      info(`[at-workspace] 引用 "${token}" 非普通文件/目录，跳过`)
    }
  }
  return blocks
}

/**
 * 装载 @工作区引用注入。
 * @param ctx - 预设作用域内的插件上下文。
 * @param config - 可覆盖 {@link DEFAULT_CONFIG} 的任意字段。
 */
export function apply(ctx, config) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) }
  const root = rootOf(cfg)
  const log = {
    info: (message) => {
      try {
        if (ctx.logger && typeof ctx.logger.info === 'function') ctx.logger.info(message)
        else console.log(message)
      } catch { /* 日志不可用不影响功能 */ }
    },
  }
  const seen = new Set()
  const claim = (key) => {
    if (seen.has(key)) return false
    if (seen.size > 4000) seen.delete(seen.values().next().value)
    seen.add(key)
    return true
  }

  const onPreStep = async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || payload.signal?.aborted === true) return decision
    const sessionId = String(payload.agent?.id ?? payload.agent?.session?.id ?? '')
    if (!claim(`${sessionId}:${payload.turn}:${payload.step}`)) return decision
    const injected = []
    const messages = payload.messages ?? []
    for (const message of messages) {
      if (message?.source?.kind !== 'user') continue
      const text = textOf(message)
      const blocks = expandReferences(root, text, log)
      if (blocks.length > 0) injected.push(...blocks)
    }
    if (injected.length === 0) return decision
    return { kind: 'enter', messages: [...decision.messages, ...injected.map(injectedMessage)] }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.on('agent/pre-step', onPreStep),
      ctx.root.on('agent/pre-step', onPreStep),
    ]
    return () => {
      for (const dispose of disposers) {
        try { dispose() } catch { /* fiber 卸载重复释放可忽略 */ }
      }
    }
  })
}