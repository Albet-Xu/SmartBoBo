/**
 * session-state —— 会话级粘性状态的持久化层 + 压缩后「粘性状态摘要」重注入。
 *
 * ## 双重角色（同一文件、进程内 ESM 单例）
 *
 * 1. **共享库**：reverse-memory-gate / collab-gate 以 `./session-state.mjs` 相对路径
 *    import（插件是纯 .mjs 无构建，workspace 包解析不到，相对路径是唯一选项）。
 *    模块在进程里只有一份实例，「子代理排除集」等进程态在库与插件之间天然共享。
 * 2. **host 层插件**：监听压缩生命周期（session/event）与 pre-step，把 sticky 状态
 *    在压缩后贴回上下文。挂载行在 cordis.patch.yml（主线程统一加，本文件不改 yml）。
 *
 * ## 为什么落盘：压缩与重启都会丢内存态
 *
 * 闸门类插件的激活态是会话级粘性的，但此前只活在进程内存 Map 里：压缩后上下文里
 * 不再有激活痕迹（模型可能退回未激活行为），重启后 Map 归零（只能靠 assemble 扫
 * 最新用户文本兜底，匹配不上就退化）。借鉴 dsh-meow-memory 的 sessions/<id>.json
 * （src/inject.ts 的 release 语义），状态落 `<DSH_HOME>/bobo-session-state/<id>.json`；
 * 文件名对 sessionId 做 encodeURIComponent（`/ \ :` 等分隔符全被转义，路径穿越
 * 进不来；meow 原版是裸拼文件名，这里按安全要求收紧）。DSH_HOME 缺省时降级
 * os.tmpdir 下的兜底目录——宁可写到临时目录也不能不记（fail-open）。
 *
 * ## sticky 与 released 两级生命周期（meow 的 releaseSeen 语义）
 *
 * - **sticky**（压缩/重启都不丢）：
 *   - `gates`：已激活闸门 `key → { label, at }`（压缩后重注入的数据源）；
 *   - `meta`：预留扩展位（暂无生产者，故不渲染）；
 *   - `reinjectPending`：压缩链路自身的产物——start/summary 释放**之后**才由
 *     end 置位，release 不该也不能清它，否则会把重注入打断。
 * - **released**（`releaseOnCompaction` 收到压缩信号即清空，允许"重新展示"）：
 *   - `digestShown`：本轮压缩后是否已注入过摘要。压缩把上一轮摘要挤出上下文，
 *     下一轮要能重新注入，所以它必须随压缩归零（meow 的 injected/searched 同理）。
 *
 * 结构只保留白名单字段（meow 同款），坏 JSON / 读失败一律按默认值；写失败只
 * console.warn 不抛。写盘 mkdir + tmp + rename 原子化（Windows 上 libuv rename
 * 带 replace-existing，覆盖安全）。
 *
 * ## 与 context-facts 的分工与时序（两者都在压缩后补状态，互不重叠）
 *
 * - context-facts：靠 `replaceGeneration` 代次上涨判定压缩（不依赖事件时序），
 *   注入的是**机械台账**（工作目录/写过的文件/未解决错误，T1-T4 分层），
 *   追加在 decision.messages **末尾**，预算 2000 字符、每会话 ≤6 次。
 * - 本插件：靠 session/event 的压缩生命周期（start/summary → 释放；end 无 error →
 *   置 pending），注入的是 **sticky 闸门清单**，插在最后一条真实 user 消息**之前**，
 *   预算 400 字符（可 config）、每个压缩轮 ≤1 次。
 * - 同一个 pre-step 两者可以同时触发：一头一尾各插各的，内容不重叠、互不依赖，
 *   单轮合计 ≤2400 字符；任一方失败都 fail-open，不影响压缩本身与对方。
 * - 时序差异是有意的：context-facts 读代次，压缩当轮的工具步就会注入；本插件等
 *   下一个**真实用户消息**——闸门摘要是给下一步决策看的，插进工具轮中间只打断序列。
 *
 * ## 子代理排除（源码依据）
 *
 * 子代理会话创建时写入 `origin: 'subagent'`（subagent/subagent/src/child-agent.ts:153
 * 的 childSessionMeta），落到 SessionHeader.origin（core/session/src/types.ts:117）。
 * 判定读 `session.header.origin === 'subagent'`（与 dsh-meow-memory index.ts 同款；
 * **不能**用 parentSession 判定——GUI fork 的主会话也带 parentSession，meow 真机
 * 踩过坑）。命中即 `noteSubagent` 进进程排除集：不落盘、不置 pending、不注入——
 * 子代理的 prompt 由父代理裁剪供给，粘性状态注入纯属浪费。排除集有 200 上限，
 * 但每次触碰都从活的 agent/session 重新判定 origin，淘汰后下一事件即重建。
 *
 * ## 契约
 *
 * - **只读 + 注入，不 deny**：不改工具结果，只在最后一条真实 user 消息前插入一条
 *   独立消息；照 context-facts 展开 decision（保住 `startsRequestSeries`）。
 * - **注入形态照抄 context-facts**：深冻结的 user 消息、`source: { kind:
 *   'plugin:session-state' }`（session format v4 的 producer-owned source kind，
 *   `plugin` 字段随 v3→v4 迁移已移除）；
 *   `source.kind === 'user'` 才算真实用户消息（插件注入天然被排除）。
 * - **pending 消费规则**：含真实用户消息的 pre-step 必清（空状态也清，防空转）；
 *   纯工具轮（无真实用户消息）保留 pending 等下一个用户消息。
 * - **fail-open**：读写/渲染异常全部吞掉并 console.warn，模型请求永远拿不到本
 *   插件的异常。
 *
 * 挂载：host 层一行（`cordis.patch.yml` 的 insert 列表，所有预设生效）。
 * 排障：`node session-state.mjs --selftest`；运行期留痕走 `console.warn`
 * （web profile 下 `ctx.logger` 只进内存环形缓冲，不落后端 stdout，别 grep 启动日志）。
 */
