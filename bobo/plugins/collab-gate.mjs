/**
 * collab-gate —— 多Agent协作能力的「懒加载闸门」。
 *
 * 契约：
 * - **三层懒加载**：插件常驻（L1，零提示词成本）→ 协作工具 schema 未激活不进提示词
 *   （L2）→ 协作协议正文由 multi-agent-collab 技能按需加载（L3）。未激活会话的模型
 *   **不知道**这些委派工具存在，简单任务不受协作概念干扰、也不付 schema token。
 * - **展示层过滤，执行层放行**：`filterCollabTools` 只作用于 `system-prompt/assemble`
 *   的工具列表；被滤掉的工具仍在注册表里，模型按名字调用照样成功（与
 *   reverse-memory-gate 的 lazyToolPrefix 同口径）。本插件**不做未激活拦截**——
 *   拦截语义属于各业务闸门（report-gate 的独立评分、outline 闸门等），
 *   这里混入 deny 会与既有闸门的「按名调用 subagent」流程互相卡死。
 * - **协作风味（collabFlavor，主从切换）**：`subagent`（默认路径，委派 subagent/workflow）
 *   或 `team`（插件页「智能体团队」开启时的 Agent Teams 工具面）；`auto`（默认）在
 *   激活/装配时读 `ctx.get('agentTeams')` 是否存在自动选择。两套工具集、两套指引
 *   **不混说**：team 风味滤 team 工具、指引点名 spawn_teammate；subagent 风味维持原样。
 * - **会话级粘性激活**：命中触发信号后本会话永久激活，schema 一次性露出且不再滤回
 *   （反复开关会连续打断 KV 前缀缓存）。触发信号：
 *   1. 用户文本命中 `activationTriggers`（协作形态词）或 `complexityTriggers`（复杂度词）；
 *   2. `activationScanTools` 的参数命中上述词表（todo / plan 产物）；
 *   3. `todo_write` 结构信号：条目数 ≥ `activationTodoMin` **且** 参数或最新用户文本
 *      命中复杂度词（双条件，压误报；`activationTodoMin<=0` 关闭本信号）；
 *   4. 首次按名调用协作工具；
 *   5. 显式技能手势。
 *   激活后注入**一次性**协作指引（自包含协议摘要，按风味分流），此后不再打扰。
 * - **fail-open**：assemble 过滤的任何异常原样返回（最坏 = 退回常驻行为，绝不阻塞装配）。
 * - 判定以 `agent.id`（会话）为隔离单位；未激活时不产生任何提示词痕迹。
 * - **激活态持久化**（相对路径 import `./session-state.mjs`，同一进程 ESM 单例）：
 *   INERT→ACTIVE 首次翻转即 `noteGate('collab')` 落盘；会话首次触碰时从
 *   `<DSH_HOME>/bobo-session-state/<id>.json` 水合 `activated=true`（不置
 *   `guidancePending`——重启不重发一次性指引，上下文里那份还在；压缩后的恢复由
 *   session-state 的粘性摘要负责）。子代理会话不落盘也不水合（session-state 排除集）。
 * - **子代理恒不激活**：全部激活信号在接线层经 `activateFor` 豁免子会话——父任务文本里
 *   的协作触发词落到子会话只是委托内容、不是协作意图。豁免只挡激活与指引注入：
 *   被滤掉的工具仍在注册表里按名调用照样成功（展示层过滤，"不做 deny"的取舍不变）。
 *
 * 挂载：`presets/<id>/agent.cordis.yml`（除 crawl 外的全部预设），相对路径装载；
 * config 全部可选。技能正文在 `dsh/.agents/skills/multi-agent-collab/`（播种到
 * `<DSH_HOME>/skills`）。设计文档：`docs/研究模式调研/04、05`；自动协作落地见
 * `docs/说明文档/功能实现/71-多Agent复杂任务自动协作操作指南.md`。
 * 预设过滤：事件入口比对 `config.preset` 与 `agentPresets.composedPreset(agent.ctx)`，
 * 取不到（未挂预设 / 子代理未随父加入 / 服务缺席）一律不处理（fail-closed）。
 * 排障：后端日志 grep `collab-gate`——挂载、激活原因都会留痕。
 */
import { randomUUID } from 'node:crypto'
import {
  isExcluded, isSubagentAgent, noteGate, noteSubagent, readState as readSessionState,
} from './session-state.mjs'

export const name = 'collab-gate'

/** 事件入口守卫要读 agentPresets 判定会话所属预设。 */
export const inject = ['agentPresets']

