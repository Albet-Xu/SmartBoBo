/**
 * report-memory-gate —— 文献汇报模式的「汇报经验库**强制**闸门」（fail-closed）。
 *
 * ## 为什么需要它（与 `paper-experience-gate` 的关键差别）
 *
 * 论文模式的经验闸门是 **fail-open、只注入提醒、从不 deny**——它的 D3 阶段结论是"先只提醒"。
 * 结果是"收尾必须沉淀"纯属提示词约束，模型忙起来就不调了。
 * 本模式的经验读写是**流程的显式步骤**（R0/R3 检索、R5/R6 沉淀），靠自觉做成功率很低，
 * 所以照 `reverse-memory-gate` 的做法把它提升为**工具调用被拒**。
 *
 * ## 契约
 *
 * - **只在经验库已接入时生效**：读 `report-experience/readiness.json`，只有 `ready === true`
 *   才开启闸门。文件不存在或读不到一律按「未接入」处理——**基础设施抖动绝不能阻塞干活**
 *   （没连 Qdrant 的用户本来就不需要检索与沉淀）。这条与本插件"其余部分是 fail-closed"并不矛盾：
 *   失败姿态的分界是**经验库可用性**，不是"模型有没有做该做的事"。
 * - 开启后强制两件事：
 *   1. 写 R2/R3 的叙事产物（`01-文献/matrix.md` / `02-叙事/storyline.md` / `02-叙事/slide-plan.json`）
 *      前，本会话必须至少调过一次检索工具——**这一步能改变叙事骨架与页数取舍**；
 *   2. 写交付目录前，本会话必须至少调过一次沉淀或反馈工具——收尾必做。
 * - **防死锁**：同一目标被拒超过 `maxDenials` 次即放行并告警；沉淀只要求「调用过」，
 *   不要求入库成功（如实自评 ≤ 门槛被丢弃也算尽到职责）。
 * - 判定以 `agent.id`（会话）× 汇报项目根 为隔离单位。
 *
 * ## 刻意不拦的东西
 *
 * 由脚本产出的文件（`deck.pptx` / `preview/` / `qa-report.json` / `render-manifest.json` /
 * `汇报说明.md`）**不在这里拦**——它们由 `report-gate` 拦。两处都拦只会让模型一次收到
 * 两条互相干扰的拒绝理由，反而看不出该做什么。
 *
 * 挂载：汇报预设挂一行（相对路径按预设文件目录解析），config 全部可选。
 * 预设过滤：事件入口比对 `config.preset` 与 `agentPresets.composedPreset(agent.ctx)`，
 * 取不到（未挂预设 / 子代理未随父加入 / 服务缺席）一律不处理（fail-closed）；
 * armed / reminder 判据本身不动。
 * 排障：跑 `node report-memory-gate.mjs --selftest`；真实运行时的挂载/放行留痕走
 * `ctx.logger.warn`（web profile 下该级别不落后端 stdout，别指望 grep 启动日志）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

export const name = 'report-memory-gate'

/** 事件入口守卫要读 agentPresets 判定会话所属预设。 */
export const inject = ['agentPresets']

