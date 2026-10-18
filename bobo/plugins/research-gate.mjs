/**
 * research-gate —— 论文写作模式的**诚信闸门**。
 *
 * 与 `reverse-memory-gate` 的关键差别是**失败姿态相反**：
 * 经验库闸门是 fail-open（未接入 Qdrant 就不阻塞干活），因为经验层只是锦上添花；
 * 本闸门是 **fail-closed**（学术诚信优先），因为类型包技能是**软加载**——模型可以完全
 * 无视 `SKILL.md`。把「引用必须可核验、数字必须可追溯、没证据不许成文」只写在提示词里
 * 等于没有约束，只有让工具调用被拒才是硬的。
 *
 * 契约：
 * - **判定单位 = 本会话 × 本论文项目 × 阶段**。没有 Qdrant 那类外部就绪条件，
 *   闸门常开；但它只在**路径落在论文项目阶段目录下**时才可能拦截，所以对非论文会话
 *   天然无影响（普通的 `src/foo.ts` 永远不会命中）。
 * - 产物流决定阶段：`00-选题/design.md` → `01-文献/positioning.md` → `02-数据/` →
 *   `03-分析/` → `04-稿件/` → `05-评审/review.json`。**闸门只看产物是否存在，
 *   不看模型的任何口头声明。**
 * - **防死锁**：同一 (规则, 目标) 连续被拒超过 `maxDenials` 次即放行并响亮告警——
 *   这是唯一的逃生阀，且一定会留痕。刻意不提供「静默绕过开关」：模型自己能写文件，
 *   任何文件式白名单都形同虚设。
 *
 * 已知边界（不假装覆盖）：
 * - 只认文件工具（`write` / `edit`）。用 shell 重定向（`>` / `Set-Content`）写文件绕得过去，
 *   与逆向闸门同类边界；学术诚信最终仍由人与评审把关。
 * - 引用键核验（`[@key]`）只比对本项目侧的引用台账 `01-文献/references.jsonl`：键必须在台账里、
 *   状态必须是 `verified`（见 `checkCitationKeys`）。台账由文献工具落盘，闸门另外拦住对台账文件
 *   本身的改写，所以核验的可信度来自「台账只能由库写出」，而不是闸门自己去问文献 MCP。
 *
 * 挂载：论文模式预设各挂一行（相对路径按预设文件目录解析），config 全部可选。
 * 预设过滤：事件入口比对 `config.preset` 与 `agentPresets.composedPreset(agent.ctx)`，
 * 取不到（未挂预设 / 子代理未随父加入 / 服务缺席）一律不处理（fail-closed）。
 * 排障：挂载/放行的留痕走 `ctx.logger.warn`，但 **web profile 下该级别不落到后端 stdout**
 * （与本项目既有的 `reverse-memory-gate` 表现一致，已实测差分确认），所以别指望 grep 启动
 * 日志。要确认闸门判据，跑 `node research-gate.mjs --selftest`；要确认它在真实预设里确实
 * 装上，看 `session.create` 是否成功——预设里任何一行装载失败或注入未满足，整个 mount 都会抛错。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'research-gate'

/** 事件入口守卫要读 agentPresets 判定会话所属预设。 */
export const inject = ['agentPresets']

/** 可覆盖的默认配置。 */
export const DEFAULT_CONFIG = {
  /** 本实例所属预设 id（预设行 `config.preset`）：只处理该预设的会话，留空一律不处理（fail-closed）。 */
  preset: '',
  /** 出现在拒绝理由里的模式名，便于模型与用户对上号。 */
  label: '实证研究模式',
  /** 论文项目的阶段目录名；路径里出现其中之一即可定位项目根与阶段。 */
  stageDirs: ['00-选题', '01-文献', '02-数据', '03-分析', '03-实验', '04-稿件', '05-评审'],
  /**
   * 冻结清单（实验模式）：登记评测脚本与留出集，登记后不许再改。
   * 这是「评测函数冻结」的机械落点——改了它，前面所有实验结论都不再可比。
   */
  frozenEvalFile: '00-选题/frozen.json',
  /** 实验结果台账（实验模式）：只能由实验脚本写出，模型不许手写（手写等于伪造实验记录）。 */
  experimentResultsFile: '03-实验/results.tsv',
  /** 论文写作说明：由 `scripts/paper_report.py` 生成，模型不许手写。 */
  paperReportFile: '论文写作说明.md',
  /** 会被检查的写入类工具。 */
  writeTools: ['write', 'edit'],
  /** 证据层文件（相对项目根）。 */
  evidenceFile: 'evidence.jsonl',
  /** 稿件目录 / 终稿文件名（相对项目根）。 */
  manuscriptDir: '04-稿件',
  finalManuscript: 'paper.md',
  /** 评审结论文件（相对项目根）。 */
  reviewFile: '05-评审/review.json',
  /** 分析目录 / 数据目录（相对项目根）。 */
  analysisDir: '03-分析',
  dataDir: '02-数据',
  /** 文献目录与闸门要读的引用台账（相对项目根）。 */
  literatureDir: '01-文献',
  referencesFile: '01-文献/references.jsonl',
  /**
   * 写 `03-分析/` 是否需要数据集前置。实证/实验模式为 true；
   * **建模模式无数据集，必须置 false**——否则它会被 G3 永久拦住，一个写不进分析的建模模式等于不可用。
   */
  requireDataBeforeAnalysis: true,
  /** 命题核验前置（建模模式）：写稿件前，正文里每个 `P<i>` 都要有核验脚本。 */
  requireProofChecks: false,
  /** 命题核验脚本目录（相对项目根）。 */
  proofsDir: '03-分析/proofs',
  /**
   * 检索留档前置（综述与质性模式）。本模式的头号风险是「凭记忆综述」——
   * 没有检索记录就说明"综述"没有真的检索过，此时不许成文。
   */
  requireSearchLogBeforeManuscript: false,
  /** 检索留档文件（相对项目根）；由文献工具机械追加，不许手写。 */
  searchLogFile: '01-文献/search-log.jsonl',
  /** 同一 (规则, 目标) 连续被拒上限；超过即放行以免工具链卡死。 */
  maxDenials: 3,
  /** 同一会话最多注入多少条提醒。 */
  maxReminders: 12,
  /** 单会话内记录「已判定过的调用」的上限。 */
  maxClaims: 500,
}

