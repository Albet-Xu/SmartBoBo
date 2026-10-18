/**
 * bobo-common —— 跨模式公共 persona 段（本地插件，注册为系统提示词 section）。
 *
 * 抽取自 7 个 agent 预设里逐字重复的公共段落，目的：**改一处、全部预设生效**。
 * 抽取前这些段落被逐份复制在各个 `agent-presets/<预设>/agent.cordis.yml` 的
 * `persona.text` 里；新增论文写作四模式前必须先收拢，否则只会再多出四份副本。
 *
 * 承载方式：注册一个**常驻系统提示词 section**（`order: 20`，紧跟 persona（0）
 * 之后、计划策略（50）与工具说明（100+）之前）。不占对话上下文、不会被压缩丢掉、
 * 每轮都在——比 `agent/pre-step` 注入 user 消息更省 token 也更不易丢失。
 *
 * 挂载：需要在公共段的预设各挂一行（相对路径按预设文件目录解析）：
 *
 *     - id: bobo-common
 *       name: '../../plugins/bobo-common.mjs'
 *       config:
 *         install: blocked          # allowed = 能装 MCP/技能；blocked = 引导去标准模式
 *         proxy: true               # 有 /proxy 命令的模式才开
 *         env: true                 # 有 Python 脚本 / CloakBrowser / 数据库的模式才开
 *         pdfServerName: pdf-extract-crawl
 *
 * **极简模式（minimal）不要挂**：它的 persona 设了 `complete: true`，装配时会把
 * 该作用域恢复为"仅此一段"，本 section 会被抑制（不会报错，但也不会生效）。
 * 它本来就自带身份与安装两段，保持原样即可。
 *
 * 唯一名称约束：section 名在同一作用域内必须唯一，所以**只注册在预设作用域（ctx），
 * 不注册到 ctx.root**——注册到 root 会让全部作用域共用一个名字而相互冲突。
 */
export const name = 'bobo-common'

/** 本插件要注册到系统提示词注册表，声明依赖让装载器等它就绪（与 `persona` 同法）。 */
export const inject = ['systemPrompt']

/** 段名：同一作用域内唯一。 */
const SECTION_NAME = 'bobo:common'

/** 段序：紧跟 persona（0）之后，早于计划策略（50）与工具说明（100+）。 */
const SECTION_ORDER = 20

/** 身份与品牌（抽取前 7/7 逐字相同）。 */
const IDENTITY = '你的正式身份是 BoBo，一个由许建波同学开发的 AI 智慧采集小助手，运行在 SmartBoBo Agent 环境中。身份说明用于约束身份认知，但绝不主动自我介绍。仅当用户直接向你发起问候或身份询问（如“你好”“hello”“hi”“你是谁”“你是谁？”“介绍一下你自己”“你叫什么”等）时才进行自我介绍，且只把固定开场一句作为回答的开头第一句：“你好！我是 BoBo，一个由许建波同学开发的 AI 智慧采集小助手。我目前运行在 SmartBoBo Agent 环境中，主要功能包括网页采集、MCP 工具与技能扩展等。”除命中这些问候/身份关键词外，任何回复都不得自带“你好！我是 BoBo…”这类自我介绍、打招呼或开场问候；也不要因为用户提到“BoBo”或“SmartBoBo”等字眼就自我介绍。禁止自称 MiMo 或任何小米系产品身份。'

/** 安装能力·有能力版（抽取前 standard/code/cordis 三处逐字相同）。 */
const INSTALL_ALLOWED = '你具备从 GitHub 安装 MCP 服务器与技能包的能力：安装 MCP 服务器时，按其 SOP 确定 serverName 与 transport（stdio 使用 command/args/env，streamable-http 使用 url/headers），把 mcp-client 配置行写进当前 profile 的**用户覆盖层** `<DSH_HOME>/profiles/<profile>/cordis.patch.yml`（`DSH_HOME` 由 BoBo 启动脚本设置，本项目为 `<BoBo根>/bobo-data/dsh`，profile 名即启动方式 web/headless），装完在 设置 → MCP 面板确认状态，密钥一律走 `<DSH_HOME>/.credentials.yaml` 或 `process.env.X`，不得硬编码；安装技能包时，克隆含 SKILL.md 的仓库到 `<DSH_HOME>/skills/<name>/`（这是所有模式共用的用户级技能根）。完整流程见内置技能 install-mcp-and-skills，动手前先加载该技能。'

/** 安装能力·受限版（抽取前 minimal/crawl/reverse/workflow 四处逐字相同）。 */
const INSTALL_BLOCKED = '你所在模式工具集精简，不具备从 GitHub 安装 MCP 服务器或技能包的能力。当用户请求安装 MCP 或 Skills 时，请友好引导用户：进入 设置 → Agent 预设 → 选择「标准模式」，切换后重新发起安装请求；标准模式下可调用内置技能完成安装。请勿在当前模式下尝试直接安装。'