/** 可覆盖的默认配置。 */
export const DEFAULT_CONFIG = {
  /** 本实例所属预设 id（预设行 `config.preset`）：只处理该预设的会话，留空一律不处理（fail-closed）。 */
  preset: '',
  /** 出现在拒绝理由里的模式名，便于模型与用户对上号。 */
  label: '文献汇报模式',
  /** 经验库数据目录名（与 memory_store 的 DATA_DIR_NAME 一致）。 */
  dataDirName: 'report-experience',
  /** 就绪快照文件名（与 memory_store 的 readiness 同目录）。 */
  readinessFile: 'readiness.json',
  /** 汇报项目的阶段目录名（用于判断路径是否落在汇报项目里）。 */
  stageDirs: ['00-选题', '01-文献', '02-叙事', '03-产物', '04-评审', '05-交付'],
  /** 会被检查的写入类工具。 */
  writeTools: ['write', 'edit'],
  /** 检索工具名：必须写**模型侧的完整工具名** `mcp__<serverName>__report_experience_search`。 */
  searchTool: '',
  /** 沉淀工具名：同上。 */
  saveTool: '',
  /** 反馈工具名：同上（与沉淀互为替代，满足其一即可）。 */
  feedbackTool: '',
  /** 写这些路径（相对项目根）前必须先检索过经验库。 */
  searchGatedPaths: ['01-文献/matrix.md', '02-叙事/storyline.md', '02-叙事/slide-plan.json'],
  /** 写这些目录下的文件前必须先沉淀（或反馈）过。 */
  saveGatedDirs: ['05-交付'],
  /** 脚本自有产物：由 report-gate 拦，本闸门跳过（避免双拦）。 */
  scriptOwned: ['05-交付/汇报说明.md'],
  /** 同一目标连续被拒上限；超过即放行，避免工具链被卡死。 */
  maxDenials: 3,
  /** 同一会话最多注入多少条提醒。 */
  maxReminders: 12,
  /** readiness.json 的读取缓存时长（毫秒）。 */
  readinessTtlMs: 3_000,
  /** 单会话内记录「已处理过的工具调用」的上限，防止无限增长。 */
  maxClaims: 500,
}

/** 工具名留空时退回不带名字的说法——绝不写出一个实际不存在的工具名。 */
function toolName(name, fallback) {
  return typeof name === 'string' && name !== '' ? `\`${name}\`` : fallback
}

/**
 * 定位经验库数据目录（DSH_HOME / BOBO_ROOT / cwd 三级回退；三池统一在 experience-pool/ 下）。
 * @returns 目录路径，或 null 表示找不到。
 */
export function dataDir(cwd, cfg = DEFAULT_CONFIG) {
  const cands = []
  const dsh = process.env.DSH_HOME
  if (dsh) cands.push(join(dirname(dsh), 'experience-pool', cfg.dataDirName))
  if (dsh) cands.push(join(dirname(dsh), cfg.dataDirName)) // 旧布局回退
  const root = process.env.BOBO_ROOT
  if (root) cands.push(join(root, 'bobo-data', 'experience-pool', cfg.dataDirName))
  if (root) cands.push(join(root, 'bobo-data', cfg.dataDirName))
  if (cwd) cands.push(join(cwd, 'bobo-data', 'experience-pool', cfg.dataDirName))
  if (cwd) cands.push(join(cwd, 'bobo-data', cfg.dataDirName))
  for (const c of cands) if (existsSync(c)) return c
  return null
}

/** 读就绪快照；读不到即视为未接入（fail-open）。 */
export function readiness(cwd, cfg = DEFAULT_CONFIG) {
  const d = dataDir(cwd, cfg)
  if (!d) return null
  const p = join(d, cfg.readinessFile)
  if (!existsSync(p)) return null
  try {
    const s = JSON.parse(readFileSync(p, 'utf8'))
    return s && s.ready === true ? s : null
  } catch {
    return null
  }
}