/** 从工具参数里取目标文件路径（不同工具用的字段名不同）。 */
export function targetPathOf(args) {
  for (const key of ['file_path', 'filePath', 'path']) {
    const value = args?.[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

/**
 * 从文件路径反推论文项目根与所处阶段目录。
 *
 * 判据是**路径里出现阶段目录名**，因此普通源码路径不会被误判成论文产物。
 * @param filePath - 工具参数里的目标路径（绝对或相对都行）。
 * @param stageDirs - 阶段目录名清单。
 * @returns `{ root, stage, rel }`；不属于任何论文项目时返回 null。
 */
export function projectOf(filePath, stageDirs = DEFAULT_CONFIG.stageDirs) {
  const normalized = String(filePath ?? '').replace(/\\/g, '/')
  if (normalized === '') return null
  const parts = normalized.split('/')
  const at = parts.findIndex(part => stageDirs.includes(part))
  if (at < 0) return null
  return {
    root: parts.slice(0, at).join('/'),
    stage: parts[at],
    rel: parts.slice(at).join('/'),
  }
}

/** 取出写入类工具真正落到文件里的文本（`write` 用 content，`edit` 用 new_string）。 */
export function textOf(args) {
  for (const key of ['content', 'new_string', 'newString', 'new_str']) {
    const value = args?.[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return ''
}

/** 抽出正文里用到的全部引用键（`[@key]`）。 */
export function citationKeysIn(text) {
  const found = new Set()
  // 先取方括号组，再在组内找 `@key`：键只到第一个逗号/空白为止。
  // 旧写法 `/\[@([^\]\s]+)\]/` 有两个洞：`[@wang2019, p.12]` 因为中间有空格**整条漏掉**
  // （引用键绕过 G4 核验，fail-open）；`[@wang2019,p.12]` 又把 `wang2019,p.12` 当成键
  // （台账里必然没有，误拦）。同一组里的多键写法 `[@a; @b]` 现在也一并抽出。
  for (const group of String(text ?? '').matchAll(/\[([^\]]*)\]/g)) {
    for (const match of group[1].matchAll(/@([A-Za-z0-9_][A-Za-z0-9_.:-]*)/g)) found.add(match[1])
  }
  return [...found]
}

/**
 * 读项目侧引用台账 `01-文献/references.jsonl`，返回 `key → status`。
 *
 * 台账不存在时返回 **null**——它与「台账在、但没有这个键」是两回事，理由文案完全不同。
 * 坏行直接跳过（台账由脚本生成，坏行说明被人手改过，不该让闸门崩掉）。
 */
export function readLedger(base, cfg) {
  const file = join(base, cfg.referencesFile)
  if (!existsSync(file)) return null
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const status = new Map()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const row = JSON.parse(trimmed)
      if (typeof row?.key === 'string') status.set(row.key, String(row.status ?? 'missing'))
    } catch {
      /* 坏行跳过 */
    }
  }
  return status
}

/**
 * G4：稿件里用到的每个 `[@key]` 都必须在引用台账里、且状态为 `verified`。
 *
 * 正文里一个键都没有时**不拦**——写「研究设计」这类无引用章节，不该被要求先备好台账。
 * @returns 拒绝理由，或 null 表示放行。
 */
export function checkCitationKeys(base, cfg, text) {
  const keys = citationKeysIn(text)
  if (keys.length === 0) return null
  const ledger = readLedger(base, cfg)
  if (ledger === null) {
    return `【${cfg.label}·诚信闸门】正文用了 ${keys.length} 个引用键，但 ${cfg.referencesFile} 还不存在：`
      + '请先用文献工具（literature_references）把用到的引用导出成项目侧台账，再写带引用的稿件。'
      + '**不要手写台账**——它必须由文献库落盘，否则它就不是核验依据了。'
  }
  const unknown = keys.filter(key => !ledger.has(key))
  const bad = keys.filter(key => ledger.has(key) && ledger.get(key) !== 'verified')
  if (unknown.length === 0 && bad.length === 0) return null
  const parts = []
  if (unknown.length > 0) {
    parts.push(`台账里没有：${unknown.join('、')}（多半是编造引用或键写错，先删掉或重新检索）`)
  }
  if (bad.length > 0) {
    parts.push(`状态不是 verified：${bad.join('、')}（没有外部标识、第三方无法核实，不许进正文）`)
  }
  return `【${cfg.label}·诚信闸门】引用键未通过核验，先处理再写：${parts.join('；')}。`
    + '处理完重跑导出，台账会覆盖更新。'
}

/**
 * 命题核验前置（建模模式）：正文里提到的每个命题 `P<i>` 都要有核验记录。
 *
 * 建模研究的头号风险是「推导错了但看起来对」。只写"我已推导"不可核验；有了
 * `P<i>-check.py`，任何人都能重跑并看到结论是否被数值反例打掉。
 *
 * 正文里一个 `P<i>` 都没有时不拦（改摘要、写文献综述这类阶段本就不涉及命题）。
 * @returns 拒绝理由，或 null 表示放行。
 */
export function checkProofChecks(base, cfg, text) {
  if (cfg.requireProofChecks !== true) return null
  const ids = [...new Set([...String(text ?? '').matchAll(/\bP(\d+)\b/g)].map(match => `P${match[1]}`))]
  if (ids.length === 0) return null
  const missing = ids.filter(id => !existsSync(join(base, cfg.proofsDir, `${id}-check.py`)))
  if (missing.length === 0) return null
  return `【${cfg.label}·诚信闸门】正文引用了命题但缺核验记录：${missing.join('、')}。`
    + `请为每个命题落一个 \`${cfg.proofsDir}/<命题>-check.py\`（符号验证 + 数值验证双路）并留下输出。`
    + '本类型最怕「推导错了但看起来对」——没有可复现的核验脚本，错误不会被发现。'
}

/**
 * 冻结清单里登记的路径（相对项目根，已归一化）。
 *
 * 清单形状：`{ "frozen": ["03-实验/eval.py", {"path": "02-数据/test.csv"}] }`。
 * 文件不存在或解析失败时返回空数组——**不许因为读不到清单就放行所有写入**，
 * 但也确实没有清单可依，所以只能放行（闸门在这一点上会由 `maxDenials` 与评审兜底）。
 */
export function frozenPaths(base, cfg) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(join(base, cfg.frozenEvalFile), 'utf8'))
  } catch {
    return []
  }
  const list = Array.isArray(parsed?.frozen) ? parsed.frozen : []
  return list
    .map(entry => (typeof entry === 'string' ? entry : entry?.path))
    .filter(value => typeof value === 'string' && value.trim() !== '')
    .map(value => value.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
}