const DEFAULT_CONFIG = {
  /** 本实例所属预设 id（预设行 `config.preset`）：只处理该预设的会话，留空一律不处理（fail-closed）。 */
  preset: '',
  /** 出现在指引与日志里的模式名（每个预设各写各的，便于全局日志对上号）。 */
  label: '',
  /**
   * 协作风味：`subagent` | `team` | `auto`（默认）。`auto` 在运行时读
   * `agentTeams` 服务是否存在（插件页「智能体团队」开关决定）自动二选一。
   */
  collabFlavor: 'auto',
  /**
   * subagent 风味下未激活会话滤掉的工具（精确名）：扇出（subagent / subagent_fork /
   * workflow）与子会话通信（send_message / interrupt_agent）。report 预设没有
   * workflow 行，滤不到即无副作用。
   */
  lazyToolNames: ['subagent', 'subagent_fork', 'workflow', 'send_message', 'interrupt_agent'],
  /**
   * team 风味下未激活会话滤掉的工具（精确名）。与 lazyToolNames 同语义，
   * 只是作用在 Agent Teams 的工具面上（激活前模型看不到；激活后全露）。
   */
  teamToolNames: [
    'spawn_teammate', 'send_message', 'list_agents', 'wait_agent', 'interrupt_agent',
    'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update',
  ],
  /** 协作形态触发词：用户文本 / todo / plan 参数命中任一词即激活本会话。宁宽勿严。 */
  activationTriggers: [
    '多agent', '多 agent', '多智能体', '子agent', '子 agent', '子智能体',
    '分工协作', '协同写作', '并行写', '分头写', '每个章节', '各章节',
    '扇出', '派发子代理', '开子代理', '并行执行', '波次', '统稿',
    'subagent', 'workflow 编排', 'multi-agent',
  ],
  /**
   * 复杂度触发词：与协作形态词分开记日志，但同样可激活（用户没喊「多agent」、
   * 只说「很复杂/拆成几块」时也开协作）。误激活可接受——代价只是几个 schema。
   */
  complexityTriggers: [
    '复杂', '拆解', '拆分', '子任务', '分几步', '分阶段', '里程碑',
    '批量', '多任务', '同时推进', '并行推进', '独立成块', '拆成几块', '分块',
  ],
  /** 任务拆解类工具：这些工具的 arguments 整体扫描触发词（todo / plan 产物）。 */
  activationScanTools: ['todo_write', 'exit_plan_mode'],
  /**
   * todo 结构信号阈值：`todo_write` 落盘条目数 ≥ 本值，**且**参数或最新用户文本
   * 命中复杂度词时激活。`<=0` 关闭本信号。默认 5（误激活可接受的产品口径）。
   */
  activationTodoMin: 5,
  /** 指引文案；空串 = 内置默认（按 collabFlavor 分流的五段协议摘要 + 技能入口）。 */
  guidance: '',
  /** 协作协议技能名：指引里点名它，用户可用 /<name> 直呼加载。 */
  skillName: 'multi-agent-collab',
}

/**
 * 折叠空白并转小写，使触发词匹配忽略大小写、换行与重复空格（与 tool-skill 同口径）。
 * @param value - 原始文本。
 * @returns 去首尾、单空格、小写后的文本。
 */
