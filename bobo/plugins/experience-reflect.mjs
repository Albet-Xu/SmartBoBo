/**
 * experience-reflect —— 长工具链收尾后的「经验沉淀反思」轻量触发。
 *
 * ## 解决什么问题
 *
 * 经验沉淀目前靠强制闸门（docs/说明文档/功能实现/37-逆向经验强制闸门操作指南.md），
 * 但闸门只盯它自己拦住的那几条工具路径（debug_close / write 等）；连续长工具作业里
 * 产生的、闸门视野之外的可沉淀经验没有低成本的提醒机制。借鉴开源 dsh-meow-memory 的
 * reflect：一轮里连续工具步攒够了，收尾时用一次轻量 `agent.followup` 问模型
 * 「有没有值得沉淀的」——没有就简单回一句，不强制、不拦截、不入库。
 *
 * ## 触发条件（全部满足才发 followup；判定在 createReflectCore.evaluate）
 *
 * 1. **非子代理会话**：`agent.session.header.origin !== 'subagent'`。权威标记由
 *    subagent/src/child-agent.ts:153 写入 meta、core/session/src/types.ts:115 定义。
 *    借鉴 meow index.ts:1313 的 origin 排除与 index.ts:1114 注释的真机套娃案例
 *    （子会话再反思 → 反思再产生活动 → 递归）。计数阶段也跳过子代理（observe 入口判）。
 * 2. **收尾原因不是 aborted/interrupted（用户中止绝不反思）**：本 fork 的
 *    `agent/turn-stopping` 只在正常收尾时派发——agent-loop/src/agent.ts:354-362：
 *    中止/出错在 dispatch 前已由 `signal.throwIfAborted()` / catch 重抛带走，走不到
 *    本事件；`interrupted` 只由冷读与崩溃恢复事后合成，live 循环从不发
 *    （core/session/src/types.ts:222-226 "the loop never emits this marker live"）。
 *    运行期再兜一层 `payload.signal.aborted`（dispatch 是 await，监听期间用户可能按停）。
 *    **不学 meow 读 lastTurnEndReason**：本 fork 的 `turn/end` 在 dispatch 之后才在
 *    finally 里 append（agent.ts:386-391），此刻读到的只是上一轮的原因，会误伤本轮。
 * 3. **本 turn 连续工具步 ≥ config.reflectTurns（默认 7）**：从上一个 `turn/start`
 *    之后的会话事件里数 `tool/call`，增量维护、不回读历史——同步读全量事件已被上游
 *    明令废弃（.agents/notes/implemented/architecture/
 *    2026-09-09-deprecate-synchronous-session-event-reads.md：新调用一律禁止）。
 *    计数镜像 meow src/reflect.ts:78-104：每个 tool/call 计 1 步（同一 assistant
 *    消息里的并行调用逐个计）、沉淀类工具把当前段清零、取本轮最大段；纯文本步不计
 *    也不打断（段只被沉淀动作打断，与 meow 同口径）。
 * 4. **本轮最后一个工具不在 config.depositTools**：刚沉淀过就不再追问
 *    （meow 同款：末位是 memory_ 工具即不反思）。
 * 5. **同一 turn 判重**（Map<sessionId, turn>）：meow issue #19 的教训——
 *    turn-stopping 在一次收尾窗口会多次触发（steer 续命后再触发；本插件又按房规在
 *    ctx 与 ctx.root 双注册，事件可能重复投递），不判重会连发多条反思。
 * 6. **不是自己发出的反思轮**：本轮含 `source.kind === 'plugin:experience-reflect'` 的
 *    user/message（followup 落进下一 turn）即反思轮自身，不再追问（镜像 meow sawReflect）。
 *
 * 另一条 fail-open 方向的不触发：插件挂载前的事件看不到，计数只小不大；
 * 会话状态缺失（no-state）一律不反思。
 *
 * ## 动作
 *
 * `agent.followup(消息)`（core/agent-loop/src/agent.ts:163-165：排进 next-turn 并
 * 唤醒驱动，当前轮正常收束后另起一轮）注入一段中文提示（config.prompt，预设行可覆盖），
 * 引导模型自查最近的连续操作，按**本模式既有沉淀机制**记录经验；没有就简单回复，
 * 不许硬造。消息形状：content + source.kind='plugin:experience-reflect'
 * （session format v4 的 producer-owned source kind）。
 *
 * ## 挂载
 *
 * 只挂「有沉淀机制」的自建预设（reverse / workflow / report / empirical / experiment /
 * modeling / review 各一行，agent.cordis.yml 与 decl.yml 成对，照 collab-gate 行格式）；
 * crawl 没有任何经验库、刻意不挂；不挂 host 层——避免 11 个预设全被骚扰。
 *
 * ## 契约 / fail-open
 *
 * - 只在 turn-stopping 里追加一次 followup：不拦截、不 deny、不改写任何决策；
 * - turn-stopping 监听器整体 try/catch：serial 监听器抛错会把本轮收尾变成 error
 *   （agent.ts:360 的 dispatch → tests/contract-regressions.spec.ts:357 实证），绝不允许；
 * - 计数状态按会话隔离、Map 带上限；会话日志重开（seq 回退）时整账重计；
 * - 任何异常都退化为「不反思」，绝不影响收尾与消息入队。
 *
 * 预设过滤：双注册（ctx + ctx.root）会收到其它预设的会话，入口以
 * `config.preset` 与 `agentPresets.composedPreset(agent.ctx)` 比对，
 * 取不到（未挂预设 / 子代理未随父加入 / 服务缺席）一律不反思（fail-closed）。
 * 排障：`node experience-reflect.mjs --selftest`；运行期留痕前缀 `[experience-reflect]`。
 */
