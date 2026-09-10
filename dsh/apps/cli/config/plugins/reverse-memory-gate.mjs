/**
 * reverse-memory-gate —— 逆向 / 工作流模式的「逆向经验库强制闸门」。
 *
 * 契约：
 * - **只在经验库已接入时生效**：读 memory_store 写的 `readiness.json`（与 registry.json 同目录），
 *   只有 `ready === true` 才开启闸门。文件不存在或读不到一律按「未接入」处理——基础设施抖动
 *   绝不能阻塞干活（fail-open）；未连 Qdrant 的用户本来就不需要检索与沉淀。
 * - 开启后对每个新站点强制两件事：动手（浏览器调试工具）前必须先调 reverse_memory_search；
 *   收尾（debug_close）前必须先调过一次 reverse_memory_save。拒绝理由原样回给模型，它会自我纠正。
 * - **防死锁**：同一目标被拒超过 `maxDenials` 次即放行并告警；沉淀只要求「调用过」，
 *   不要求入库成功（如实自评 ≤ 门槛被丢弃也算尽到职责）。
 * - 判定以 `agent.id`（会话）为隔离单位，拦截/沉淀是「本会话 + 本目标站点」的事。
 *
 * 挂载：`agent-presets/{reverse,workflow}/agent.cordis.yml`，相对路径装载；config 全部可选。
 * 排障：后端日志里 grep `reverse-memory-gate`——挂载成功、放行、Qdrant 配了但不可达都会留痕。
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

export const name = 'reverse-memory-gate'

const DEFAULT_CONFIG = {
  /** 出现在拒绝理由里的模式名，便于模型与用户对上号。 */
  label: '逆向模式',
  searchTool: '',
  saveTool: '',
  /** 需要「先检索」才放行的工具（动手类）。 */
  gatedTools: [],
  /** 需要「先沉淀」才放行的工具（收尾类）。 */
  closeTools: [],
  /** 同一目标连续被拒上限；超过即放行，避免工具链被卡死。 */
  maxDenials: 3,
  /** 同一会话最多注入多少条提醒。 */
  maxReminders: 12,
  /** readiness.json 的读取缓存时长（毫秒）。 */
  readinessTtlMs: 3_000,
  /** 单会话内记录「已处理过的工具调用」的上限，防止无限增长。 */
  maxClaims: 500,
}

const NON_SITE_HOSTS = new Set(['', 'localhost', '0.0.0.0'])

/**
 * 目标是否值得去经验库里查：需要可检索的域名。
 * IP、localhost、不带点的内网主机名没有可检索的域名，一律放行（否则必然死锁）。
 * @param host - {@link normalizeHost} 归一化后的主机名。
 * @returns 是否需要对它做「先检索」判定。
 */
export function isGateableHost(host) {
  if (!host || NON_SITE_HOSTS.has(host)) return false
  if (host.includes(':')) return false
  if (/^\d+(\.\d+){1,3}$/.test(host)) return false
  return host.includes('.')
}

/**
 * 从 URL 或裸域名取出可比对的主机名：小写、去尾点、去前导 www.。
 * @param input - 完整 URL（含或不含协议）或裸域名。
 * @returns 归一化主机名；无法识别时返回空串。
 */
export function normalizeHost(input) {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return ''
  let host = raw
  try {
    host = new URL(raw.includes('://') ? raw : `http://${raw}`).hostname
  } catch {
    host = raw.split('/')[0].split('?')[0]
  }
  // IPv6 的 hostname 带方括号，去掉后再作类型判断（与 isGateableHost 的 `:` 判定配合）
  host = host.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  return host.startsWith('www.') ? host.slice(4) : host
}

/**
 * 两个主机名是否属于同一站点（含子域关系：a.example.com 与 example.com 视为同站）。
 * @param a - 归一化主机名。
 * @param b - 归一化主机名。
 * @returns 是否同站。
 */
