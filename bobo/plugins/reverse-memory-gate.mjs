/**
 * reverse-memory-gate —— 逆向 / 工作流模式的「逆向经验库强制闸门」。
 *
 * 契约：
 * - **只在经验库已接入时生效**：读 memory_store 写的 `readiness.json`（与 registry.json 同目录），
 *   只有 `ready === true` 才开启闸门。文件不存在或读不到一律按「未接入」处理——基础设施抖动
 *   绝不能阻塞干活（fail-open）；未连 Qdrant 的用户本来就不需要检索与沉淀。
 * - **拦截常开、提醒懒激活**：`decide`（动手/收尾前的强制拦截）只看就绪状态，不设激活门槛——
 *   拦截不被调用就不产生任何 token，被调用时正是需要经验池的时刻。`reminder`（每步注入的
 *   提醒）在 `lazyReminders` 开启时要求会话已激活（用户文本命中 `activationTriggers`、
 *   任务拆解工具的参数命中触发词、首次触碰被拦工具、主动调用检索/沉淀工具），避免无关任务
 *   每步烧 token。激活是会话级粘性状态，一次激活整会话生效。
 * - **工具 schema 懒露出**：`lazyToolPrefix` 非空时，未激活会话的
 *   `system-prompt/assemble` 会过滤掉 `name.startsWith(prefix)` 的工具 schema——
 *   这些工具不随请求发送（省 schema token），但**仍在注册表里**：模型按名字调用照样成功。
 *   过滤 fail-open（异常时原样返回），激活后工具集一次性露出并保持稳定。
 * - 开启后对每个新站点强制两件事：动手（浏览器调试工具）前必须先调 reverse_memory_search；
 *   收尾（debug_close）前必须先调过一次 reverse_memory_save。拒绝理由原样回给模型，它会自我纠正。
 * - **防死锁**：同一目标被拒超过 `maxDenials` 次即放行并告警；沉淀只要求「调用过」，
 *   不要求入库成功（如实自评 ≤ 门槛被丢弃也算尽到职责）。
 * - 判定以 `agent.id`（会话）为隔离单位，拦截/沉淀是「本会话 + 本目标站点」的事。
 * - **激活态持久化**（相对路径 import `./session-state.mjs`，同一进程 ESM 单例）：
 *   `activated` 首次置位即 `noteGate('reverse')` 落盘到
 *   `<DSH_HOME>/bobo-session-state/<id>.json`；会话首次触碰时从文件水合回内存——
 *   压缩/重启后不再依赖 assemble 的最新用户文本兜底匹配。子代理会话不落盘也不水合
 *   （session-state 排除集；origin 判定依据 child-agent.ts:153 → SessionHeader.origin）。
 *
 * 挂载：`agent-presets/{reverse,workflow}/agent.cordis.yml`，相对路径装载；config 全部可选。
 * 预设过滤：事件入口比对 `config.preset` 与 `agentPresets.composedPreset(agent.ctx)`，
 * 取不到（未挂预设 / 子代理未随父加入 / 服务缺席）一律不处理（fail-closed）。
 * 排障：后端日志里 grep `reverse-memory-gate`——挂载成功、放行、Qdrant 配了但不可达都会留痕。
 */
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  isSubagentAgent, noteGate, noteSubagent, readState as readSessionState,
} from './session-state.mjs'

export const name = 'reverse-memory-gate'

/** 事件入口守卫要读 agentPresets 判定会话所属预设。 */
export const inject = ['agentPresets']