import { randomUUID } from 'node:crypto'

export const name = 'experience-reflect'

/** 事件入口守卫要读 agentPresets 判定会话所属预设。 */
export const inject = ['agentPresets']

/** 可覆盖的默认配置（预设行按本模式的真实沉淀工具与话术覆盖）。 */
export const DEFAULT_CONFIG = {
  /** 本实例所属预设 id（预设行 `config.preset`）：只处理该预设的会话，留空一律不处理（fail-closed）。 */
  preset: '',
  /** 本轮连续工具步达到这个数才追问（与 meow reflect 默认一致）。 */
  reflectTurns: 7,
  /**
   * 「已是沉淀动作」的工具（模型侧精确名）：计数时清零连续段，且末位命中即不追问。
   * 默认是本项目三个经验库家族的真实沉淀工具，出处逐条列出：
   * - 逆向三实例：reverse-memory-gate 预设行 saveTool（reverse:172 / workflow:235）+
   *   实证模式的读写实例（empirical:233-239 serverName reverse-memory-empirical），
   *   服务端实现 scripts/reverse_memory_server.py:107（def reverse_memory_save）；
   * - 论文四实例：paper-experience-gate 预设行 saveTool（empirical:194 /
   *   experiment:133 / modeling:131 / review:131），服务端 scripts/paper_memory_server.py:154；
   * - 汇报：report-memory-gate 预设行（report:57-58），服务端
   *   scripts/report_memory_server.py:156/262；save 与 feedback 都算沉淀——闸门自己把
   *   feedbackTool 记作 saved（report-memory-gate.mjs:174-176）。
   */
  depositTools: [
    'mcp__reverse-memory__reverse_memory_save',
    'mcp__reverse-memory-wf__reverse_memory_save',
    'mcp__reverse-memory-empirical__reverse_memory_save',
    'mcp__paper-memory-empirical__paper_experience_save',
    'mcp__paper-memory-experiment__paper_experience_save',
    'mcp__paper-memory-modeling__paper_experience_save',
    'mcp__paper-memory-review__paper_experience_save',
    'mcp__report-memory__report_experience_save',
    'mcp__report-memory__report_experience_feedback',
  ],
  /** 追问话术（预设行按本模式沉淀入口覆盖）；空串回落到这里。 */
  prompt: '【经验沉淀反思】刚才这一轮你连续做了多步工具操作，请简短自查：有没有值得按本模式既有沉淀机制'
    + '记录的经验（踩过的坑、可复用的做法、失败教训）？\n'
    + '有就按本模式的沉淀流程入库；确实没有就直接回复「无可沉淀」，'
    + '不要编造、不要为了沉淀而沉淀。',
  /** 计数状态保留的会话数上限（超出丢最旧）。 */
  maxSessions: 200,
  /** turn 判重表保留的会话数上限（meow 同款兜底，防长跑进程无限增长）。 */
  maxTrackedTurns: 512,
}

