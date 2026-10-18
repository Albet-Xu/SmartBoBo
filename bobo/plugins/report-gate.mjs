/**
 * report-gate —— 文献汇报模式的**交付闸门**（fail-closed）。
 *
 * 与 `research-gate` 同族、失败姿态相同（**fail-closed**），但守的是一套**不同的前提**：
 * 论文模式守"没证据不许成文、没评审不许定稿"；本闸门守的是
 *
 * 1. **不许手写机器产物**——`deck.pptx` / `preview/` / `qa-report.json` / `render-manifest.json` /
 *    `notes.md` / `汇报说明.md` 都必须由脚本产出。手写 pptx 等于绕开 plan，
 *    整套"plan 是唯一真相"的设计随之失效；
 * 2. **分数不许自证**——写 `04-评审/score.json` 的人**必须是另一个会话**，
 *    且 `pptx_sha256` 必须与盘上的 pptx 一致。没有这条，"评分低于 85 就打回"是一个
 *    被评者自己控制的开关；
 * 3. **页面主张必须有出处**——写 `slide-plan.json` 时，实质页的每条 claim 都要有
 *    `evidence_id`（真的存在于 `evidence.jsonl`）与论文页码 `source`。
 *
 * 契约：
 * - **判定单位 = 本会话 × 本汇报项目**。只在路径落在汇报项目的阶段目录下时才可能拦截，
 *   所以对非汇报会话天然无影响（普通的 `src/foo.ts` 永远不会命中）。
 * - **闸门只看盘上事实与本次写入的正文**，不看模型的任何口头声明。
 * - **防死锁**：同一 (规则, 目标) 连续被拒超过 `maxDenials` 次即放行并响亮告警——
 *   这是唯一的逃生阀，且一定会留痕。刻意不提供"静默绕过开关"。
 *
 * 已知边界（不假装覆盖）：
 * - 只认文件工具（`write` / `edit`）。用 shell 重定向写文件绕得过去——但 `deck.pptx` 与
 *   `render-manifest.json` 的**哈希绑定**会在评分与交付两步把绕过去的结果暴露出来。
 * - `edit` 是增量写入，抓到的正文可能不是完整文件；此时只做**能判**的检查（如评价者字段），
 *   不做"整份 JSON 必须合法"这类全量判定。
 * - 评分者身份靠"该会话 id 在本进程内被观察到过"来近似。进程重启后观察集为空，
 *   此时降级为"只要不等于当前会话即可"——这是**有意的降级**，宁可弱一点也不把闸门做成死锁。
 *
 * 挂载：汇报预设挂一行（相对路径按预设文件目录解析），config 全部可选。
 * 预设过滤：事件入口比对 `config.preset` 与 `agentPresets.composedPreset(agent.ctx)`，
 * 取不到（未挂预设 / 子代理未随父加入 / 服务缺席）一律不处理（fail-closed）；
 * `hasReportProject(cwd)` 护栏保留。
 * 排障：跑 `node report-gate.mjs --selftest`；要确认它在真实预设里装上，看 `session.create` 是否成功。
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'report-gate'

/** 事件入口守卫要读 agentPresets 判定会话所属预设。 */
export const inject = ['agentPresets']

/** 可覆盖的默认配置。 */
export const DEFAULT_CONFIG = {
  /** 本实例所属预设 id（预设行 `config.preset`）：只处理该预设的会话，留空一律不处理（fail-closed）。 */
  preset: '',
  /** 出现在拒绝理由里的模式名，便于模型与用户对上号。 */
  label: '文献汇报模式',
  /** 汇报项目的阶段目录名；路径里出现其中之一即可定位项目根与阶段。 */
  stageDirs: ['00-选题', '01-文献', '02-叙事', '03-产物', '04-评审', '05-交付'],
  /** 会被检查的写入类工具。 */
  writeTools: ['write', 'edit'],
  /** 证据层（相对项目根）。 */
  evidenceFile: 'evidence.jsonl',
  /** 逐篇抽取结果。 */
  extractionFile: '01-文献/extraction.jsonl',
  /** 源论文目录（不许删改）。 */
  papersDir: '01-文献/papers',
  /** 对比矩阵（多篇汇报必做）。 */
  matrixFile: '01-文献/matrix.md',
  /** deck plan —— 页面的唯一真相。 */
  planFile: '02-叙事/slide-plan.json',
  /** 交付 pptx 与讲稿（必须由脚本产出）。 */
  pptxFile: '03-产物/deck.pptx',
  notesFile: '03-产物/notes.md',
  /** 渲染预览图目录（必须由 report_qa.py 渲染产出）。 */
  previewDir: '03-产物/preview',
  /** 机械质检与渲染指纹（必须由 report_qa.py 产出）。 */
  qaReportFile: '04-评审/qa-report.json',
  renderManifestFile: '04-评审/render-manifest.json',
  /** 评分结论、问题清单与逐轮分数（评分结论由独立评分者产出）。 */
  scoreFile: '04-评审/score.json',
  issuesFile: '04-评审/issues.jsonl',
  historyFile: '04-评审/score-history.jsonl',
  /** 交付目录与《汇报说明》（由 report_deliver.py 产出）。 */
  deliverDir: '05-交付',
  deliverReport: '05-交付/汇报说明.md',
  /** 交付门槛（满分 100）。 */
  threshold: 85,
  /** 返修轮数上限。达到上限后允许"带已知缺口交付"，但不允许有未了结 high。 */
  maxRounds: 3,
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
 * 从文件路径反推汇报项目根与相对路径。
 *
 * 判据是**路径里出现阶段目录名**，因此普通源码路径不会被误判成汇报产物。
 * @param filePath - 工具参数里的目标路径（绝对或相对都行）。
 * @param stageDirs - 阶段目录名清单。
 * @returns `{ root, stage, rel }`；不属于任何汇报项目时返回 null。
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

/** 路径是否落在某个目录下（含该目录本身的前缀判定）。 */
function under(rel, dir) {
  return rel === dir || rel.startsWith(`${dir}/`)
}

function normalizeRel(rel) {
  return String(rel ?? '').replace(/\\/g, '/')
}

/** 读 JSON；读不到返回 null。 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** 读 JSONL，跳过坏行；返回合法对象数组。 */
function readJsonl(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const rec = JSON.parse(trimmed)
      if (rec && typeof rec === 'object' && !Array.isArray(rec)) out.push(rec)
    } catch {
      /* 坏行跳过：坏行由 report_qa.py 报出来，闸门不做格式审计 */
    }
  }
  return out
}