import {
  mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'session-state'

/** 可覆盖的默认配置（apply 的 config 合并到它上面）。 */
export const DEFAULT_CONFIG = {
  /** 粘性状态摘要的字符预算；≤0 表示不注入。 */
  budgetChars: 400,
  /** 摘要标题（首行 `=== … ===`）。 */
  title: '压缩后粘性状态恢复',
}

/** 子代理排除集的进程内上限（超出丢最旧；每次触碰都会重新判定并补回）。 */
const EXCLUDED_MAX = 200

/**
 * 默认状态（读不到文件 / 坏 JSON 时的返回值，也是写盘结构的白名单）。
 * @returns `{ gates, meta, digestShown, reinjectPending }` 的全新对象。
 */
export function defaultState() {
  return { gates: {}, meta: {}, digestShown: false, reinjectPending: false }
}

/**
 * 状态目录：`<DSH_HOME>/bobo-session-state`；DSH_HOME 缺省时降级 os.tmpdir 兜底。
 * @param env - 环境变量来源（默认 process.env；selftest 用显式入参隔离真实环境）。
 * @returns 状态目录绝对路径（不创建，写盘前才 mkdir）。
 */
export function stateDir(env = process.env) {
  const dshHome = String(env.DSH_HOME ?? '').trim()
  if (dshHome !== '') return join(dshHome, 'bobo-session-state')
  return join(tmpdir(), 'bobo-session-state')
}

/**
 * 单会话状态文件路径。
 *
 * encodeURIComponent 把 `/` `\` `:` 等路径分隔符全部转义成 `%XX`——sessionId
 * 无论长什么样都只能拼出 base 下的一个文件名，逃不出目录（selftest 有专项判据）。
 * @param sessionId - 会话 id（调用方保证非空）。
 * @param dir - 状态目录覆盖（测试传临时目录；缺省 {@link stateDir}）。
 * @returns 绝对路径。
 */
export function stateFile(sessionId, dir) {
  const base = dir ?? stateDir()
  return join(base, `${encodeURIComponent(String(sessionId))}.json`)
}

/**
 * 是否子代理会话：读 SessionHeader.origin（child-agent.ts:153 写入的权威标记）。
 * 同时接受 agent 形态（`{ session: { header } }`）与 session 形态（`{ header }`）。
 * @param candidate - agent、session 或其它对象。
 * @returns 命中 `origin === 'subagent'` 为 true；读不到一律 false（fail-open）。
 */
export function isSubagentAgent(candidate) {
  try {
    const header = candidate?.header ?? candidate?.session?.header
    return header?.origin === 'subagent'
  } catch {
    return false
  }
}

/** 进程内子代理排除集（sessionId 字符串；有界，触碰时可重建）。 */
const excluded = new Set()

/**
 * 把会话记入排除集：随后一切落盘（patchState 系）对该 id 静默 no-op。
 * 由各插件在拿到活 agent/session 时调用——每次触碰都会重判，淘汰无害。
 * @param sessionId - 会话 id。
 */
export function noteSubagent(sessionId) {
  const id = String(sessionId ?? '')
  if (id === '') return
  if (excluded.has(id)) excluded.delete(id)
  else if (excluded.size >= EXCLUDED_MAX) excluded.delete(excluded.values().next().value)
  excluded.add(id)
}

/**
 * 会话是否在排除集中。
 * @param sessionId - 会话 id。
 * @returns 已被记为子代理则 true。
 */
export function isExcluded(sessionId) {
  return excluded.has(String(sessionId ?? ''))
}

/** 解析已知字段（白名单）；未知字段丢弃，类型不对一律回默认值。 */
function normalizeState(raw) {
  const state = defaultState()
  if (raw === null || typeof raw !== 'object') return state
  if (raw.gates !== null && typeof raw.gates === 'object') {
    for (const [key, entry] of Object.entries(raw.gates)) {
      if (entry === null || typeof entry !== 'object') continue
      const label = typeof entry.label === 'string' ? entry.label : ''
      if (label === '') continue
      state.gates[key] = { label, at: typeof entry.at === 'number' ? entry.at : 0 }
    }
  }
  if (raw.meta !== null && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) {
    state.meta = { ...raw.meta }
  }
  state.digestShown = raw.digestShown === true
  state.reinjectPending = raw.reinjectPending === true
  return state
}

/**
 * 读会话状态。
 * @param sessionId - 会话 id。
 * @param dir - 状态目录覆盖（测试用）。
 * @returns 状态对象；文件不存在 / 坏 JSON / 读失败一律返回默认值（fail-open，不抛）。
 */
export function readState(sessionId, dir) {
  const id = String(sessionId ?? '')
  if (id === '') return defaultState()
  try {
    return normalizeState(JSON.parse(readFileSync(stateFile(id, dir), 'utf8')))
  } catch {
    // 文件不存在是最常见的情况（新会话）；坏 JSON 与读失败同样按默认值降级。
    return defaultState()
  }
}

/** mkdir + 写临时文件 + rename（同目录内原子替换）。失败向上抛，由 mutate 吞掉告警。 */
function writeFileAtomic(file, state) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(tmp, JSON.stringify(state), 'utf8')
  try {
    renameSync(tmp, file)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      /* 临时文件残留不影响主链路 */
    }
    throw error
  }
}