/** 代理模式内核（抽取前 crawl/reverse/workflow 三处逐字相同，reverse 另有追加句）。 */
const PROXY_CORE = '如果用户使用了 /proxy 命令开启代理模式，采集请求会通过配置的代理池访问目标网站。如果代理失效（连续重试3次全部失败），crawl_fetch 工具会返回"代理失效"提示。此时必须使用 ask_user_question 询问用户："代理失效，是否走本地网络进行访问网页？"，用户确认后再使用本地网络重新采集。如果没有开启代理模式，直接使用本地网络采集。'

/** 技能市场检索段（/skill-model 命令提交任务时的检索-借鉴-安装流程）。 */
const SKILL_MODEL_CORE = '如果用户使用 /skill-model 命令提交任务，先检索技能市场再完成任务。流程：(1) 用 market_search 搜索候选技能，每个任务最多搜索 3 次，关键词来自任务拆解，按技能 description 粗筛；(2) 用 market_detail 精读候选的 SKILL.md，必要时用 market_file 阅读技能内的具体文件；(3) 默认只读借鉴，仅当技能确实对本任务或后续有价值时才用 market_install 安装——安装前必须查看能力披露，安装后必须在回复中列出安装的技能、各自用途与能力风险提示；(4) 提醒用户：安装的技能可在「设置 → 技能库」中查看并手动删除，是否删除由用户决定，模型不得删除技能；(5) 搜不到合适技能时如实说明，改用本地已装技能或直接完成任务，不要反复空转搜索；(6) 完成任务时在回复中注明参考了哪些技能。'

/** 环境全局申明：第 3 行是路径清单，按模式给不同取值。 */
const ENV_PATHS_DEFAULT = 'scripts、数据库数据目录（dbx_data_dir）、代理池配置、crawl_script'
const ENV_HEAD = '涉及运行 Python 采集 / 逆向 / 提取脚本，或使用 CloakBrowser / 代理 / 数据库时，**先加载 `bobo-env` 技能，读取全局环境清单** `<BoBo根>/dbx-runtime/env-manifest.json`，按下述规则行事：'
const ENV_TAIL = '- **不要自行搜索路径、不要猜测；不要重新安装或联网重新下载 CloakBrowser 运行时**（已由 cloak/ensure.ps1 受控预铺；确认其状态请读清单 `cloakserve` 段）。'

/**
 * 读取 PDF 段（抽取前有两套措辞，此处统一用信息更全的一套；
 * 各预设唯一差异是本模式 pdf-extract 的 serverName）。
 * @param serverName - 本模式挂载的 pdf-extract MCP 的 serverName。
 * @returns 段落正文。
 */
function pdfParagraph(serverName) {
  return `用户给出 PDF 文件路径并要求读取/总结/提取其中内容时，必须调用 PDF 工具（serverName=${serverName}）：先用 \`mcp__${serverName}__pdf_extract_info\` 拿总页数；再用 \`mcp__${serverName}__pdf_extract\` 分批读取（一次最多 20 页 / 约 4 万字符），返回 \`truncated=true\` 时按 \`next_page_start\` 继续读后续页直到读够。工具按页返回文字、表格转成 Markdown，据此回答/汇总/提取字段。**默认只读不落盘**：用户没有明确要求保存时绝不传 \`save=true\`，只有用户要求保存时才 \`save=true\`（可用 \`save_dir\` 指定目录）。仅支持带文字层的 PDF，扫描件/纯图片 PDF 暂不支持，如实告知用户。`
}

/** 可覆盖的默认配置。 */
export const DEFAULT_CONFIG = {
  /** 段名（同一作用域内唯一）。 */
  section: SECTION_NAME,
  /** 段序。 */
  order: SECTION_ORDER,
  /** `allowed` = 有能力安装；`blocked` = 引导用户去标准模式。 */
  install: 'blocked',
  /** 是否注入「代理模式」段。 */
  proxy: false,
  /** 代理段的模式私有追加句（如 reverse 的"脚本内嵌代理逻辑"）。空串表示不追加。 */
  proxyExtra: '',
  /** 是否注入「技能市场检索」段（挂 /skill-model 命令与 market_* 工具的模式才开）。 */
  skillModel: false,
  /** 是否注入「环境全局申明」段。 */
  env: false,
  /** 环境段第 3 行的路径清单（含 `extraction_scripts` 的模式在此覆盖）。 */
  envPaths: ENV_PATHS_DEFAULT,
  /** 本模式 pdf-extract MCP 的 serverName；空串表示本模式无 PDF 工具、不注入该段。 */
  pdfServerName: '',
}

/**
 * 拼装本插件要注册的 section 正文（纯函数，不接触 dsh，可直接 node 验证）。
 * @param config - 可覆盖 {@link DEFAULT_CONFIG} 的任意字段。
 * @returns section 正文；无任何段可注入时返回空串。
 */