/** pptx 的 sha256（用于指纹绑定）。读不到返回空串。 */
function sha256Of(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return ''
  }
}

/** 一条 issue 是否已了结：`resolved`，或 `wontfix` 且写了非空 `reason`。缺 `status` 一律未了结（从严）。 */
export function isSettled(issue) {
  const status = String(issue?.status ?? '').toLowerCase()
  if (status === 'resolved') return true
  if (status === 'wontfix') return String(issue?.reason ?? '').trim() !== ''
  return false
}

/**
 * 当前未了结的高严重度问题（闸门与《汇报说明》都读这一份判定）。
 * @returns issue id 数组。
 */
export function unresolvedHighIssues(base, cfg = DEFAULT_CONFIG) {
  const issues = readJsonl(join(base, cfg.issuesFile))
  return issues
    .filter(issue => String(issue?.severity ?? '').toLowerCase() === 'high')
    .filter(issue => !isSettled(issue))
    .map(issue => String(issue?.id ?? issue?.where ?? '<未命名>'))
}

/** 评分与指纹现状——交付判据的唯一取数口（纯读盘）。 */
export function deliveryState(base, cfg = DEFAULT_CONFIG) {
  const score = readJson(join(base, cfg.scoreFile))
  const manifest = readJson(join(base, cfg.renderManifestFile))
  const pptx = join(base, cfg.pptxFile)
  const diskHash = existsSync(pptx) ? sha256Of(pptx) : ''
  const manifestHash = String(manifest?.pptx_sha256 ?? '')
  const scoreHash = String(score?.pptx_sha256 ?? '')
  const total = Number(score?.total)
  const threshold = Number(score?.threshold ?? cfg.threshold)
  const round = Number(score?.round ?? 0)
  return {
    score_exists: score !== null,
    total: Number.isFinite(total) ? total : null,
    threshold: Number.isFinite(threshold) ? threshold : cfg.threshold,
    round: Number.isFinite(round) ? round : 0,
    rendered: manifest?.rendered_slides > 0 || manifest?.renderer === 'powerpoint-com',
    disk_hash: diskHash,
    manifest_hash: manifestHash,
    score_hash: scoreHash,
    fingerprint_ok: diskHash !== '' && diskHash === manifestHash && diskHash === scoreHash,
    unresolved: unresolvedHighIssues(base, cfg),
  }
}

/** 交付是否被允许：分数达标或轮数触顶，且无未了结 high，且指纹一致。 */
export function deliveryAllowed(base, cfg = DEFAULT_CONFIG) {
  const st = deliveryState(base, cfg)
  const reasons = []
  if (!st.score_exists) reasons.push(`还没有 ${cfg.scoreFile}（必须先由独立评分者评分）`)
  if (!st.rendered) reasons.push(`还没有渲染（${cfg.renderManifestFile} 缺失或未渲染，评分者看不到页面实际样子）`)
  if (!st.fingerprint_ok) {
    reasons.push(
      `pptx 指纹不一致（盘上 ${st.disk_hash.slice(0, 12) || '<无>'} / `
      + `manifest ${st.manifest_hash.slice(0, 12) || '<无>'} / `
      + `score ${st.score_hash.slice(0, 12) || '<无>'}）——`
      + 'pptx 被改过但没重新质检与评分，请重跑 report_qa.py 再重评')
  }
  if (st.total !== null && st.total < st.threshold && st.round < cfg.maxRounds) {
    reasons.push(`总分 ${st.total} 低于门槛 ${st.threshold}，且只到第 ${st.round}/${cfg.maxRounds} 轮——`
      + '继续返修，不要提前交付')
  }
  if (st.unresolved.length > 0) {
    reasons.push(`还有未了结的高严重度问题：${st.unresolved.join('、')}`)
  }
  return { ok: reasons.length === 0, reasons, state: st }
}

/** 理由：要写终稿时评审还没了结。 */
function unresolvedReason(cfg, ids) {
  return `【${cfg.label}·交付闸门】评分还有未了结的高严重度问题，不能交付：${ids.join('、')}。`
    + '请逐条了结：能改的改掉，把 `status` 置为 `resolved` 并在 `resolution` 写明改了什么；'
    + '确实不该改的置为 `wontfix` 并在 `reason` 写清为什么（「不修改」不写理由等于没处理）。'
    + '两条路都要在 `04-评审/revision-log.md` 留痕，但**不许把 high 降级成 medium 来放行**。'
}