/**
 * 读-改-整写的公共通道：排除集/空 id 直接跳过，变更为空不写盘，写失败只 warn。
 * @param sessionId - 会话 id。
 * @param mutator - 就地修改状态的函数。
 * @param dir - 状态目录覆盖。
 */
function mutate(sessionId, mutator, dir) {
  const id = String(sessionId ?? '')
  if (id === '') return
  if (isExcluded(id)) return
  try {
    const state = readState(id, dir)
    const before = JSON.stringify(state)
    mutator(state)
    if (JSON.stringify(state) === before) return
    writeFileAtomic(stateFile(id, dir), state)
  } catch (error) {
    warn(`写状态文件失败（fail-open，不影响会话）：${error?.message ?? error}`)
  }
}

/** fail-open 的告警通道（web profile 下 ctx.logger 不落后端 stdout，统一走 console）。 */
function warn(message) {
  try {
    console.warn(`[session-state] ${message}`)
  } catch {
    /* 日志不可用不能影响主链路 */
  }
}

/**
 * 整块合并写入（只认 {@link defaultState} 的顶层键，未知键下次读即丢弃）。
 * @param sessionId - 会话 id。
 * @param fields - 要合并的顶层字段。
 * @param dir - 状态目录覆盖。
 */
export function patchState(sessionId, fields = {}, dir) {
  mutate(sessionId, (state) => Object.assign(state, fields), dir)
}