/** 从工具参数里取目标文件路径（不同工具用的字段名不同）。 */
export function targetPathOf(args) {
  for (const key of ['file_path', 'filePath', 'path']) {
    const value = args?.[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

/** 从文件路径反推汇报项目根与相对路径。不属于任何汇报项目时返回 null。 */
export function projectOf(filePath, stageDirs = DEFAULT_CONFIG.stageDirs) {
  const normalized = String(filePath ?? '').replace(/\\/g, '/')
  if (normalized === '') return null
  const parts = normalized.split('/')
  const at = parts.findIndex(part => stageDirs.includes(part))
  if (at < 0) return null
  return { root: parts.slice(0, at).join('/'), stage: parts[at], rel: parts.slice(at).join('/') }
}

function under(rel, dir) {
  return rel === dir || rel.startsWith(`${dir}/`)
}

/**
 * 创建闸门判定核心（纯函数，可脱离 dsh 单测）。
 * @param config - 见 {@link DEFAULT_CONFIG}。
 * @param log - `{ warn(message) }`，可选。
 * @returns `decide` / `observe` / `reminder` / `state`。
 */
export function createGateCore(config = {}, log = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const warn = typeof log.warn === 'function' ? log.warn : () => {}
  const sessions = new Map()

  const session = (id) => {
    let state = sessions.get(id)
    if (state === undefined) {
      if (sessions.size > 200) sessions.delete(sessions.keys().next().value)
      state = { denials: new Map(), searched: new Set(), saved: new Set(), reminders: 0, notice: false }
      sessions.set(id, state)
    }
    return state
  }

  /** 防死锁：同一 (规则, 目标) 连续被拒到上限就放行并告警。 */
  const deny = (state, key, reason) => {
    const seen = state.denials.get(key) ?? 0
    if (seen >= cfg.maxDenials) {
      warn(`[report-memory-gate] ${key} 已连续 ${seen} 次被拒，放行以免阻塞（请人工复核该处经验读写前提）`)
      return null
    }
    state.denials.set(key, seen + 1)
    return reason
  }

  return {
    /**
     * 工具执行后记录状态（只观测，不改结果）。
     *
     * 「调用过」即算尽责——**不要求入库成功**：如实自评到门槛及以下会被 memory_store 直接丢弃，
     * 那也是正确的行为，不该反过来被闸门惩罚。
     * @param request - `{ sessionId, toolName }`。
     */
    observe({ sessionId = '', toolName }) {
      const state = session(sessionId)
      if (toolName === cfg.searchTool) state.searched.add('*')
      if (toolName === cfg.saveTool && toolName !== '') state.saved.add('*')
      if (toolName === cfg.feedbackTool && toolName !== '') state.saved.add('*')
    },

    /**
     * 写文件前判定。
     * @param request - `{ sessionId, toolName, args, cwd }`。
     * @returns 拒绝理由字符串，或 null 表示放行。
     */
    decide({ sessionId = '', toolName, args, cwd = '' }) {
      if (!cfg.writeTools.includes(toolName)) return null
      const target = String(targetPathOf(args)).replace(/\\/g, '/')
      if (target === '') return null

      const project = projectOf(target, cfg.stageDirs)
      if (project === null) return null
      const base = project.root !== '' ? project.root : String(cwd ?? '')
      if (base === '') return null
      const rel = project.rel.replace(/\\/g, '/')
      const state = session(sessionId)

      // 脚本自有产物交给 report-gate 拦；本闸门跳过，避免一次调用收到两条互相干扰的理由。
      if (cfg.scriptOwned.includes(rel)) return null

      // ── 规则 1：写 R2/R3 叙事产物前必须检索过经验库 ────────────────────
      if (cfg.searchGatedPaths.includes(rel) && state.searched.size === 0) {
        return deny(state, `search:${sessionId}:${base}`,
          `【${cfg.label}·经验库闸门】要写 ${rel} 之前，请先调用 ${toolNameFallback(cfg.searchTool, '汇报经验库的检索工具')}`
          + ' 检索历史汇报经验。'
          + '这一步**能改变决策**：叙事骨架、页数取舍、"哪些内容决定不讲"都有前车之鉴。'
          + '检索时**务必传对 `report_type`**（它是硬过滤，组会与开题踩的坑几乎不通用），'
          + '再传 tags（现象标签）与特征文本（如「15 页 / 中文 / 2 篇实证论文」）。'
          + '命中结果仅作**待验证假设**，禁止照搬。本会话检索一次即可。')
      }

      // ── 规则 2：写交付物前必须沉淀（或反馈）过 ─────────────────────────
      if (cfg.saveGatedDirs.some(d => under(rel, d)) && state.saved.size === 0) {
        return deny(state, `save:${sessionId}:${base}`,
          `【${cfg.label}·经验库闸门】要往交付目录写东西之前，请先调用 `
          + `${toolNameFallback(cfg.saveTool, '汇报经验库的沉淀工具')} 沉淀本次经验（`
          + '成功/失败/部分成功都要），或用 '
          + `${toolNameFallback(cfg.feedbackTool, '经验反馈工具')} 给本轮参考过的经验打分。`
          + '**先过迁移判据**——这条经验换几篇论文、换一个汇报场合之后还成立吗？不成立就毙掉。'
          + '没有 `applicable_when` 会被服务端拒绝；置信度要严格大于 2.0 才入库'
          + '（如实自评到门槛及以下会被丢弃，那也算尽责——但你必须真的调用一次）。')
      }

      return null
    },

    /** 每步开始前该注入什么提醒；返回文本或 null。 */
    reminder({ sessionId = '', cwd = '' }) {
      const state = session(sessionId)
      if (state.reminders >= cfg.maxReminders) return null
      let text = null
      if (!state.notice) {
        text = readyText(cfg)
      } else if (state.searched.size === 0) {
        text = searchReminderText(cfg)
      } else if (state.saved.size === 0) {
        text = saveReminderText(cfg)
      }
      if (text === null) return null
      state.reminders += 1
      state.notice = true
      return text
    },

    /** 排障用。 */
    state: (sessionId = '') => session(sessionId),
  }
}

function toolNameFallback(name, fallback) {
  return toolName(name, fallback)
}

function readyText(cfg) {
  return `【${cfg.label}经验库】汇报经验库已就绪：写叙事产物（` + '`01-文献/matrix.md` / '
    + '`02-叙事/storyline.md` / `02-叙事/slide-plan.json`）前先调 '
    + `${toolName(cfg.searchTool, '检索工具')}；收尾前调 ${toolName(cfg.saveTool, '沉淀工具')}。`
}

function searchReminderText(cfg) {
  return `【${cfg.label}经验库】本次会话尚未检索历史汇报经验：写叙事产物前先调 `
    + `${toolName(cfg.searchTool, '检索工具')}（传 report_type + tags + 特征文本）。`
    + '命中结果仅作待验证假设，禁止照搬。'
}

function saveReminderText(cfg) {
  return `【${cfg.label}经验库】本次会话尚未沉淀经验：R5 每轮返修后与 R6 交付前调 `
    + `${toolName(cfg.saveTool, '沉淀工具')}；给本轮参考过的经验调用 `
    + `${toolName(cfg.feedbackTool, '反馈工具')} 打分——这是经验池唯一能自我进化的入口。`
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
 * 装载闸门：订阅每步注入与写文件前判定。
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
  const core = createGateCore(cfg, { warn })

  let cache = { at: 0, value: null }
  let warnedUnreachable = false

  /** fail-open 的分界是**经验库可用性**：未接入就不拦任何东西。 */
  const armed = (cwd) => {
    const now = Date.now()
    if (now - cache.at > cfg.readinessTtlMs) cache = { at: now, value: readiness(cwd, cfg) }
    const state = cache.value
    if (state === null && !warnedUnreachable) {
      warnedUnreachable = true
      const d = dataDir(cwd, cfg)
      if (d !== null) {
        warn(`[report-memory-gate] ${d} 下没有 readies=ready 的 ${cfg.readinessFile}：`
          + '闸门关闭，不强制检索/沉淀（经验库未接入）')
      }
    }
    return state !== null
  }

  const sessionIdOf = (agent) => String(agent?.id ?? agent?.session?.id ?? '')
  const cwdOf = (agent) => String(agent?.session?.header?.cwd ?? process.cwd())
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
    if (!cfg.writeTools.includes(exec.name)) return downstream
    const cwd = cwdOf(exec.agent)
    if (!armed(cwd)) return downstream
    if (!claim(exec.callId)) return downstream
    const reason = core.decide({
      sessionId: sessionIdOf(exec.agent),
      toolName: exec.name,
      args: exec.arguments,
      cwd,
    })
    return reason === null ? downstream : { kind: 'deny', reason }
  }

  const observedTools = () => [cfg.searchTool, cfg.saveTool, cfg.feedbackTool].filter(t => t !== '')

  const onPostExecute = async (exec, _result, next) => {
    const downstream = await next()
    if (!ownAgent(exec.agent)) return downstream
    if (observedTools().includes(exec.name)) {
      core.observe({ sessionId: sessionIdOf(exec.agent), toolName: exec.name })
    }
    return downstream
  }

  const onPreStep = async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || payload.signal?.aborted === true) return decision
    if (!ownAgent(payload.agent)) return decision
    const cwd = cwdOf(payload.agent)
    if (!armed(cwd)) return decision
    const sessionId = sessionIdOf(payload.agent)
    if (!claim(`step:${sessionId}:${payload.turn}:${payload.step}`)) return decision
    const text = core.reminder({ sessionId, cwd })
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

  warn(`[report-memory-gate] 已挂载（${cfg.label}）：经验库已接入时 fail-closed，`
    + '强制「写叙事产物前先检索」「写交付物前先沉淀」')
}

/**
 * 自检：把两条规则与逃生阀真跑一遍（`node report-memory-gate.mjs --selftest`）。
 *
 * 注意这里**不测 `armed()`**——它依赖真实文件系统上的 readiness.json，
 * 属接线层；判据本身用注入的 core 直接验证，避免伪造一个"通过"。
 */
function selftest() {
  const failures = []
  let cases = 0
  const check = (label, condition, actual) => {
    cases += 1
    if (condition !== true) failures.push(`✗ ${label}：${actual}`)
  }

  const cfg = { ...DEFAULT_CONFIG, label: '自检模式',
    searchTool: 'mcp__report-memory__report_experience_search',
    saveTool: 'mcp__report-memory__report_experience_save',
    feedbackTool: 'mcp__report-memory__report_experience_feedback' }
  const base = 'C:/work/bike-report'
  const write = (rel) => ({ sessionId: 's1', toolName: 'write',
    args: { file_path: `${base}/${rel}`, content: 'x' }, cwd: 'C:/work' })

  const core = createGateCore(cfg, { warn: () => {} })

  // 未检索 → 写叙事产物被拒
  const storyline = core.decide(write('02-叙事/storyline.md'))
  check('未检索时写 storyline.md 被拒',
    typeof storyline === 'string' && storyline.includes('report_experience_search'), storyline)
  const plan = core.decide(write('02-叙事/slide-plan.json'))
  check('未检索时写 slide-plan.json 被拒',
    typeof plan === 'string' && plan.includes('report_experience_search'), plan)
  const matrix = core.decide(write('01-文献/matrix.md'))
  check('未检索时写 matrix.md 被拒',
    typeof matrix === 'string' && matrix.includes('report_experience_search'), matrix)

  // 非受控产物不被拦
  check('写 extraction.jsonl 不被拦', core.decide(write('01-文献/extraction.jsonl')) === null, '被误拦')
  check('写 brief.md 不被拦', core.decide(write('00-选题/brief.md')) === null, '被误拦')
  check('写项目外文件不被拦', core.decide({ sessionId: 's1', toolName: 'write',
    args: { file_path: 'C:/work/src/foo.ts', content: 'x' }, cwd: 'C:/work' }) === null, '被误拦')
  // 脚本自有产物交给 report-gate，这里必须跳过
  check('汇报说明.md 不由本闸门拦',
    core.decide(write('05-交付/汇报说明.md')) === null, '被本闸门误拦')

  // 检索过之后：叙事产物放行，但交付目录仍被拦（还没沉淀）
  core.observe({ sessionId: 's1', toolName: cfg.searchTool })
  check('检索后 storyline.md 放行', core.decide(write('02-叙事/storyline.md')) === null, '仍被拦')
  const deliver = core.decide(write('05-交付/其他材料.md'))
  check('未沉淀时写交付物被拒',
    typeof deliver === 'string' && deliver.includes('report_experience_save'), deliver)

  // 沉淀过之后：交付目录放行
  core.observe({ sessionId: 's1', toolName: cfg.saveTool })
  check('沉淀后写交付物放行', core.decide(write('05-交付/其他材料.md')) === null, '仍被拦')

  // 反馈工具与沉淀工具互为替代
  const core2 = createGateCore(cfg, { warn: () => {} })
  core2.observe({ sessionId: 's1', toolName: cfg.feedbackTool })
  check('仅反馈过也算尽责（交付目录放行）',
    core2.decide(write('05-交付/其他材料.md')) === null, '被误拦')

  // 会话隔离：另一个会话没有检索过，照拦
  const core3 = createGateCore(cfg, { warn: () => {} })
  core3.observe({ sessionId: 'other', toolName: cfg.searchTool })
  const isolated = core3.decide(write('02-叙事/storyline.md'))
  check('检索状态按会话隔离',
    typeof isolated === 'string' && isolated.includes('report_experience_search'), isolated)

  // 逃生阀
  const core4 = createGateCore({ ...cfg, maxDenials: 2 }, { warn: () => {} })
  const a = core4.decide(write('02-叙事/storyline.md'))
  const b = core4.decide(write('02-叙事/storyline.md'))
  const c = core4.decide(write('02-叙事/storyline.md'))
  check('连续被拒到上限后放行（逃生阀）',
    typeof a === 'string' && typeof b === 'string' && c === null, `${typeof a},${typeof b},${typeof c}`)

  // 提醒文案：三档都会出话，且不点名不存在的工具
  const bare = createGateCore({ ...DEFAULT_CONFIG, label: '空工具名模式' }, { warn: () => {} })
  const bareText = bare.reminder({ sessionId: 'r1', cwd: 'C:/work' })
  check('工具名留空时也有提醒文案（不写出假工具名）',
    typeof bareText === 'string' && !bareText.includes('undefined') && !bareText.includes('mcp__'),
    bareText)
  const core5 = createGateCore(cfg, { warn: () => {} })
  const t1 = core5.reminder({ sessionId: 'r2', cwd: 'C:/work' })
  check('首条提醒是就绪说明', typeof t1 === 'string' && t1.includes('已就绪'), t1)
  const t2 = core5.reminder({ sessionId: 'r2', cwd: 'C:/work' })
  check('第二条提醒催检索', typeof t2 === 'string' && t2.includes('尚未检索'), t2)
  core5.observe({ sessionId: 'r2', toolName: cfg.searchTool })
  const t3 = core5.reminder({ sessionId: 'r2', cwd: 'C:/work' })
  check('第三条提醒催沉淀', typeof t3 === 'string' && t3.includes('尚未沉淀'), t3)
  core5.observe({ sessionId: 'r2', toolName: cfg.saveTool })
  check('尽责之后不再提醒', core5.reminder({ sessionId: 'r2', cwd: 'C:/work' }) === null, '仍在提醒')

  // 注入消息 source 形态（session format v4 producer-owned kind）+ 预设身份守卫
  const sample = injectedMessage('自检提醒')
  check('注入消息 source.kind 为非空字符串且 ≠ plugin',
    typeof sample.source.kind === 'string' && sample.source.kind !== '' && sample.source.kind !== 'plugin',
    JSON.stringify(sample.source))
  check('注入消息 source.kind 为 plugin:report-memory-gate',
    sample.source.kind === 'plugin:report-memory-gate', sample.source.kind)
  check('预设守卫：同预设放行、其它预设不处理',
    ownsPreset('report', 'report') === true && ownsPreset('report', 'crawl') === false,
    `${ownsPreset('report', 'report')}/${ownsPreset('report', 'crawl')}`)
  check('预设守卫：未配置 / 取不到一律不处理（fail-closed）',
    ownsPreset('', 'report') === false && ownsPreset('report', undefined) === false, 'fail-open')

  if (failures.length > 0) {
    console.error(`report-memory-gate selftest 失败：${failures.length}/${cases} 项`)
    for (const f of failures) console.error(`  ${f}`)
    process.exitCode = 1
    return
  }
  console.log(`report-memory-gate selftest 通过：${cases} 项判据全部符合预期`)
}

if (process.argv[1] && process.argv[1].endsWith('report-memory-gate.mjs')
  && process.argv.includes('--selftest')) {
  selftest()
}