/** 写 plan 时的自检：实质页必须有 claim，且 evidence_id 真的存在。 */
export function checkPlanText(base, rawText, cfg = DEFAULT_CONFIG) {
  let plan
  try {
    plan = JSON.parse(rawText)
  } catch (e) {
    return `${cfg.label}·交付闸门】${cfg.planFile} 不是合法 JSON（${e.message}）。`
      + 'plan 是页面的唯一真相，必须是合法 JSON。'
  }
  if (!plan || typeof plan !== 'object') {
    return `【${cfg.label}·交付闸门】${cfg.planFile} 顶层必须是对象。`
  }
  const slides = Array.isArray(plan.slides) ? plan.slides : []
  if (slides.length === 0) {
    return `【${cfg.label}·交付闸门】${cfg.planFile} 里没有任何 slides。`
  }
  const evidence = readJsonl(join(base, cfg.evidenceFile))
  const evidenceIds = new Set(evidence.map(r => String(r.id ?? '')).filter(Boolean))
  if (evidenceIds.size === 0) {
    return `【${cfg.label}·交付闸门】` + '`' + cfg.evidenceFile + '` 不存在或没有任何带 `id` 的记录：'
      + '页面主张必须能追到一条证据。请先在 R1 建立证据层（一条一行 JSON，含 `id` 与 `claim`），再写 plan。'
  }
  const substantive = new Set(['background', 'question', 'method', 'data', 'result', 'compare',
    'limitation', 'takeaway'])
  const problems = []
  for (const [i, slide] of slides.entries()) {
    const no = Number(slide?.no ?? i + 1)
    const role = String(slide?.role ?? '').toLowerCase()
    if (String(slide?.notes ?? '').trim() === '') {
      problems.push(`第 ${no} 页没有 notes（讲稿）——交付物必须含每页口播内容`)
    }
    if (!substantive.has(role)) continue
    const claims = Array.isArray(slide?.claims) ? slide.claims : []
    if (claims.length === 0) {
      problems.push(`第 ${no} 页（role=${role}）是实质页但没有任何 claims`)
      continue
    }
    for (const [ci, claim] of claims.entries()) {
      const eid = String(claim?.evidence_id ?? '').trim()
      const source = String(claim?.source ?? '').trim()
      if (source === '') problems.push(`第 ${no} 页第 ${ci + 1} 条 claim 没有 source（论文页码/图表编号）`)
      if (eid === '') problems.push(`第 ${no} 页第 ${ci + 1} 条 claim 没有 evidence_id`)
      else if (!evidenceIds.has(eid)) {
        problems.push(`第 ${no} 页第 ${ci + 1} 条 claim 的 evidence_id=${eid} 在 ${cfg.evidenceFile} 里不存在`)
      }
    }
  }
  if (problems.length === 0) return null
  const head = problems.slice(0, 6).join('；')
  const more = problems.length > 6 ? `；…另有 ${problems.length - 6} 处` : ''
  return `【${cfg.label}·交付闸门】${cfg.planFile} 还不能落盘：${head}${more}。`
    + '实质页的每条 claim 都要有 `evidence_id`（真的写进 evidence.jsonl）与论文页码 `source`，'
    + '每页都要有 `notes`。**写不出出处的页面主张就是没读到位**，请回 R1 补齐证据，'
    + '或把该主张从页面上删掉。'
}

/**
 * 创建闸门判定核心（纯函数、只读磁盘，可脱离 dsh 单测）。
 * @param config - 见 {@link DEFAULT_CONFIG}。
 * @param log - `{ warn(message) }`，可选。
 * @returns `decide` / `reminder` / `observeSession` / `state`。
 */