/** 证据层是否已就位：文件存在，且至少有一行能解析成带 id/claim 的对象。 */
function evidenceReady(base, cfg) {
  const file = join(base, cfg.evidenceFile)
  if (!existsSync(file)) return false
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return false
  }
  return text.split('\n').some((line) => {
    const trimmed = line.trim()
    if (trimmed === '') return false
    try {
      const row = JSON.parse(trimmed)
      return typeof row?.id === 'string' && typeof row?.claim === 'string'
    } catch {
      return false
    }
  })
}

/**
 * 一条高严重度问题是否已**了结**。
 *
 * 两条路都算：改掉了（`resolved`），或明确决定不改但写清了理由（`wontfix` + `reason`）。
 * 后者是必要的——设计上「不修改也必须写理由」是合法结论。若只认 `resolved`，那么
 * 合理的不修改会永久卡住定稿，反而**逼模型把 high 降级成 medium 来绕闸门**，比放行更糟。
 * 缺 `status`、或 `wontfix` 没写理由，一律按未了结算。
 */
function isSettled(issue) {
  const status = String(issue?.status ?? '').toLowerCase()
  if (status === 'resolved') return true
  if (status === 'wontfix') {
    const reason = issue?.reason ?? issue?.justification
    return typeof reason === 'string' && reason.trim().length > 0
  }
  return false
}

/**
 * 评审结论是否干净：文件存在，且没有**未了结的高严重度**问题。
 *
 * `review.json` 的约定形状：`{ round, language, dimensions: [{ name, score, basis }],
 * issues: [{ id, severity, where, problem, suggestion, status, resolution?, reason? }],
 * verdict }`。缺 `status` 一律按**未了结**算（从严）。
 * @returns `{ exists, unresolved }`。
 */
function reviewState(base, cfg) {
  const file = join(base, cfg.reviewFile)
  if (!existsSync(file)) return { exists: false, unresolved: [] }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { exists: true, unresolved: ['<review.json 不是合法 JSON>'] }
  }
  const issues = Array.isArray(parsed?.issues) ? parsed.issues : []
  const unresolved = issues
    .filter(issue => String(issue?.severity ?? '').toLowerCase() === 'high')
    .filter(issue => !isSettled(issue))
    .map(issue => String(issue?.id ?? issue?.where ?? '<未命名>'))
  return { exists: true, unresolved }
}

/** 数据集是否已就位：清洗日志存在，或 `02-数据/` 下有 `dataset_*.csv` 快照。 */
function dataReady(base, cfg) {
  const dir = join(base, cfg.dataDir)
  if (!existsSync(dir)) return false
  if (existsSync(join(dir, 'cleaning-log.md'))) return true
  try {
    return readdirSync(dir).some(entry => /^dataset_.*\.csv$/i.test(String(entry)))
  } catch {
    return false
  }
}

/**
 * 按产物推断当前阶段。闸门不看模型的声明，只用磁盘上的事实。
 * @param base - 论文项目根（或会话工作区，当路径为相对路径时）。
 * @param cfg - 见 {@link DEFAULT_CONFIG}。
 * @returns `{ id, title, gate }`。
 */
export function inferStage(base, cfg = DEFAULT_CONFIG) {
  const has = (rel) => existsSync(join(base, rel))
  if (!has(join('00-选题', 'design.md'))) {
    return { id: 'S0', title: '开局定盘', gate: '写完 `00-选题/design.md`（含语言、识别策略、事前分析计划）并与用户确认' }
  }
  // S1 的产物随方法族不同：定位稿（实证/建模）或协议（综述与质性）。
  if (!has(join('01-文献', 'positioning.md')) && !has(join('01-文献', 'protocol.md'))) {
    return {
      id: 'S1',
      title: '选题与定位',
      gate: '写完 `01-文献/positioning.md`（综述与质性模式为 `01-文献/protocol.md`），给出明确的贡献声明与可复现的检索式',
    }
  }
  if (!dataReady(base, cfg)) {
    return { id: 'S2', title: '证据获取', gate: '产出 `02-数据/` 数据集与 `cleaning-log.md`，并冻结数据版本' }
  }
  if (!has(join('03-分析', 'results.json'))) {
    return { id: 'S3', title: '分析与论证', gate: '产出 `03-分析/results.json`，完成本模式强制稳健性组' }
  }
  if (!has(join(cfg.manuscriptDir, cfg.finalManuscript))) {
    return { id: 'S4', title: '结构化写作', gate: '分节写成 `04-稿件/` 各节，再合成 `paper.md`' }
  }
  if (!has(cfg.reviewFile)) {
    return { id: 'S5', title: '自评审与返修', gate: '产出 `05-评审/review.json` 与 `revision-log.md`，处理掉全部高严重度项' }
  }
  return { id: 'S6', title: '产出与交付', gate: '整理可复现包与 `投稿转换说明.md`' }
}

/**
 * 闸门判定核心（纯逻辑，只读磁盘；不接触 dsh，便于单独验证）。
 * @param config - 见 {@link DEFAULT_CONFIG}。
 * @param log - `{ warn(message) }`，可选。
 * @returns `decide` / `reminder` / `state`。
 */