/**
 * 记录一个已激活闸门（sticky；每次调用刷新 at）。
 * @param sessionId - 会话 id。
 * @param key - 闸门键（如 `reverse` / `collab`）。
 * @param label - 展示名（进重注入摘要）。
 * @param dir - 状态目录覆盖。
 */
export function noteGate(sessionId, key, label, dir) {
  const gateKey = String(key ?? '')
  if (gateKey === '') return
  mutate(sessionId, (state) => {
    state.gates[gateKey] = { label: String(label ?? gateKey), at: Date.now() }
  }, dir)
}

/**
 * 压缩信号（compaction/start、compaction/summary）→ 清空 released 字段。
 * sticky 字段（gates / meta / reinjectPending）原样保留；重复调用无副作用。
 * @param sessionId - 会话 id。
 * @param dir - 状态目录覆盖。
 */
export function releaseOnCompaction(sessionId, dir) {
  mutate(sessionId, (state) => {
    state.digestShown = false
  }, dir)
}

/**
 * 标记「本轮压缩已注入过摘要」（released 字段，下次压缩被 release 清零）。
 * @param sessionId - 会话 id。
 * @param dir - 状态目录覆盖。
 */
export function markDigestShown(sessionId, dir) {
  mutate(sessionId, (state) => {
    state.digestShown = true
  }, dir)
}

/**
 * 清「已注入」标记（由 releaseOnCompaction 承担；此函数供测试与排障直呼）。
 * @param sessionId - 会话 id。
 * @param dir - 状态目录覆盖。
 */
export function clearDigestShown(sessionId, dir) {
  mutate(sessionId, (state) => {
    state.digestShown = false
  }, dir)
}

/**
 * 压缩成功（compaction/end 无 error）后置位重注入待办；重启不丢（文件字段）。
 * @param sessionId - 会话 id。
 * @param dir - 状态目录覆盖。
 */
export function markReinjectPending(sessionId, dir) {
  mutate(sessionId, (state) => {
    state.reinjectPending = true
  }, dir)
}

/**
 * 清重注入待办（注入完成或空状态消费后调用，幂等）。
 * @param sessionId - 会话 id。
 * @param dir - 状态目录覆盖。
 */
export function clearReinjectPending(sessionId, dir) {
  mutate(sessionId, (state) => {
    state.reinjectPending = false
  }, dir)
}

/**
 * 读重注入待办标记。
 * @param sessionId - 会话 id。
 * @param dir - 状态目录覆盖。
 * @returns 待注入为 true；排除集/无文件为 false。
 */
export function isReinjectPending(sessionId, dir) {
  return readState(sessionId, dir).reinjectPending === true
}

function clip(text, limit) {
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 1))}…`
}

/**
 * 渲染粘性状态摘要（纯函数，selftest 直测）。
 *
 * 只渲染闸门清单（meta 暂无生产者不渲染）。超预算时先截断清单，极端小预算
 * 对整块兜底截断——返回值长度永远 ≤ budgetChars。
 * @param state - {@link readState} 的返回值。
 * @param cfg - 见 {@link DEFAULT_CONFIG}（`budgetChars` / `title`）。
 * @returns 文本，或 null 表示没有可注入内容（空闸门 / 预算 ≤0）。
 */
export function renderStickyState(state, cfg = {}) {
  const rawBudget = cfg.budgetChars ?? DEFAULT_CONFIG.budgetChars
  const budget = typeof rawBudget === 'number' && Number.isFinite(rawBudget)
    ? Math.floor(rawBudget)
    : DEFAULT_CONFIG.budgetChars
  if (budget <= 0) return null

  const labels = []
  for (const entry of Object.values(state?.gates ?? {})) {
    const label = String(entry?.label ?? '').trim()
    if (label !== '' && !labels.includes(label)) labels.push(label)
  }
  if (labels.length === 0) return null

  const head = `=== ${cfg.title ?? DEFAULT_CONFIG.title} ===`
  const lead = '已激活闸门（压缩后仍生效）：'
  const text = `${head}\n${lead}${labels.join('、')}`
  if (text.length <= budget) return text
  // 超预算：先截断清单行；标题行保底。room 要为省略号留一位。
  const room = budget - (head.length + 1 + lead.length + 1)
  if (room > 0) return `${head}\n${lead}${clip(labels.join('、'), room)}`
  return clip(text, budget)
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/**
 * 构造一条插件来源的 user 消息——**完全照抄 context-facts.mjs 的契约**：
 * 深冻结（会话表面与投影层会直接持有并比较它）、`source.kind` 为
 * `plugin:session-state`（session format v4 的 producer-owned source kind）。
 */
export function injectedMessage(text, sessionId) {
  return deepFreeze({
    id: `session-state-${sessionId}-${Date.now()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: `plugin:${name}` },
  })
}