export function createGateCore(config = {}, log = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const warn = typeof log.warn === 'function' ? log.warn : () => {}
  const sessions = new Map()
  /** 本进程内观察到过的会话 id——评分者身份检查据此判断"有没有真的起过独立评分者"。 */
  const observed = new Set()

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
      warn(`[report-gate] ${key} 已连续 ${seen} 次被拒，放行以免阻塞（请人工复核该处交付前提）`)
      return null
    }
    state.denials.set(key, seen + 1)
    return reason
  }

  const scriptOnly = (state, key, file, script, why) =>
    deny(state, key,
      `【${cfg.label}·交付闸门】${file} 由 \`${script}\` 产出，不能手写——${why}。`
      + `请运行 \`python <BoBo根>/${script} <汇报项目目录>\` 生成或覆盖。`)

  return {
    /** 记录一个被观察到的会话 id（由 `agent/pre-step` 喂入）。 */
    observeSession(id) {
      if (typeof id === 'string' && id !== '') observed.add(id)
    },

    /** 供排障与自检读取当前观察集。 */
    observedSessions: () => observed,

    /**
     * 写文件前判定。
     * @param request - `{ sessionId, toolName, args, cwd }`。
     * @returns 拒绝理由字符串，或 null 表示放行。
     */
    decide({ sessionId = '', toolName, args, cwd = '' }) {
      if (!cfg.writeTools.includes(toolName)) return null
      const target = targetPathOf(args)
      const state = session(sessionId)
      const normalized = normalizeRel(target)

      // 证据层在项目根，不属于任何阶段目录，`projectOf` 认不出它 —— 先单独判。
      if (normalized === cfg.evidenceFile || normalized.includes(`/${cfg.evidenceFile}`)) {
        // 证据层允许写入（它是模型在 R1/R2 的产出），这里只做「证据必须带出处」的轻校验。
        const text = textOf(args)
        if (text !== '') {
          const bad = text.split('\n').map(l => l.trim()).filter(Boolean).some((line) => {
            try {
              const rec = JSON.parse(line)
              const src = rec?.source
              return rec?.id === undefined || src === undefined || src === null
                || String(src?.file ?? '').trim() === ''
            } catch {
              return true
            }
          })
          if (bad) {
            return deny(state, `evidence-line:${cwd}`,
              `【${cfg.label}·交付闸门】${cfg.evidenceFile} 的每一行都必须是合法 JSON，`
              + '且含 `id` 与 `source.file`——证据层是页面主张的唯一取数来源，'
              + '缺出处的记录等于不可追溯。请补齐后再写。')
          }
        }
        return null
      }

      const project = projectOf(target, cfg.stageDirs)
      if (project === null) return null
      const base = project.root !== '' ? project.root : String(cwd ?? '')
      if (base === '') return null
      const rel = normalizeRel(project.rel)

      // ── 1. 机器产物一律不许手写 ───────────────────────────────────────
      if (rel === cfg.deliverReport) {
        return scriptOnly(state, `handwrite:${base}:deliver`, cfg.deliverReport,
          'scripts/report_deliver.py',
          '它记录的是盘上的事实（页数、每页出处、评分与轮次），手写它就等于伪造过程记录')
      }
      if (rel === cfg.pptxFile) {
        return scriptOnly(state, `handwrite:${base}:pptx`, cfg.pptxFile,
          'scripts/report_pptx.py',
          'pptx 必须从 `slide-plan.json` 渲染出来，手写 pptx 等于绕开 plan，'
          + '「改页面就改 plan」的整套设计随之失效，且评分者看到的东西将与 plan 脱钩')
      }
      if (rel === cfg.notesFile) {
        return scriptOnly(state, `handwrite:${base}:notes`, cfg.notesFile,
          'scripts/report_pptx.py',
          '讲稿与 pptx 备注页同源（都是 plan 的 `notes` 字段），分开手写必然两边不一致')
      }
      if (under(rel, cfg.previewDir)) {
        return scriptOnly(state, `handwrite:${base}:preview`, `${cfg.previewDir}/`,
          'scripts/report_qa.py',
          '预览图只能来自**渲染**——手写或伪造预览图会让评分者评一个不存在的页面')
      }
      if (rel === cfg.qaReportFile) {
        return scriptOnly(state, `handwrite:${base}:qa`, cfg.qaReportFile,
          'scripts/report_qa.py',
          '质检结论是机械判定的结果，手写它就等于自己给自己发合格证')
      }
      if (rel === cfg.renderManifestFile) {
        return scriptOnly(state, `handwrite:${base}:manifest`, cfg.renderManifestFile,
          'scripts/report_qa.py',
          '它记录渲染时刻的 pptx 与每页图片哈希，是**评分与交付物的绑定**；'
          + '能手写它就等于可以改了 pptx 还用旧评分')
      }

      // ── 2. 写 deck plan 前的两个硬前提 ────────────────────────────────
      if (rel === cfg.planFile) {
        const extraction = readJsonl(join(base, cfg.extractionFile))
        if (extraction.length === 0) {
          return deny(state, `extraction:${base}`,
            `【${cfg.label}·交付闸门】要写 ${cfg.planFile}，但 ${cfg.extractionFile} 不存在或没有任何记录：`
            + '没有逐篇抽取，页面内容就只能来自你的印象，而印象一定会写错。'
            + '请先在 R1 对每篇论文产出六个字段（question/method/data/key_result/limitation/transferable），'
            + '**带 `page_anchors` 指回页码**，再写 plan。')
        }
        const papersDir = join(base, cfg.papersDir)
        let papers = []
        try {
          papers = readdirSync(papersDir).filter(f => !f.startsWith('.'))
        } catch {
          papers = []
        }
        if (papers.length === 0) {
          return deny(state, `papers:${base}`,
            `【${cfg.label}·交付闸门】${cfg.papersDir}/ 里没有论文原件：`
            + '每页的出处都要能回到原文，请先把用户给的 PDF 落到 `' + cfg.papersDir + '/`。')
        }
        const text = textOf(args)
        if (text !== '') {
          const problem = checkPlanText(base, text, cfg)
          if (problem !== null) return deny(state, `plan:${base}`, problem)
        }
        return null
      }

      // ── 3. 写评分结论：分数不许自证 ───────────────────────────────────
      if (rel === cfg.scoreFile) {
        const text = textOf(args)
        let score = null
        try {
          score = JSON.parse(text)
        } catch {
          // `edit` 的增量写入抓不到完整 JSON——不做全量校验，交给 report_qa/report_deliver 兜。
          score = null
        }
        const claimId = String(score?.evaluator_session_id ?? score?.evaluatorSessionId ?? '').trim()
        const isEdit = !score
        if (!isEdit) {
          if (claimId === '') {
            return deny(state, `score-nosession:${base}`,
              `【${cfg.label}·交付闸门】${cfg.scoreFile} 缺 \`evaluator_session_id\`：`
              + '评分必须由**另一个会话**做出，否则"低于门槛就打回"就是被评者自己控制的开关。'
              + '请用 subagent 工具起一个独立评分者（见 `report-review` 技能），'
              + '把渲染图与论文原文给它，并让它把自己的会话 id 写进这个字段。')
          }
          if (claimId === String(sessionId)) {
            return deny(state, `score-self:${base}`,
              `【${cfg.label}·交付闸门】\`evaluator_session_id\` 就是当前会话 id —— `
              + '这是**自评**。自评的分数会通胀到你想要的任何值：生成者的目标不是"打高分"而是"通过闸门"，'
              + '让他自己打分，门槛就形同虚设。请用 subagent 起独立评分者，让它写这个文件。')
          }
          if (observed.size > 0 && !observed.has(claimId)) {
            return deny(state, `score-ghost:${base}`,
              `【${cfg.label}·交付闸门】\`evaluator_session_id\`=${claimId} `
              + '在本进程里从未出现过——也就是说，**没有一个真实会话做过这次评分**，这个 id 是编的。'
              + '请真的用 subagent 工具起一个独立评分者。')
          }
          const st = deliveryState(base, cfg)
          const scoreHash = String(score?.pptx_sha256 ?? '').trim()
          if (scoreHash === '') {
            return deny(state, `score-nohash:${base}`,
              `【${cfg.label}·交付闸门】${cfg.scoreFile} 缺 \`pptx_sha256\`：`
              + '评分必须绑定到**具体哪一份 pptx**。没有这个字段，改完 pptx 用旧评分就无人能发现。'
              + `请从 ${cfg.renderManifestFile} 抄 ` + '`pptx_sha256`。')
          }
          if (st.disk_hash !== '' && scoreHash !== st.disk_hash) {
            return deny(state, `score-stale:${base}`,
              `【${cfg.label}·交付闸门】评分绑定的 pptx 哈希（${scoreHash.slice(0, 12)}）`
              + `与盘上的 deck.pptx（${st.disk_hash.slice(0, 12)}）不一致：`
              + '评分评的是**旧版本**。请重跑 `report_qa.py` 重新渲染，再让评分者重评。')
          }
          const dims = Array.isArray(score?.dimensions) ? score.dimensions : []
          if (dims.length === 0) {
            return deny(state, `score-nodims:${base}`,
              `【${cfg.label}·交付闸门】${cfg.scoreFile} 的 \`dimensions\` 为空：`
              + '只有总分、没有分维度与 `basis` 的评分无法指导返修——'
              + '打回理由不可执行，下一轮只会重排一遍字。请按 `report-review` 技能的维度表逐维写分并附依据。')
          }
          const dimProblem = dims.find(d => String(d?.basis ?? '').trim() === '')
          if (dimProblem !== undefined) {
            return deny(state, `score-basis:${base}`,
              `【${cfg.label}·交付闸门】维度 \`${dimProblem?.name ?? '?'}\` 没有 \`basis\`：`
              + '每个分数都要写清判据，并尽量引用具体页码（"第 7 页正文 380 字超过上限 260 字"）。'
              + '「整体质量不佳」这种依据无法执行。')
          }
        }
        return null
      }

      // ── 4. 写交付目录（除已拦的《汇报说明》）──────────────────────────
      if (under(rel, cfg.deliverDir)) {
        const verdict = deliveryAllowed(base, cfg)
        if (!verdict.ok) {
          return deny(state, `deliver:${base}`,
            `【${cfg.label}·交付闸门】还不能往 ${cfg.deliverDir}/ 写交付物：${verdict.reasons.join('；')}。`)
        }
        return null
      }

      // ── 5. 终止条件：未了结 high 时不许收尾 ───────────────────────────
      if (rel === cfg.historyFile) {
        const unresolved = unresolvedHighIssues(base, cfg)
        if (unresolved.length > 0) {
          return deny(state, `history-open:${base}`, unresolvedReason(cfg, unresolved))
        }
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
      // 只在会话真正落在汇报项目里时才发声，避免给别的会话添噪音。
      if (!state.intro && stage.id === 'R0' && !hasReportProject(base, cfg)) return null
      const text = state.intro ? stageReminder(cfg, stage) : introText(cfg, stage)
      state.intro = true
      state.reminders += 1
      return text
    },

    /** 排障用。 */
    state: (sessionId = '') => session(sessionId),
  }
}

