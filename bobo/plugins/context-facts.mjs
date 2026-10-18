/**
 * context-facts —— 压缩后的「确定性事实块」（不花 LLM 调用，不丢工作状态）。
 *
 * ## 为什么需要它
 *
 * 上游 `compaction-basic` 压缩时是**让模型写摘要**：质量不错，但（1）每次压缩都要多花一次
 * 大模型调用；（2）摘要由模型自由发挥，"这次改过哪些文件、哪几个表、报了哪些错"有可能被
 * 写丢或写歪。项目自己的文档也承认这个失败模式（`功能实现/38-BoBo人格开关操作指南.md`：
 * "长会话每 10 步补一次保持提醒（防止长会话压缩丢失）"）。
 *
 * 本插件补上另一半：**从会话事件里机械提取**一段事实（有就是有，没有就是没有，不经模型），
 * 压缩一发生就把它贴回上下文。模型写的那份摘要是"叙述"，这份是"台账"，两者互补。
 *
 * ## 检测压缩：用 `replaceGeneration`，不依赖监听器注册顺序
 *
 * 会话表面（surface）的 `replaceGeneration` **只在位置替换提交时自增**——压缩摘要的替换、
 * 工具结果剪枝的替换都会 +1；而插件投影类改写（如图片卸载）只动 `contentGeneration`。
 * 所以"代次涨了"就等于"发生了压缩/剪枝"。
 *
 * 每步开始时读一次代次，`await next()` 之后再读一次：涨了就说明**本步内**压缩刚发生，
 * 立刻注入（模型本步就能看到）；同时与上次记录值比对，这样在两次步骤之间发生的压缩
 * （`agent/request-error` 的溢出恢复、用户手动 `/compact`）也不会漏掉。
 * 这样就不必care 自己相对 `compaction-basic` 是谁包谁。
 *
 * ## 预算：分层丢弃（借 context-mode 的做法）
 *
 * 事实块按优先级分四层，从 T4 往上丢到装进 `budgetChars`（默认 2000 字符）为止：
 * T1 工作目录 / 用户最后请求 / 写过的文件 —— 永远保
 * T2 未解决错误
 * T3 采集站点 / 数据库表 / 文献键 / 涉及文件
 * T4 工具调用统计
 * T1 自身超预算时只砍文件列表，绝不整段丢失。
 *
 * ## 契约
 *
 * - **只读**：只订阅 `tools/result`（emit，无 next）做台账，和在 `agent/pre-step` 里放行。
 *   不改任何工具的结果，不 deny 任何调用。
 * - **绝不阻塞**：任何异常都吞掉并降级为不注入。压缩不能因为本插件失败而失败。
 * - 状态按 `agent.id`（会话）隔离，用 Map 带容量上限；`agent/created` 且 source 为
 *   `startup` / `clear` 时清空该会话台账（新会话是新账）。
 * - 每会话注入次数上限 `maxInjections`，防止反复压缩时反复刷屏。
 *
 * 挂载：host 层一行（`cordis.patch.yml` 的 insert 列表），所有预设生效。
 * 排障：`node context-facts.mjs --selftest`；运行期留痕走 `console.warn`
 * （web profile 下 `ctx.logger` 只进内存环形缓冲，不落后端 stdout，别 grep 启动日志）。
 */

export const name = 'context-facts'

/** 可覆盖的默认配置。 */
export const DEFAULT_CONFIG = {
  /** 事实块的字符预算；超了就按层级丢。 */
  budgetChars: 2_000,
  /** 每次压缩后注入的块标题。 */
  title: '本次会话事实（运行时从会话事件机械提取，非模型摘要）',
  /** 结尾定调：与摘要冲突时以本段为准（因为是原始事实）。 */
  footnote: '以上为压缩前的既有事实；若与上面的压缩摘要冲突，以本段为准。',
  maxFiles: 12,
  maxErrors: 3,
  maxSites: 6,
  maxTables: 6,
  maxLiterature: 5,
  maxPdfs: 5,
  maxToolKinds: 8,
  /** 未解决错误单条截断长度。 */
  errorChars: 160,
  /** 用户请求截断长度。 */
  requestChars: 200,
  /** 同一会话最多注入几次（反复压缩时不刷屏）。 */
  maxInjections: 6,
  /** 台账保留的会话数上限。 */
  maxSessions: 200,
  /** 把文件路径写进块的字符上限（单条）。 */
  pathChars: 120,
}