const DEFAULT_CONFIG = {
  /** 本实例所属预设 id（预设行 `config.preset`）：只处理该预设的会话，留空一律不处理（fail-closed）。 */
  preset: '',
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
  /** 提醒懒激活：true 时 reminder 需会话激活后才注入；false 保持「就绪即每步提醒」的原行为。 */
  lazyReminders: false,
  /** 激活触发词：用户文本 / 任务拆解工具参数命中任一词即激活本会话提醒。 */
  activationTriggers: [],
  /** 任务拆解类工具：这些工具的 arguments 整体扫描触发词（todo / plan 产物）。 */
  activationScanTools: ['todo_write', 'exit_plan_mode'],
  /**
   * 经验池工具 schema 懒露出前缀：非空时，未激活会话的 `system-prompt/assemble`
   * 会过滤掉所有 `name.startsWith(prefix)` 的工具 schema（执行层不受影响，工具仍在
   * 注册表）。空前缀 = 不过滤（保持旧行为）。
   */
  lazyToolPrefix: '',
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
 *
 * memory_store 可能在 DSH_HOME 侧（打包版正常）、BOBO_ROOT/bobo-data 或旧 ~/bobo-data
 * 落盘（早期/环境被清洗/未注入 DSH_HOME 时），这里按 候选根 → 第一个真实存在 的原则取，
 * 避免两侧路径不一致让闸门静默失效（永远 fail-open）。
 * @param env - 环境变量来源（默认 process.env）。
 * @returns 就绪状态文件的绝对路径（候选都取不到时回到 DSH_HOME 优先的默认路径，仅作日志展示）。
 */
export function readinessPath(env = process.env) {
  const dshHome = String(env.DSH_HOME || '').trim()
  const roots = []
  if (dshHome) roots.push(dirname(dshHome))
  roots.push(join(String(env.BOBO_ROOT || process.cwd()), 'bobo-data'))
  roots.push(join(homedir(), 'bobo-data'))
  for (const root of roots) {
    const p = join(root, 'experience-pool', 'reverse-experience', 'readiness.json')
    if (existsSync(p)) return p
    const legacy = join(root, 'reverse-experience', 'readiness.json')
    if (existsSync(legacy)) return legacy
  }
  return join((dshHome ? dirname(dshHome) : roots[1]), 'experience-pool', 'reverse-experience', 'readiness.json')
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
 * 折叠空白并转小写，使触发词匹配忽略大小写、换行与重复空格（与 tool-skill 的同名口径一致）。
 * @param value - 原始文本。
 * @returns 去首尾、单空格、小写后的文本。
 */
export function normalizeText(value) {
  return String(value ?? '').replaceAll(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * 文本是否命中触发词表。
 *
 * **与 tool-skill 的 `triggerMatches` 语义相反，这是有意的**：技能目录的空表表示
 * 「无门槛、恒放行」；此处空表表示「未声明文本信号」——文本不参与激活，只剩工具类
 * 信号（首次触碰被拦工具、主动检索），不能被解读成「一律激活」。
 * @param text - 待扫描文本（内部会先 {@link normalizeText}）。
 * @param triggers - 触发词表。
 * @returns 命中任一非空触发词时为 true；空表恒为 false。
 */
export function triggerMatches(text, triggers) {
  if (!Array.isArray(triggers) || triggers.length === 0) return false
  const haystack = normalizeText(text)
  if (haystack === '') return false
  return triggers.some((trigger) => {
    const phrase = normalizeText(trigger)
    return phrase !== '' && haystack.includes(phrase)
  })
}

/**
 * 按懒露出前缀过滤工具 schema（纯逻辑，供 assemble 与 selftest 共用）。
 *
 * **只作用于展示层**：被滤掉的工具仍在注册表里，模型按名字调用照样成功——
 * 过滤改变的只是「哪些 schema 随请求发送」。`prefix` 为空或会话已激活时原样返回；
 * 前缀匹配是 `startsWith`，`mcp__reverse-memory__`（末尾双下划线）不会命中
 * `mcp__reverse-memory-empirical__*`。
 * @param tools - 组装完成的工具 schema 列表（`PromptAssembly.tools`，含 `{name}`）。
 * @param prefix - {@link DEFAULT_CONFIG.lazyToolPrefix}。
 * @param activated - 该会话是否已激活。
 * @returns 过滤后的**新数组**（不需要过滤时是原数组引用）。
 */
export function filterLazyTools(tools, prefix, activated) {
  if (!prefix || activated || !Array.isArray(tools)) return tools
  return tools.filter(tool => !String(tool?.name ?? '').startsWith(prefix))
}

/**
 * 闸门判定核心（纯逻辑，不接触 dsh，便于单独验证）。
 * @param config - 见 {@link DEFAULT_CONFIG}；缺省项由默认值补齐。
 * @param log - `{ warn(message), hydrate?(state, sessionId), onActivated?(sessionId) }`，
 *   可选；后两个由 apply 注入（文件 → 内存水合 / 首次激活落盘），selftest 不传即纯内存。
 * @returns `decide`（是否拦截某个工具调用）、`observe`（记录工具结果）、`reminder`（该不该注入提醒）、`state`（排障用）。
 */
export function createGateCore(config = {}, log = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const warn = typeof log.warn === 'function' ? log.warn : () => {}
  /** 会话状态首次创建时的水合钩子（apply 注入；只准就地改传入 state，不得回调 core）。 */
  const hydrate = typeof log.hydrate === 'function' ? log.hydrate : null
  /** activated 首次置位的落盘钩子（apply 注入 → session-state noteGate）。 */
  const onActivated = typeof log.onActivated === 'function' ? log.onActivated : null
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
        activated: false,
      }
      sessions.set(id, state)
      if (hydrate !== null) {
        // 先入 Map 再水合，且整段包在 try 里：文件抖动按未激活降级（fail-open），
        // 钩子若回调 core 也只会拿到已存在的 state，不会递归重建。
        try {
          hydrate(state, id)
        } catch {
          /* 水合异常按未激活处理，绝不影响闸门 */
        }
      }
    }
    return state
  }

  /** activated 翻转的统一出口：落盘钩子只在真正 false→true 时调一次（水合直接改 state，不走这里）。 */
  const markActivated = (sessionId, state) => {
    if (state.activated) return
    state.activated = true
    if (onActivated !== null) {
      try {
        onActivated(sessionId)
      } catch {
        /* 落盘失败不影响闸门（session-state 内部已 fail-open） */
      }
    }
  }

  const covered = (set, host) => {
    if (set.has('*')) return true
    for (const known of set) if (sameSite(host, known)) return true
    return false
  }

  const pendingSave = (state) => [...state.acted.keys()].filter((host) => !covered(state.saved, host))

  return {
    /**
     * 激活本会话的提醒（懒激活模式下 reminder 才会注入）。
     * 粘性状态：一次激活整会话生效，与 `searched`/`saved` 同生命周期。
     * @param input - `{ sessionId, reason }`；`reason` 仅供日志对上号。
     * @returns 是否为该会话的首次激活（供调用方打一条日志）。
     */
    activate({ sessionId = '', reason = '' } = {}) {
      const state = session(sessionId)
      if (state.activated) return false
      markActivated(sessionId, state)
      if (reason !== '') warn(`[reverse-memory-gate] 会话 ${sessionId} 提醒已激活（原因: ${reason}）`)
      return true
    },

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
        markActivated(sessionId, state)
      } else if (toolName === cfg.saveTool) {
        const host = normalizeHost(args?.domain)
        state.saved.add(host || '*')
        markActivated(sessionId, state)
      } else if (cfg.gatedTools.includes(toolName)) {
        const host = normalizeHost(args?.url)
        if (isGateableHost(host)) state.acted.set(host, Date.now())
      }
    },

    /** 每步开始前该注入什么提醒；返回文本或 null。 */
    reminder({ sessionId = '', threshold }) {
      const state = session(sessionId)
      if (cfg.lazyReminders && !state.activated) return null
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

/** 取一条消息的纯文本（content 里所有 text 块拼接；非 user 消息也适用）。 */
function messageText(message) {
  const blocks = message?.content
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}

/**
 * 会话最新的直接用户文本（倒序找第一条 `source.kind === 'user'` 的文本块）。
 *
 * 与 tool-skill 的 `latestUserText` 同口径：恢复的会话不会重放 `inbox/inserted`，
 * assemble 兜底扫描靠它拿到触发词判定依据。只在会话未激活时调用。
 * @param agent - 当前步的 agent（可能为 undefined）。
 * @returns 归一化后的最新用户文本；取不到返回空串。
 */
function latestUserText(agent) {
  let messages
  try {
    messages = agent?.session?.deriveMessages?.()
  } catch {
    return ''
  }
  if (!Array.isArray(messages)) return ''
  for (const message of [...messages].reverse()) {
    if (message?.source?.kind !== 'user') continue
    const text = normalizeText(messageText(message))
    if (text !== '') return text
  }
  return ''
}

/**
 * 预设身份判定（纯函数，自检直接调用）：本实例只处理自己预设的会话。
 *
 * 事件按房规在 ctx 与 ctx.root 双注册，root 监听会收到所有预设的会话；
 * `configPreset`（预设行 `config.preset`）或 agent 的预设 id 取不到时返回
 * false——fail-closed 到"不处理"。
 * @param configPreset - 本实例所属预设 id。
 * @param agentPreset - `agentPresets.composedPreset(agent.ctx)` 的结果。
 * @returns 仅当两者是非空字符串且相等时 true。
 */
export function ownsPreset(configPreset, agentPreset) {
  return typeof configPreset === 'string' && configPreset !== ''
    && typeof agentPreset === 'string' && agentPreset === configPreset
}

/** 构造一条插件来源的 user 消息（source.kind 用 session format v4 的 producer-owned 形态 `plugin:<插件名>`）。 */
export function injectedMessage(text) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: `plugin:${name}` },
  })
}

