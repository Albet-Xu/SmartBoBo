/**
 * paper-experience-gate —— 论文经验库提醒闸门（fail-open，**只提醒不拦截**）。
 *
 * 设计依据：`docs/研究模式调研/03-论文写作模式设计思路（经验沉淀层）.md`
 * §5.4（挂载点：三个检索点 + 两个沉淀点）、§6.1（闸门：两组规则两种失败姿态）、
 * §7.2 收紧阶段的 D3（**第一阶段只注入提醒、不返回 deny**）。
 *
 * ## 与 research-gate 的关系（刻意分文件）
 *
 * §6.1 原话是「两组住在同一个插件里，各有独立的 `armed()`」。实现上拆成两个插件，
 * **理由**：`research-gate` 是 fail-closed（学术诚信优先）且带着自己的测试套件，
 * 往它里面塞一组 fail-open 规则会让失败姿态的边界变得难验证（正是 §6.1 想避开的 M3/R5）。
 * 拆开后两组各自持有独立的 `armed()`，语义边界由文件边界保证；代价是两处都要挂载。
 *
 * ## 行为
 *
 * - `armed()` = 经验库就绪（`readiness.json` 的 `ready === true`）。**未接入一律不提醒**（fail-open），
 *   与「没配 Qdrant 时论文全流程照常跑通」的验收标准一致。
 * - 只在 `agent/pre-step` 注入提醒；**不订阅 `tools/pre-execute`，不会拒绝任何工具调用**。
 *   D3 收紧时再补 `gatedTools` / `closeTools`——结构已经按那个形状预留。
 * - 同一 (会话, 阶段) 只提醒一次；`maxReminders` 兜底防刷屏。
 * - **S4 写作阶段不提醒检索**（§5.4 / 红线 5：经验不得进正文）；那一步只提示"不要查"。
 * - 预设过滤：事件入口比对 `config.preset` 与 `agentPresets.composedPreset(agent.ctx)`，
 *   取不到（未挂预设 / 子代理未随父加入 / 服务缺席）一律不提醒（fail-closed）；
 *   `stageOf(cwd)` 护栏保留。
 */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const name = 'paper-experience-gate'

/** 事件入口守卫要读 agentPresets 判定会话所属预设。 */
export const inject = ['agentPresets']

/** 可覆盖的默认配置。 */
export const DEFAULT_CONFIG = {
  /** 本实例所属预设 id（预设行 `config.preset`）：只处理该预设的会话，留空一律不处理（fail-closed）。 */
  preset: '',
  /** 出现在提醒文案里的模式名。 */
  label: '论文写作模式',
  /** 经验库数据目录名（与 memory_store 的 DATA_DIR_NAME 一致）。 */
  dataDirName: 'paper-experience',
  /** 就绪快照文件名（与 memory_store 的 readiness 同目录）。 */
  readinessFile: 'readiness.json',
  /** 论文项目的阶段目录名（用于判断 cwd 是否是一个论文项目）。 */
  stageDirs: ['00-选题', '01-文献', '02-数据', '03-分析', '03-实验', '04-稿件', '05-评审'],
  /** 检索工具名：必须写**模型侧的完整工具名** `mcp__<serverName>__paper_experience_search`。留空则该句不点名工具。 */
  searchTool: '',
  /** 沉淀工具名：同上，完整名 `mcp__<serverName>__paper_experience_save`。 */
  saveTool: '',
  /** 逆向库检索工具名（设计稿 D1：数据源类经验走逆向库）。留空 = 本模式未挂逆向库，提醒里不点名、也不承诺能查到。 */
  reverseSearchTool: '',
  /** 同一会话最多注入多少条提醒。 */
  maxReminders: 6,
  /** 单会话记录已提醒过的 (阶段) 上限。 */
  maxClaims: 64,
}

/** 工具名留空时退回不带名字的说法——绝不写出一个实际不存在的工具名。 */
function toolName(name, fallback) {
  return typeof name === 'string' && name !== '' ? `\`${name}\`` : fallback
}