/**
 * 消费一次重注入待办（apply 的 pre-step 与 selftest 共用的纯通道）。
 *
 * 规则：无 pending → 原样返回；有 pending 但本步无真实 user 消息 → 保留 pending
 * 等下一个用户消息；有真实 user 消息 → **必清 pending**（空状态/同轮已注入也清，
 * 防每个用户消息轮空转），且仅在「本轮未注入过 + 渲染得出内容」时插入消息，
 * 插入位置 = 最后一条真实 user 消息之前。
 * @param sessionId - 会话 id。
 * @param messages - 本步最终消息数组（decision.messages）。
 * @param cfg - 见 {@link DEFAULT_CONFIG}。
 * @param dir - 状态目录覆盖（测试用）。
 * @returns `{ messages, injected }`：`injected=true` 时 messages 为含摘要的新数组。
 */
export function consumeReinject(sessionId, messages, cfg = {}, dir) {
  const id = String(sessionId ?? '')
  const list = Array.isArray(messages) ? messages : []
  if (id === '' || isExcluded(id)) return { messages: list, injected: false }
  const state = readState(id, dir)
  if (!state.reinjectPending) return { messages: list, injected: false }

  let lastUser = -1
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.source?.kind === 'user') {
      lastUser = i
      break
    }
  }
  if (lastUser < 0) return { messages: list, injected: false }

  clearReinjectPending(id, dir)
  if (state.digestShown) return { messages: list, injected: false }
  const text = renderStickyState(state, cfg)
  if (text === null) return { messages: list, injected: false }

  markDigestShown(id, dir)
  const next = [...list]
  next.splice(lastUser, 0, injectedMessage(text, id))
  return { messages: next, injected: true }
}

/**
 * 装载插件：压缩生命周期（释放 / 置待办） + 下一个真实用户消息前的粘性摘要注入。
 * @param ctx - host 作用域的插件上下文。
 * @param config - 见 {@link DEFAULT_CONFIG}。
 */
