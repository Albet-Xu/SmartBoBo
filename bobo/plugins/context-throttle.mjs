/**
 * context-throttle —— 重型检索工具的调用限流（软提醒 + 硬熔断）。
 *
 * ## 为什么需要它
 *
 * 项目文档里已经反复出现同一个病灶：**检索会刷屏吃 token**。
 * `研究模式调研/02-…:923` 的 R4（上下文预算失控）、`03-…:425` 的"上下文预算纪律"都要求
 * 检索返回摘要化、`top_k` 默认 3、只在"检索能改变决策"的位置挂检索——但这全是**提示词纪律**，
 * 模型忙起来就一遍遍搜。本插件把它变成**运行时机制**。
 *
 * 借的是 context-mode 的"渐进限流"做法：同一会话里对同一类检索工具的调用次数分两档——
 *
 * - **软档**：到达 `soft` 时，在这一次的工具结果后面挂一条提醒（该规则每会话只提醒一次），
 *   告诉模型"你已经搜了 N 次了，先用手上的结果，或者换更省的做法"。
 * - **硬档**：超过 `hard` 时直接拒绝这次调用，理由里写清**替代做法**。
 *
 * ## 两条自缚的安全绳（这是给发布版产品用的，不能把活卡死）
 *
 * 1. **硬档默认只开在"便宜就能重来"的检索上**（会话检索、经验库检索）。采集、PDF 分页、
 *    文献检索、SQL 探索这些**合法地就是多轮**的工具默认 `hard: null`——只提醒，不拒绝。
 * 2. **逃生阀**：同一 (会话, 规则) 连续被拒到 `maxDenials` 次即放行并告警。
 *    最坏情况下模型只浪费三次工具调用，不可能真的干不了活。
 *
 * 另有一键总闸：`denyEnabled: false` 关掉全部硬档（只留软提醒）；`enabled: false` 整个插件不动手。
 *
 * ## 契约
 *
 * - 规则**首次匹配即生效**（从上到下），所以把更具体的规则写在前面（如 `session_event_read`
 *   要写在 `session_*` 之前，否则永远轮不到它）。
 * - 嵌套调用（PTC 里的子调用 `exec.parent !== undefined`）不计次、不拦。
 * - `next()` 返回非 `allow` 时一律放行——别的闸门（经验库闸门等）已经拒了，本插件不叠加第二刀。
 * - 任何异常都降级为放行。限流绝不能让一次正常调用变成失败。
 *
 * 挂载：host 层一行，所有预设生效。
 * 排障：`node context-throttle.mjs --selftest`；运行期留痕走 `console.warn`
 * （web profile 下 `ctx.logger` 不落后端 stdout）。
 */

export const name = 'context-throttle'

/**
 * 默认规则。`pattern` 是对**模型侧工具名**的通配（`*` 任意串，`?` 单字符）。
 *
 * `soft` 到达即软提醒（每会话每规则一次）；`hard` 超过即拒绝，`null` 表示只提醒不拒绝。
 * 数值是"同一会话内累计调用次数"，不是速率。
 */