/** 阶段 → 提醒文案。返回 null 表示该阶段不提醒。 */
export function reminderFor(stage, cfg = DEFAULT_CONFIG) {
  const P = `【${cfg.label}·经验库】`
  const search = toolName(cfg.searchTool, '论文经验库的检索工具')
  const save = toolName(cfg.saveTool, '论文经验库的沉淀工具')
  switch (stage) {
    case 'S0':
    case 'S1':
      return `${P}定盘后、写 \`00-选题/design.md\` 之前先用 ${search} 检索**方法经验**`
        + `（传 scope + method_tags + 已观察到的特征）。这一步能改变识别策略、事前分析计划与局限预期——`
        + `不查就可能重蹈覆辙。检索结果只当**待验证假设**，结合本课题实测确认，**禁止照搬**。`
    case 'S2':
      return `${P}动手采集 / 参数标定前先查**方法经验**：调 ${search}。`
        + (cfg.reverseSearchTool === ''
          ? `**本模式未挂逆向经验库**——数据源类的坑（某源分页要带 token、某字段口径在某年变了）没有现成经验可查，`
          + `只能靠实测与向用户确认。`
          : `数据源类的坑（某源分页要带 token、某字段口径在某年变了）在**逆向库**里，`
          + `调 ${toolName(cfg.reverseSearchTool, '逆向经验库的检索工具')}。`)
    case 'S3':
      return `${P}分析阶段多为工具层小坑，检索收益低——**不必专门查**。`
        + `分析完成后直接进 S5/S6 的沉淀点即可。`
    case 'S4':
      return `${P}**写作阶段不要检索经验库。** 经验只能改变流程与检查表，**不能进正文、不能当引用**`
        + `（经验 id 只允许出现在 design.md 与 cleaning-log.md 的「参考经验」字段）。`
    case 'S5':
      return `${P}评审返修后建议查一次**评审常打回点**（${search}，可传 stage=S5）；`
        + `本轮收尾时用 ${save} 沉淀经验——\`05-评审/review.json\` 里 high 严重度的问题`
        + `是最有价值的原料。**注意：盲审的审稿人不许读经验库**，否则等于自己给自己出题。`
    case 'S6':
      return `${P}交付前收尾必做：用 ${save} 沉淀经验（成功/失败/部分成功都要）。`
        + `**先过迁移判据**——这条经验换一个数据集、换一个课题之后还成立吗？不成立就毙掉。`
        + `没有 \`applicable_when\` 会被服务端拒绝。`
    default:
      return null
  }
}

/**
 * 从文件系统推断论文项目**当前所处**阶段（只看产物是否存在，不看口头声明）。
 *
 * 判据：**最早的"出口产物缺失"的阶段**——与六阶段骨架的 `gate` 列一一对应。
 * 不是论文项目（cwd 下没有任何阶段目录）时返回 null。
 */
export function stageOf(base, cfg = DEFAULT_CONFIG) {
  if (!base || !existsSync(base)) return null
  const has = (...p) => existsSync(join(base, ...p))
  if (!cfg.stageDirs.some(d => existsSync(join(base, d)))) return null

  if (!has('00-选题', 'design.md')) return 'S0'
  if (!(has('01-文献', 'positioning.md') || has('01-文献', 'protocol.md'))) return 'S1'
  if (!(has('evidence.jsonl') || has('02-数据', 'cleaning-log.md') || has('02-数据'))) return 'S2'
  if (!(has('03-分析', 'results.json') || has('03-实验', 'results.tsv') || has('03-分析', 'results.tsv'))) return 'S3'
  if (!has('04-稿件', 'paper.md')) return 'S4'
  if (!has('05-评审', 'review.json')) return 'S5'
  if (!has('论文写作说明.md')) return 'S5'      // 评审中/返修中，仍是 S5
  return 'S6'
}

/** 定位经验库数据目录（DSH_HOME / BOBO_ROOT / cwd 三级回退；三池统一在 experience-pool/ 下）。 */
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

/** 读取就绪快照；读不到即视为未就绪（fail-open）。 */
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

export function injectedMessage(text) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: `plugin:${name}` },
  })
}