/**
 * 组装 followup 消息正文：config.prompt 非空用它，空/空白回落默认话术。
 * @param config - 见 {@link DEFAULT_CONFIG}。
 * @returns 要注入的提示文本（trim 后非空）。
 */
export function buildMessage(config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) }
  const text = typeof cfg.prompt === 'string' ? cfg.prompt.trim() : ''
  return text !== '' ? text : DEFAULT_CONFIG.prompt.trim()
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
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

/**
 * 构造 followup 的 user 消息（content + source.kind='plugin:experience-reflect'，
 * session format v4 的 producer-owned 形态，冻结后交给 inbox，
 * 见 context-facts / collab-gate 的同名函数）。
 * @param text - {@link buildMessage} 的产物。
 * @returns 只读 UserMessage 形状的对象。
 */
export function injectedMessage(text) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: `plugin:${name}` },
  })
}

/**
 * 反思核心（纯逻辑，不接触 dsh，便于单独验证）。
 *
 * `observe` 消费会话事件流（turn/start / tool/call / user/message），按会话增量维护
 * 「本轮最大连续段」与「本轮末位工具」；`evaluate` 做六条触发判定并在放行时登记判重。
 * @param config - 见 {@link DEFAULT_CONFIG}；缺省项由默认值补齐。
 * @param log - `{ warn(message) }`，可选。
 * @returns `observe`、`evaluate`、`state`（排障用，不创建状态）。
 */
export function createReflectCore(config = {}, log = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) }
  const warn = typeof log.warn === 'function' ? log.warn : () => {}
  const deposit = new Set((Array.isArray(cfg.depositTools) ? cfg.depositTools : [])
    .filter(tool => typeof tool === 'string' && tool !== ''))
  const sessions = new Map()
  /** 判重键：sessionId → 最近一次已发反思的 turn（meow issue #19）。 */
  const reflected = new Map()

  const session = (id) => {
    let state = sessions.get(id)
    if (state === undefined) {
      while (sessions.size >= cfg.maxSessions && sessions.size > 0) {
        sessions.delete(sessions.keys().next().value)
      }
      state = { lastSeq: -1, steps: 0, best: 0, lastTool: '', sawOwn: false }
      sessions.set(id, state)
    }
    return state
  }

  const reset = (state) => {
    state.lastSeq = -1
    state.steps = 0
    state.best = 0
    state.lastTool = ''
    state.sawOwn = false
  }

  return {
    /**
     * 消费一条会话事件（增量计数；同 seq 的重复投递只算一次）。
     *
     * 只关心三类事件，其余类型不建状态（省 Map churn）。双注册（ctx + ctx.root）
     * 会把同一条事件投递两次，靠 seq 判重；seq 回退视为会话日志重开，整账重计，
     * 避免旧 best 在新日志里误触发。
     * @param request - `{ sessionId, type, seq, data }`。
     */
    observe({ sessionId = '', type = '', seq, data } = {}) {
      if (sessionId === '') return
      if (type !== 'turn/start' && type !== 'tool/call' && type !== 'user/message') return
      const state = session(sessionId)
      const value = typeof seq === 'number' ? seq : state.lastSeq + 1
      if (value < state.lastSeq) reset(state)
      if (value <= state.lastSeq) return
      state.lastSeq = value

      if (type === 'turn/start') {
        state.steps = 0
        state.best = 0
        state.lastTool = ''
        state.sawOwn = false
        return
      }
      if (type === 'tool/call') {
        const tool = String(data?.name ?? '')
        if (tool === '') return
        // 沉淀动作清零当前段（已主动沉淀，不再追问），但不回拨历史最大段。
        if (deposit.has(tool)) state.steps = 0
        else {
          state.steps += 1
          if (state.steps > state.best) state.best = state.steps
        }
        state.lastTool = tool
        return
      }
      // user/message：本插件自己发出的 followup 落进下一轮 → 那是反思轮自身。
      if (data?.source?.kind === `plugin:${name}`) state.sawOwn = true
    },

    /**
     * 收尾判定：全部条件满足才放行，并在放行时登记 turn 判重。
     * @param request - `{ sessionId, turn, origin, aborted }`（接 turn-stopping 载荷）。
     * @returns `{ reflect: boolean, reason: string }`，reason 供自检与排障对上号。
     */
    evaluate({ sessionId = '', turn, origin, aborted = false } = {}) {
      const deny = (reason) => ({ reflect: false, reason })
      if (aborted === true) return deny('aborted')
      if (origin === 'subagent') return deny('subagent')
      if (sessionId === '' || typeof turn !== 'number') return deny('no-session')
      if (reflected.get(sessionId) === turn) return deny('same-turn')
      const state = sessions.get(sessionId)
      if (state === undefined) return deny('no-state')
      if (state.sawOwn === true) return deny('own-followup-turn')
      if (!(state.best >= cfg.reflectTurns)) return deny('below-threshold')
      if (state.lastTool !== '' && deposit.has(state.lastTool)) return deny('last-tool-deposit')

      reflected.set(sessionId, turn)
      while (reflected.size > cfg.maxTrackedTurns && reflected.size > 0) {
        reflected.delete(reflected.keys().next().value)
      }
      warn(`[experience-reflect] 会话 ${sessionId} turn ${turn} 通过反思判定`
        + `（连续工具步 ${state.best} ≥ ${cfg.reflectTurns}，末位 ${state.lastTool || '无'}）`)
      return { reflect: true, reason: 'ok' }
    },

    /** 排障/自检：读取会话计数状态（不创建）；无状态返回 null。 */
    state: (sessionId = '') => sessions.get(sessionId) ?? null,
  }
}