export const DEFAULT_RULES = [
  {
    id: 'session-event-read',
    pattern: 'session_event_read',
    soft: 2,
    hard: 6,
    hint: '改用 `session_event_search` 先用关键词定位到 seq，再用小窗口 `before`/`after` 读；'
      + '一次开 50+50 个邻居等于把整段历史倒进上下文。',
  },
  {
    // session_recall 必须排在下面 session_* 通配之前（规则首次匹配即生效），
    // 否则它会被并进 session-search 的预算。它是本地检索、输出有 6000 字符硬帽，
    // 单次比 session_search 便宜，但每次调用都带一次增量索引同步——硬档收到 15（软档同 5）。
    id: 'session-recall',
    pattern: 'session_recall',
    soft: 5,
    hard: 15,
    hint: '中文历史检索用普通子串就行（无需语法），把要找的词句一次给全、别换着词连环搜；'
      + '首次调用会增量建索引（每次有时间预算，超出部分下次继续），空结果稍等一拍再查，'
      + '比立刻重试更省。',
  },
  {
    id: 'session-search',
    pattern: 'session_*',
    soft: 5,
    hard: 20,
    hint: '先把要查的东西合并成一次更精确的查询（站点键 / 表名 / 报错原文这类 ASCII 串最好使），'
      + '别一个词搜一次。',
  },
  {
    id: 'experience-search',
    pattern: '*_experience_search',
    soft: 4,
    hard: 15,
    hint: '经验库只在"检索能改变决策"的位置查。已经拿到的经验先落地验证，'
      + '不要反复换关键词重搜；要明细用 `*_experience_get` 取那一条。',
  },
  {
    id: 'dbx-query',
    pattern: 'mcp__*__dbx_query',
    soft: 8,
    hard: null,
    hint: '把要看的几件事合成一条 SQL（或带上 WHERE/LIMIT 再跑），别一行一行试；'
      + '结果超过上限时会落盘，直接 `grep`/`read` 那个路径比再查一次便宜。',
  },
  {
    id: 'literature-search',
    pattern: 'mcp__*__literature_*',
    soft: 6,
    hard: null,
    hint: '先用 `detail="digest"` 拿到候选（不含摘要），只对**真的要引**的那几篇用 `literature_get` 取摘要。',
  },
  {
    id: 'pdf-extract',
    pattern: 'mcp__*__pdf_extract',
    soft: 25,
    hard: null,
    hint: 'PDF 是按 20 页/次分页读的，本身合法；但若你只是想知道"这篇讲了什么"，'
      + '用 `detail="digest"` + `save=True` 或先看 `pdf_extract_info` 的页数/目录，别整本灌进来。',
  },
  {
    id: 'crawl-fetch',
    pattern: 'crawl_fetch',
    soft: 40,
    hard: null,
    hint: '采集本身要按页面来，合法；但如果同一站点同一批列表页，考虑改用骨架（`outputFormat: skeleton`）'
      + '先定位结构，再只采要的那几页。',
  },
]

/** 可覆盖的默认配置。 */
export const DEFAULT_CONFIG = {
  /** 总闸：false 时连软提醒都不发。 */
  enabled: true,
  /** 硬档总闸：false 时所有规则只提醒不拒绝。 */
  denyEnabled: true,
  /** 同一 (会话, 规则) 连续被拒到该次数即放行（逃生阀）。 */
  maxDenials: 3,
  /** 台账保留的会话数上限。 */
  maxSessions: 200,
  /** 拒绝理由的前后缀，便于模型认出是本插件所为。 */
  label: '上下文预算',
  rules: DEFAULT_RULES,
}

/** 通配符转正则：`*` → `.*`，`?` → `.`，其余转义。 */
export function globToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
}

/** 命中第一条匹配的规则（规则顺序即优先级）。 */
export function matchRule(toolName, rules) {
  for (const rule of rules) {
    if (!rule || typeof rule.pattern !== 'string') continue
    try {
      if (globToRegExp(rule.pattern).test(toolName)) return rule
    } catch {
      /* 非法模式跳过，绝不影响其它规则 */
    }
  }
  return null
}

/**
 * 创建限流核心（纯函数，可脱离 dsh 单测）。
 * @param config - 见 {@link DEFAULT_CONFIG}。
 * @param log - `{ warn(message) }`，可选。
 * @returns `decide` / `takeWarning` / `state`。
 */