export function createGateCore(config = {}, log = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const warn = typeof log.warn === 'function' ? log.warn : () => {}
  const sessions = new Map()

  const session = (id) => {
    let state = sessions.get(id)
    if (state === undefined) {
      if (sessions.size > 200) sessions.delete(sessions.keys().next().value)
      state = { denials: new Map(), reminders: 0, intro: false }
      sessions.set(id, state)
    }
    return state
  }

  /** 防死锁：同一 (规则, 目标) 连续被拒到上限就放行并告警。 */
  const deny = (state, key, reason) => {
    const seen = state.denials.get(key) ?? 0
    if (seen >= cfg.maxDenials) {
      warn(`[research-gate] ${key} 已连续 ${seen} 次被拒，放行以免阻塞（请人工复核该处诚信前提）`)
      return null
    }
    state.denials.set(key, seen + 1)
    return reason
  }

  /** 检索留档是否已就位：文件存在，且至少有一行带 `query` 的记录。空文件不算留档。 */
  const searchLogReady = (base) => {
    const file = join(base, cfg.searchLogFile)
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      return false
    }
    return text.split('\n').some((line) => {
      const trimmed = line.trim()
      if (trimmed === '') return false
      try {
        return typeof JSON.parse(trimmed)?.query === 'string'
      } catch {
        return false
      }
    })
  }

  return {
    /**
     * 写文件前判定。
     * @param request - `{ sessionId, toolName, args, cwd }`。
     * @returns 拒绝理由字符串，或 null 表示放行。
     */
    decide({ sessionId = '', toolName, args, cwd = '' }) {
      if (!cfg.writeTools.includes(toolName)) return null
      const target = targetPathOf(args)
      const state = session(sessionId)

      // 论文写作说明位于**项目根**，不属于任何阶段目录，所以 `projectOf` 认不出它 —— 先单独判。
      // 只按文件名匹配：这个文件名专属于本工作流，路径要么就是它，要么以 `/它` 结尾。
      const normalized = target.replace(/\\/g, '/')
      if (normalized === cfg.paperReportFile || normalized.endsWith(`/${cfg.paperReportFile}`)) {
        const reportBase = normalized === cfg.paperReportFile
          ? String(cwd ?? '')
          : normalized.slice(0, -(cfg.paperReportFile.length + 1))
        return deny(state, `report:${reportBase}`,
          `【${cfg.label}·诚信闸门】${cfg.paperReportFile} 由 \`scripts/paper_report.py\` 生成，不能手写——`
          + '它记录的是盘上的事实（哪些文件存在、各节多少字、引用与证据各有多少条），'
          + '手写它就等于伪造过程记录。'
          + '请运行 `python <BoBo根>/scripts/paper_report.py <论文项目目录>` 生成或覆盖。')
      }

      const project = projectOf(target, cfg.stageDirs)
      if (project === null) return null
      const base = project.root !== '' ? project.root : String(cwd ?? '')
      if (base === '') return null

      // 台账是引用核验的依据：能用文件工具改它，整套核验就失效了。文献工具写它不走
      // 文件工具，所以拦这里不影响正常导出。
      if (project.rel === cfg.referencesFile) {
        return deny(state, `ledger:${base}`,
          `【${cfg.label}·诚信闸门】${cfg.referencesFile} 是引用核验的依据，必须由文献库落盘，`
          + '不能手写或手改——改它等于伪造核验记录。要更新台账请重跑 literature_references。')
      }

      // 冻结清单（实验模式）：评测脚本与留出集一经登记不许再改。
      // **首次写入允许**（建立冻结），此后一律拒绝——同一个文件既能冻结又能解冻就不叫冻结。
      if (project.rel === cfg.frozenEvalFile && existsSync(join(base, cfg.frozenEvalFile))) {
        return deny(state, `frozen:${base}`,
          `【${cfg.label}·诚信闸门】${cfg.frozenEvalFile} 已建立，不能改写：`
          + '冻结清单一旦可改，前面所有实验结论就失去了可比性（等于改了尺子再量一遍）。'
          + '确需更换评测口径，请开一轮**新的预注册**，而不是改这份清单。')
      }

      // 清单里登记的文件（评测脚本、留出集）一律不许改——这才是「评测函数冻结」的落点。
      for (const entry of frozenPaths(base, cfg)) {
        if (project.rel === entry || project.rel.endsWith(`/${entry}`) || entry.endsWith(`/${project.rel}`)) {
          return deny(state, `frozenhit:${base}:${entry}`,
            `【${cfg.label}·诚信闸门】${entry} 已在冻结清单里登记，不能修改：`
            + '评测脚本或留出集一旦改动，之前跑出的所有结果都不再与它可比（等于改了尺子再量一遍），'
            + '本轮的实验结论需要整体作废。'
            + '确需更换评测口径，请开一轮**新的预注册**并在其中说明为什么要换。')
        }
      }

      // 实验结果台账：只能由实验脚本写出。
      if (project.rel === cfg.experimentResultsFile) {
        return deny(state, `results:${base}`,
          `【${cfg.label}·诚信闸门】${cfg.experimentResultsFile} 必须由实验脚本写出，不能手写或手改——`
          + '手写的台账等于伪造实验记录，而它正是后面所有数字的来源。'
          + '要补记一行，请改脚本重跑，让脚本自己追加。')
      }

      if (project.rel.startsWith(`${cfg.manuscriptDir}/`)) {
        const file = project.rel.slice(cfg.manuscriptDir.length + 1)
        if (file === cfg.finalManuscript) {
          const review = reviewState(base, cfg)
          if (!review.exists) {
            return deny(state, `review:${base}`, reviewReason(cfg, base))
          }
          if (review.unresolved.length > 0) {
            return deny(state, `review-open:${base}`, unresolvedReason(cfg, review.unresolved))
          }
        }
        if (!evidenceReady(base, cfg)) {
          return deny(state, `evidence:${base}`, evidenceReason(cfg, base))
        }
        // 检索留档前置：综述与质性研究的稿件必须建立在「真的检索过」之上
        if (cfg.requireSearchLogBeforeManuscript === true && !searchLogReady(base)) {
          return deny(state, `searchlog:${base}`,
            `【${cfg.label}·诚信闸门】要写稿件，但 ${cfg.searchLogFile} 不存在或没有可用记录：`
            + '本次研究没有检索留档。请用文献工具检索，**每次传 `log_dir` 指向 `01-文献/`**，'
            + '工具会把检索式与命中机械地追加进去。**不要手写这个文件**——'
            + '手写的留档等于没留档，而本模式最怕的正是「凭记忆综述」。')
        }
        const keyProblem = checkCitationKeys(base, cfg, textOf(args))
        if (keyProblem !== null) return deny(state, `keys:${base}`, keyProblem)
        const proofProblem = checkProofChecks(base, cfg, textOf(args))
        if (proofProblem !== null) return deny(state, `proofs:${base}`, proofProblem)
      }

      // 数据前置只在实证/实验类模式开启：建模模式没有数据集，照这条会被永久拦住。
      if (cfg.requireDataBeforeAnalysis === true
        && project.rel.startsWith(`${cfg.analysisDir}/`)
        && !dataReady(base, cfg)) {
        return deny(state, `data:${base}`, dataReason(cfg, base))
      }

      return null
    },

    /** 每步开始前该注入什么提醒；返回文本或 null。 */
    reminder({ sessionId = '', cwd = '' }) {
      const state = session(sessionId)
      if (state.reminders >= cfg.maxReminders) return null
      const base = String(cwd ?? '')
      if (base === '' || !existsSync(base)) return null
      const stage = inferStage(base, cfg)
      // 只在会话真正落在论文项目里时才发声，避免给采集/写代码的会话添噪音。
      if (!state.intro && stage.id === 'S0' && !hasPaperProject(base, cfg)) return null
      const text = state.intro ? stageReminder(cfg, stage) : introText(cfg, stage)
      state.intro = true
      state.reminders += 1
      return text
    },

    /** 排障用。 */
    state: (sessionId = '') => session(sessionId),
  }
}