/**
 * 装载闸门：订阅每步注入与工具前后判定。
 * @param ctx - 预设作用域内的插件上下文。
 * @param config - 见 {@link DEFAULT_CONFIG}。
 */
export function apply(ctx, config) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) }
  /** 事件入口守卫：只处理本预设的 agent（ctx.root 双注册会收到其它预设的会话）。 */
  const ownAgent = (agent) => {
    try {
      const presets = ctx.get('agentPresets')
      if (presets === undefined || agent?.ctx === undefined) return false
      return ownsPreset(cfg.preset, presets.composedPreset(agent.ctx))
    } catch {
      return false
    }
  }
  const warn = (message) => {
    try {
      if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(message)
      else console.warn(message)
    } catch {
      /* 日志不可用不能影响闸门 */
    }
  }
  const core = createGateCore(cfg, {
    warn,
    // 压缩/重启恢复：文件里已有 reverse 闸门记录 → 内存态首次创建即置 activated。
    // 改的是传入 state、不走 activate()，水合不会被当成"新激活"再写回去；
    // 子代理会话没有持久化文件，readState 返回默认值即无操作。
    hydrate: (state, sessionId) => {
      if (readSessionState(sessionId).gates?.reverse) state.activated = true
    },
    // 首次激活落盘；子代理会话已被 sessionIdOf 记入排除集，noteGate 内部静默跳过。
    onActivated: (sessionId) => {
      noteGate(sessionId, 'reverse', `${cfg.label}经验闸门`)
    },
  })

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

  const sessionIdOf = (agent) => {
    const id = String(agent?.id ?? agent?.session?.id ?? '')
    // 子代理不持久化：每次触碰重判 origin 并补回排除集（排除集淘汰后立即重建，
    // 不存在漏网窗口）。依据 child-agent.ts:153 → SessionHeader.origin；不能用
    // parentSession 判定——GUI fork 的主会话也带 parentSession（meow 真机踩坑）。
    if (id !== '' && isSubagentAgent(agent)) noteSubagent(id)
    return id
  }
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
    if (!ownAgent(exec.agent)) return downstream
    if (!armed()) return downstream
    const mine = cfg.gatedTools.includes(exec.name) || cfg.closeTools.includes(exec.name)
    if (!mine) return downstream
    // 首次触碰被拦工具即激活提醒（兜底信号）：模型动手了，本会话必然与经验池相关；
    // 激活在 decide 之前，deny 后的下一步提醒就能接上。
    core.activate({ sessionId: sessionIdOf(exec.agent), reason: '首次动手' })
    if (!claim(exec.callId)) return downstream
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
    if (!ownAgent(exec.agent)) return downstream
    if (armed()) {
      const sessionId = sessionIdOf(exec.agent)
      if ((cfg.lazyReminders || cfg.lazyToolPrefix) && cfg.activationScanTools.includes(exec.name)
        && triggerMatches(JSON.stringify(exec.arguments ?? {}), cfg.activationTriggers)) {
        core.activate({ sessionId, reason: `${exec.name} 扫描命中触发词` })
      }
      core.observe({ sessionId, toolName: exec.name, args: exec.arguments })
    }
    return downstream
  }

  const onPreStep = async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || payload.signal?.aborted === true) return decision
    if (!ownAgent(payload.agent)) return decision
    const sessionId = sessionIdOf(payload.agent)
    // 用户文本触发词：只扫本步 claim 的真实用户消息（source.kind==='user'，
    // plugin 注入天然被排除）。激活在 armed() 之前做——它是纯状态记录，
    // 就绪状态晚到也不影响本会话后续提醒。
    if ((cfg.lazyReminders || cfg.lazyToolPrefix) && cfg.activationTriggers.length > 0) {
      const blocks = []
      for (const message of payload.messages ?? []) {
        if (message?.source?.kind !== 'user') continue
        for (const block of message.content ?? []) {
          if (block?.type === 'text' && typeof block.text === 'string') blocks.push(block.text)
        }
      }
      if (triggerMatches(blocks.join('\n'), cfg.activationTriggers)) {
        core.activate({ sessionId, reason: '用户文本命中触发词' })
      }
    }
    if (!armed()) return decision
    if (!claim(`step:${sessionId}:${payload.turn}:${payload.step}`)) return decision
    const text = core.reminder({ sessionId, threshold: cache.value.threshold })
    if (text === null) return decision
    return { kind: 'enter', messages: [...decision.messages, injectedMessage(text)] }
  }

  // 用户消息入队即扫触发词（emit 事件，发生在该步 assemble **之前**）：
  // 消息 1 命中时首个请求就带工具 schema，header 从第一步起稳定、不打断前缀缓存。
  // pre-step 的同款扫描保留作冗余（幂等）。
  const onInboxInserted = (payload) => {
    try {
      if (!ownAgent(payload?.agent)) return
      if ((!cfg.lazyReminders && !cfg.lazyToolPrefix) || cfg.activationTriggers.length === 0) return
      if (triggerMatches(messageText(payload?.message), cfg.activationTriggers)) {
        core.activate({ sessionId: sessionIdOf(payload?.agent), reason: '用户消息入队命中触发词' })
      }
    } catch {
      /* 激活信号失败绝不影响消息入队 */
    }
  }

  // 工具 schema 懒露出：未激活会话的 assemble 过滤掉经验池工具 schema。
  // fail-open：任何异常返回原样 assembly（最坏 = 退回旧行为，绝不阻塞装配）。
  const onAssemble = async (assembly, context, next) => {
    const result = await next()
    if (!ownAgent(context?.agent)) return result
    try {
      if (!cfg.lazyToolPrefix) return result
      const sessionId = sessionIdOf(context?.agent)
      if (sessionId === '') return result
      const state = core.state(sessionId)
      if (!state.activated && cfg.activationTriggers.length > 0) {
        // 会话恢复兜底：历史消息不会重放 inbox/inserted，用最新用户文本补一次匹配。
        if (triggerMatches(latestUserText(context.agent), cfg.activationTriggers)) {
          core.activate({ sessionId, reason: 'assemble 兜底命中触发词（恢复会话）' })
        }
      }
      if (!core.state(sessionId).activated) {
        return { ...result, tools: filterLazyTools(result.tools, cfg.lazyToolPrefix, false) }
      }
      return result
    } catch {
      return result
    }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.on('tools/pre-execute', onPreExecute),
      ctx.on('tools/post-execute', onPostExecute),
      ctx.on('agent/pre-step', onPreStep),
      ctx.on('agent/inbox/inserted', onInboxInserted),
      ctx.on('system-prompt/assemble', onAssemble),
      ctx.root.on('tools/pre-execute', onPreExecute),
      ctx.root.on('tools/post-execute', onPostExecute),
      ctx.root.on('agent/pre-step', onPreStep),
      ctx.root.on('agent/inbox/inserted', onInboxInserted),
      ctx.root.on('system-prompt/assemble', onAssemble),
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

/**
 * 自检：拦截常开 + 提醒懒激活两层语义真跑一遍
 * （`node reverse-memory-gate.mjs --selftest`）。
 *
 * 注意这里**不测 `armed()`**——它依赖真实文件系统上的 readiness.json，属接线层；
 * 判据本身用注入的 core 直接验证，避免伪造一个「通过」。
 * @param cfg - 覆盖配置（测试可注入）。
 * @returns `{ ok, cases, failures }`。
 */
export function selftest(cfg = {}) {
  const failures = []
  let cases = 0
  const check = (label, condition, actual) => {
    cases += 1
    if (condition !== true) failures.push(`✗ ${label}：${actual}`)
  }

  const base = {
    label: '自检模式',
    searchTool: 'mcp__reverse-memory__reverse_memory_search',
    saveTool: 'mcp__reverse-memory__reverse_memory_save',
    gatedTools: ['mcp__cloak-debug__debug_navigate'],
    closeTools: ['mcp__cloak-debug__debug_close'],
    ...cfg,
  }
  const cfgOld = { ...base, lazyReminders: false }
  const cfgLazy = {
    ...base,
    lazyReminders: true,
    activationTriggers: ['逆向', '反爬'],
    activationScanTools: ['todo_write', 'exit_plan_mode'],
  }

  // 1) lazyReminders:false → 就绪即提醒（改造前行为的回归锚点）
  const old = createGateCore(cfgOld, { warn: () => {} })
  const oldFirst = old.reminder({ sessionId: 's1' })
  check('关闭懒激活时首步即提醒', typeof oldFirst === 'string' && oldFirst.includes('Qdrant 已连接'), oldFirst)

  // 2) 懒激活未激活 → reminder 静默，但 decide 照常拦截（拦截常开）
  const lazy = createGateCore(cfgLazy, { warn: () => {} })
  check('未激活时提醒静默', lazy.reminder({ sessionId: 's1' }) === null, lazy.reminder({ sessionId: 's1' }))
  const deny = lazy.decide({ sessionId: 's1', toolName: 'mcp__cloak-debug__debug_navigate', args: { url: 'https://example.com/a' } })
  check('未激活时拦截仍生效', typeof deny === 'string' && deny.includes('reverse_memory_search'), deny)

  // 3) 激活（用户文本信号由接线层折算成 activate 调用）→ 提醒恢复
  check('首次激活返回 true', lazy.activate({ sessionId: 's1', reason: '自检' }) === true, '首激活')
  const first = lazy.reminder({ sessionId: 's1' })
  check('激活后首条为就绪提示', typeof first === 'string' && first.includes('Qdrant 已连接'), first)
  const second = lazy.reminder({ sessionId: 's1' })
  check('激活后第二条催检索', typeof second === 'string' && second.includes('尚未检索'), second)

  // 4) 激活幂等
  check('二次激活返回 false', lazy.activate({ sessionId: 's1', reason: '重复' }) === false, '重复激活')

  // 5) observe(searchTool) 视为激活 + 记为已检索
  lazy.observe({ sessionId: 's2', toolName: 'mcp__reverse-memory__reverse_memory_search', args: { domain: 'example.com' } })
  check('主动检索即激活', lazy.state('s2').activated === true, lazy.state('s2').activated)
  check('已检索站点不再拦截', lazy.decide({ sessionId: 's2', toolName: 'mcp__cloak-debug__debug_navigate', args: { url: 'https://www.example.com/x' } }) === null, '同站放行')

  // 6) observe(gatedTool) 不算激活（只记 acted；激活由接线层 pre-execute 负责）
  const lazy2 = createGateCore(cfgLazy, { warn: () => {} })
  lazy2.observe({ sessionId: 's3', toolName: 'mcp__cloak-debug__debug_navigate', args: { url: 'https://a.com/' } })
  check('仅观测不误激活', lazy2.state('s3').activated === false, lazy2.state('s3').activated)

  // 7) 触发词匹配口径
  check('触发词命中', triggerMatches('帮我逆向这个站点', ['逆向', '反爬']) === true, '命中')
  check('触发词大小写与空白无关', triggerMatches('  Cookie   轮换 ', ['cookie']) === true, '归一化')
  check('空表恒不命中（与 tool-skill 相反）', triggerMatches('逆向', []) === false, '空表')

  // 8) 空触发词表：文本信号不存在，但工具信号仍可激活
  const lazy3 = createGateCore({ ...base, lazyReminders: true, activationTriggers: [] }, { warn: () => {} })
  check('空词表时未激活静默', lazy3.reminder({ sessionId: 's4' }) === null, lazy3.reminder({ sessionId: 's4' }))
  lazy3.activate({ sessionId: 's4', reason: '首次动手' })
  check('空词表时工具信号仍能激活', typeof lazy3.reminder({ sessionId: 's4' }) === 'string', '激活后有提醒')

  // 9) 工具 schema 懒露出（filterLazyTools 纯逻辑）
  const mkTools = () => [
    { name: 'mcp__reverse-memory__reverse_memory_search' },
    { name: 'mcp__reverse-memory__reverse_memory_save' },
    { name: 'mcp__reverse-memory__reverse_memory_feedback' },
    { name: 'mcp__reverse-memory__reverse_memory_stats' },
    { name: 'mcp__reverse-memory__reverse_memory_cleanup' },
    { name: 'mcp__reverse-memory__reverse_memory_sync' },
    { name: 'mcp__cloak-debug__debug_navigate' },
    { name: 'todo_write' },
  ]
  const all = mkTools()
  check('空前缀不过滤（回归）', filterLazyTools(all, '', false) === all, '原数组')
  const hidden = filterLazyTools(all, 'mcp__reverse-memory__', false)
  check('未激活时经验池工具被滤掉', hidden.length === 2 && all.length === 8,
    `过滤后 ${hidden.length}/8`)
  check('过滤后保留非目标工具', hidden.every(t => !t.name.startsWith('mcp__reverse-memory__'))
    && hidden.some(t => t.name === 'todo_write'), hidden.map(t => t.name).join(','))
  check('已激活原样返回', filterLazyTools(all, 'mcp__reverse-memory__', true) === all, '原数组')
  check('前缀边界不误伤 empirical',
    filterLazyTools([{ name: 'mcp__reverse-memory-empirical__reverse_memory_search' }],
      'mcp__reverse-memory__', false).length === 1, '保留 empirical 工具')

  // 10) 恢复会话兜底：latestUserText 真函数 + 触发词匹配（assemble 接线层逻辑等价复现）
  const lazy4 = createGateCore({ ...base, lazyReminders: true, activationTriggers: ['逆向'] }, { warn: () => {} })
  check('恢复兜底前未激活', lazy4.state('s5').activated === false, '未激活')
  const fakeAgent = { session: { deriveMessages: () => [
    { source: { kind: 'user' }, content: [{ type: 'text', text: '早先的消息' }] },
    { source: { kind: 'plugin:context-facts' }, content: [{ type: 'text', text: '插件注入不算' }] },
    { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我逆向这个站点' }] },
  ] } }
  check('latestUserText 取最新用户文本',
    latestUserText(fakeAgent) === '帮我逆向这个站点', latestUserText(fakeAgent))
  check('latestUserText 对空 agent 返回空串', latestUserText(undefined) === '', '空串')
  if (triggerMatches(latestUserText(fakeAgent), ['逆向'])) {
    lazy4.activate({ sessionId: 's5', reason: '恢复兜底' })
  }
  check('最新用户文本命中触发词即激活', lazy4.state('s5').activated === true, '已激活')
  check('激活后 assemble 不再过滤',
    filterLazyTools(all, 'mcp__reverse-memory__', lazy4.state('s5').activated) === all, '原数组')

  // 11) session-state 接线钩子（纯逻辑：水合 / 激活上报；不碰文件系统）
  const hooks = []
  const hydrated = createGateCore(cfgLazy, {
    warn: () => {},
    hydrate: (state) => { state.activated = true },
    onActivated: (sid) => hooks.push(sid),
  })
  check('水合后首触即为已激活', hydrated.state('s9').activated === true, hydrated.state('s9').activated)
  check('水合不触发 onActivated（不把恢复写回文件）', hooks.length === 0, JSON.stringify(hooks))
  check('水合会话再次 activate 返回 false',
    hydrated.activate({ sessionId: 's9', reason: '重复' }) === false, 'true')
  const watched = createGateCore(cfgLazy, { warn: () => {}, onActivated: (sid) => hooks.push(sid) })
  watched.activate({ sessionId: 's10', reason: '自检' })
  watched.activate({ sessionId: 's10', reason: '重复' })
  check('首次激活上报恰好一次', hooks.filter((sid) => sid === 's10').length === 1, JSON.stringify(hooks))
  watched.observe({ sessionId: 's11', toolName: base.searchTool, args: { domain: 'hook.example.com' } })
  check('observe 主动检索也上报落盘', hooks.includes('s11'), JSON.stringify(hooks))
  const broken = createGateCore(cfgLazy, { warn: () => {}, hydrate: () => { throw new Error('x') } })
  check('水合异常不冒泡（fail-open）', broken.state('s12').activated === false, '异常冒泡')

  // 12) 注入消息 source 形态（session format v4 producer-owned kind）+ 预设身份守卫
  const sample = injectedMessage('自检提醒')
  check('注入消息 source.kind 为非空字符串且 ≠ plugin',
    typeof sample.source.kind === 'string' && sample.source.kind !== '' && sample.source.kind !== 'plugin',
    JSON.stringify(sample.source))
  check('注入消息 source.kind 为 plugin:reverse-memory-gate',
    sample.source.kind === 'plugin:reverse-memory-gate', sample.source.kind)
  check('预设守卫：同预设放行、其它预设不处理',
    ownsPreset('reverse', 'reverse') === true && ownsPreset('reverse', 'workflow') === false,
    `${ownsPreset('reverse', 'reverse')}/${ownsPreset('reverse', 'workflow')}`)
  check('预设守卫：未配置 / 取不到一律不处理（fail-closed）',
    ownsPreset('', 'reverse') === false && ownsPreset('reverse', undefined) === false, 'fail-open')

  return { ok: failures.length === 0, cases, failures }
}

const invokedDirectly = Boolean(process.argv[1]) && process.argv[1].endsWith('reverse-memory-gate.mjs')
if (invokedDirectly && process.argv.includes('--selftest')) {
  const r = selftest()
  console.log(`[reverse-memory-gate] selftest: ${r.ok ? 'PASS' : 'FAIL'}（${r.cases} 例）`)
  for (const line of r.failures) console.error(`  ${line}`)
  process.exit(r.ok ? 0 : 1)
}