export function normalizeText(value) {
  return String(value ?? '').replaceAll(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * 文本是否命中触发词表。
 *
 * 空表表示「未声明文本信号」（恒 false），与技能目录的空表语义（恒放行）相反——
 * 这里空表不能被解读成「一律激活」。
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
 * 按协作工具名列表过滤工具 schema（纯逻辑，供 assemble 与 selftest 共用）。
 *
 * **只作用于展示层**：被滤掉的工具仍在注册表里，模型按名字调用照样成功。
 * 精确名匹配（不是前缀）：`subagent` 不会误伤 `subagent_xxx` 之外的名字，
 * `subagent_fork` 各算一个。`toolNames` 为空或会话已激活时原样返回。
 * @param tools - 组装完成的工具 schema 列表（`PromptAssembly.tools`，含 `{name}`）。
 * @param toolNames - 惰性工具名表（subagent 或 team 风味各取各的）。
 * @param activated - 该会话是否已激活。
 * @returns 过滤后的**新数组**（不需要过滤时是原数组引用）。
 */
export function filterCollabTools(tools, toolNames, activated) {
  if (!Array.isArray(toolNames) || toolNames.length === 0 || activated || !Array.isArray(tools)) {
    return tools
  }
  const hidden = new Set(toolNames)
  return tools.filter(tool => !hidden.has(String(tool?.name ?? '')))
}

/**
 * 解析生效的协作风味。
 * @param cfg - 已合并默认值的配置（读 `collabFlavor`）。
 * @param hasTeam - 探测函数：当前组合是否挂有 `agentTeams` 服务（apply 注入）。
 * @returns `'team'` 或 `'subagent'`（永不返回 `auto`）。
 */
export function resolveCollabFlavor(cfg, hasTeam) {
  const mode = cfg?.collabFlavor
  if (mode === 'team' || mode === 'subagent') return mode
  try {
    return hasTeam() === true ? 'team' : 'subagent'
  } catch {
    return 'subagent'
  }
}

/**
 * 取该风味下未激活会话应被滤掉的工具名表。
 * @param cfg - 已合并默认值的配置。
 * @param flavor - `resolveCollabFlavor` 的结果。
 * @returns 精确名数组。
 */
export function lazyNamesFor(cfg, flavor) {
  return flavor === 'team' ? cfg.teamToolNames : cfg.lazyToolNames
}

/**
 * 统一的文本激活信号判定：先协作形态词、后复杂度词。
 * @param text - 待扫文本。
 * @param cfg - 已合并默认值的配置。
 * @returns `'trigger-word'` | `'complexity-word'` | `null`。
 */
export function matchActivationText(text, cfg) {
  if (triggerMatches(text, cfg.activationTriggers)) return 'trigger-word'
  if (triggerMatches(text, cfg.complexityTriggers)) return 'complexity-word'
  return null
}

/**
 * 从 `todo_write` 的 arguments 里数条目（`todos` 数组长度；非数组返回 0）。
 * @param args - 工具入参。
 * @returns 条目数。
 */
export function countTodos(args) {
  const todos = args?.todos
  return Array.isArray(todos) ? todos.length : 0
}

/**
 * todo 结构信号：条目数 ≥ 阈值 **且** 参数或补充文本命中复杂度词。
 * @param args - `todo_write` 入参。
 * @param cfg - 已合并默认值的配置。
 * @param extraText - 最新用户文本（可选，用于「用户说了复杂但 todo 里没写」）。
 * @returns 命中时返回可读原因串，否则 null。
 */
export function matchTodoStructure(args, cfg, extraText = '') {
  const min = cfg.activationTodoMin
  if (!Number.isFinite(min) || min <= 0) return null
  const n = countTodos(args)
  if (n < min) return null
  const argsJson = JSON.stringify(args ?? {})
  const hit = triggerMatches(argsJson, cfg.complexityTriggers)
    || triggerMatches(extraText, cfg.complexityTriggers)
    || triggerMatches(argsJson, cfg.activationTriggers)
    || triggerMatches(extraText, cfg.activationTriggers)
  if (!hit) return null
  return `todo 结构命中复杂任务信号（${n} 条 ≥ ${min} 且含触发/复杂度词）`
}

/**
 * 默认协作指引 · subagent 风味（激活后注入一次；自包含，不依赖技能是否可加载）。
 * @param cfg - 已合并默认值的配置。
 * @returns 指引文本。
 */
export function defaultSubagentGuidance(cfg) {
  const head = cfg.label ? `【多Agent协作 · ${cfg.label}】` : '【多Agent协作】'
  return head + '本会话已开启多Agent协作，复杂任务按五段协议推进：\n'
    + '1) 先规划再动手：产出大纲（总论点→分论点→证据映射）与分块 spec（每块：核心论点 1 句 / 必引证据 / 字数区间 / 禁写内容 / 依赖关系），按依赖排成波次计划；spec 标准是「照做即可，无需再决策」。\n'
    + '2) 证据先行：共享事实库先建好，每块只准引用库内证据，不许自行新造事实。\n'
    + '3) 波次扇出：同波并行、波间串行；每个子代理只装载 任务摘要 + 本块 spec + 相关事实切片 + 文风样例，禁止整包上下文与历史对话。\n'
    + '4) 两阶段评审：每块先查 spec 合规（独立子会话逐条对照），再做整体质量评审（术语一致 / 论点链完整 / 无重复论证 / 文风统一）；执行者不得自评。\n'
    + '5) 统稿收口：跨块修改只由统稿方执行，写手只写自己那块；收尾把协作经验回写经验库。\n'
    + '工具选择：单块委派用 subagent（可续话）或 subagent_fork（继承上下文、一次性）；'
    + '大规模并行用 workflow 写编排脚本（parallel 扇出、波次分批）。\n'
    + `完整模板（spec 模板 / 波次计划 / 装载清单）见技能 ${cfg.skillName}`
    + `（技能目录可见时用 skill 工具加载，用户也可首行输入 /${cfg.skillName} 直呼）。\n`
    + '简单任务不必协作，按原模式正常推进即可。'
}

/**
 * 默认协作指引 · team 风味（Agent Teams 开启时）。
 *
 * 含**策略修正**：上游 tool-agent-team 的常驻 POLICY 首句要求「只有用户明确点名才
 * 创建 teammate」——本指引在激活会话里显式覆盖该句，允许 Lead 在复杂任务下主动
 * spawn_teammate。与上游 POLICY 相邻可读，模型以本条（更新、更具体）为准。
 * @param cfg - 已合并默认值的配置。
 * @returns 指引文本。
 */
export function defaultTeamGuidance(cfg) {
  const head = cfg.label ? `【多Agent协作 · ${cfg.label}】` : '【多Agent协作】'
  return head + '本会话已开启多Agent协作（Agent Teams 模式）。\n'
    + '【策略修正】不要等待用户点名才创建 teammate：当任务可拆为 ≥3 个相对独立的块、'
    + '或用户表达了并行/分工/复杂拆解意图时，Lead **应当**主动 spawn_teammate，无需再次征得同意。'
    + '简单任务仍单线程做完，别为协作而协作。\n'
    + '五段协议（team 版）：\n'
    + '1) 规划：用 team_task_create 建共享任务，写清 writeScopes（写路径不重叠）与 blockedBy 依赖；\n'
    + '2) 事实库：共享事实与约束先落任务描述或统一文件，teammate 只引用不新造；\n'
    + '3) 扇出：spawn_teammate（fresh 无历史 / fork 继承已完成轮次）；prompt 给完整 spec，'
    + '不要塞整包对话；成员数受 maxMembers 限制，够用即可；\n'
    + '4) 编排：send_message 推进波次；wait_agent 前先 list_agents 确认有人 running/provisioning，'
    + 'inactive 的用 send_message 唤醒；\n'
    + '5) 统稿：Lead 等必要成员完成后再给最终答案；跨成员修改只由 Lead 收口。\n'
    + '工具：spawn_teammate / list_agents / send_message / wait_agent / interrupt_agent / '
    + 'team_task_create / team_task_list / team_task_get / team_task_update。\n'
    + `完整模板见技能 ${cfg.skillName}（可用 skill 工具加载，或首行输入 /${cfg.skillName} 直呼）。`
}

/**
 * 按风味取默认指引（`cfg.guidance` 非空时整段覆盖，两风味共用）。
 * @param cfg - 已合并默认值的配置。
 * @param flavor - 生效风味。
 * @returns 指引文本。
 */
export function defaultGuidance(cfg, flavor = 'subagent') {
  if (cfg.guidance !== '') return cfg.guidance
  return flavor === 'team' ? defaultTeamGuidance(cfg) : defaultSubagentGuidance(cfg)
}

/**
 * 协作闸门核心（纯逻辑，不接触 dsh，便于单独验证）。
 * @param config - 见 {@link DEFAULT_CONFIG}；缺省项由默认值补齐。
 * @param log - `{ warn(message), hydrate?(state, sessionId), onActivated?(sessionId),
 *   hasTeam?() }`，可选；hydrate/onActivated 由 apply 注入（文件 → 内存水合 /
 *   首次激活落盘），selftest 不传即纯内存。`hasTeam` 供 `collabFlavor: 'auto'`
 *   在激活时刻解析风味。
 * @returns `activate`（粘性激活）、`consumeGuidance`（一次性指引）、`state`（排障用）。
 */
export function createCollabCore(config = {}, log = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const warn = typeof log.warn === 'function' ? log.warn : () => {}
  /** 会话状态首次创建时的水合钩子（apply 注入；只准就地改传入 state，不得回调 core）。 */
  const hydrate = typeof log.hydrate === 'function' ? log.hydrate : null
  /** activated 首次置位的落盘钩子（apply 注入 → session-state noteGate）。 */
  const onActivated = typeof log.onActivated === 'function' ? log.onActivated : null
  const hasTeam = typeof log.hasTeam === 'function' ? log.hasTeam : () => false
  const sessions = new Map()

  const session = (id) => {
    let state = sessions.get(id)
    if (state === undefined) {
      if (sessions.size > 200) sessions.delete(sessions.keys().next().value)
      state = { activated: false, guidancePending: false, flavor: 'subagent' }
      sessions.set(id, state)
      if (hydrate !== null) {
        // 水合只恢复 activated，不置 guidancePending：重启后上下文里那份一次性指引
        // 还在，重发是浪费；压缩后的恢复由 session-state 的粘性摘要负责。
        // 整段包在 try 里，文件抖动按未激活降级（fail-open）。
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

  return {
    /**
     * 粘性激活本会话（一次激活整会话生效，不可逆）。
     * @param input - `{ sessionId, reason }`；`reason` 仅供日志对上号。
     * @returns 是否为该会话的首次激活（供调用方打一条日志）。
     */
    activate({ sessionId = '', reason = '' } = {}) {
      const state = session(sessionId)
      if (state.activated) return false
      state.guidancePending = true
      state.flavor = resolveCollabFlavor(cfg, hasTeam)
      markActivated(sessionId, state)
      if (reason !== '') warn(`[collab-gate] 会话 ${sessionId} 已激活（原因: ${reason}；风味: ${state.flavor}）`)
      return true
    },

    /**
     * 取走待注入的协作指引（一次性：每个会话最多返回一次非 null）。
     * 未激活或已取走返回 null——pre-step 每步都会调它，空转零成本。
     * 文案按激活时记录的风味分流（team / subagent 两套，不混说）。
     * @param sessionId - 会话 id。
     * @returns 指引文本，或 null。
     */
    consumeGuidance(sessionId = '') {
      const state = session(sessionId)
      if (!state.activated || !state.guidancePending) return null
      state.guidancePending = false
      return defaultGuidance(cfg, state.flavor ?? 'subagent')
    },

    /** 排障用：查看某会话的激活状态（含风味）。 */
    state: (sessionId = '') => session(sessionId),

    /** 已合并默认值的配置（apply 装配惰性名单时用）。 */
    config: () => cfg,
  }
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
 * assemble 兜底扫描靠它拿到触发词判定依据。插件注入的消息（source.kind 为
 * `plugin:<插件名>`，非 'user'）不算用户文本。只在会话未激活时调用。
 * @param agent - 当前步的 agent（可能为 undefined）。
 * @returns 归一化后的最新用户文本；取不到返回空串。
 */
export function latestUserText(agent) {
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

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/**
 * 装载闸门：订阅触发扫描、指引注入与工具 schema 懒露出。
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
  // 「智能体团队」开启时 agentTeams 服务在组合里；auto 风味据此二选一。
  const hasTeam = () => {
    try {
      return ctx.get('agentTeams') !== undefined && ctx.get('agentTeams') !== null
    } catch {
      return false
    }
  }
  const core = createCollabCore(cfg, {
    warn,
    hasTeam,
    // 压缩/重启恢复：文件里已有 collab 闸门记录 → 内存态首次创建即置 activated。
    // 不置 guidancePending（见 createCollabCore 的水合注释）；子代理无文件即无操作。
    hydrate: (state, sessionId) => {
      if (readSessionState(sessionId).gates?.collab) state.activated = true
    },
    // 首次激活落盘；子代理会话已被 sessionIdOf 记入排除集，noteGate 内部静默跳过。
    onActivated: (sessionId) => {
      noteGate(sessionId, 'collab', '多Agent协作闸门')
    },
  })

  const sessionIdOf = (agent) => {
    const id = String(agent?.id ?? agent?.session?.id ?? '')
    // 子代理不持久化：每次触碰重判 origin 并补回排除集（见 session-state 头注释）。
    if (id !== '' && isSubagentAgent(agent)) noteSubagent(id)
    return id
  }

  // 子代理会话恒不激活（全部激活信号共用的豁免口）：子会话的 prompt 由父代理裁剪供给，
  // 父任务文本里的协作触发词落到子会话只是委托内容、不是协作意图——激活只会向
  // 子会话露出委派 schema 并注入协议指引，还可能诱发嵌套扇出。
  // sessionIdOf 已把子代理记入 session-state 排除集，isExcluded 即判定。豁免只挡激活与
  // 指引注入：被滤掉的工具仍在注册表里，按名调用照样成功（展示层过滤，不做 deny）。
  const activateFor = (agent, reason) => {
    const sessionId = sessionIdOf(agent)
    if (isExcluded(sessionId)) return false
    return core.activate({ sessionId, reason })
  }

  // 首次按名调用协作工具即激活（兜底信号）：模型动手了，本会话必然在做协作型任务。
  // 只激活、不拦截——展示层滤掉的工具按名调用照样成功（见文件头契约）。
  // 名表按当前风味取：team 开时按名调用 spawn_teammate 等同样激活。
  const onPreExecute = async (exec, next) => {
    const downstream = await next()
    if (downstream.kind !== 'allow') return downstream
    if (!ownAgent(exec.agent)) return downstream
    const flavor = resolveCollabFlavor(cfg, hasTeam)
    const names = lazyNamesFor(cfg, flavor)
    if (names.includes(exec.name) || cfg.lazyToolNames.includes(exec.name)) {
      activateFor(exec.agent, `首次调用 ${exec.name}`)
    }
    return downstream
  }

  // todo / plan 产物：① 整参命中协作形态/复杂度词即激活；② todo_write 结构信号
  //（条目数 ≥ activationTodoMin 且含词）——双条件压误报，误激活可接受的产品口径。
  const onPostExecute = async (exec, _result, next) => {
    const downstream = await next()
    if (!ownAgent(exec.agent)) return downstream
    if (cfg.activationScanTools.includes(exec.name)) {
      const argsJson = JSON.stringify(exec.arguments ?? {})
      if (triggerMatches(argsJson, cfg.activationTriggers)
        || triggerMatches(argsJson, cfg.complexityTriggers)) {
        activateFor(exec.agent, `${exec.name} 扫描命中触发/复杂度词`)
      } else if (exec.name === 'todo_write') {
        const reason = matchTodoStructure(exec.arguments, cfg, latestUserText(exec.agent))
        if (reason !== null) activateFor(exec.agent, reason)
      }
    }
    return downstream
  }

  const onPreStep = async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || payload.signal?.aborted === true) return decision
    if (!ownAgent(payload.agent)) return decision
    const sessionId = sessionIdOf(payload.agent)
    // 用户文本触发词：只扫本步 claim 的真实用户消息（source.kind==='user'，
    // plugin 注入天然被排除）。激活是纯状态记录，与业务闸门互不干扰。
    // 子代理（isExcluded）整段跳过——见 activateFor 注释。
    if (!isExcluded(sessionId)) {
      const blocks = []
      for (const message of payload.messages ?? []) {
        if (message?.source?.kind !== 'user') continue
        for (const block of message.content ?? []) {
          if (block?.type === 'text' && typeof block.text === 'string') blocks.push(block.text)
        }
      }
      const hit = matchActivationText(blocks.join('\n'), cfg)
      if (hit !== null) {
        core.activate({
          sessionId,
          reason: hit === 'complexity-word' ? '用户文本命中复杂度词' : '用户文本命中触发词',
        })
      }
    }
    // 指引注入同口豁免（双保险：激活被挡后 consume 本就恒 null，这里把契约写死）。
    const text = isExcluded(sessionId) ? null : core.consumeGuidance(sessionId)
    if (text === null) return decision
    return { kind: 'enter', messages: [...decision.messages, injectedMessage(text)] }
  }

  // 用户消息入队即扫触发词（emit 事件，发生在该步 assemble **之前**）：
  // 消息 1 命中时首个请求就带协作工具 schema，header 从第一步起稳定、不打断前缀缓存。
  // pre-step 的同款扫描保留作冗余（幂等）。
  const onInboxInserted = (payload) => {
    try {
      if (!ownAgent(payload?.agent)) return
      const hit = matchActivationText(messageText(payload?.message), cfg)
      if (hit === null) return
      activateFor(
        payload?.agent,
        hit === 'complexity-word' ? '用户消息入队命中复杂度词' : '用户消息入队命中触发词',
      )
    } catch {
      /* 激活信号失败绝不影响消息入队 */
    }
  }

  // 工具 schema 懒露出：未激活会话的 assemble 过滤掉协作工具 schema（按风味取名表）。
  // fail-open：任何异常返回原样 assembly（最坏 = 退回常驻行为，绝不阻塞装配）。
  const onAssemble = async (assembly, context, next) => {
    const result = await next()
    if (!ownAgent(context?.agent)) return result
    try {
      const sessionId = sessionIdOf(context?.agent)
      if (sessionId === '') return result
      // 兜底激活同样豁免子代理：排除集内会话既不激活、也永远走不进兜底匹配。
      if (!isExcluded(sessionId) && !core.state(sessionId).activated) {
        // 会话恢复兜底：历史消息不会重放 inbox/inserted，用最新用户文本补一次匹配。
        const hit = matchActivationText(latestUserText(context.agent), cfg)
        if (hit !== null) {
          core.activate({
            sessionId,
            reason: hit === 'complexity-word'
              ? 'assemble 兜底命中复杂度词（恢复会话）'
              : 'assemble 兜底命中触发词（恢复会话）',
          })
        }
      }
      if (core.state(sessionId).activated) return result
      const flavor = resolveCollabFlavor(cfg, hasTeam)
      return { ...result, tools: filterCollabTools(result.tools, lazyNamesFor(cfg, flavor), false) }
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

  const mountFlavor = resolveCollabFlavor(cfg, hasTeam)
  const mountLazy = lazyNamesFor(cfg, mountFlavor)
  warn(`[collab-gate] 已挂载（${cfg.label || '默认'}，风味 ${mountFlavor}）：`
    + `未激活会话不携带协作工具 schema（${mountLazy.join(', ')}）；`
    + `todo 阈值 ${cfg.activationTodoMin}`)
}

/**
 * 自检：schema 懒露出 + 粘性激活 + 一次性指引 + 风味分流 + 触发/复杂度/todo 结构
 * （`node collab-gate.mjs --selftest`）。
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
    activationTriggers: ['多agent', '并行写', '统稿'],
    complexityTriggers: ['复杂', '拆解', '子任务'],
    activationTodoMin: 5,
    ...cfg,
  }

  // 1) filterCollabTools 纯逻辑
  const mkTools = () => [
    { name: 'subagent' },
    { name: 'subagent_fork' },
    { name: 'workflow' },
    { name: 'send_message' },
    { name: 'interrupt_agent' },
    { name: 'todo_write' },
    { name: 'skill' },
    { name: 'fs' },
  ]
  const all = mkTools()
  check('空前表不过滤（回归）', filterCollabTools(all, [], false) === all, '原数组')
  const hidden = filterCollabTools(all, DEFAULT_CONFIG.lazyToolNames, false)
  check('未激活时五个协作工具被滤掉', hidden.length === 3 && all.length === 8, `过滤后 ${hidden.length}/8`)
  check('过滤后保留普通工具',
    hidden.every(t => !DEFAULT_CONFIG.lazyToolNames.includes(t.name))
    && hidden.some(t => t.name === 'todo_write') && hidden.some(t => t.name === 'skill'),
    hidden.map(t => t.name).join(','))
  check('已激活原样返回', filterCollabTools(all, DEFAULT_CONFIG.lazyToolNames, true) === all, '原数组')
  check('精确名匹配不误伤', filterCollabTools([{ name: 'subagent_x' }], ['subagent'], false).length === 1,
    '保留 subagent_x')
  check('非数组工具列表安全返回', filterCollabTools(undefined, DEFAULT_CONFIG.lazyToolNames, false) === undefined,
    'undefined')

  // 1b) 风味解析与惰性名表
  const cfgSub = { ...DEFAULT_CONFIG, ...base, collabFlavor: 'subagent' }
  const cfgTeam = { ...DEFAULT_CONFIG, ...base, collabFlavor: 'team' }
  const cfgAutoOn = { ...DEFAULT_CONFIG, ...base, collabFlavor: 'auto' }
  check('flavor 显式 subagent', resolveCollabFlavor(cfgSub, () => true) === 'subagent', 'subagent')
  check('flavor 显式 team', resolveCollabFlavor(cfgTeam, () => false) === 'team', 'team')
  check('flavor auto + 无 team 服务 → subagent',
    resolveCollabFlavor(cfgAutoOn, () => false) === 'subagent', 'subagent')
  check('flavor auto + 有 team 服务 → team',
    resolveCollabFlavor(cfgAutoOn, () => true) === 'team', 'team')
  check('flavor auto + 探测异常 → subagent（fail-open）',
    resolveCollabFlavor(cfgAutoOn, () => { throw new Error('boom') }) === 'subagent', 'subagent')
  check('lazyNamesFor subagent 风味取 lazyToolNames',
    lazyNamesFor(cfgSub, 'subagent').includes('subagent')
    && !lazyNamesFor(cfgSub, 'subagent').includes('spawn_teammate'), 'subagent 表')
  check('lazyNamesFor team 风味取 teamToolNames',
    lazyNamesFor(cfgTeam, 'team').includes('spawn_teammate')
    && !lazyNamesFor(cfgTeam, 'team').includes('subagent'), 'team 表')
  const teamTools = [
    { name: 'spawn_teammate' }, { name: 'list_agents' }, { name: 'todo_write' },
  ]
  const teamHidden = filterCollabTools(teamTools, lazyNamesFor(cfgTeam, 'team'), false)
  check('team 风味未激活滤掉 spawn_teammate',
    teamHidden.length === 1 && teamHidden[0].name === 'todo_write', JSON.stringify(teamHidden))

  // 2) 触发词与复杂度词匹配口径
  check('触发词命中', triggerMatches('这篇论文多agent分工写', ['多agent', '统稿']) === true, '命中')
  check('触发词大小写与空白无关', triggerMatches('  SubAgent  请扇出 ', ['subagent']) === true, '归一化')
  check('空表恒不命中', triggerMatches('多agent', []) === false, '空表')
  check('复杂度词命中', matchActivationText('这个任务很复杂，帮我拆解', base) === 'complexity-word', 'complexity')
  check('协作形态词优先于复杂度词',
    matchActivationText('多agent 并且复杂', base) === 'trigger-word', 'trigger')
  check('无关文本不激活', matchActivationText('今天天气不错', base) === null, 'null')

  // 2b) todo 结构信号
  const manyTodos = { todos: Array.from({ length: 5 }, (_, i) => ({ content: `任务${i}`, status: 'pending' })) }
  const fewTodos = { todos: [{ content: '单一任务', status: 'pending' }] }
  const manyNoWord = {
    todos: Array.from({ length: 6 }, (_, i) => ({ content: `alpha-${i}`, status: 'pending' })),
  }
  check('todo≥5 且含复杂度词 → 命中',
    typeof matchTodoStructure(manyTodos, base, '帮我拆解一下') === 'string', '命中')
  check('todo≥5 且最新用户文本含复杂度词 → 命中',
    matchTodoStructure(manyNoWord, base, '这个很复杂') !== null, '命中')
  check('todo≥5 但无任何词 → 不命中（双条件）',
    matchTodoStructure(manyNoWord, base, '继续做') === null, 'null')
  check('todo<5 即使命中词也不走结构信号（仍可由词表路径激活）',
    matchTodoStructure(fewTodos, base, '复杂') === null, 'null')
  check('activationTodoMin=0 关闭结构信号',
    matchTodoStructure(manyTodos, { ...base, activationTodoMin: 0 }, '复杂') === null, 'null')
  check('countTodos 非数组安全', countTodos({ todos: 'nope' }) === 0, '0')

  // 3) 粘性激活
  const core = createCollabCore(base, { warn: () => {} })
  check('激活前未激活', core.state('s1').activated === false, '未激活')
  check('首次激活返回 true', core.activate({ sessionId: 's1', reason: '自检' }) === true, '首激活')
  check('二次激活返回 false（粘性）', core.activate({ sessionId: 's1', reason: '重复' }) === false, '重复激活')
  check('激活后状态粘住', core.state('s1').activated === true, '已激活')
  check('默认风味记录为 subagent', core.state('s1').flavor === 'subagent', core.state('s1').flavor)

  // 3b) team 风味激活与指引
  const teamCore = createCollabCore(cfgTeam, { warn: () => {} })
  teamCore.activate({ sessionId: 't1', reason: '自检' })
  check('team 激活记录风味', teamCore.state('t1').flavor === 'team', teamCore.state('t1').flavor)
  const teamGuidance = teamCore.consumeGuidance('t1')
  check('team 指引含策略修正', typeof teamGuidance === 'string'
    && teamGuidance.includes('策略修正') && teamGuidance.includes('spawn_teammate'), 'team 指引')
  check('team 指引不含 subagent 委派话术',
    !teamGuidance.includes('subagent_fork'), teamGuidance.slice(0, 60))
  check('team 指引只发一次', teamCore.consumeGuidance('t1') === null, 'null')
  const autoTeamCore = createCollabCore(cfgAutoOn, { warn: () => {}, hasTeam: () => true })
  autoTeamCore.activate({ sessionId: 't2', reason: '自检' })
  check('auto+hasTeam 指引走 team 文案',
    autoTeamCore.consumeGuidance('t2')?.includes('Agent Teams 模式') === true, 'auto team')

  // 4) 一次性指引（subagent）
  check('激活前无指引', core.consumeGuidance('s2') === null, 'null')
  const guidance = core.consumeGuidance('s1')
  check('首次激活后有指引', typeof guidance === 'string' && guidance.includes('五段协议'), '有指引')
  check('指引带模式标签', guidance.includes('自检模式'), guidance.slice(0, 40))
  check('指引点名协议技能', guidance.includes('multi-agent-collab'), '技能名')
  check('指引说明三个委派工具', guidance.includes('subagent') && guidance.includes('workflow'), '工具名')
  check('指引只发一次', core.consumeGuidance('s1') === null, 'null')

  // 5) 自定义文案与技能名
  const custom = createCollabCore({ ...base, guidance: '自定义指引', skillName: 'my-skill' }, { warn: () => {} })
  custom.activate({ sessionId: 's3', reason: '自检' })
  const customText = custom.consumeGuidance('s3')
  check('自定义 guidance 优先（两风味共用）', customText === '自定义指引', customText)

  // 6) latestUserText：只取最新直接用户文本，插件注入不算
  const fakeAgent = { session: { deriveMessages: () => [
    { source: { kind: 'user' }, content: [{ type: 'text', text: '早先的消息' }] },
    { source: { kind: 'plugin:context-facts' }, content: [{ type: 'text', text: '插件注入不算' }] },
    { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我多agent分工' }] },
  ] } }
  check('latestUserText 取最新用户文本',
    latestUserText(fakeAgent) === '帮我多agent分工', latestUserText(fakeAgent))
  check('latestUserText 对空 agent 返回空串', latestUserText(undefined) === '', '空串')
  check('latestUserText 命中触发词', triggerMatches(latestUserText(fakeAgent), base.activationTriggers) === true,
    '命中')

  // 7) assemble 等价复现：未激活过滤 → 兜底激活 → 不再过滤
  const core7 = createCollabCore(base, { warn: () => {} })
  const before = filterCollabTools(all, DEFAULT_CONFIG.lazyToolNames, core7.state('s7').activated)
  check('恢复兜底前被过滤', before.length === 3, `${before.length}/8`)
  if (matchActivationText(latestUserText(fakeAgent), base) !== null) {
    core7.activate({ sessionId: 's7', reason: '恢复兜底' })
  }
  const after = filterCollabTools(all, DEFAULT_CONFIG.lazyToolNames, core7.state('s7').activated)
  check('兜底激活后不过滤', after === all, '原数组')

  // 8) session-state 接线钩子（纯逻辑：水合 / 激活上报；不碰文件系统）
  const hooks = []
  const hydrated = createCollabCore(base, {
    warn: () => {},
    hydrate: (state) => { state.activated = true },
    onActivated: (sid) => hooks.push(sid),
  })
  check('水合后首触即为已激活', hydrated.state('s8').activated === true, hydrated.state('s8').activated)
  check('水合不触发 onActivated（不把恢复写回文件）', hooks.length === 0, JSON.stringify(hooks))
  check('水合不置 guidancePending（重启不重发一次性指引）',
    hydrated.consumeGuidance('s8') === null, '有指引')
  const watched = createCollabCore(base, { warn: () => {}, onActivated: (sid) => hooks.push(sid) })
  watched.activate({ sessionId: 's9', reason: '自检' })
  watched.activate({ sessionId: 's9', reason: '重复' })
  check('首次激活上报恰好一次', hooks.filter((sid) => sid === 's9').length === 1, JSON.stringify(hooks))
  check('活激活仍置 guidancePending（新会话指引照发）',
    typeof watched.consumeGuidance('s9') === 'string', '无指引')

  // 9) 子代理恒不激活（apply 的 activateFor 判定等价复现：排除集 → 不激活 → 不露 schema/指引）
  noteSubagent('s-child')
  check('子会话进排除集', isExcluded('s-child') === true, isExcluded('s-child'))
  const guarded = createCollabCore(base, { warn: () => {} })
  if (!isExcluded('s-child')) guarded.activate({ sessionId: 's-child', reason: '父任务文本命中' })
  check('子会话即使命中触发词也不激活',
    guarded.state('s-child').activated === false, guarded.state('s-child').activated)
  check('子会话 schema 仍被展示层过滤（按名调用不受影响）',
    filterCollabTools(all, DEFAULT_CONFIG.lazyToolNames, guarded.state('s-child').activated).length === 3,
    '未过滤')
  check('子会话指引恒 null', guarded.consumeGuidance('s-child') === null, '有指引')
  if (!isExcluded('s-main')) guarded.activate({ sessionId: 's-main', reason: '同信号' })
  check('主会话同信号照常激活', guarded.state('s-main').activated === true, '未激活')
  check('主会话指引照发', typeof guarded.consumeGuidance('s-main') === 'string', '无指引')

  // 10) 注入消息 source 形态（session format v4 producer-owned kind）+ 预设身份守卫
  const sample = injectedMessage('自检指引')
  check('注入消息 source.kind 为非空字符串且 ≠ plugin',
    typeof sample.source.kind === 'string' && sample.source.kind !== '' && sample.source.kind !== 'plugin',
    JSON.stringify(sample.source))
  check('注入消息 source.kind 为 plugin:collab-gate',
    sample.source.kind === 'plugin:collab-gate', sample.source.kind)
  check('预设守卫：同预设放行、其它预设不处理',
    ownsPreset('empirical', 'empirical') === true && ownsPreset('empirical', 'review') === false,
    `${ownsPreset('empirical', 'empirical')}/${ownsPreset('empirical', 'review')}`)
  check('预设守卫：未配置 / 取不到一律不处理（fail-closed）',
    ownsPreset('', 'empirical') === false && ownsPreset('empirical', undefined) === false, 'fail-open')

  return { ok: failures.length === 0, cases, failures }
}

const invokedDirectly = Boolean(process.argv[1]) && process.argv[1].endsWith('collab-gate.mjs')
if (invokedDirectly && process.argv.includes('--selftest')) {
  const r = selftest()
  console.log(`[collab-gate] selftest: ${r.ok ? 'PASS' : 'FAIL'}（${r.cases} 例）`)
  for (const line of r.failures) console.error(`  ${line}`)
  process.exit(r.ok ? 0 : 1)
}