/** 会话工作区里是否已经有论文项目的痕迹。 */
function hasPaperProject(base, cfg) {
  return cfg.stageDirs.some(dir => existsSync(join(base, dir)))
}

function evidenceReason(cfg, base) {
  return `【${cfg.label}·诚信闸门】要往 ${cfg.manuscriptDir}/ 写稿件，但证据层还没就位：`
    + `请先建立 ${cfg.evidenceFile}（相对项目根 ${base}），并至少写入一条证据记录——`
    + '一条一行 JSON，必须含 `id` 与 `claim`，`source` 指向真实存在的文件或记录。'
    + '正文里的每个数字与每条引用都必须能追到一条证据；没有证据就不许成文。'
    + '若某处确实缺证据，回到对应阶段补，或如实降级表述、写进局限。'
}

function reviewReason(cfg, base) {
  return `【${cfg.label}·诚信闸门】要写终稿 ${cfg.finalManuscript}，但还没有评审结论：`
    + `请先产出 ${cfg.reviewFile}（相对项目根 ${base}）——`
    + '含 `issues: [{ id, severity, where, problem, suggestion, status }]` 与 `verdict`。'
    + '走完一轮自评审再定稿，是本模式的硬性流程。'
}

function unresolvedReason(cfg, ids) {
  return `【${cfg.label}·诚信闸门】评审还有未了结的高严重度问题，不能定稿：${ids.join('、')}。`
    + '请逐条了结：能改的改掉，把 `status` 置为 `resolved` 并在 `resolution` 写明改了什么；'
    + '确实不该改的置为 `wontfix` 并在 `reason` 写清为什么（「不修改」不写理由等于没处理）。'
    + '两条路都要在 revision-log.md 留痕，但**不许把 high 降级成 medium 来放行**。'
}

function dataReason(cfg, base) {
  return `【${cfg.label}·诚信闸门】要往 ${cfg.analysisDir}/ 写分析，但数据还没就位：`
    + `请先在 ${cfg.dataDir}/（相对项目根 ${base}）产出数据集快照（\`dataset_v1.csv\`）与 \`cleaning-log.md\`。`
    + '分析必须跑在冻结过的数据版本上——先有数据与清洗记录，再写分析脚本。'
}

function introText(cfg, stage) {
  return `【${cfg.label}·阶段闸门】当前阶段（按产物推断）：${stage.id} ${stage.title}。`
    + `本阶段出口：${stage.gate}。闸门只看产物是否存在，不看口头声明。`
    + `本模式硬性前提：往 ${cfg.manuscriptDir}/ 写稿件前 ${cfg.evidenceFile} 必须非空；`
    + `写 ${cfg.finalManuscript} 前必须先有干净的 ${cfg.reviewFile}。`
}

function stageReminder(cfg, stage) {
  return `【${cfg.label}·阶段闸门】仍在 ${stage.id} ${stage.title}：${stage.gate}。`
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
    if (!claim(exec.callId)) return downstream
    const reason = core.decide({
      sessionId: sessionIdOf(exec.agent),
      toolName: exec.name,
      args: exec.arguments,
      cwd: cwdOf(exec.agent),
    })
    return reason === null ? downstream : { kind: 'deny', reason }
  }

  const onPreStep = async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || payload.signal?.aborted === true) return decision
    if (!ownAgent(payload.agent)) return decision
    const sessionId = sessionIdOf(payload.agent)
    if (!claim(`step:${sessionId}:${payload.turn}:${payload.step}`)) return decision
    const text = core.reminder({ sessionId, cwd: cwdOf(payload.agent) })
    if (text === null) return decision
    return { kind: 'enter', messages: [...decision.messages, injectedMessage(text)] }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.on('tools/pre-execute', onPreExecute),
      ctx.on('agent/pre-step', onPreStep),
      ctx.root.on('tools/pre-execute', onPreExecute),
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

  warn(`[research-gate] 已挂载（${cfg.label}）：fail-closed，拦截写稿前的证据层/评审缺失`)
}

/**
 * 自检：把各判据真跑一遍（`node research-gate.mjs --selftest`）。
 *
 * fixture 全建在系统临时目录里，跑完即删，不在仓库留文件。
 * 判据之外的接线（`apply` 的事件订阅）要真实 dsh 运行时，显式跳过而不是伪造通过。
 */