/** 写入类工具：记下改过哪些文件。 */
const WRITE_TOOLS = new Set(['write', 'edit'])
/** 报错时额外记下的"问题工具"。 */
const ERROR_TOOLS = new Set(['write', 'edit', 'read', 'bash', 'pwsh', 'crawl_fetch'])

/** 从工具参数里取目标路径（不同工具字段名不同）。 */
export function pathOf(args) {
  for (const key of ['file_path', 'filePath', 'path', 'outFile', 'saveDir', 'save_dir', 'pdf_path']) {
    const value = args?.[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

/**
 * 域名 → 站点键（与采集模式的站点归类约定一致：去前导 www.，点换横线）。
 * @returns 站点键，取不到返回 ''。
 */
export function siteKeyOf(url) {
  if (typeof url !== 'string' || url.trim() === '') return ''
  try {
    const host = new URL(url.trim()).hostname.toLowerCase()
    return host.replace(/^www\./, '').replace(/\./g, '-')
  } catch {
    return ''
  }
}

/** 从 SQL 里粗略抠出涉及的表名（只用于台账，不求精确）。 */
export function tablesOf(sql) {
  if (typeof sql !== 'string' || sql === '') return []
  const found = new Set()
  const re = /\b(?:from|join|into|update)\s+[`"[]?([A-Za-z_][A-Za-z0-9_$]*)/gi
  let match
  while ((match = re.exec(sql)) !== null) found.add(match[1])
  return [...found]
}

/** 截断并标注省略量。 */
function clip(text, limit) {
  const value = String(text ?? '')
  if (limit <= 0) return value
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

/** 有界有序去重集合：超出上限丢最旧的。 */
function boundedAdd(list, value, limit) {
  if (value === '' ) return
  const at = list.indexOf(value)
  if (at >= 0) list.splice(at, 1)
  list.push(value)
  while (list.length > limit) list.shift()
}

/**
 * 创建台账核心（纯函数，可脱离 dsh 单测）。
 * @param config - 见 {@link DEFAULT_CONFIG}。
 * @returns `observe` / `noteRequest` / `noteGeneration` / `render` / `state`。
 */
export function createFactsCore(config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const sessions = new Map()

  const session = (id) => {
    let state = sessions.get(id)
    if (state === undefined) {
      if (sessions.size >= cfg.maxSessions) sessions.delete(sessions.keys().next().value)
      state = {
        cwd: '',
        startedAt: Date.now(),
        files: [],
        errors: [],
        sites: [],
        tables: [],
        literature: [],
        pdfs: [],
        tools: new Map(),
        request: '',
        lastGen: null,
        injections: 0,
        compactedAt: 0,
      }
      sessions.set(id, state)
    }
    return state
  }

  return {
    /** 会话建立/清空时丢弃台账。 */
    reset(sessionId) {
      sessions.delete(sessionId)
    },

    /** 记录用户最后一次原始请求（只在 `agent/pre-step` 里传，source.kind==='user'）。 */
    noteRequest(sessionId, text, cwd = '') {
      const state = session(sessionId)
      if (typeof text === 'string' && text.trim() !== '') state.request = text.trim()
      if (typeof cwd === 'string' && cwd !== '') state.cwd = cwd
    },

    /**
     * 记一笔工具调用的台账（只观测，不改结果）。
     * @param request - `{ sessionId, toolName, args, isError, errorText }`。
     */
    observe({ sessionId = '', toolName = '', args, isError = false, errorText = '' }) {
      if (toolName === '') return
      const state = session(sessionId)
      state.tools.set(toolName, (state.tools.get(toolName) ?? 0) + 1)

      if (isError && ERROR_TOOLS.has(toolName)) {
        const detail = typeof errorText === 'string' && errorText.trim() !== ''
          ? errorText.trim().replace(/\s+/g, ' ')
          : '(无错误正文)'
        boundedAdd(state.errors, `${toolName}: ${clip(detail, cfg.errorChars)}`, 8)
      }

      if (WRITE_TOOLS.has(toolName) && !isError) {
        boundedAdd(state.files, clip(pathOf(args), cfg.pathChars), 40)
      }
      if (toolName === 'crawl_fetch' && !isError) {
        boundedAdd(state.sites, siteKeyOf(args?.url), 20)
      }
      if (toolName.endsWith('dbx_query') && !isError) {
        for (const table of tablesOf(args?.sql)) boundedAdd(state.tables, table, 20)
      }
      if (toolName.startsWith('mcp__literature') && !isError) {
        const query = String(args?.query ?? args?.title ?? '').trim()
        if (query !== '') boundedAdd(state.literature, clip(query, 80), 20)
      }
      if (toolName.endsWith('pdf_extract') && !isError) {
        const file = pathOf(args)
        if (file !== '') boundedAdd(state.pdfs, clip(file.split(/[\\/]/).pop() ?? file, 80), 20)
      }
    },

    /**
     * 读表面代次并判断"自从上次以来是否发生了压缩/剪枝"，随后记录新值。
     * @returns true 表示有替换提交过。
     */
    noteGeneration(sessionId, generation) {
      const state = session(sessionId)
      const value = typeof generation === 'number' && Number.isFinite(generation) ? generation : null
      if (value === null) return false
      const changed = state.lastGen !== null && value > state.lastGen
      state.lastGen = value
      return changed
    },

    /** 还有没有注入额度。 */
    canInject(sessionId) {
      return session(sessionId).injections < cfg.maxInjections
    },

    /**
     * 渲染事实块（分层丢弃到装进预算）。
     * @returns 文本，或 null 表示没有可注入的事实。
     */
    render(sessionId) {
      const state = session(sessionId)
      const hasAny = state.files.length > 0 || state.errors.length > 0 || state.sites.length > 0
        || state.tables.length > 0 || state.literature.length > 0 || state.pdfs.length > 0
        || state.request !== '' || state.tools.size > 0
      if (!hasAny) return null

      // ── T1：永远保（工作目录 / 用户最后请求 / 写过的文件）──────────────
      const t1 = []
      if (state.cwd !== '') t1.push(`- 工作目录：${state.cwd}`)
      if (state.request !== '') t1.push(`- 用户最后请求：「${clip(state.request, cfg.requestChars)}」`)
      const files = state.files.slice(-cfg.maxFiles)
      if (files.length > 0) {
        const more = state.files.length - files.length
        t1.push(`- 本会话写过 ${state.files.length} 个文件`
          + `${more > 0 ? `（含更早 ${more} 个）` : ''}：\n  ${files.join('\n  ')}`)
      }

      // ── T2：未解决错误 ────────────────────────────────────────────────
      const t2 = []
      if (state.errors.length > 0) {
        const shown = state.errors.slice(-cfg.maxErrors)
        t2.push(`- 最近失败 ${state.errors.length} 次：\n  ${shown.join('\n  ')}`)
      }

      // ── T3：数据面（站点 / 表 / 文献 / PDF）────────────────────────────
      const t3 = []
      if (state.sites.length > 0) {
        t3.push(`- 采集过的站点键（数据在 \`<工作区>/<站点键>/data/\`）：`
          + state.sites.slice(-cfg.maxSites).join('、'))
      }
      if (state.tables.length > 0) {
        t3.push(`- 涉及过的数据库表：${state.tables.slice(-cfg.maxTables).join('、')}`)
      }
      if (state.pdfs.length > 0) {
        t3.push(`- 读过的 PDF：${state.pdfs.slice(-cfg.maxPdfs).join('、')}`)
      }
      if (state.literature.length > 0) {
        t3.push(`- 检索过的文献主题：${state.literature.slice(-cfg.maxLiterature).join('、')}`)
      }

      // ── T4：工具调用统计 ──────────────────────────────────────────────
      const t4 = []
      if (state.tools.size > 0) {
        const top = [...state.tools.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, cfg.maxToolKinds)
          .map(([tool, count]) => `${tool}×${count}`)
        t4.push(`- 工具调用：${top.join('，')}`)
      }

      const head = `=== ${cfg.title} ===`
      const tail = `=== ${cfg.footnote} ===`
      const budget = Math.max(0, cfg.budgetChars)

      // 永远先放 T1；T1 自己超预算就砍文件列表（其余照旧）。
      let parts = [...t1]
      const assemble = () => [head, ...parts, tail].join('\n')
      if (assemble().length > budget) {
        const withoutFiles = t1.filter(line => !line.startsWith('- 本会话写过'))
        const note = files.length > 0 ? [`- 本会话写过 ${state.files.length} 个文件（列表过长已省略）`] : []
        parts = [...withoutFiles, ...note]
      }
      // 从 T4 往上加，加不下就停——但 T1 已经在了，绝不会整段丢失。
      for (const tier of [t2, t3, t4]) {
        const candidate = [...parts, ...tier]
        const saved = parts
        parts = candidate
        if (assemble().length > budget) parts = saved
      }
      return assemble()
    },

    /** 注入计数 +1 并返回剩余额度。 */
    countInjection(sessionId) {
      const state = session(sessionId)
      state.injections += 1
      state.compactedAt = Date.now()
      return cfg.maxInjections - state.injections
    },

    /** 排障用。 */
    state: (sessionId = '') => session(sessionId),
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/**
 * 构造一条插件来源的 user 消息（source.kind 用 session format v4 的
 * producer-owned 形态 `plugin:<插件名>`）。
 *
 * 冻结是必须的：dsh 内建注入的消息都是只读的，会话表面与投影层会直接持有并比较它们，
 * 交出一条可变的普通对象后患无穷。与 `report-memory-gate.mjs` / `at-workspace.mjs` 一致。
 */
export function injectedMessage(text, sessionId) {
  return deepFreeze({
    id: `context-facts-${sessionId}-${Date.now()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: `plugin:${name}` },
  })
}

/** 取一条消息里的纯文本。 */
function textOf(message) {
  const blocks = message?.content
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}

/** 从工具结果里取一句错误正文。 */
function errorTextOf(result) {
  const content = result?.content
  if (Array.isArray(content)) {
    const text = content
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n')
      .trim()
    if (text !== '') return text
  }
  const error = result?.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message
  return ''
}

/**
 * 装载：台账 + 压缩后注入。
 * @param ctx - 插件上下文（host 层插入时为 host 作用域）。
 * @param config - 见 {@link DEFAULT_CONFIG}。
 */
export function apply(ctx, config) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) }
  const core = createFactsCore(cfg)

  // 注意：web profile 下 ctx.logger 只写内存环形缓冲、不落后端 stdout，
  // 所以排障信息走 console.warn（桌面壳会把它收进 bobo-backend.log）。
  const warn = (message) => {
    try {
      console.warn(`[context-facts] ${message}`)
    } catch {
      /* 日志不可用不能影响注入 */
    }
  }

  const sessionIdOf = (agent) => String(agent?.id ?? agent?.session?.id ?? '')
  const cwdOf = (agent) => String(agent?.session?.header?.cwd ?? '')
  const generationOf = (agent) => {
    try {
      const value = agent?.session?.surface?.replaceGeneration
      return typeof value === 'number' ? value : null
    } catch {
      return null
    }
  }

  const onCreated = async (payload) => {
    try {
      const source = payload?.source
      if (source === 'startup' || source === 'clear') {
        const id = sessionIdOf(payload?.agent)
        if (id !== '') core.reset(id)
      }
    } catch {
      /* 清账失败不影响会话 */
    }
  }

  const onToolResult = (exec, result) => {
    try {
      // 嵌套调用（PTC 里的子调用）不计账：外层那次已经代表它了。
      if (exec?.parent !== undefined) return
      const agent = exec?.agent
      if (agent === undefined || agent === null) return
      const sessionId = sessionIdOf(agent)
      if (sessionId === '') return
      const isError = result?.isError === true
      core.observe({
        sessionId,
        toolName: String(exec.name ?? ''),
        args: exec.arguments,
        isError,
        errorText: isError ? errorTextOf(result) : '',
      })
      const cwd = cwdOf(agent)
      if (cwd !== '') {
        const state = core.state(sessionId)
        if (state.cwd === '') state.cwd = cwd
      }
    } catch {
      /* 台账失败绝不影响工具结果 */
    }
  }

  const onPreStep = async (payload, next) => {
    const decision = await next()
    try {
      if (decision.kind === 'reject') return decision
      if (payload?.signal?.aborted === true) return decision
      const agent = payload?.agent
      if (agent === undefined || agent === null) return decision
      const sessionId = sessionIdOf(agent)
      if (sessionId === '') return decision

      // 1) 记下用户最后一次原始请求（注入的消息 source.kind 为 `plugin:<插件名>`，天然被排除）
      const cwd = cwdOf(agent)
      if (cwd !== '') {
        const state = core.state(sessionId)
        if (state.cwd === '') state.cwd = cwd
      }
      for (const message of payload?.messages ?? []) {
        if (message?.source?.kind !== 'user') continue
        const text = textOf(message)
        if (text !== '') core.noteRequest(sessionId, text, cwd)
      }

      // 2) 判断这一步里（或上一步以来）有没有压缩/剪枝提交过
      const generation = generationOf(agent)
      const compacted = core.noteGeneration(sessionId, generation)
      if (!compacted) return decision
      if (!core.canInject(sessionId)) return decision
      if (core.state(sessionId).injections === 0) {
        warn('检测到压缩/剪枝，注入确定性事实块（后续同会话最多再注入 '
          + (cfg.maxInjections - 1) + ' 次）')
      }
      const text = core.render(sessionId)
      if (text === null) return decision
      const left = core.countInjection(sessionId)
      warn(`已注入事实块（${text.length} 字符，剩余额度 ${left}）`)
      // 必须展开 decision：`startsRequestSeries` 是上游声明的请求序列边界，
      // 丢掉它会把模型消息序列切错（docs/architecture.md:113 的成文约定）。
      return { ...decision, messages: [...decision.messages, injectedMessage(text, sessionId)] }
    } catch {
      /* 注入失败就当没这回事——压缩本身已经成功了 */
      return decision
    }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.on('agent/created', onCreated),
      ctx.on('tools/result', onToolResult),
      ctx.on('agent/pre-step', onPreStep, { prepend: true }),
      ctx.root.on('agent/created', onCreated),
      ctx.root.on('tools/result', onToolResult),
      ctx.root.on('agent/pre-step', onPreStep, { prepend: true }),
    ]
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* fiber 卸载时的重复释放可忽略 */
        }
      }
    }
  })

  warn('已挂载：压缩/剪枝提交后注入「确定性事实块」，按 T1-T4 分层丢弃装进 '
    + cfg.budgetChars + ' 字符预算')
}

/**
 * 自检：把台账、代次判定、分层预算与 T1 保底真跑一遍
 * （`node context-facts.mjs --selftest`）。
 */
function selftest() {
  const failures = []
  let cases = 0
  const check = (label, condition, actual) => {
    cases += 1
    if (condition !== true) failures.push(`✗ ${label}：${actual}`)
  }

  // ── 站点键与表名提取 ──────────────────────────────────────────────────
  check('站点键去 www 并换横线', siteKeyOf('https://www.news.qq.com/a/b') === 'news-qq-com',
    siteKeyOf('https://www.news.qq.com/a/b'))
  check('站点键：无 www 的域名', siteKeyOf('http://iaea.org/x') === 'iaea-org', siteKeyOf('http://iaea.org/x'))
  check('站点键：非 URL 返回空', siteKeyOf('不是网址') === '', siteKeyOf('不是网址'))
  check('表名：FROM/JOIN 都能抠出来',
    JSON.stringify(tablesOf('SELECT * FROM book JOIN author ON 1=1')) === JSON.stringify(['book', 'author']),
    JSON.stringify(tablesOf('SELECT * FROM book JOIN author ON 1=1')))

  // ── 台账 ──────────────────────────────────────────────────────────────
  const core = createFactsCore({ budgetChars: 2_000 })
  const sid = 's1'
  core.noteRequest(sid, '把 book 表按站点去重入库', 'C:/work/ws')
  core.observe({ sessionId: sid, toolName: 'write', args: { file_path: 'C:/work/ws/clean.py' } })
  core.observe({ sessionId: sid, toolName: 'write', args: { file_path: 'C:/work/ws/load.py' } })
  core.observe({ sessionId: sid, toolName: 'crawl_fetch', args: { url: 'https://news.qq.com/1' } })
  core.observe({ sessionId: sid, toolName: 'mcp__dbx__dbx_query', args: { sql: 'SELECT * FROM book' } })
  core.observe({ sessionId: sid, toolName: 'mcp__dbx__dbx_query', args: { sql: 'SELECT * FROM book' } })
  core.observe({ sessionId: sid, toolName: 'crawl_fetch', args: { url: 'https://news.qq.com/2' },
    isError: true, errorText: '超时：浏览器无响应' })

  const first = core.render(sid)
  check('事实块含标题', typeof first === 'string' && first.includes('本次会话事实'), first)
  check('事实块含工作目录', typeof first === 'string' && first.includes('C:/work/ws'), first)
  check('事实块含用户最后请求', typeof first === 'string' && first.includes('去重入库'), first)
  check('事实块含两个写过文件',
    typeof first === 'string' && first.includes('clean.py') && first.includes('load.py'), first)
  check('事实块含站点键', typeof first === 'string' && first.includes('news-qq-com'), first)
  check('事实块含表名', typeof first === 'string' && first.includes('book'), first)
  check('事实块含失败记录', typeof first === 'string' && first.includes('最近失败'), first)
  check('事实块含工具调用统计',
    typeof first === 'string' && first.includes('crawl_fetch×2'), first)

  // 失败的写入不进"写过文件"（只记错误）
  const core2 = createFactsCore()
  core2.observe({ sessionId: 's2', toolName: 'write', args: { file_path: 'X/a.py' }, isError: true,
    errorText: '权限不足' })
  const second = core2.render('s2')
  check('失败的 write 不进"写过文件"',
    typeof second === 'string' && !second.includes('本会话写过'), second)
  check('失败的 write 进失败记录', typeof second === 'string' && second.includes('权限不足'), second)
  check('空台账返回 null', core2.render('从未出现过的会话') === null, core2.render('从未出现过的会话'))

  // ── 分层预算：T1 保底，T4 先丢 ────────────────────────────────────────
  // 造一个"T1 很小、T3/T4 很大"的台账，用两个预算把层级差异证出来：
  // T1 约 125 字符，加上 T3 约 276，再加 T4 约 367（含标题与页脚 72 字符）。
  // 所以 180 只够放 T1，20000 全放得下——两侧都留足余量，不靠卡边界过测。
  const buildBudgetCase = (budget) => {
    const core = createFactsCore({ budgetChars: budget })
    const sid = 's3'
    core.noteRequest(sid, 'q', 'C:/w')
    core.observe({ sessionId: sid, toolName: 'write', args: { file_path: 'C:/w/a.py' } })
    for (const host of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']) {
      core.observe({ sessionId: sid, toolName: 'crawl_fetch', args: { url: `https://${host}-example.com/1` } })
    }
    for (const tool of ['read', 'bash', 'edit', 'grep', 'glob', 'todo']) {
      core.observe({ sessionId: sid, toolName: tool, args: {} })
    }
    return core.render(sid)
  }
  const tight = buildBudgetCase(180)
  const roomy = buildBudgetCase(20_000)
  check('紧预算下仍在预算内', typeof tight === 'string' && tight.length <= 180, `${tight?.length} 字符`)
  check('紧预算保 T1 工作目录', typeof tight === 'string' && tight.includes('C:/w'), tight)
  check('紧预算保 T1 用户请求', typeof tight === 'string' && tight.includes('「q」'), tight)
  check('紧预算丢弃 T3（站点）',
    typeof tight === 'string' && !tight.includes('采集过的站点'), tight)
  check('紧预算丢弃 T4（工具统计）',
    typeof tight === 'string' && !tight.includes('工具调用'), tight)
  check('宽预算同时含 T3 与 T4',
    typeof roomy === 'string' && roomy.includes('采集过的站点') && roomy.includes('工具调用'), roomy)
  check('宽预算严格长于紧预算', roomy.length > tight.length, `${roomy?.length} vs ${tight?.length}`)

  // 极端预算：T1 自己也超，只砍文件列表（绝不整段丢失）
  const core4 = createFactsCore({ budgetChars: 90 })
  core4.noteRequest('s4', 'x'.repeat(300), 'C:/w')
  core4.observe({ sessionId: 's4', toolName: 'write', args: { file_path: 'C:/w/very-long-name.py' } })
  const tiny = core4.render('s4')
  check('极端预算下仍给出请求与目录（只砍文件列表）',
    typeof tiny === 'string' && tiny.includes('C:/w') && tiny.includes('用户最后请求'), tiny)
  check('极端预算下超长的文件列表被省略',
    typeof tiny === 'string' && !tiny.includes('very-long-name'), tiny)

  // ── 代次判定 ──────────────────────────────────────────────────────────
  const core5 = createFactsCore()
  const gen1 = core5.noteGeneration('s5', 3)
  const gen2 = core5.noteGeneration('s5', 3)
  const gen3 = core5.noteGeneration('s5', 4)
  const gen4 = core5.noteGeneration('s5', 1)
  check('首次读代次不算变化', gen1 === false, gen1)
  check('代次未涨不算变化', gen2 === false, gen2)
  check('代次上涨算压缩', gen3 === true, gen3)
  check('代次回退不算压缩', gen4 === false, gen4)
  check('代次为 null 时不动台账（表面不可读也不误判）',
    core5.noteGeneration('s5', null) === false, '被判成压缩')

  // ── 注入额度 ──────────────────────────────────────────────────────────
  const core6 = createFactsCore({ maxInjections: 2 })
  check('初始有额度', core6.canInject('s6') === true, '无额度')
  core6.countInjection('s6')
  check('用掉一次仍有额度', core6.canInject('s6') === true, '无额度')
  core6.countInjection('s6')
  check('额度用尽后不再注入', core6.canInject('s6') === false, '仍可注入')

  // ── 会话隔离与清账 ────────────────────────────────────────────────────
  const core7 = createFactsCore()
  core7.observe({ sessionId: 'a', toolName: 'write', args: { file_path: 'A/1.py' } })
  check('会话隔离：b 看不到 a 的文件', core7.render('b') === null, core7.render('b'))
  core7.reset('a')
  check('reset 后台账清空', core7.render('a') === null, core7.render('a'))

  // 注入消息 source 形态（session format v4 producer-owned kind）
  const sample = injectedMessage('自检', 'sample')
  check('注入消息 source.kind 为非空字符串且 ≠ plugin',
    typeof sample.source.kind === 'string' && sample.source.kind !== '' && sample.source.kind !== 'plugin',
    JSON.stringify(sample.source))
  check('注入消息 source.kind 为 plugin:context-facts', sample.source.kind === 'plugin:context-facts',
    sample.source.kind)

  if (failures.length > 0) {
    console.error(`context-facts selftest 失败：${failures.length}/${cases} 项`)
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
    return
  }
  console.log(`context-facts selftest 通过：${cases} 项判据全部符合预期`)
}

if (process.argv[1] && process.argv[1].endsWith('context-facts.mjs')
  && process.argv.includes('--selftest')) {
  selftest()
}