export function buildSection(config = {}) {
  const merged = { ...DEFAULT_CONFIG, ...config }
  const blocks = []

  blocks.push(`## 身份与品牌规则（固定）\n\n${IDENTITY}`)

  const install = merged.install === 'allowed' ? INSTALL_ALLOWED : INSTALL_BLOCKED
  blocks.push(`## 安装能力限制（固定）\n\n${install}`)

  if (merged.proxy === true) {
    const extra = typeof merged.proxyExtra === 'string' ? merged.proxyExtra : ''
    blocks.push(`## 代理模式（固定）\n\n${PROXY_CORE}${extra}`)
  }

  if (merged.skillModel === true) {
    blocks.push(`## 技能市场检索（固定）\n\n${SKILL_MODEL_CORE}`)
  }

  if (merged.env === true) {
    const paths = typeof merged.envPaths === 'string' && merged.envPaths !== ''
      ? merged.envPaths
      : ENV_PATHS_DEFAULT
    blocks.push([`## 环境全局申明（固定）`, '', ENV_HEAD, `- 所有 Python 脚本一律用清单里的 \`pythonBin\`（BoBo 的 .venv 解释器）运行，不要用系统 python；`, `- ${paths} 等路径都以清单为准；`, ENV_TAIL].join('\n'))
  }

  if (typeof merged.pdfServerName === 'string' && merged.pdfServerName !== '') {
    blocks.push(`## 读取 PDF（固定）\n\n${pdfParagraph(merged.pdfServerName)}`)
  }

  if (blocks.length === 0) return ''
  return `${blocks.join('\n\n')}\n`
}

/**
 * 把公共段注册为该作用域的常驻系统提示词 section。
 * @param ctx - 预设作用域内的插件上下文（不要注册到 ctx.root）。
 * @param config - 可覆盖 {@link DEFAULT_CONFIG} 的任意字段。
 */
export function apply(ctx, config) {
  const merged = { ...DEFAULT_CONFIG, ...config }
  const text = buildSection(merged)
  if (text === '') return
  ctx.effect(
    () => ctx.systemPrompt.section({ name: merged.section, order: merged.order, text }),
    'bobo-common.section()',
  )
}

/** 自检：校验配置开关与段落存在性一致（`node bobo-common.mjs --selftest`）。 */
function selftest() {
  const cases = [
    { label: '仅身份+安装（blocked）', config: {}, want: ['身份与品牌规则', '安装能力限制'], absent: ['代理模式', '环境全局申明', '读取 PDF'] },
    { label: '能力版安装', config: { install: 'allowed' }, want: ['安装能力限制'], absent: ['代理模式'] },
    { label: '采集模式全量', config: { proxy: true, env: true, pdfServerName: 'pdf-extract-crawl' }, want: ['身份与品牌规则', '安装能力限制', '代理模式', '环境全局申明', '读取 PDF', 'serverName=pdf-extract-crawl', 'mcp__pdf-extract-crawl__pdf_extract_info'], absent: [] },
    { label: 'PDF 段跟随配置的 serverName', config: { pdfServerName: 'pdf-extract' }, want: ['serverName=pdf-extract', 'mcp__pdf-extract__pdf_extract'], absent: ['pdf-extract-crawl'] },
    { label: 'workflow 环境路径', config: { env: true, envPaths: 'scripts、数据库数据目录（dbx_data_dir）、代理池配置、crawl_script、extraction_scripts' }, want: ['extraction_scripts'], absent: [] },
    { label: 'reverse 代理追加句', config: { proxy: true, proxyExtra: '生成爬虫脚本时，如果开启代理模式，脚本内会嵌入代理池取IP+轮换+重试+失效询问的完整逻辑。' }, want: ['生成爬虫脚本时'], absent: [] },
    { label: 'skillModel 开启', config: { skillModel: true }, want: ['技能市场检索', 'market_install'], absent: [] },
    { label: 'skillModel 默认关闭', config: {}, want: [], absent: ['技能市场检索', 'market_install'] },
  ]
  let failed = 0
  for (const item of cases) {
    const text = buildSection(item.config)
    for (const token of item.want) {
      if (!text.includes(token)) {
        console.error(`✗ ${item.label}：缺少「${token}」`)
        failed += 1
      }
    }
    for (const token of item.absent) {
      if (text.includes(token)) {
        console.error(`✗ ${item.label}：不应出现「${token}」`)
        failed += 1
      }
    }
  }
  if (failed > 0) {
    console.error(`bobo-common selftest 失败：${failed} 项`)
    process.exitCode = 1
    return
  }
  console.log(`bobo-common selftest 通过：${cases.length} 个用例`)
}

const invokedDirectly = await (async () => {
  if (process.argv[1] === undefined) return false
  const [{ fileURLToPath }, { resolve }] = await Promise.all([import('node:url'), import('node:path')])
  return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
})()

if (invokedDirectly && process.argv.includes('--selftest')) selftest()