function selftest() {
  const failures = []
  let cases = 0
  /** 记一条用例；不满足时记下实际值。 */
  const check = (label, condition, actual) => {
    cases += 1
    if (condition !== true) failures.push(`✗ ${label}：${actual}`)
  }
  /** 值比较（只用于可 JSON 序列化的值）。 */
  const eq = (label, actual, expected) => {
    check(label, JSON.stringify(actual) === JSON.stringify(expected),
      `${JSON.stringify(actual)}（期望 ${JSON.stringify(expected)}）`)
  }
  /** 判定结果必须是有内容的字符串，且提到 token（拒绝理由 / 提醒文本）。 */
  const contains = (label, value, token) => {
    check(label, typeof value === 'string' && value.includes(token), JSON.stringify(value))
  }
  /** 判定结果必须是放行。 */
  const allowed = (label, value) => check(label, value === null, JSON.stringify(value))

  /** 建一个临时论文项目目录跑用例，跑完连同 fixture 一起删。 */
  const withProject = (run) => {
    const root = mkdtempSync(join(tmpdir(), 'research-gate-selftest-'))
    /** 项目内相对路径 → 绝对 posix 路径（`decide` 收到的参数就是这个形状）。 */
    const at = (rel) => join(root, ...rel.split('/')).replace(/\\/g, '/')
    /** 按项目内相对路径写文件，自动建父目录。 */
    const put = (rel, text = '') => {
      const file = join(root, ...rel.split('/'))
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text, 'utf8')
    }
    try {
      run({ root, at, put })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  const cfg = { ...DEFAULT_CONFIG, label: '自检模式' }

  // 工具参数读取
  eq('targetPathOf 按字段名优先级取值', targetPathOf({ file_path: 'a.md', path: 'b.md' }), 'a.md')
  eq('targetPathOf 去掉首尾空白', targetPathOf({ path: '  b.md  ' }), 'b.md')
  eq('targetPathOf 都不是非空字符串 → 空串', targetPathOf({ file_path: '   ', path: 42 }), '')
  eq('textOf 空 content 落到 new_string', textOf({ content: '', new_string: '正文' }), '正文')
  eq('textOf 没有写入文本 → 空串', textOf({ file_path: 'a.md' }), '')

  // 阶段推断：只认盘上的产物
  withProject(({ root, put }) => {
    eq('inferStage 无任何产物 → S0', inferStage(root, cfg).id, 'S0')
    put('00-选题/design.md')
    eq('inferStage 定盘后 → S1', inferStage(root, cfg).id, 'S1')
    put('01-文献/positioning.md')
    eq('inferStage 定位后 → S2 证据获取', inferStage(root, cfg).id, 'S2')
    put('02-数据/cleaning-log.md')
    eq('inferStage 数据就位 → S3', inferStage(root, cfg).id, 'S3')
    put('03-分析/results.json', '{}')
    eq('inferStage 分析就位 → S4 稿件层', inferStage(root, cfg).id, 'S4')
    put('04-稿件/paper.md')
    eq('inferStage 成稿后 → S5 评审层', inferStage(root, cfg).id, 'S5')
    put('05-评审/review.json', '{"issues":[]}')
    eq('inferStage 评审后 → S6', inferStage(root, cfg).id, 'S6')
    eq('inferStage 阶段标题随 id 走', inferStage(root, cfg).title, '产出与交付')
  })

  // 综述与质性模式：协议稿也算 S1 出口
  withProject(({ root, put }) => {
    put('00-选题/design.md')
    put('01-文献/protocol.md')
    eq('inferStage 协议模式 → S2', inferStage(root, cfg).id, 'S2')
  })

  // 项目定位：阶段目录名是唯一判据，项目外路径不许命中
  withProject(({ root }) => {
    const here = root.replace(/\\/g, '/')
    eq('projectOf 绝对路径 → 项目根/阶段/相对路径',
      projectOf(`${here}/04-稿件/paper.md`),
      { root: here, stage: '04-稿件', rel: '04-稿件/paper.md' })
    eq('projectOf 反斜杠路径', projectOf('E:\\ws\\proj\\02-数据\\x.csv'),
      { root: 'E:/ws/proj', stage: '02-数据', rel: '02-数据/x.csv' })
    eq('projectOf 项目外路径 → null', projectOf('dsh/packages/bobo/plugins/research-gate.mjs'), null)
    eq('projectOf 空路径 → null', projectOf(''), null)
  })

  // 提醒注入：会话不在论文项目里就不发声
  withProject(({ root, put }) => {
    const core = createGateCore(cfg)
    allowed('reminder 非论文工作区 → 不发声', core.reminder({ sessionId: 'r1', cwd: root }))
    allowed('reminder cwd 不存在 → 不发声', core.reminder({ sessionId: 'r2', cwd: `${root}/缺失目录` }))
    put('00-选题/.keep')
    contains('reminder 论文项目 S0 → 注入阶段提醒',
      core.reminder({ sessionId: 'r3', cwd: root }), '·阶段闸门】当前阶段')
  })

  // 引用键抽取与台账核验（G4）
  withProject(({ root, put }) => {
    eq('citationKeysIn 抽取并去重',
      citationKeysIn('如 [@smith2020] 所述；另见 [@wang2019]，与 [@smith2020] 同源。'),
      ['smith2020', 'wang2019'])
    eq('citationKeysIn 无引用 → 空数组', citationKeysIn('这里没有任何引用键。'), [])
    eq('citationKeysIn 只有 @ 没有键 → 空数组', citationKeysIn('[@]、[@ ] 都不算合法键'), [])
    eq('citationKeysIn 带空格页码 → 只取键', citationKeysIn('见 [@wang2019, p.12]。'), ['wang2019'])
    eq('citationKeysIn 紧贴页码 → 只取键', citationKeysIn('见 [@wang2019,p.12]。'), ['wang2019'])
    eq('citationKeysIn 同组多键 → 全抽出', citationKeysIn('见 [@a; @b]。'), ['a', 'b'])

    const noLedger = readLedger(root, cfg)
    check('readLedger 台账不存在 → null', noLedger === null, String(noLedger))
    allowed('checkCitationKeys 正文无引用键 → 不拦', checkCitationKeys(root, cfg, '无引用的研究设计章节。'))
    contains('checkCitationKeys 台账不存在 → 报错', checkCitationKeys(root, cfg, '见 [@a]。'), '还不存在')

    put('01-文献/references.jsonl', [
      '{"key":"a","status":"verified"}',
      '{"key":"b","status":"pending"}',
      '{"key":"c"}',
      '这行不是 JSON',
    ].join('\n') + '\n')
    const ledger = readLedger(root, cfg)
    eq('readLedger 读出键与状态', [ledger.get('a'), ledger.get('b')], ['verified', 'pending'])
    eq('readLedger 缺 status → 记为 missing', ledger.get('c'), 'missing')
    eq('readLedger 坏行跳过', ledger.size, 3)
    allowed('checkCitationKeys 键已 verified → 放行', checkCitationKeys(root, cfg, '见 [@a]。'))
    contains('checkCitationKeys 台账里没有该键 → 报错', checkCitationKeys(root, cfg, '见 [@z]。'), '台账里没有：z')
    contains('checkCitationKeys 状态非 verified → 报错', checkCitationKeys(root, cfg, '见 [@b]。'), '状态不是 verified：b')
  })

  // 命题核验前置（建模模式）
  withProject(({ root, put }) => {
    const proofCfg = { ...cfg, requireProofChecks: true }
    const text = '命题 P1 已证，命题 P2 待核验。'
    contains('checkProofChecks 缺核验脚本 → 报错', checkProofChecks(root, proofCfg, text), '缺核验记录：P1、P2')
    put('03-分析/proofs/P1-check.py', '# 符号验证 + 数值验证\n')
    contains('checkProofChecks 只缺 P2 → 报错', checkProofChecks(root, proofCfg, text), '缺核验记录：P2')
    put('03-分析/proofs/P2-check.py')
    allowed('checkProofChecks 命题都有核验脚本 → 放行', checkProofChecks(root, proofCfg, text))
    allowed('checkProofChecks 正文无命题 → 不拦', checkProofChecks(root, proofCfg, '本段不涉及命题。'))
    allowed('checkProofChecks 未开前置 → 不拦', checkProofChecks(root, cfg, text))
  })

  // 判据主链：证据层未就位不许写稿，评审没干净不许定稿
  withProject(({ root, at, put }) => {
    const core = createGateCore(cfg)
    put('00-选题/design.md')
    put('01-文献/positioning.md')
    put('02-数据/cleaning-log.md')
    const section = at('04-稿件/01-引言.md')
    const final = at('04-稿件/paper.md')

    allowed('decide 非写入类工具 → 放行',
      core.decide({ sessionId: 'g1', toolName: 'read', args: { file_path: section }, cwd: root }))
    allowed('decide 项目外路径 → 放行',
      core.decide({ sessionId: 'g2', toolName: 'write', args: { file_path: 'src/foo.ts' }, cwd: root }))
    contains('decide 证据层未就位就写稿 → 拒绝',
      core.decide({ sessionId: 'g3', toolName: 'write', args: { file_path: section }, cwd: root }),
      '证据层还没就位')

    put('evidence.jsonl', '{"id":"E1","claim":"政策实施后 ESG 得分上升"}\n')
    allowed('decide 证据就位后写稿 → 放行',
      core.decide({ sessionId: 'g4', toolName: 'write', args: { file_path: section }, cwd: root }))

    const quoted = (sessionId) => core.decide({
      sessionId, toolName: 'write', args: { file_path: section, content: '见 [@a]。' }, cwd: root,
    })
    contains('decide 稿件引用键无台账 → 拒绝', quoted('g5'), '还不存在')
    put('01-文献/references.jsonl', '{"key":"a","status":"verified"}\n')
    allowed('decide 稿件引用键已核验 → 放行', quoted('g6'))
    contains('decide 稿件引用键不在台账 → 拒绝',
      core.decide({ sessionId: 'g7', toolName: 'write', args: { file_path: section, content: '见 [@zz]。' }, cwd: root }),
      '台账里没有：zz')

    const toFinal = (sessionId) => core.decide({
      sessionId, toolName: 'write', args: { file_path: final }, cwd: root,
    })
    contains('decide 写终稿但无评审结论 → 拒绝', toFinal('g8'), '还没有评审结论')
    put('05-评审/review.json', JSON.stringify({ issues: [{ id: 'R1', severity: 'high', status: 'open' }] }))
    contains('decide 有未了结高严重度项 → 拒绝', toFinal('g9'), '未了结的高严重度问题')
    put('05-评审/review.json', JSON.stringify({ issues: [{ id: 'R1', severity: 'high', status: 'wontfix' }] }))
    contains('decide wontfix 没写理由 → 仍按未了结拒绝', toFinal('g10'), '未了结的高严重度问题')
    put('05-评审/review.json', JSON.stringify({
      issues: [{ id: 'R1', severity: 'high', status: 'wontfix', reason: '数据可得性限制，写进局限' }],
    }))
    allowed('decide 高严重度项已了结 → 放行', toFinal('g11'))
    put('05-评审/review.json', JSON.stringify({
      issues: [{ id: 'R1', severity: 'high', status: 'resolved', resolution: '改写了第 3 节的表述' }],
    }))
    allowed('decide 高严重度项已 resolved → 放行', toFinal('g12'))
    put('05-评审/review.json', '{ 这不是 JSON')
    contains('decide 评审文件不是合法 JSON → 拒绝', toFinal('g13'), '未了结的高严重度问题')
  })

  // 台账保护、冻结清单、脚本产物不许手写；数据前置
  withProject(({ root, at, put }) => {
    const core = createGateCore(cfg)
    put('00-选题/design.md')
    put('01-文献/positioning.md')

    contains('decide 手写引用台账 → 拒绝',
      core.decide({ sessionId: 'h1', toolName: 'write', args: { file_path: at('01-文献/references.jsonl') }, cwd: root }),
      '不能手写或手改')
    contains('decide 手写实验台账 → 拒绝',
      core.decide({ sessionId: 'h2', toolName: 'edit', args: { file_path: at('03-实验/results.tsv') }, cwd: root }),
      '必须由实验脚本写出')
    contains('decide 手写论文写作说明 → 拒绝',
      core.decide({ sessionId: 'h3', toolName: 'write', args: { file_path: at('论文写作说明.md') }, cwd: root }),
      'paper_report.py')
    contains('decide 数据集未就位就写分析 → 拒绝',
      core.decide({ sessionId: 'h4', toolName: 'write', args: { file_path: at('03-分析/scripts/run.py') }, cwd: root }),
      '数据还没就位')

    eq('frozenPaths 清单不存在 → 空数组', frozenPaths(root, cfg), [])
    allowed('decide 首次建立冻结清单 → 放行',
      core.decide({ sessionId: 'h5', toolName: 'write', args: { file_path: at('00-选题/frozen.json') }, cwd: root }))
    put('00-选题/frozen.json', JSON.stringify({
      frozen: ['03-实验/eval.py', { path: './02-数据/test.csv' }, null, 42, ''],
    }))
    eq('frozenPaths 归一化并过滤非路径项', frozenPaths(root, cfg), ['03-实验/eval.py', '02-数据/test.csv'])
    contains('decide 改写已建立的冻结清单 → 拒绝',
      core.decide({ sessionId: 'h6', toolName: 'write', args: { file_path: at('00-选题/frozen.json') }, cwd: root }),
      '不能改写')
    contains('decide 改写清单登记的文件 → 拒绝',
      core.decide({ sessionId: 'h7', toolName: 'write', args: { file_path: at('02-数据/test.csv') }, cwd: root }),
      '已在冻结清单里登记')
    allowed('decide 未登记的文件 → 放行',
      core.decide({ sessionId: 'h8', toolName: 'write', args: { file_path: at('01-文献/notes/idea.md') }, cwd: root }))
    put('00-选题/frozen.json', '{ 这不是 JSON')
    eq('frozenPaths 清单解析失败 → 空数组', frozenPaths(root, cfg), [])
  })

  // 相对路径：项目根取会话 cwd
  withProject(({ root, put }) => {
    put('00-选题/design.md')
    const relative = createGateCore(cfg)
    contains('decide 相对路径按 cwd 定位项目 → 拒绝',
      relative.decide({ sessionId: 'p1', toolName: 'write', args: { file_path: '04-稿件/01-引言.md' }, cwd: root }),
      '证据层还没就位')
    contains('decide 相对路径写论文写作说明 → 拒绝',
      relative.decide({ sessionId: 'p2', toolName: 'write', args: { file_path: '论文写作说明.md' }, cwd: root }),
      'paper_report.py')
  })

  // 检索留档前置（综述与质性模式）
  withProject(({ root, at, put }) => {
    put('00-选题/design.md')
    put('evidence.jsonl', '{"id":"E1","claim":"检索式与命中已留档"}\n')
    const core = createGateCore({ ...cfg, requireSearchLogBeforeManuscript: true })
    const writeSection = (sessionId) => core.decide({
      sessionId, toolName: 'write', args: { file_path: at('04-稿件/01-引言.md') }, cwd: root,
    })
    contains('decide 没有检索留档就写稿 → 拒绝', writeSection('s1'), '没有检索留档')
    put('01-文献/search-log.jsonl', '\n{"query":"ESG AND policy"}\n')
    allowed('decide 检索留档就位后写稿 → 放行', writeSection('s2'))
    put('01-文献/search-log.jsonl', '{"note":"没有 query 字段"}\n')
    contains('decide 留档里没有 query → 仍拒绝', writeSection('s3'), '没有检索留档')
  })

  // 数据就位的另一种证据：dataset_*.csv 快照
  withProject(({ root, at, put }) => {
    put('00-选题/design.md')
    put('02-数据/dataset_v1.csv', 'id,value\n1,2\n')
    allowed('decide 有数据集快照即可写分析 → 放行',
      createGateCore(cfg).decide({
        sessionId: 'x1', toolName: 'write', args: { file_path: at('03-分析/scripts/run.py') }, cwd: root,
      }))
  })

  // 提醒注入：首轮给阶段总览，此后只提当前阶段；总量受 maxReminders 限制
  withProject(({ root, put }) => {
    put('00-选题/.keep')
    const core = createGateCore({ ...cfg, maxReminders: 2 })
    contains('reminder 首轮注入阶段总览', core.reminder({ sessionId: 'm1', cwd: root }), '当前阶段（按产物推断）')
    contains('reminder 次轮只提当前阶段', core.reminder({ sessionId: 'm1', cwd: root }), '仍在 S0')
    allowed('reminder 到达 maxReminders → 不再注入', core.reminder({ sessionId: 'm1', cwd: root }))
  })

  // 建模模式关掉数据前置；防死锁逃生阀；会话表上限
  withProject(({ root, at, put }) => {
    put('00-选题/design.md')
    put('01-文献/positioning.md')
    const script = at('03-分析/scripts/run.py')

    allowed('decide 关掉数据前置的建模模式 → 放行',
      createGateCore({ ...cfg, requireDataBeforeAnalysis: false })
        .decide({ sessionId: 'd1', toolName: 'write', args: { file_path: script }, cwd: root }))

    const warnings = []
    const valve = createGateCore(cfg, { warn: (message) => warnings.push(message) })
    const attempt = () => valve.decide({
      sessionId: 'stuck', toolName: 'write', args: { file_path: at('04-稿件/01-引言.md') }, cwd: root,
    })
    contains('防死锁：第 1 次仍拒绝', attempt(), '证据层还没就位')
    contains('防死锁：第 2 次仍拒绝', attempt(), '证据层还没就位')
    contains('防死锁：第 3 次仍拒绝', attempt(), '证据层还没就位')
    allowed('防死锁：到 maxDenials 即放行（唯一逃生阀）', attempt())
    check('防死锁放行时留痕告警',
      warnings.some(message => message.includes('已连续')), JSON.stringify(warnings))

    const lru = createGateCore(cfg)
    lru.decide({ sessionId: 'old', toolName: 'write', args: { file_path: at('04-稿件/01-引言.md') }, cwd: root })
    eq('会话状态按 sessionId 记账', lru.state('old').denials.size, 1)
    for (let i = 0; i < 201; i += 1) {
      lru.decide({ sessionId: `filler-${i}`, toolName: 'write', args: {}, cwd: '' })
    }
    eq('会话表超上限后最旧会话被淘汰', lru.state('old').denials.size, 0)
  })

  // 注入消息 source 形态（session format v4 producer-owned kind）+ 预设身份守卫
  const sample = injectedMessage('自检提醒')
  check('注入消息 source.kind 为非空字符串且 ≠ plugin',
    typeof sample.source.kind === 'string' && sample.source.kind !== '' && sample.source.kind !== 'plugin',
    JSON.stringify(sample.source))
  check('注入消息 source.kind 为 plugin:research-gate', sample.source.kind === 'plugin:research-gate',
    sample.source.kind)
  check('预设守卫：同预设放行、其它预设不处理',
    ownsPreset('experiment', 'experiment') === true && ownsPreset('experiment', 'review') === false,
    `${ownsPreset('experiment', 'experiment')}/${ownsPreset('experiment', 'review')}`)
  check('预设守卫：未配置 / 取不到一律不处理（fail-closed）',
    ownsPreset('', 'experiment') === false && ownsPreset('experiment', undefined) === false, 'fail-open')

  // 判据之外的接线需要真实 dsh 运行时，显式跳过而不是伪造通过
  console.log('跳过（以下不是判据，而是接线，纯 Node 下构造不出来）：')
  console.log('  · apply() 的事件订阅与 allow/deny、enter 转换、exec.callId 去重、fiber 卸载 —— 需要真实 ctx 与 executor')

  for (const line of failures) console.error(line)
  if (failures.length > 0) {
    console.error(`research-gate selftest 失败：${failures.length}/${cases} 项`)
    process.exitCode = 1
    return
  }
  console.log(`research-gate selftest 通过：${cases} 个用例`)
}

const invokedDirectly = await (async () => {
  if (process.argv[1] === undefined) return false
  const [{ fileURLToPath }, { resolve }] = await Promise.all([import('node:url'), import('node:path')])
  return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
})()

if (invokedDirectly && process.argv.includes('--selftest')) selftest()