/** 会话工作区里是否已经有汇报项目的痕迹。 */
function hasReportProject(base, cfg) {
  return cfg.stageDirs.some(dir => existsSync(join(base, dir)))
}

/** 从文件系统推断汇报项目**当前所处**阶段（只看产物是否存在）。 */
export function inferStage(base, cfg = DEFAULT_CONFIG) {
  const has = (...p) => existsSync(join(base, ...p))
  const score = readJson(join(base, cfg.scoreFile))
  const total = Number(score?.total)
  const threshold = Number(score?.threshold ?? cfg.threshold)
  const round = Number(score?.round ?? 0)

  if (!has('00-选题', 'brief.md')) {
    return { id: 'R0', title: '定盘', gate: '语言/时长/汇报类型确认落盘，并检索一次经验库' }
  }
  if (!has(cfg.extractionFile)) {
    return { id: 'R1', title: '论文抽取', gate: '每篇都有 question/method/data/key_result/limitation/transferable' }
  }
  if (!has('02-叙事', 'storyline.md')) {
    return { id: 'R2', title: '叙事组织', gate: '一句话主线 + 多篇时的对比矩阵（共同结论与分歧点）' }
  }
  if (!has(cfg.planFile)) {
    return { id: 'R3', title: '页策划', gate: '每页 role/title/notes；实质页有 claims 与出处' }
  }
  if (!has(cfg.pptxFile)) {
    return { id: 'R4', title: '生成', gate: '用 report_pptx.py 渲染出 deck.pptx 与讲稿' }
  }
  if (!has(cfg.scoreFile) || !Number.isFinite(total) || total < threshold) {
    return {
      id: 'R5', title: '评分与返修',
      gate: `机械质检无 high 且总分 ≥ ${threshold}（当前 ${Number.isFinite(total) ? total : '未评分'}，第 ${round || 0}/${cfg.maxRounds} 轮）`,
    }
  }
  if (!has(cfg.deliverReport)) {
    return { id: 'R6', title: '交付与沉淀', gate: '用 report_deliver.py 生成《汇报说明》并沉淀经验' }
  }
  return { id: 'R6', title: '已完成', gate: '交付完成' }
}