export function sameSite(a, b) {
  if (!a || !b) return false
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

/**
 * readiness.json 的路径：与 memory_store.data_dir() 保持同一口径。
 * @param env - 环境变量来源（默认 process.env）。
 * @returns 就绪状态文件的绝对路径。
 */
export function readinessPath(env = process.env) {
  const dshHome = String(env.DSH_HOME || '').trim()
  const root = dshHome
    ? dirname(dshHome)
    : join(String(env.BOBO_ROOT || process.cwd()), 'bobo-data')
  return join(root, 'reverse-experience', 'readiness.json')
}

/**
 * 解析就绪状态文件内容。
 * @param text - readiness.json 的原文。
 * @returns `{ state: 'ready' | 'not-ready' | 'unknown', configured, url, threshold }`。
 */
export function parseReadiness(text) {
  try {
    const raw = JSON.parse(text)
    return {
      state: raw?.ready === true ? 'ready' : 'not-ready',
      configured: raw?.qdrant_configured === true,
      url: typeof raw?.qdrant_url === 'string' ? raw.qdrant_url : '',
      threshold: typeof raw?.threshold === 'number' ? raw.threshold : undefined,
    }
  } catch {
    return { state: 'unknown', configured: false, url: '' }
  }
}

/**
 * 闸门判定核心（纯逻辑，不接触 dsh，便于单独验证）。
 * @param config - 见 {@link DEFAULT_CONFIG}；缺省项由默认值补齐。
 * @param log - `{ warn(message) }`，可选。
 * @returns `decide`（是否拦截某个工具调用）、`observe`（记录工具结果）、`reminder`（该不该注入提醒）、`state`（排障用）。
 */
export function createGateCore(config = {}, log = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const warn = typeof log.warn === 'function' ? log.warn : () => {}
  const sessions = new Map()

  const session = (id) => {
    let state = sessions.get(id)
    if (state === undefined) {
      if (sessions.size > 200) sessions.delete(sessions.keys().next().value)
      state = {
        searched: new Set(),
        saved: new Set(),
        acted: new Map(),
        denials: new Map(),
        reminders: 0,
        readyNotice: false,
      }
      sessions.set(id, state)
    }
    return state
  }

  const covered = (set, host) => {
    if (set.has('*')) return true
    for (const known of set) if (sameSite(host, known)) return true
    return false
  }

  const pendingSave = (state) => [...state.acted.keys()].filter((host) => !covered(state.saved, host))

  return {
    /** 工具调用前判定；返回拒绝理由字符串，或 null 表示放行。 */
    decide({ sessionId = '', toolName, args, threshold }) {
      const state = session(sessionId)
      if (cfg.gatedTools.includes(toolName)) {
        const host = normalizeHost(args?.url)
        if (!isGateableHost(host)) return null
        if (covered(state.searched, host)) return null
        const denials = state.denials.get(host) ?? 0
        if (denials >= cfg.maxDenials) {
          warn(`[reverse-memory-gate] ${host} 已连续 ${denials} 次未检索，放行以免阻塞`)
          return null
        }
        state.denials.set(host, denials + 1)
        return searchReason(cfg, host)
      }
      if (cfg.closeTools.includes(toolName)) {
        const pending = pendingSave(state)
        if (pending.length === 0) return null
        const host = pending[0]
        const key = `save:${host}`
        const denials = state.denials.get(key) ?? 0
        if (denials >= cfg.maxDenials) {
          warn(`[reverse-memory-gate] ${host} 已连续 ${denials} 次未沉淀，放行以免阻塞`)
          return null
        }
        state.denials.set(key, denials + 1)
        return saveReason(cfg, host, threshold)
      }
      return null
    },

    /** 工具执行后记录状态（只观测，不改结果）。 */
    observe({ sessionId = '', toolName, args }) {
      const state = session(sessionId)
      if (toolName === cfg.searchTool) {
        const host = normalizeHost(args?.domain)
        state.searched.add(host || '*')
      } else if (toolName === cfg.saveTool) {
        const host = normalizeHost(args?.domain)
        state.saved.add(host || '*')
      } else if (cfg.gatedTools.includes(toolName)) {
        const host = normalizeHost(args?.url)
        if (isGateableHost(host)) state.acted.set(host, Date.now())
      }
    },

    /** 每步开始前该注入什么提醒；返回文本或 null。 */
    reminder({ sessionId = '', threshold }) {
      const state = session(sessionId)
      if (state.reminders >= cfg.maxReminders) return null
      let text = null
      if (!state.readyNotice) {
        text = readyText(cfg)
      } else if (state.searched.size === 0) {
        text = searchReminderText(cfg)
      } else {
        const pending = pendingSave(state)
        if (pending.length > 0) text = saveReminderText(cfg, pending[0], threshold)
      }
      if (text === null) return null
      state.reminders += 1
      state.readyNotice = true
      return text
    },

    /** 排障用：查看某会话的判定状态。 */
    state: (sessionId = '') => session(sessionId),
  }
}

function searchReason(cfg, host) {
  return `【${cfg.label}经验库闸门】动手前必须先检索历史经验：请先调用 ${cfg.searchTool}`
    + `（domain="${host}"，features 填已观察到的特征，tags 如 js混淆/签名参数/动态cookie），`
    + '把命中结果当作待验证假设，然后重新调用本工具。同一站点本次会话只需检索一次。'
}

function saveReason(cfg, host, threshold) {
  return `【${cfg.label}经验库闸门】${host} 已经动过手但还没沉淀经验：请先调用 ${cfg.saveTool}`
    + `（domain="${host}"，按 log_template 组织 attempts/final_solution/positive_lessons 等字段）。`
    + `置信度须严格大于 ${thresholdText(threshold)} 才入库；如实自评到门槛及以下会被直接丢弃（不产生文件），`
    + '那也要先调用一次并说明原因，然后重新调用本工具。'
}

function readyText(cfg) {
  return `【${cfg.label}经验库】Qdrant 已连接：动手前先调 ${cfg.searchTool} 查同类站点经验，`
    + `收尾前调 ${cfg.saveTool} 沉淀（成败都要），随后本插件不再提醒。`
}

function searchReminderText(cfg) {
  return `【${cfg.label}经验库】本次会话尚未检索历史经验：动手（打开目标页面）前先调 ${cfg.searchTool}，`
    + '传目标域名与已观察到的特征；命中结果仅作待验证假设，禁止照搬。'
}

function saveReminderText(cfg, host, threshold) {
  return `【${cfg.label}经验库】${host} 已动手但尚未沉淀：收尾前调 ${cfg.saveTool}（成败都要，`
    + `置信度严格大于 ${thresholdText(threshold)} 才入库；≤ 门槛会被丢弃、不产生文件）。`
}

function thresholdText(threshold) {
  return typeof threshold === 'number' && Number.isFinite(threshold) ? String(threshold) : '2.0'
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** 构造一条插件来源的 user 消息（与 dsh 内建注入同形：content + source.kind='plugin'）。 */
function injectedMessage(text) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name },
  })
}