/**
 * 装载：订阅会话事件计数与收尾判定。
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
      /* 日志不可用不能影响反思判定 */
    }
  }
  const core = createReflectCore(cfg, { warn })

  // 计数：子代理会话不建账（observe 入口再判一次 origin，成本一次字符串比较）。
  const onSessionEvent = (session, event) => {
    try {
      const sessionId = String(session?.id ?? '')
      if (sessionId === '') return
      if (session?.header?.origin === 'subagent') return
      core.observe({ sessionId, type: event?.type, seq: event?.seq, data: event?.data })
    } catch {
      /* 计数失败绝不影响会话事件派发 */
    }
  }

  // 收尾：本监听器绝不允许抛错——serial 链上的异常会把本轮收尾变成 error。
  const onTurnStopping = (payload) => {
    try {
      const agent = payload?.agent
      if (agent === undefined || agent === null) return
      // 预设守卫：多实例各自挂 root 监听，非本预设的会话不反思（fail-closed）。
      if (!ownAgent(agent)) return
      const decision = core.evaluate({
        sessionId: String(agent?.session?.id ?? agent?.id ?? ''),
        turn: payload?.turn,
        origin: agent?.session?.header?.origin,
        aborted: payload?.signal?.aborted === true,
      })
      if (decision.reflect !== true) return
      agent.followup(injectedMessage(buildMessage(cfg)))
      warn(`[experience-reflect] 已为会话排入经验沉淀反思 followup（turn ${payload?.turn}）`)
    } catch (error) {
      warn(`[experience-reflect] turn-stopping 处理失败（已忽略，不影响收尾）: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  ctx.effect(() => {
    // 双注册（ctx + ctx.root）是本仓库房规：事件沿派发上下文向根冒泡，派发点不在
    // 本插件子树时只有 root 监听器收得到；落在子树内则两个都收到——重复投递由
    // seq 判重与 turn 判重吸收。
    const disposers = [
      ctx.on('session/event', onSessionEvent),
      ctx.on('agent/turn-stopping', onTurnStopping),
      ctx.root.on('session/event', onSessionEvent),
      ctx.root.on('agent/turn-stopping', onTurnStopping),
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

  warn(`[experience-reflect] 已挂载：本轮连续工具步 ≥ ${cfg.reflectTurns} 且末位非沉淀工具时，`
    + `收尾追问一次（沉淀工具 ${cfg.depositTools.length} 个）`)
}

/**
 * 自检：连续步计数（含沉淀清零、并行逐个计、seq 判重与回退重开）、
 * 触发条件六条分支与 prompt 组装（`node experience-reflect.mjs --selftest`）。
 * 不接真实会话系统——计数与判定全是纯逻辑。
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

  const DEPOSIT = 'mcp__reverse-memory__reverse_memory_save'
  const base = {
    reflectTurns: 7,
    depositTools: [DEPOSIT],
    prompt: '自检话术',
    ...cfg,
  }
  const quiet = { warn: () => {} }

  // 事件构造器：seq 单调递增（同一 core 内模拟真实日志序）。
  const mk = () => {
    let seq = 0
    return (type, data) => ({ type, seq: ++seq, data })
  }

  // ── 1) 连续步计数：达标段 ─────────────────────────────────────────────
  const c1 = createReflectCore(base, quiet)
  const e1 = mk()
  c1.observe({ sessionId: 'a', ...e1('turn/start', { turn: 1 }) })
  for (let i = 0; i < 7; i++) {
    c1.observe({ sessionId: 'a', ...e1('tool/call', { turn: 1, step: 1, name: 'read' }) })
  }
  check('连续 7 个普通工具 = best 7', c1.state('a')?.best === 7, c1.state('a')?.best)
  check('末位工具被记下', c1.state('a')?.lastTool === 'read', c1.state('a')?.lastTool)

  // ── 2) 沉淀工具清零当前段 + 取最大段（不是末段）────────────────────────
  const c2 = createReflectCore(base, quiet)
  const e2 = mk()
  c2.observe({ sessionId: 'b', ...e2('turn/start', { turn: 1 }) })
  for (let i = 0; i < 4; i++) c2.observe({ sessionId: 'b', ...e2('tool/call', { name: 'read' }) })
  c2.observe({ sessionId: 'b', ...e2('tool/call', { name: DEPOSIT }) })
  for (let i = 0; i < 3; i++) c2.observe({ sessionId: 'b', ...e2('tool/call', { name: 'read' }) })
  check('沉淀动作清零连续段（后 3 段 < 前 4）', c2.state('b')?.best === 4, c2.state('b')?.best)
  check('沉淀后新段从 1 起算', c2.state('b')?.steps === 3, c2.state('b')?.steps)
  check('末位是普通工具', c2.state('b')?.lastTool === 'read', c2.state('b')?.lastTool)

  // ── 3) 并行调用逐个计（同一 step 的多个 tool/call 各算 1 步）────────────
  const c3 = createReflectCore(base, quiet)
  const e3 = mk()
  c3.observe({ sessionId: 'p', ...e3('turn/start', { turn: 1 }) })
  for (let i = 0; i < 3; i++) {
    c3.observe({ sessionId: 'p', ...e3('tool/call', { turn: 1, step: 1, name: 'read' }) })
  }
  check('同 step 并行 3 次调用逐个计', c3.state('p')?.best === 3, c3.state('p')?.best)

  // ── 4) turn/start 重置本轮 ─────────────────────────────────────────────
  c3.observe({ sessionId: 'p', ...e3('turn/start', { turn: 2 }) })
  check('新一轮计数清零', c3.state('p')?.best === 0 && c3.state('p')?.lastTool === '',
    `best=${c3.state('p')?.best} last=${c3.state('p')?.lastTool}`)
  c3.observe({ sessionId: 'p', ...e3('tool/call', { name: 'read' }) })
  check('新一轮正常累计', c3.state('p')?.best === 1, c3.state('p')?.best)

  // ── 5) 双注册重复投递：同 seq 只算一次 ─────────────────────────────────
  const c4 = createReflectCore(base, quiet)
  const dup = { type: 'tool/call', seq: 2, data: { name: 'read' } }
  c4.observe({ sessionId: 'd', type: 'turn/start', seq: 1, data: { turn: 1 } })
  c4.observe({ sessionId: 'd', ...dup })
  c4.observe({ sessionId: 'd', ...dup })
  check('同 seq 重复投递只计一次', c4.state('d')?.best === 1, c4.state('d')?.best)

  // ── 6) seq 回退 = 会话日志重开：整账重计，旧 best 不误触发 ──────────────
  const c5 = createReflectCore(base, quiet)
  c5.observe({ sessionId: 'r', type: 'turn/start', seq: 1, data: { turn: 1 } })
  for (let i = 0; i < 8; i++) {
    c5.observe({ sessionId: 'r', type: 'tool/call', seq: 2 + i, data: { name: 'read' } })
  }
  check('重开前已达标', c5.state('r')?.best === 8, c5.state('r')?.best)
  c5.observe({ sessionId: 'r', type: 'turn/start', seq: 1, data: { turn: 1 } })
  check('seq 回退触发整账重计', c5.state('r')?.best === 0 && c5.state('r')?.lastSeq === 1,
    `best=${c5.state('r')?.best} seq=${c5.state('r')?.lastSeq}`)

  // ── 7) 沉淀工具精确匹配（前缀相近不误伤）────────────────────────────────
  const c6 = createReflectCore(base, quiet)
  const e6 = mk()
  c6.observe({ sessionId: 'x', ...e6('turn/start', { turn: 1 }) })
  c6.observe({ sessionId: 'x', ...e6('tool/call', { name: 'mcp__reverse-memory-empirical__reverse_memory_save' }) })
  check('前缀相近的经验库工具不算沉淀（精确匹配）',
    c6.state('x')?.steps === 1 && c6.state('x')?.lastTool !== DEPOSIT, c6.state('x')?.steps)

  // ── 8) 触发条件分支 ────────────────────────────────────────────────────
  // 满分状态：best=8、末位普通工具。
  const good = createReflectCore(base, quiet)
  good.observe({ sessionId: 'g', type: 'turn/start', seq: 1, data: { turn: 1 } })
  for (let i = 0; i < 8; i++) {
    good.observe({ sessionId: 'g', type: 'tool/call', seq: 2 + i, data: { name: 'read' } })
  }
  check('满分状态放行', good.evaluate({ sessionId: 'g', turn: 1 }).reflect === true,
    JSON.stringify(good.evaluate({ sessionId: 'g', turn: 1 })))
  check('同 turn 判重（第二次拒绝）',
    good.evaluate({ sessionId: 'g', turn: 1 }).reason === 'same-turn',
    good.evaluate({ sessionId: 'g', turn: 1 }).reason)
  check('换 turn 放行（判重键按 turn 而非布尔闩）',
    good.evaluate({ sessionId: 'g', turn: 2 }).reflect === true,
    good.evaluate({ sessionId: 'g', turn: 2 }).reason)

  check('用户中止不反思', good.evaluate({ sessionId: 'g', turn: 3, aborted: true }).reason === 'aborted',
    good.evaluate({ sessionId: 'g', turn: 3, aborted: true }).reason)
  check('子代理会话不反思',
    good.evaluate({ sessionId: 'g', turn: 3, origin: 'subagent' }).reason === 'subagent',
    good.evaluate({ sessionId: 'g', turn: 3, origin: 'subagent' }).reason)
  check('无状态会话不反思',
    good.evaluate({ sessionId: '从未见过的会话', turn: 1 }).reason === 'no-state',
    good.evaluate({ sessionId: '从未见过的会话', turn: 1 }).reason)
  check('缺 turn 不反思', good.evaluate({ sessionId: 'g' }).reason === 'no-session',
    good.evaluate({ sessionId: 'g' }).reason)

  // 不足阈值：best 恰好 6（<7）。
  const low = createReflectCore(base, quiet)
  low.observe({ sessionId: 'l', type: 'turn/start', seq: 1, data: { turn: 1 } })
  for (let i = 0; i < 6; i++) low.observe({ sessionId: 'l', type: 'tool/call', seq: 2 + i, data: { name: 'read' } })
  check('不足阈值不反思', low.evaluate({ sessionId: 'l', turn: 1 }).reason === 'below-threshold',
    low.evaluate({ sessionId: 'l', turn: 1 }).reason)
  // 阈值边界：恰好 7 放行。
  const edge = createReflectCore(base, quiet)
  edge.observe({ sessionId: 'e', type: 'turn/start', seq: 1, data: { turn: 1 } })
  for (let i = 0; i < 7; i++) edge.observe({ sessionId: 'e', type: 'tool/call', seq: 2 + i, data: { name: 'read' } })
  check('恰好等于阈值放行', edge.evaluate({ sessionId: 'e', turn: 1 }).reflect === true,
    edge.evaluate({ sessionId: 'e', turn: 1 }).reason)

  // 末位是沉淀工具：8 步后沉淀 → 不反思。
  const dep = createReflectCore(base, quiet)
  dep.observe({ sessionId: 'w', type: 'turn/start', seq: 1, data: { turn: 1 } })
  for (let i = 0; i < 8; i++) dep.observe({ sessionId: 'w', type: 'tool/call', seq: 2 + i, data: { name: 'read' } })
  dep.observe({ sessionId: 'w', type: 'tool/call', seq: 10, data: { name: DEPOSIT } })
  check('末位是沉淀工具不反思',
    dep.evaluate({ sessionId: 'w', turn: 1 }).reason === 'last-tool-deposit',
    dep.evaluate({ sessionId: 'w', turn: 1 }).reason)

  // 反思轮自身：本轮含本插件注入的 user/message → 不再追问。
  const own = createReflectCore(base, quiet)
  own.observe({ sessionId: 'o', type: 'turn/start', seq: 1, data: { turn: 1 } })
  own.observe({
    sessionId: 'o',
    type: 'user/message',
    seq: 2,
    data: { role: 'user', content: [], source: { kind: 'plugin:experience-reflect' } },
  })
  check('反思轮自身不追问',
    own.evaluate({ sessionId: 'o', turn: 1 }).reason === 'own-followup-turn',
    own.evaluate({ sessionId: 'o', turn: 1 }).reason)
  // 真实用户消息不算反思轮。
  const real = createReflectCore(base, quiet)
  real.observe({ sessionId: 'u', type: 'turn/start', seq: 1, data: { turn: 1 } })
  real.observe({
    sessionId: 'u',
    type: 'user/message',
    seq: 2,
    data: { role: 'user', content: [], source: { kind: 'user' } },
  })
  check('真实用户消息不误判为反思轮',
    real.evaluate({ sessionId: 'u', turn: 1 }).reason === 'below-threshold',
    real.evaluate({ sessionId: 'u', turn: 1 }).reason)

  // ── 9) 会话隔离 ────────────────────────────────────────────────────────
  check('会话隔离：c1 的 a 不影响 c3 的 p',
    c1.state('p') === null && c3.state('a') === null, '串账')
  check('无状态读取返回 null', c1.state('从未出现') === null, '非 null')

  // ── 10) prompt 组装 ────────────────────────────────────────────────────
  check('自定义 prompt 优先', buildMessage({ prompt: '换我来' }) === '换我来', buildMessage({ prompt: '换我来' }))
  check('空白 prompt 回落默认', buildMessage({ prompt: '   ' }).includes('经验沉淀反思'),
    buildMessage({ prompt: '   ' }).slice(0, 20))
  const fallback = buildMessage()
  check('默认话术点名沉淀机制', fallback.includes('沉淀'), fallback.slice(0, 30))
  check('默认话术禁止硬造', fallback.includes('不要编造'), fallback.slice(-30))
  check('默认话术给出无沉淀出口', fallback.includes('无可沉淀'), fallback.slice(-40))

  // ── 11) 注入消息 source 形态（v4 producer-owned kind）+ 预设身份守卫 ────
  const sample = injectedMessage('自检话术')
  check('注入消息 source.kind 为非空字符串且 ≠ plugin',
    typeof sample.source.kind === 'string' && sample.source.kind !== '' && sample.source.kind !== 'plugin',
    JSON.stringify(sample.source))
  check('注入消息 source.kind 为 plugin:experience-reflect',
    sample.source.kind === 'plugin:experience-reflect', sample.source.kind)
  check('非本预设不发（同预设才放行）',
    ownsPreset('report', 'report') === true && ownsPreset('report', 'crawl') === false,
    `${ownsPreset('report', 'report')}/${ownsPreset('report', 'crawl')}`)
  check('预设未配置 / 取不到一律不发（fail-closed）',
    ownsPreset('', 'report') === false && ownsPreset('report', undefined) === false, 'fail-open')

  return { ok: failures.length === 0, cases, failures }
}

const invokedDirectly = Boolean(process.argv[1]) && process.argv[1].endsWith('experience-reflect.mjs')
if (invokedDirectly && process.argv.includes('--selftest')) {
  const r = selftest()
  console.log(`[experience-reflect] selftest: ${r.ok ? 'PASS' : 'FAIL'}（${r.cases} 例）`)
  for (const line of r.failures) console.error(`  ${line}`)
  process.exit(r.ok ? 0 : 1)
}