/**
 * 装载提醒闸门。
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
  const warn = (m) => {
    try {
      if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(m)
      else console.warn(m)
    } catch {
      /* 日志不可用不能影响闸门 */
    }
  }

  const sessionIdOf = (agent) => String(agent?.id ?? agent?.session?.id ?? '')
  const cwdOf = (agent) => String(agent?.session?.header?.cwd ?? process.cwd())
  const claims = new Set()
  const reminders = new Map()
  const claim = (key) => {
    if (claims.has(key)) return false
    if (claims.size >= cfg.maxClaims) claims.delete(claims.values().next().value)
    claims.add(key)
    return true
  }

  const onPreStep = async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || payload.signal?.aborted === true) return decision
    if (!ownAgent(payload.agent)) return decision
    const cwd = cwdOf(payload.agent)
    const sessionId = sessionIdOf(payload.agent)
    if (!claim(`step:${sessionId}:${payload.turn}:${payload.step}`)) return decision

    // fail-open：经验库未就绪不提醒（也不拦截）
    if (readiness(cwd, cfg) === null) return decision

    const base = cwd
    const stage = stageOf(base, cfg)
    if (stage === null) return decision
    if ((reminders.get(sessionId) ?? 0) >= cfg.maxReminders) return decision
    if (!claim(`stage:${sessionId}:${stage}`)) return decision     // 同一阶段只提醒一次

    const text = reminderFor(stage, cfg)
    if (text === null) return decision
    reminders.set(sessionId, (reminders.get(sessionId) ?? 0) + 1)
    return { kind: 'enter', messages: [...decision.messages, injectedMessage(text)] }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.on('agent/pre-step', onPreStep),
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

  warn(`[paper-experience-gate] 已挂载（${cfg.label}）：fail-open，经验库未就绪时不提醒、不拦截`)
}

/**
 * 自检：确保「每个可能触发的阶段都有文案」——一个没有任何阶段会跑的闸门，
 * 就是一个永远不会触发的闸门（§6.1 的教训，对齐 `02` §6.3 的 `--selftest`）。
 *
 * 注意 S3/S4 的文案是**有意不提醒检索**的（"不必查" / "不要查"），但它们仍**必须**有文案：
 * 沉默与"明确告知不要查"是两件事，后者才是红线 5 的执行点。
 *
 * @returns `{ ok, covered, silent, stages }`
 */
export function selftest(cfg = DEFAULT_CONFIG) {
  const stages = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6']
  const covered = stages.filter((s) => reminderFor(s, cfg) !== null)
  const silent = stages.filter((s) => reminderFor(s, cfg) === null)
  // 注入消息 source 形态（session format v4 producer-owned kind）+ 预设身份守卫
  const sample = injectedMessage('自检提醒')
  const sourceKindOk = typeof sample.source.kind === 'string' && sample.source.kind !== ''
    && sample.source.kind !== 'plugin' && sample.source.kind === `plugin:${name}`
  const presetGuardOk = ownsPreset('empirical', 'empirical') === true
    && ownsPreset('empirical', 'experiment') === false
    && ownsPreset('', 'empirical') === false && ownsPreset('empirical', undefined) === false
  return { ok: silent.length === 0 && sourceKindOk && presetGuardOk, covered, silent, stages, sourceKindOk, presetGuardOk }
}

/** 供测试/预设装载自检：不依赖 CLI，直接拿到报告。 */
export function selftestReport(cfg = DEFAULT_CONFIG) {
  const r = selftest(cfg)
  return { ...r, table: Object.fromEntries(r.stages.map((s) => [s, reminderFor(s, cfg) !== null])) }
}

if (process.argv[1] && process.argv[1].endsWith('paper-experience-gate.mjs') && process.argv.includes('--selftest')) {
  const r = selftest()
  console.log(`[paper-experience-gate] selftest: ${r.ok ? 'PASS' : 'FAIL'}`)
  console.log(`  覆盖阶段: ${r.covered.join(' ')}`)
  console.log(`  source.kind: ${r.sourceKindOk ? 'ok' : 'FAIL'}（非空、≠ plugin、为 plugin:${name}）`)
  console.log(`  预设守卫: ${r.presetGuardOk ? 'ok' : 'FAIL'}（同预设放行、异预设/取不到不处理）`)
  if (r.silent.length) console.log(`  ⚠ 无文案（等于永不提醒）: ${r.silent.join(' ')}`)
  process.exit(r.ok ? 0 : 1)
}