export function createThrottleCore(config = {}, log = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const rules = Array.isArray(cfg.rules) && cfg.rules.length > 0 ? cfg.rules : DEFAULT_RULES
  const warn = typeof log.warn === 'function' ? log.warn : () => {}
  const sessions = new Map()

  const session = (id) => {
    let state = sessions.get(id)
    if (state === undefined) {
      if (sessions.size >= cfg.maxSessions) sessions.delete(sessions.keys().next().value)
      state = { counts: new Map(), denials: new Map(), pending: new Set() }
      sessions.set(id, state)
    }
    return state
  }

  /** 把 soft/hard 归一成安全的整数（或 null）：至少 2，且 hard 不能低于 soft。 */
  const threshold = (value, floor = 2) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return Math.max(floor, Math.floor(value))
  }

  return {
    /**
     * 这次调用要不要放行。
     * @param request - `{ sessionId, toolName }`。
     * @returns `{ kind: 'allow' }` 或 `{ kind: 'deny', reason }`。
     */
    decide({ sessionId = '', toolName = '' }) {
      if (cfg.enabled === false) return { kind: 'allow' }
      const rule = matchRule(toolName, rules)
      if (rule === null) return { kind: 'allow' }
      const state = session(sessionId)
      const attempted = (state.counts.get(rule.id) ?? 0) + 1
      const soft = threshold(rule.soft)
      const hard = cfg.denyEnabled === false ? null : threshold(rule.hard)

      if (hard !== null && attempted > hard) {
        const denied = state.denials.get(rule.id) ?? 0
        if (denied >= cfg.maxDenials) {
          warn(`规则 ${rule.id} 已连续被拒 ${denied} 次，放行以免阻塞（该处限流阈值可能定得太紧，建议复核）`)
        } else {
          state.denials.set(rule.id, denied + 1)
          return {
            kind: 'deny',
            reason: `【${cfg.label}·限流】本次会话已经调用 ${toolName} ${attempted - 1} 次`
              + `（上限 ${hard} 次）。${rule.hint}`
              + `若这次确实必要：换更省的等价做法；或请用户在 cordis.patch.yml 里调 context-throttle 的 `
              + `rules（id=${rule.id}）阈值——连续被拒到 ${cfg.maxDenials} 次后本插件会自动放行。`,
          }
        }
      }

      if (hard !== null && attempted === hard) {
        // 到硬档前的最后一次，先提醒一次，给模型一个自己收手的机会
        state.pending.add(rule.id)
      } else if (soft !== null && attempted >= soft && !state.counts.has(`warned:${rule.id}`)) {
        state.counts.set(`warned:${rule.id}`, 1)
        state.pending.add(rule.id)
      }

      state.counts.set(rule.id, attempted)
      // 这次放行了，清掉"连续被拒"计数（逃生阀只针对连续拒绝）
      state.denials.delete(rule.id)
      return { kind: 'allow' }
    },

    /**
     * 取一条待发的软提醒（取出即消费，同一规则每会话只发一次）。
     * @returns 文本或 null。
     */
    takeWarning({ sessionId = '', toolName = '' }) {
      if (cfg.enabled === false) return null
      const rule = matchRule(toolName, rules)
      if (rule === null) return null
      const state = session(sessionId)
      if (!state.pending.has(rule.id)) return null
      state.pending.delete(rule.id)
      const count = state.counts.get(rule.id) ?? 0
      return `【${cfg.label}·提醒】本次会话已调用 ${toolName} ${count} 次。${rule.hint}`
        + '（只提醒这一次，不再打扰。）'
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

/** 构造一条插件来源的 user 消息（source.kind 用 session format v4 的 producer-owned 形态 `plugin:<插件名>`，必须冻结）。 */
export function injectedMessage(text) {
  return deepFreeze({
    id: `context-throttle-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: `plugin:${name}` },
  })
}

/**
 * 装载：工具调用前判定，工具调用后挂软提醒。
 * @param ctx - 插件上下文（host 层插入时为 host 作用域）。
 * @param config - 见 {@link DEFAULT_CONFIG}。
 */
export function apply(ctx, config) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) }
  const core = createThrottleCore(cfg, {
    warn: (message) => {
      try {
        console.warn(`[context-throttle] ${message}`)
      } catch {
        /* 日志不可用不能影响限流 */
      }
    },
  })

  const sessionIdOf = (agent) => String(agent?.id ?? agent?.session?.id ?? '')

  const onPreExecute = async (exec, next) => {
    const downstream = await next()
    try {
      // 别的闸门已经拒了/要问用户 —— 不叠加第二刀
      if (downstream.kind !== 'allow') return downstream
      // 嵌套调用（PTC 里的子调用）不计次不拦
      if (exec?.parent !== undefined) return downstream
      if (exec?.signal?.aborted === true) return downstream
      const sessionId = sessionIdOf(exec?.agent)
      if (sessionId === '') return downstream
      const verdict = core.decide({ sessionId, toolName: String(exec.name ?? '') })
      return verdict.kind === 'deny' ? { kind: 'deny', reason: verdict.reason } : downstream
    } catch {
      /* 限流失败就当没这回事——绝不能把正常调用变成失败 */
      return downstream
    }
  }

  const onPostExecute = async (exec, _result, next) => {
    const decision = await next()
    try {
      if (decision.kind !== 'accept') return decision
      if (exec?.parent !== undefined) return decision
      const sessionId = sessionIdOf(exec?.agent)
      if (sessionId === '') return decision
      const text = core.takeWarning({ sessionId, toolName: String(exec.name ?? '') })
      if (text === null) return decision
      return {
        ...decision,
        additionalContexts: [...(decision.additionalContexts ?? []), injectedMessage(text)],
      }
    } catch {
      /* 提醒失败不影响结果 */
      return decision
    }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.on('tools/pre-execute', onPreExecute),
      ctx.on('tools/post-execute', onPostExecute),
      ctx.root.on('tools/pre-execute', onPreExecute),
      ctx.root.on('tools/post-execute', onPostExecute),
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

  const armed = cfg.enabled !== false
  // 用**生效**的规则集统计，而不是 DEFAULT_RULES——配置覆盖后报错数会骗人
  const effectiveRules = Array.isArray(cfg.rules) && cfg.rules.length > 0 ? cfg.rules : DEFAULT_RULES
  const hardCount = armed && cfg.denyEnabled !== false
    ? effectiveRules.filter(rule => typeof rule.hard === 'number').length
    : 0
  try {
    console.warn(`[context-throttle] 已挂载：软提醒${armed ? '' : '（总闸关闭）'}；`
      + `硬档 ${hardCount}/${effectiveRules.length} 条规则（逃生阀 ${cfg.maxDenials} 次）`)
  } catch {
    /* 日志不可用不影响挂载 */
  }
}

/**
 * 自检（`node context-throttle.mjs --selftest`）。
 */
function selftest() {
  const failures = []
  let cases = 0
  const check = (label, condition, actual) => {
    cases += 1
    if (condition !== true) failures.push(`✗ ${label}：${actual}`)
  }
  const silent = { warn: () => {} }

  // ── 通配匹配 ──────────────────────────────────────────────────────────
  check('glob 精确名', globToRegExp('session_search').test('session_search') === true, '不匹配')
  check('glob 不匹配近似名', globToRegExp('session_search').test('session_search_x') === false, '误匹配')
  check('glob 星号跨下划线',
    globToRegExp('mcp__*__dbx_query').test('mcp__dbx-empirical__dbx_query') === true, '不匹配')
  check('glob 星号不跨空串要求',
    globToRegExp('session_*').test('session_event_read') === true, '不匹配')
  check('glob 问号单字符', globToRegExp('a?c').test('abc') === true, '不匹配')
  check('glob 正则元字符被转义', globToRegExp('a.b').test('axb') === false, '误匹配（. 未转义）')

  // ── 顺序：具体规则优先 ────────────────────────────────────────────────
  check('session_event_read 命中它自己的规则（不是 session_*）',
    matchRule('session_event_read', DEFAULT_RULES)?.id === 'session-event-read',
    matchRule('session_event_read', DEFAULT_RULES)?.id)
  check('session_search 落到通配规则',
    matchRule('session_search', DEFAULT_RULES)?.id === 'session-search',
    matchRule('session_search', DEFAULT_RULES)?.id)
  check('经验库检索跨 serverName 命中',
    matchRule('mcp__paper-memory-review__paper_experience_search', DEFAULT_RULES)?.id === 'experience-search',
    matchRule('mcp__paper-memory-review__paper_experience_search', DEFAULT_RULES)?.id)
  check('无关工具不受影响', matchRule('read', DEFAULT_RULES) === null, '被误命中')

  // ── 硬档与逃生阀 ──────────────────────────────────────────────────────
  const rule = { id: 'r', pattern: 'heavy_tool', soft: 2, hard: 3, hint: '换省法。' }
  const core = createThrottleCore({ rules: [rule], maxDenials: 2 }, silent)
  const call = (c, sid = 's1') => c.decide({ sessionId: sid, toolName: 'heavy_tool' })
  check('第 1 次放行', call(core).kind === 'allow', '被拦')
  check('第 2 次放行（到软档）', call(core).kind === 'allow', '被拦')
  check('第 3 次放行（到硬档，先提醒）', call(core).kind === 'allow', '被拦')
  check('第 4 次拒绝', call(core).kind === 'deny', '未拦')
  const firstDeny = call(core)
  check('第 5 次拒绝（连续第 2 次）', firstDeny.kind === 'deny', firstDeny.kind)
  check('拒绝理由含替代做法', typeof firstDeny.reason === 'string' && firstDeny.reason.includes('换省法。'),
    firstDeny.reason)
  check('拒绝理由点明是本插件', typeof firstDeny.reason === 'string' && firstDeny.reason.includes('上下文预算'),
    firstDeny.reason)
  check('连续被拒到 maxDenials(2) 次后放行（逃生阀）',
    call(core).kind === 'allow', '未放行')

  // 逃生阀是"连续"而非"累计"：放行会清掉连续计数，随后重新开始计数
  const coreEscape = createThrottleCore({ rules: [rule], maxDenials: 1 }, silent)
  for (let i = 0; i < 4; i += 1) coreEscape.decide({ sessionId: 'x', toolName: 'heavy_tool' })
  const escape = coreEscape.decide({ sessionId: 'x', toolName: 'heavy_tool' })
  const again = coreEscape.decide({ sessionId: 'x', toolName: 'heavy_tool' })
  check('逃生阀紧跟连续被拒之后放行', escape.kind === 'allow', escape.kind)
  check('放行后重新计数，下一次再被拒', again.kind === 'deny', again.kind)

  // ── 软提醒：每规则每会话只发一次 ──────────────────────────────────────
  const coreWarn = createThrottleCore({ rules: [rule] }, silent)
  coreWarn.decide({ sessionId: 'w', toolName: 'heavy_tool' })
  check('未到软档不发提醒', coreWarn.takeWarning({ sessionId: 'w', toolName: 'heavy_tool' }) === null, '发了')
  coreWarn.decide({ sessionId: 'w', toolName: 'heavy_tool' })
  const warn1 = coreWarn.takeWarning({ sessionId: 'w', toolName: 'heavy_tool' })
  check('到软档发提醒', typeof warn1 === 'string' && warn1.includes('换省法。'), warn1)
  check('提醒只发一次', coreWarn.takeWarning({ sessionId: 'w', toolName: 'heavy_tool' }) === null, '重复发')

  // ── 会话隔离 ──────────────────────────────────────────────────────────
  const coreIso = createThrottleCore({ rules: [rule] }, silent)
  for (let i = 0; i < 5; i += 1) coreIso.decide({ sessionId: 'a', toolName: 'heavy_tool' })
  check('计数按会话隔离（b 还没用过）',
    coreIso.decide({ sessionId: 'b', toolName: 'heavy_tool' }).kind === 'allow', '被 b 受到牵连')

  // ── 两档总闸 ──────────────────────────────────────────────────────────
  const coreOff = createThrottleCore({ rules: [rule], enabled: false }, silent)
  let offAllowed = true
  for (let i = 0; i < 10; i += 1) if (call(coreOff).kind !== 'allow') offAllowed = false
  check('enabled:false 时永不拒绝', offAllowed === true, '仍在拦')
  check('enabled:false 时也不提醒',
    coreOff.takeWarning({ sessionId: 's1', toolName: 'heavy_tool' }) === null, '仍在提醒')

  const coreNoHard = createThrottleCore({ rules: [rule], denyEnabled: false }, silent)
  let softAllowed = true
  for (let i = 0; i < 10; i += 1) if (call(coreNoHard).kind !== 'allow') softAllowed = false
  check('denyEnabled:false 时只提醒不拒绝', softAllowed === true, '仍在拦')

  // ── 阈值兜底：非法/过低的值被夹到安全范围 ─────────────────────────────
  const coreBad = createThrottleCore({ rules: [{ id: 'b', pattern: 't', soft: 0, hard: 1, hint: '' }] }, silent)
  const first = coreBad.decide({ sessionId: 'z', toolName: 't' })
  const second = coreBad.decide({ sessionId: 'z', toolName: 't' })
  check('hard=1 被夹到 2，首次调用绝不被拦',
    first.kind === 'allow' && second.kind === 'allow', `${first.kind}/${second.kind}`)

  // ── 默认规则集本身要自洽 ──────────────────────────────────────────────
  const badDefaults = DEFAULT_RULES.filter(r => typeof r.hard === 'number' && r.hard <= (r.soft ?? 0))
  check('默认规则里 hard 必须大于 soft', badDefaults.length === 0,
    badDefaults.map(r => r.id).join(','))
  check('默认规则 id 唯一',
    new Set(DEFAULT_RULES.map(r => r.id)).size === DEFAULT_RULES.length, '有重复 id')

  // 注入消息 source 形态（session format v4 producer-owned kind）
  const sample = injectedMessage('自检提醒')
  check('注入消息 source.kind 为非空字符串且 ≠ plugin',
    typeof sample.source.kind === 'string' && sample.source.kind !== '' && sample.source.kind !== 'plugin',
    JSON.stringify(sample.source))
  check('注入消息 source.kind 为 plugin:context-throttle', sample.source.kind === 'plugin:context-throttle',
    sample.source.kind)

  if (failures.length > 0) {
    console.error(`context-throttle selftest 失败：${failures.length}/${cases} 项`)
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
    return
  }
  console.log(`context-throttle selftest 通过：${cases} 项判据全部符合预期`)
}

if (process.argv[1] && process.argv[1].endsWith('context-throttle.mjs')
  && process.argv.includes('--selftest')) {
  selftest()
}