export function apply(ctx, config) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) }

  const sessionIdOf = (agent) => {
    const id = String(agent?.id ?? agent?.session?.id ?? '')
    // 子代理不落盘不注入：每次触碰重判 origin 并补回排除集（淘汰后立即重建）。
    if (id !== '' && isSubagentAgent(agent)) noteSubagent(id)
    return id
  }

  const onSessionEvent = (session, event) => {
    try {
      const type = event?.type
      if (type !== 'compaction/start' && type !== 'compaction/summary'
        && type !== 'compaction/end') return
      const sessionId = String(session?.id ?? '')
      if (sessionId === '') return
      if (isSubagentAgent(session)) {
        noteSubagent(sessionId)
        return
      }
      if (type === 'compaction/end') {
        // 带 error 的 end = 压缩失败、表层未变（原上下文还在）：不置位。
        const error = event?.data?.error
        if (error === undefined || error === null || error === '') {
          // 先读后置：ctx 与 ctx.root 双注册可能让同一事件走两遍，只在首遍告警。
          if (!isReinjectPending(sessionId)) {
            markReinjectPending(sessionId)
            warn(`压缩完成，已置重注入待办（会话 ${sessionId}）`)
          }
        }
        return
      }
      releaseOnCompaction(sessionId)
    } catch (error) {
      warn(`处理压缩事件失败（fail-open）：${error?.message ?? error}`)
    }
  }

  const onPreStep = async (payload, next) => {
    const decision = await next()
    try {
      if (decision?.kind === 'reject') return decision
      if (payload?.signal?.aborted === true) return decision
      const sessionId = sessionIdOf(payload?.agent)
      if (sessionId === '') return decision
      const result = consumeReinject(sessionId, decision?.messages ?? [], cfg)
      if (!result.injected) return decision
      warn(`已注入粘性状态摘要（会话 ${sessionId}，${result.messages.length} 条消息）`)
      // 必须展开 decision：`startsRequestSeries` 是上游声明的请求序列边界，
      // 丢掉它会把模型消息序列切错（docs/architecture.md:113 的成文约定）。
      return { ...decision, messages: result.messages }
    } catch (error) {
      warn(`pre-step 注入失败（fail-open 放行）：${error?.message ?? error}`)
      return decision
    }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.on('session/event', onSessionEvent),
      ctx.on('agent/pre-step', onPreStep, { prepend: true }),
      ctx.root.on('session/event', onSessionEvent),
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

  warn(`已挂载：状态目录 ${stateDir()}（压缩释放 + 粘性状态重注入，预算 `
    + `${cfg.budgetChars} 字符）`)
}

/**
 * 自检：状态文件读写往返、sticky/released 差异、pending 生命周期、摘要渲染与
 * 400 字符上限、sessionId 路径安全、子代理跳过真跑一遍
 * （`node session-state.mjs --selftest`）。文件 IO 全程走临时目录，不碰真实 DSH_HOME。
 */