/**
 * 装载闸门：订阅每步注入与工具前后判定。
 * @param ctx - 预设作用域内的插件上下文。
 * @param config - 见 {@link DEFAULT_CONFIG}。
 */
export function apply(ctx, config) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) }
  const warn = (message) => {
    try {
      if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(message)
      else console.warn(message)
    } catch {
      /* 日志不可用不能影响闸门 */
    }
  }
  const core = createGateCore(cfg, { warn })

  let cache = { at: 0, value: { state: 'unknown', configured: false, url: '', threshold: undefined } }
  let warnedUnreachable = false

  const readState = () => {
    let text
    try {
      text = readFileSync(readinessPath(), 'utf8')
    } catch {
      return { state: 'unknown', configured: false, url: '', threshold: undefined }
    }
    return parseReadiness(text)
  }

  const armed = () => {
    const now = Date.now()
    if (now - cache.at > cfg.readinessTtlMs) cache = { at: now, value: readState() }
    const state = cache.value
    if (state.state === 'not-ready' && state.configured && !warnedUnreachable) {
      warnedUnreachable = true
      warn(`[reverse-memory-gate] 已配置 Qdrant（${state.url}）但不可达：闸门关闭，不强制检索/沉淀`)
    }
    return state.state === 'ready'
  }

  const sessionIdOf = (agent) => String(agent?.id ?? agent?.session?.id ?? '')
  const claims = new Set()
  const claim = (key) => {
    if (claims.has(key)) return false
    if (claims.size >= cfg.maxClaims) claims.delete(claims.values().next().value)
    claims.add(key)
    return true
  }

  const onPreExecute = async (exec, next) => {
    const downstream = await next()
    if (downstream.kind !== 'allow') return downstream
    if (!armed()) return downstream
    const mine = cfg.gatedTools.includes(exec.name) || cfg.closeTools.includes(exec.name)
    if (!mine || !claim(exec.callId)) return downstream
    const reason = core.decide({
      sessionId: sessionIdOf(exec.agent),
      toolName: exec.name,
      args: exec.arguments,
      threshold: cache.value.threshold,
    })
    return reason === null ? downstream : { kind: 'deny', reason }
  }

  const onPostExecute = async (exec, _result, next) => {
    const downstream = await next()
    if (armed()) {
      core.observe({ sessionId: sessionIdOf(exec.agent), toolName: exec.name, args: exec.arguments })
    }
    return downstream
  }

  const onPreStep = async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || payload.signal?.aborted === true) return decision
    if (!armed()) return decision
    const sessionId = sessionIdOf(payload.agent)
    if (!claim(`step:${sessionId}:${payload.turn}:${payload.step}`)) return decision
    const text = core.reminder({ sessionId, threshold: cache.value.threshold })
    if (text === null) return decision
    return { kind: 'enter', messages: [...decision.messages, injectedMessage(text)] }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.on('tools/pre-execute', onPreExecute),
      ctx.on('tools/post-execute', onPostExecute),
      ctx.on('agent/pre-step', onPreStep),
      ctx.root.on('tools/pre-execute', onPreExecute),
      ctx.root.on('tools/post-execute', onPostExecute),
      ctx.root.on('agent/pre-step', onPreStep),
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

  warn(`[reverse-memory-gate] 已挂载（${cfg.label}）：闸门开关取决于 ${readinessPath()}`)
}