function introText(cfg, stage) {
  return `【${cfg.label}·阶段闸门】当前阶段（按产物推断）：${stage.id} ${stage.title}。`
    + `本阶段出口：${stage.gate}。闸门只看产物是否存在，不看口头声明。`
    + '本模式硬性前提：'
    + `写 ${cfg.planFile} 前必须有 ${cfg.extractionFile} 与 ${cfg.papersDir}/；`
    + `${cfg.pptxFile} / ${cfg.qaReportFile} / ${cfg.renderManifestFile} / ${cfg.deliverReport} 一律由脚本产出，不许手写；`
    + `${cfg.scoreFile} 必须由**独立会话**的评分者写出并绑定 pptx 指纹。`
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
    // 记录观察到的会话——评分者身份检查据此判断"有没有真的起过独立评分者"
    core.observeSession(sessionId)
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

  warn(`[report-gate] 已挂载（${cfg.label}）：fail-closed，拦截手写机器产物 / 自评分数 / 无出处主张`)
}

/**
 * 自检：把各判据真跑一遍（`node report-gate.mjs --selftest`）。
 *
 * fixture 全建在系统临时目录里，跑完即删，不在仓库留文件。
 * 判据之外的接线（`apply` 的事件订阅）要真实 dsh 运行时，显式跳过而不是伪造通过。
 */