function selftest() {
  const failures = []
  let cases = 0
  const check = (label, condition, actual) => {
    cases += 1
    if (condition !== true) failures.push(`✗ ${label}：${actual}`)
  }

  const dir = mkdtempSync(join(tmpdir(), 'bobo-session-state-test-'))
  try {
    // ── sessionId 路径安全 ────────────────────────────────────────────────
    for (const nasty of ['../../evil', 'a/b', 'a\\b', 'C:x', '..', '普通 id 空格']) {
      const file = stateFile(nasty, dir)
      check(`路径安全：${nasty}`, dirname(file) === dir && file.endsWith('.json'), file)
    }
    check('空格被编码', stateFile('a b', dir).endsWith('a%20b.json'), stateFile('a b', dir))

    // ── 读写往返 ─────────────────────────────────────────────────────────
    check('文件不存在返回默认值',
      JSON.stringify(readState('roundtrip', dir)) === JSON.stringify(defaultState()),
      JSON.stringify(readState('roundtrip', dir)))
    patchState('roundtrip', { meta: { cwd: 'E:/work' } }, dir)
    check('patchState 往返 meta', readState('roundtrip', dir).meta.cwd === 'E:/work',
      JSON.stringify(readState('roundtrip', dir).meta))
    noteGate('roundtrip', 'reverse', '逆向模式经验闸门', dir)
    const gates = readState('roundtrip', dir).gates
    check('noteGate 写入 label', gates.reverse?.label === '逆向模式经验闸门',
      JSON.stringify(gates))
    check('noteGate 写入 at', typeof gates.reverse?.at === 'number', typeof gates.reverse?.at)
    noteGate('roundtrip', 'collab', '多Agent协作闸门', dir)
    check('多个闸门共存', Object.keys(readState('roundtrip', dir).gates).length === 2,
      JSON.stringify(Object.keys(readState('roundtrip', dir).gates)))

    // ── sticky vs released（compaction 释放下的差异）─────────────────────
    markDigestShown('roundtrip', dir)
    markReinjectPending('roundtrip', dir)
    releaseOnCompaction('roundtrip', dir)
    releaseOnCompaction('roundtrip', dir) // 幂等：重复释放无副作用
    const released = readState('roundtrip', dir)
    check('released：digestShown 被清', released.digestShown === false, released.digestShown)
    check('sticky：gates 保留', released.gates.reverse?.label === '逆向模式经验闸门',
      JSON.stringify(released.gates))
    check('sticky：meta 保留', released.meta.cwd === 'E:/work', JSON.stringify(released.meta))
    check('sticky：reinjectPending 不被 release 清（end 才置位，清了会打断重注入）',
      released.reinjectPending === true, released.reinjectPending)
    clearReinjectPending('roundtrip', dir)

    // ── pending 生命周期：置位 → 注入 → 清空 ─────────────────────────────
    const user1 = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '早' }] }
    const pluginMsg = {
      role: 'user', source: { kind: 'plugin:context-facts' }, content: [{ type: 'text', text: '插件' }],
    }
    const user2 = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '晚' }] }
    const round = [user1, pluginMsg, user2]

    markReinjectPending('life', dir)
    check('pending 置位', isReinjectPending('life', dir) === true, isReinjectPending('life', dir))
    noteGate('life', 'reverse', 'R闸门', dir)
    const first = consumeReinject('life', round, {}, dir)
    check('注入成功', first.injected === true, first.injected)
    check('插入位置 = 最后一条真实 user 消息之前',
      first.messages.length === 4 && first.messages[3] === user2
        && first.messages[2]?.source?.kind === 'plugin:session-state',
      JSON.stringify(first.messages.map((m) => m?.source?.kind)))
    const injected = first.messages[2]
    check('注入消息 source 形态（v4 producer-owned kind）',
      injected?.source?.kind === 'plugin:session-state',
      JSON.stringify(injected?.source))
    check('注入消息深冻结', Object.isFrozen(injected) === true && Object.isFrozen(injected.content[0]),
      Object.isFrozen(injected))
    check('注入正文含闸门 label', typeof injected?.content?.[0]?.text === 'string'
      && injected.content[0].text.includes('R闸门'), injected?.content?.[0]?.text)
    check('注入后 pending 清空', isReinjectPending('life', dir) === false,
      isReinjectPending('life', dir))
    check('注入后 digestShown 置位', readState('life', dir).digestShown === true,
      readState('life', dir).digestShown)
    const second = consumeReinject('life', round, {}, dir)
    check('二次消费不再注入（pending 已清）',
      second.injected === false && second.messages === round, second.injected)

    // 空状态也清 pending（防空转）：置位但没有任何可渲染内容
    markReinjectPending('empty', dir)
    const emptyRun = consumeReinject('empty', [user1], {}, dir)
    check('空状态不注入', emptyRun.injected === false, emptyRun.injected)
    check('空状态也清 pending', isReinjectPending('empty', dir) === false,
      isReinjectPending('empty', dir))
    check('空状态不置 digestShown', readState('empty', dir).digestShown === false,
      readState('empty', dir).digestShown)

    // 无真实用户消息（纯插件轮）：pending 保留，等下一个真实用户消息
    markReinjectPending('nouser', dir)
    const toolRun = consumeReinject('nouser', [pluginMsg], {}, dir)
    check('无真实用户消息不注入', toolRun.injected === false, toolRun.injected)
    check('无真实用户消息保留 pending', isReinjectPending('nouser', dir) === true,
      isReinjectPending('nouser', dir))
    clearReinjectPending('nouser', dir)

    // 同轮已注入过（digestShown=true 时 pending 被意外重置）：只清 pending 不重复注入
    markDigestShown('guard', dir)
    markReinjectPending('guard', dir)
    noteGate('guard', 'collab', 'C闸门', dir)
    const guardRun = consumeReinject('guard', [user1], {}, dir)
    check('同轮已注入不重复', guardRun.injected === false, guardRun.injected)
    check('同轮消费仍清 pending', isReinjectPending('guard', dir) === false,
      isReinjectPending('guard', dir))

    // ── 摘要渲染与 400 字符上限 ──────────────────────────────────────────
    const many = { gates: {} }
    for (let i = 0; i < 20; i++) {
      many.gates[`g${i}`] = { label: `第${i}号协作闸门的展示名称要足够长以便撑爆默认预算上限`, at: Date.now() }
    }
    const rendered = renderStickyState(many, {})
    check('默认预算（400）下不超限', typeof rendered === 'string' && rendered.length <= 400,
      typeof rendered === 'string' ? rendered.length : String(rendered))
    check('渲染含标题', typeof rendered === 'string' && rendered.includes('压缩后粘性状态恢复'),
      rendered?.slice(0, 40))
    check('渲染含首个闸门', typeof rendered === 'string' && rendered.includes('第0号协作闸门'),
      rendered?.slice(0, 80))
    check('超预算截断带省略号', typeof rendered === 'string' && rendered.includes('…'),
      rendered?.slice(-20))
    const tiny = renderStickyState(many, { budgetChars: 60 })
    check('小预算截断后 ≤60', typeof tiny === 'string' && tiny.length <= 60,
      typeof tiny === 'string' ? tiny.length : String(tiny))
    const single = renderStickyState({ gates: { r: { label: 'R闸门', at: 1 } } }, {})
    check('单闸门完整渲染', single === '=== 压缩后粘性状态恢复 ===\n已激活闸门（压缩后仍生效）：R闸门',
      single)
    check('空闸门返回 null', renderStickyState(defaultState(), {}) === null,
      renderStickyState(defaultState(), {}))
    check('预算 ≤0 返回 null', renderStickyState(many, { budgetChars: 0 }) === null,
      renderStickyState(many, { budgetChars: 0 }))

    // ── 子代理会话跳过 ───────────────────────────────────────────────────
    check('识别 agent 形态子代理',
      isSubagentAgent({ session: { header: { origin: 'subagent' } } }) === true, '未识别')
    check('识别 session 形态子代理',
      isSubagentAgent({ header: { origin: 'subagent' } }) === true, '未识别')
    check('主会话不误判（无 parentSession 陷阱）',
      isSubagentAgent({ session: { header: { parentSession: 'p', origin: undefined } } }) === false,
      '误判')
    check('空对象返回 false', isSubagentAgent(undefined) === false, '误判')
    noteSubagent('sub1')
    check('排除集生效', isExcluded('sub1') === true, isExcluded('sub1'))
    noteGate('sub1', 'reverse', '不应写入', dir)
    patchState('sub1', { meta: { x: 1 } }, dir)
    markReinjectPending('sub1', dir)
    markDigestShown('sub1', dir)
    check('子代理不落盘 gates', readState('sub1', dir).gates.reverse === undefined,
      JSON.stringify(readState('sub1', dir).gates))
    check('子代理不落盘 pending', isReinjectPending('sub1', dir) === false,
      isReinjectPending('sub1', dir))
    check('子代理 pending 置位被跳过（不注入的前提）',
      consumeReinject('sub1', [user1], {}, dir).injected === false, '注入了')

    // ── 坏 JSON / 状态目录降级 ───────────────────────────────────────────
    writeFileSync(stateFile('bad', dir), '{ 不是 JSON', 'utf8')
    check('坏 JSON 返回默认值',
      JSON.stringify(readState('bad', dir)) === JSON.stringify(defaultState()),
      JSON.stringify(readState('bad', dir)))
    check('DSH_HOME 缺省降级 os.tmpdir',
      stateDir({}) === join(tmpdir(), 'bobo-session-state'), stateDir({}))
    check('DSH_HOME 存在时落其下',
      stateDir({ DSH_HOME: 'X:/dsh' }) === join('X:/dsh', 'bobo-session-state'),
      stateDir({ DSH_HOME: 'X:/dsh' }))
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 临时目录清理失败不影响判定 */
    }
  }

  // 注入消息 source 形态（session format v4 producer-owned kind）
  const sample = injectedMessage('自检', 'sample')
  check('注入消息 source.kind 为非空字符串且 ≠ plugin',
    typeof sample.source.kind === 'string' && sample.source.kind !== '' && sample.source.kind !== 'plugin',
    JSON.stringify(sample.source))
  check('注入消息 source.kind 为 plugin:session-state', sample.source.kind === 'plugin:session-state',
    sample.source.kind)

  if (failures.length > 0) {
    console.error(`session-state selftest 失败：${failures.length}/${cases} 项`)
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
    return
  }
  console.log(`session-state selftest 通过：${cases} 项判据全部符合预期`)
}

if (process.argv[1] && process.argv[1].endsWith('session-state.mjs')
  && process.argv.includes('--selftest')) {
  selftest()
}