function selftest() {
  const failures = []
  let cases = 0
  const check = (label, condition, actual) => {
    cases += 1
    if (condition !== true) failures.push(`✗ ${label}：${actual}`)
  }

  const dir = mkdtempSync(join(tmpdir(), 'report-gate-selftest-'))
  try {
    const cfg = { ...DEFAULT_CONFIG, label: '自检模式' }
    for (const sub of ['00-选题', '01-文献/papers', '02-叙事', '03-产物', '04-评审', '05-交付']) {
      mkdirSync(join(dir, sub), { recursive: true })
    }
    const core = createGateCore(cfg, { warn: () => {} })
    /**
     * 每个用例一把**新闸门**：上一次被拒会累积逃生阀计数，
     * 复用同一把会把后续用例静默放行，从而掩盖真实判据。
     * 同时预先观察一个"评分者会话"，模拟"本进程里确实起过独立评分者"。
     */
    const gate = () => {
      const fresh = createGateCore(cfg, { warn: () => {} })
      fresh.observeSession('judge-1')
      return fresh
    }
    const write = (rel) => ({ sessionId: 's1', toolName: 'write',
      args: { file_path: join(dir, rel), content: '{}' }, cwd: dir })

    // 机器产物：一律拒绝
    for (const [rel, token] of [
      ['03-产物/deck.pptx', 'report_pptx.py'],
      ['03-产物/notes.md', 'report_pptx.py'],
      ['03-产物/preview/slide-01.png', 'report_qa.py'],
      ['04-评审/qa-report.json', 'report_qa.py'],
      ['04-评审/render-manifest.json', 'report_qa.py'],
      ['05-交付/汇报说明.md', 'report_deliver.py'],
    ]) {
      const reason = gate().decide(write(rel))
      check(`手写 ${rel} 被拒`, typeof reason === 'string' && reason.includes(token), reason)
    }

    // 非汇报路径：放行
    check('普通源码路径放行', gate().decide({ sessionId: 's1', toolName: 'write',
      args: { file_path: join(dir, 'src/foo.ts'), content: 'x' }, cwd: dir }) === null, '被误拦')

    const writePlan = (body) => ({ sessionId: 's1', toolName: 'write',
      args: { file_path: join(dir, '02-叙事/slide-plan.json'), content: JSON.stringify(body) },
      cwd: dir })

    // 写 plan：缺抽取结果 → 拒
    const planReason = gate().decide(writePlan({ slides: [{ no: 1, role: 'cover', notes: 'n' }] }))
    check('缺 extraction.jsonl 时写 plan 被拒',
      typeof planReason === 'string' && planReason.includes('extraction.jsonl'), planReason)

    // 补齐抽取结果与论文原件，但证据层为空 → 仍拒
    writeFileSync(join(dir, '01-文献', 'papers', 'a.pdf'), 'x')
    writeFileSync(join(dir, '01-文献', 'extraction.jsonl'),
      `${JSON.stringify({ paper_id: 'P1', question: 'q' })}\n`)
    const planReason2 = gate().decide(writePlan({ slides: [{ no: 1, role: 'cover', notes: 'n' }] }))
    check('缺证据层时写 plan 被拒',
      typeof planReason2 === 'string' && planReason2.includes('evidence.jsonl'), planReason2)

    // 证据层就位 + 合法 plan（实质页有 claim 且 evidence 存在）→ 放行
    writeFileSync(join(dir, 'evidence.jsonl'),
      `${JSON.stringify({ id: 'E-1', claim: 'c', source: { file: 'a.pdf', page: 7 } })}\n`)
    const goodPlan = {
      schema: 'bobo-report-deck/1',
      slides: [
        { no: 1, role: 'cover', title: 't', notes: 'n' },
        { no: 2, role: 'result', title: 'r', notes: 'n',
          claims: [{ claim: 'c', evidence_id: 'E-1', source: 'a.pdf p.7' }] },
      ],
    }
    const okPlan = gate().decide(writePlan(goodPlan))
    check('合法 plan 放行', okPlan === null, okPlan)

    // 实质页缺 claim → 拒
    const badPlanReason = gate().decide(writePlan({ schema: 'bobo-report-deck/1',
      slides: [{ no: 1, role: 'result', title: 'r', notes: 'n', claims: [] }] }))
    check('实质页缺 claim 被拒',
      typeof badPlanReason === 'string' && badPlanReason.includes('claims'), badPlanReason)

    // 实质页缺 notes → 拒
    const noNotesReason = gate().decide(writePlan({ schema: 'bobo-report-deck/1',
      slides: [{ no: 1, role: 'result', title: 'r', notes: '',
        claims: [{ claim: 'c', evidence_id: 'E-1', source: 'a.pdf p.7' }] }] }))
    check('缺讲稿被拒', typeof noNotesReason === 'string' && noNotesReason.includes('notes'), noNotesReason)

    // evidence_id 不存在 → 拒
    const ghostReason = gate().decide(writePlan({ schema: 'bobo-report-deck/1',
      slides: [{ no: 1, role: 'result', title: 'r', notes: 'n',
        claims: [{ claim: 'c', evidence_id: 'E-999', source: 'a.pdf p.7' }] }] }))
    check('幽灵 evidence_id 被拒',
      typeof ghostReason === 'string' && ghostReason.includes('E-999'), ghostReason)

    // ── 评分结论：分数不许自证 ───────────────────────────────────────
    // 先准备一份真实的 pptx，并把 manifest / score 的哈希都对准它（模拟正常流程）
    const pptxPath = join(dir, '03-产物', 'deck.pptx')
    writeFileSync(pptxPath, 'fake-pptx-bytes')
    const realHash = sha256Of(pptxPath)
    writeFileSync(join(dir, '04-评审', 'render-manifest.json'), JSON.stringify({
      schema: 'bobo-report-render/1', pptx_sha256: realHash,
      rendered_slides: 2, renderer: 'powerpoint-com' }))

    const score = (over) => ({ sessionId: 's1', toolName: 'write',
      args: { file_path: join(dir, '04-评审/score.json'),
        content: JSON.stringify({ total: 90, threshold: 85, round: 1,
          evaluator_session_id: 'judge-1', pptx_sha256: realHash,
          dimensions: [{ name: '叙事结构', score: 90, weight: 0.2, basis: '主线清楚' }],
          ...over }) }, cwd: dir })

    const selfReason = gate().decide(score({ evaluator_session_id: 's1' }))
    check('自评被拒', typeof selfReason === 'string' && selfReason.includes('自评'), selfReason)

    const noSess = gate().decide(score({ evaluator_session_id: '' }))
    check('缺评分者会话被拒',
      typeof noSess === 'string' && noSess.includes('evaluator_session_id'), noSess)

    const ghostJudge = gate().decide(score({ evaluator_session_id: 'judge-ghost' }))
    check('幽灵评分者被拒',
      typeof ghostJudge === 'string' && ghostJudge.includes('judge-ghost'), ghostJudge)

    const noHash = gate().decide(score({ pptx_sha256: '' }))
    check('缺 pptx_sha256 被拒',
      typeof noHash === 'string' && noHash.includes('pptx_sha256'), noHash)

    const staleHash = gate().decide(score({ pptx_sha256: 'stale-hash' }))
    check('评分绑定旧 pptx 被拒',
      typeof staleHash === 'string' && staleHash.includes('旧版本'), staleHash)

    const noDims = gate().decide(score({ dimensions: [] }))
    check('缺 dimensions 被拒',
      typeof noDims === 'string' && noDims.includes('dimensions'), noDims)

    const noBasis = gate().decide(score({ dimensions: [{ name: 'x', score: 90, weight: 1, basis: '' }] }))
    check('dimension 缺 basis 被拒',
      typeof noBasis === 'string' && noBasis.includes('basis'), noBasis)

    const okScore = gate().decide(score())
    check('评分字段齐全且指纹一致时放行', okScore === null, okScore)

    // ── 交付目录：分数不达标时拒绝 ────────────────────────────────────
    writeFileSync(join(dir, '04-评审', 'issues.jsonl'), '')
    const writeScore = (total, round) => writeFileSync(join(dir, '04-评审', 'score.json'),
      JSON.stringify({ total, threshold: 85, round, evaluator_session_id: 'judge-1',
        pptx_sha256: realHash,
        dimensions: [{ name: 'x', score: total, weight: 1, basis: 'b' }] }))
    writeScore(70, 1)
    const lowReason = gate().decide(write('05-交付/其他材料.md'))
    check('分数不达标且未触顶轮数时写交付物被拒',
      typeof lowReason === 'string' && lowReason.includes('70'), lowReason)

    // 分数不达标但已触顶轮数 → 允许"带已知缺口交付"
    writeScore(70, 3)
    const cappedReason = gate().decide(write('05-交付/其他材料.md'))
    check('分数不达标但轮数触顶时放行（带缺口交付）', cappedReason === null, cappedReason)

    // 未了结 high → 仍拒
    writeScore(92, 2)
    writeFileSync(join(dir, '04-评审', 'issues.jsonl'),
      `${JSON.stringify({ id: 'I-1', severity: 'high', status: 'open' })}\n`)
    const openReason = gate().decide(write('05-交付/其他材料.md'))
    check('有未了结 high 时写交付物被拒',
      typeof openReason === 'string' && openReason.includes('I-1'), openReason)

    // 了结 high（resolved）后放行
    writeFileSync(join(dir, '04-评审', 'issues.jsonl'),
      `${JSON.stringify({ id: 'I-1', severity: 'high', status: 'resolved', resolution: '已改' })}\n`)
    const passReason = gate().decide(write('05-交付/其他材料.md'))
    check('了结 high 后放行', passReason === null, passReason)

    // 指纹脱钩：pptx 被改写而 manifest 未更新 → 拒绝
    writeFileSync(pptxPath, 'tampered-bytes')
    const tamperedReason = gate().decide(write('05-交付/其他材料.md'))
    check('pptx 被改写后交付被拒（指纹脱钩）',
      typeof tamperedReason === 'string' && tamperedReason.includes('指纹不一致'), tamperedReason)

    // ── 逃生阀 ──────────────────────────────────────────────────────
    const core2 = createGateCore({ ...cfg, maxDenials: 2 }, { warn: () => {} })
    const a = core2.decide(write('03-产物/deck.pptx'))
    const b = core2.decide(write('03-产物/deck.pptx'))
    const c = core2.decide(write('03-产物/deck.pptx'))
    check('连续被拒到上限后放行（逃生阀）',
      typeof a === 'string' && typeof b === 'string' && c === null, `${typeof a},${typeof b},${typeof c}`)

    // ── 阶段推断 ────────────────────────────────────────────────────
    check('阶段推断：空项目是 R0', inferStage(dir, cfg).id === 'R0', JSON.stringify(inferStage(dir, cfg)))
    writeFileSync(join(dir, '00-选题', 'brief.md'), '# 定盘')
    rmSync(join(dir, '01-文献', 'extraction.jsonl'), { force: true })
    // 前面几段用例已写入 score.json 与 pptx；阶段推断要看中间态，先清掉
    rmSync(join(dir, '04-评审', 'score.json'), { force: true })
    rmSync(pptxPath, { force: true })
    check('阶段推断：定盘后抽取缺失 → R1',
      inferStage(dir, cfg).id === 'R1', JSON.stringify(inferStage(dir, cfg)))
    writeFileSync(join(dir, '01-文献', 'extraction.jsonl'),
      `${JSON.stringify({ paper_id: 'P1', question: 'q' })}\n`)
    check('阶段推断：抽取就位但无主线 → R2',
      inferStage(dir, cfg).id === 'R2', JSON.stringify(inferStage(dir, cfg)))
    writeFileSync(join(dir, '02-叙事', 'storyline.md'), '# 主线')
    check('阶段推断：有主线但无 plan → R3',
      inferStage(dir, cfg).id === 'R3', JSON.stringify(inferStage(dir, cfg)))
    writeFileSync(join(dir, '02-叙事', 'slide-plan.json'), JSON.stringify(goodPlan))
    check('阶段推断：有 plan 但无 pptx → R4',
      inferStage(dir, cfg).id === 'R4', JSON.stringify(inferStage(dir, cfg)))
    writeFileSync(pptxPath, 'fake-pptx-bytes')
    writeFileSync(join(dir, '04-评审', 'issues.jsonl'), '')
    check('阶段推断：有 pptx 但未评分 → R5',
      inferStage(dir, cfg).id === 'R5', JSON.stringify(inferStage(dir, cfg)))
    writeScore(92, 2)
    check('阶段推断：分数达标后是 R6', inferStage(dir, cfg).id === 'R6', JSON.stringify(inferStage(dir, cfg)))
    writeScore(70, 1)
    check('阶段推断：分数不达标是 R5', inferStage(dir, cfg).id === 'R5', JSON.stringify(inferStage(dir, cfg)))

    const empty = mkdtempSync(join(tmpdir(), 'report-gate-empty-'))
    try {
      check('阶段推断：空目录是 R0（无阶段目录时也安全）',
        inferStage(empty, cfg).id === 'R0', JSON.stringify(inferStage(empty, cfg)))
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }

    // ── isSettled ───────────────────────────────────────────────────
    check('isSettled: resolved', isSettled({ status: 'resolved' }) === true, 'false')
    check('isSettled: wontfix 带 reason', isSettled({ status: 'wontfix', reason: 'x' }) === true, 'false')
    check('isSettled: wontfix 无 reason', isSettled({ status: 'wontfix' }) === false, 'true')
    check('isSettled: 缺 status', isSettled({}) === false, 'true')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  // 注入消息 source 形态（session format v4 producer-owned kind）+ 预设身份守卫
  const sample = injectedMessage('自检提醒')
  check('注入消息 source.kind 为非空字符串且 ≠ plugin',
    typeof sample.source.kind === 'string' && sample.source.kind !== '' && sample.source.kind !== 'plugin',
    JSON.stringify(sample.source))
  check('注入消息 source.kind 为 plugin:report-gate', sample.source.kind === 'plugin:report-gate',
    sample.source.kind)
  check('预设守卫：同预设放行、其它预设不处理',
    ownsPreset('report', 'report') === true && ownsPreset('report', 'crawl') === false,
    `${ownsPreset('report', 'report')}/${ownsPreset('report', 'crawl')}`)
  check('预设守卫：未配置 / 取不到一律不处理（fail-closed）',
    ownsPreset('', 'report') === false && ownsPreset('report', undefined) === false, 'fail-open')

  if (failures.length > 0) {
    console.error(`report-gate selftest 失败：${failures.length}/${cases} 项`)
    for (const f of failures) console.error(`  ${f}`)
    process.exitCode = 1
    return
  }
  console.log(`report-gate selftest 通过：${cases} 项判据全部符合预期`)
}

if (process.argv[1] && process.argv[1].endsWith('report-gate.mjs') && process.argv.includes('--selftest')) {
  selftest()
}
