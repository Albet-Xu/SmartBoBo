/**
 * session-search-cn —— 中文友好的历史会话检索工具（`session_recall`）。
 *
 * ## 为什么另起一个工具
 *
 * 上游会话全文检索的 FTS5 表硬编码 `tokenize = 'unicode61'`（dsh/packages/session-query/
 * session-query-sqlite/src/schema.ts:126-136），unicode61 把标点之间的连续汉字算成**一个**
 * token，中文子串搜索基本不可用（docs/说明文档/功能实现/48-上下文优化与预算管理操作指南.md
 * §2.3 有实测表：搜「天气」「电影」命中 0）。该局限是上游刻意保留的，本项目不改上游——
 * 所以在 bobo 目录里自建 `tokenize='trigram'` 索引补上中文这一半（trigram 按 3 字符滑窗
 * 分词，天然支持任意子串匹配，中文实测可用）。
 *
 * 上游 5 个 `session_*` 工具名不占用（dsh/packages/session-query/tool-session-query/src/
 * index.ts:66-109：session_search / session_event_search / session_trace /
 * session_event_trace / session_event_read），本工具注册为 `session_recall`（已 grep 确认全仓无冲突）。
 *
 * ## 会话存储依据（读源码 + 对真实文件实测）
 *
 * - **根目录**：`bundle/base/cordis.patch.yml:130-133` 把 JSONL 后端配成
 *   `root: !!js dshHomePath('sessions')`；开发态 `启动.cmd:32` 设 `DSH_HOME=<BoBo根>\bobo-data\dsh`，
 *   故落盘在 `bobo-data/dsh/sessions/`。
 * - **目录布局**：`session-persistence-jsonl/src/format.ts:254-305`——
 *   `<root>/<projectKey>/<encodeSegment(sessionId)>/`。
 * - **文件名**：`session-format/src/filename.ts:6-16`——`session.jsonl`（v0）或 `session.vN.jsonl`；
 *   压缩后缀 `.jsonl.zstd` 见 `format.ts:42-44`，默认压缩为 zstd（`session-persistence-jsonl/src/index.ts:68`）。
 *   同一目录可能并存 v3/v4 两代，取**数值最高代**（同上游 `index.ts:1446-1447`
 *   `resolveGenerationInDirectory` 的规则），否则同一批消息会索引两遍。
 * - **行结构**：`format.ts:313-324`（每行一个 JSON 对象）+ 实测真实文件：首行是 header
 *   `{"type":"session","version":4,"id":"session-…","createdAt":…}`（header 字段见 `format.ts:83-98`），
 *   事件行形如 `{"type":"user/message","seq":9,"time":1790848766601,"data":{...}}`——
 *   `seq`/`time`/`type` 在顶层，正文在 `data` 里（各事件类型的 data 形状见实测：
 *   user/message 有 `data.content[]` + `data.source.kind`；assistant/message 是 `data.message.content[]`；
 *   tool/result 是 `data.message.content[]`，v3 里还多套一层 `type:'tool-result'` 的壳）。
 * - **zstd 是多帧拼接**：每个写批次一个独立帧（`session-persistence-jsonl/src/zstd.ts:15,48-118`
 *   的 `scanZstdFrames` 就是为它写的）。实测 41704B 的文件含 27 帧，而 Node 的
 *   `zstdDecompressSync` **只解第一帧**——所以本插件自己扫帧逐帧解码（帧结构逻辑同源，含撕裂尾容忍）。
 * - **归档会话**：`archivedSessionIds` 只是 workspace registry 里的 id 集合
 *   （`workspace/src/spec.ts:48-62`；实测 `bobo-data/dsh/storages/workspace.json`），
 *   文件**不挪动**，仍躺在 `sessions/` 下——所以扫 `sessions/` 即覆盖归档。
 *   实测 DSH_HOME 下没有 `archived-sessions/` 目录；若未来上游真的分出来，本插件会顺带扫
 *   `<root 的兄弟目录>/archived-sessions`（存在才扫，不存在就跳过）。
 *
 * ## 设计取舍
 *
 * - **惰性索引（openAt: first-search 的教训）**：`cordis.patch.yml:46-56` 记录了——启动期打开
 *   损坏索引会让 `[Service.init]` 抛、11 个预设全挂。所以本插件 apply 时**不碰数据库**，
 *   第一次调用才打开；打开失败只让**当次调用**报错（下一次调用重试），绝不拖垮启动。
 * - **增量 + 时间预算**：`meta` 表记每个源文件的 mtime+size，检索前只重索引变化的文件，
 *   且受 `config.indexBudgetMs`（默认 2000ms）约束——超预算就停，下次检索续上（按文件粒度切，
 *   单个超大文件会一次建完；实测最大单文件 3.2MB）。候选文件按 mtime 倒序，**新会话优先入索引**。
 * - **检索公式**：命中覆盖率（命中的查询 trigram 数 / 查询 trigram 总数，防"单字碰瓷"）×
 *   时间衰减（艾宾浩斯分桶，照抄参考源 dsh-meow-memory 的
 *   src/bm25.ts:210-221）→ 同会话按 seq 相邻命中聚合成簇（簇分 = 最高分 + 密度小加成，封顶 +0.2）。
 *   覆盖率在 JS 里对存储文本做子串统计（大小写不敏感，对齐 trigram 分词器的 ASCII 折叠）。
 * - **查询即普通子串**：≥3 字符走 FTS5（每个 trigram 包成带双引号转义的 phrase 再 OR）；
 *   <3 字符 FTS5 trigram 无能为力（实测 2 字短语命中 0），回退 `LIKE … ESCAPE` 扫描。
 *   查询里的引号/`OR`/`*` 等 FTS 语法字符全部被引号包死，只当字面量（selftest 有真库验证）。
 * - **输出硬上限**：默认 6000 字符，组装时预留截断提示的长度，超了就截并注明；
 *   最后还有一道 slice 兜底，保证永不越线。
 * - **当前会话不参与**：本工具是"检索历史"，当前会话的消息太新（时间衰减满分）会霸榜，直接排除。
 *
 * ## 契约
 *
 * - 只读：只读 `sessions/` 与自建的 `cache/session-recall.db`，不写任何会话文件、不监听事件。
 * - 工具失败即当次失败：所有错误以工具错误返回给模型（中文、带路径提示），不影响其它链路。
 * - WAL + busy_timeout=5000（可能与桌面壳并发打开同一库）。
 *
 * 挂载：host 层一行（`cordis.patch.yml` 的 insert 列表），不改上游任何文件。
 * 排障：`node session-search-cn.mjs --selftest`；手动验证真实索引见报告里的命令。
 */

import { DatabaseSync } from 'node:sqlite'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'

export const name = 'session-search-cn'

/** 本工具依赖的服务。 */
export const inject = ['tools']

/** 可覆盖的默认配置（cordis.patch.yml 的 config 段可整段覆盖）。 */
export const DEFAULT_CONFIG = {
  /** 会话根目录；null → `<DSH_HOME>/sessions`。 */
  sessionsRoot: null,
  /** 索引库路径；null → `<DSH_HOME>/cache/session-recall.db`。 */
  dbPath: null,
  /** 每次检索最多花在增量索引上的毫秒数（超了下次续）。 */
  indexBudgetMs: 2_000,
  /** 每组会话最多输出几条摘录。 */
  snippetsPerSession: 3,
  /** 输出硬上限（字符）。 */
  outputCharLimit: 6_000,
  /** FTS/LIKE 候选行上限（先粗筛再精排）。 */
  candidateLimit: 500,
  /** 同会话内 seq 相差不超过该值算"相邻命中"，聚成一簇。 */
  adjacentSeqGap: 10,
  /** 摘录窗口：命中处前后各取多少字符。 */
  snippetRadius: 80,
  /** 单条消息入索引的字符上限（防超大工具结果撑爆索引，超出截断）。 */
  maxMessageChars: 4_000,
  /** 会话标题取第一条 user 消息的前多少字符。 */
  titleChars: 40,
  /** 单次查询的最大字符数（防超长查询生成过多 OR 分支）。 */
  maxQueryChars: 200,
}

/** 索引库的 application_id（'BSRC'），用于拒绝打开别人的数据库。 */
const APP_ID = 0x42535243
/** 本插件的索引 schema 版本；不匹配就整库重建（派生数据，重建无损）。 */
const SCHEMA_VERSION = 1
/** 索引表允许出现的全部用户表（含 FTS5 影子表）。 */
const OWNED_TABLES = new Set([
  'meta', 'msgs', 'msgs_data', 'msgs_idx', 'msgs_docsize', 'msgs_config', 'msgs_content',
])

/** 角色 → 输出里的中文标签。 */
const ROLE_LABELS = { user: '用户', assistant: '助手', tool: '工具', system: '系统' }

// ══════════════════════════════════ 纯函数（selftest 直接覆盖） ══════════════════════════════════

/**
 * DSH_HOME 解析：显式配置 > $DSH_HOME > ~/.dsh（同 home-paths util 的优先级，空白视为未设）。
 * @param env - 环境变量映射。
 * @param homedirFn - 用户主目录取值（测试可注入）。
 * @returns DSH_HOME 路径。
 */
export function resolveDshHome(env = process.env, homedirFn = homedir) {
  const fromEnv = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (fromEnv !== '') return fromEnv
  return join(homedirFn(), '.dsh')
}

/**
 * 控制字符 → 空格（保留长度、去掉不可见噪声），并清掉 FTS5 highlight 保留字符。
 * 用码点判定而不是正则字符类：FDD0-FDD1 是非字符、C0/DEL 是控制符，含义与
 * 上游 query.ts:12-13 的 sanitizeFtsText 一致；写成码点区间也免得源码里躺着控制字面量。
 * 索引写入与查询构造共用，保证"存进去的"和"查出来的"是同一套文本。
 * @param text - 任意原文。
 * @returns 清洗后的文本（不折叠空白——折叠会破坏子串语义）。
 */
export function sanitizeText(text) {
  let out = ''
  for (const ch of String(text ?? '')) {
    const code = ch.codePointAt(0)
    const isControl = code <= 0x1f || code === 0x7f || (code >= 0xfdd0 && code <= 0xfddf)
    out += isControl ? ' ' : ch
  }
  return out
}

/** 查询清洗：控制字符 → 空格并 trim（查询里的换行按空格处理，与索引侧一致）。 */
export function sanitizeQuery(text) {
  return sanitizeText(text).trim()
}

/** 以 Unicode 码点计数的长度（避免把增补平面字符劈开）。 */
export function cpLength(text) {
  return Array.from(String(text ?? '')).length
}

/**
 * 把查询切成去重后的 trigram 列表（3 个码点的滑窗，保序去重）。
 * 查询不足 3 码点时返回空数组——FTS5 trigram 对短语无能为力（实测 2 字短语命中 0）。
 * @param query - 已清洗的查询。
 * @returns trigram 数组；空数组表示应走 LIKE 回退。
 */
export function trigramList(query) {
  const cps = Array.from(String(query ?? ''))
  if (cps.length < 3) return []
  const seen = new Set()
  const out = []
  for (let i = 0; i + 3 <= cps.length; i++) {
    const tri = cps.slice(i, i + 3).join('')
    if (!seen.has(tri)) {
      seen.add(tri)
      out.push(tri)
    }
  }
  return out
}

/** FTS5 phrase 转义：整体包双引号，内部 `"` 翻倍——语法字符从此只是字面量。 */
export function ftsPhrase(term) {
  return `"${String(term ?? '').replaceAll('"', '""')}"`
}

/**
 * 构造 FTS5 MATCH 表达式：每个 trigram 一个 phrase，OR 连接。
 * 覆盖率的精排在 JS 里做，这里只负责把候选**召回**（含部分命中的行）。
 * @param trigrams - {@link trigramList} 的结果。
 * @returns MATCH 表达式；trigrams 为空返回 null（调用方走 LIKE）。
 */
export function buildFtsExpr(trigrams) {
  if (!Array.isArray(trigrams) || trigrams.length === 0) return null
  return trigrams.map(ftsPhrase).join(' OR ')
}

/** LIKE 模式转义：反斜杠、百分号、下划线前加反斜杠，配合 `ESCAPE '\'`。 */
export function escapeLike(text) {
  return String(text ?? '').replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/** LIKE 回退模式（短查询专用）。 */
export function likePattern(query) {
  return `%${escapeLike(query)}%`
}

/**
 * 艾宾浩斯复习间隔分桶（年龄天数 → 权重）。
 * 照抄参考源 dsh-meow-memory 的 src/bm25.ts:210-221。
 * @param ageMs - now - time（毫秒）。
 * @returns [0.08, 1] 区间的衰减权重。
 */
export function recencyWeight(ageMs) {
  const days = ageMs / 86_400_000
  if (days < 1) return 1.0
  if (days < 2) return 0.9
  if (days < 4) return 0.8
  if (days < 7) return 0.65
  if (days < 15) return 0.5
  if (days < 30) return 0.35
  if (days < 60) return 0.25
  if (days < 180) return 0.15
  return 0.08
}

/**
 * 命中覆盖率：查询 trigram 里有多少出现在文本中（大小写不敏感，对齐分词器的 ASCII 折叠）。
 * 整串直接命中时短路为 1，省掉逐 trigram 扫描。
 * @param text - 已清洗的存储文本。
 * @param query - 已清洗的查询（短查询路径下覆盖率按"整串包含"算）。
 * @param trigrams - {@link trigramList} 的结果；空数组表示短查询。
 * @returns [0, 1]。
 */
export function coverageOf(text, query, trigrams) {
  const hay = String(text ?? '').toLowerCase()
  const needle = String(query ?? '').toLowerCase()
  if (needle !== '' && hay.includes(needle)) return 1
  if (!Array.isArray(trigrams) || trigrams.length === 0) return 0
  let hit = 0
  for (const tri of trigrams) {
    if (hay.includes(tri.toLowerCase())) hit += 1
  }
  return hit / trigrams.length
}

/**
 * 单条命中的得分 = 覆盖率 × 时间衰减。
 * @param coverage - {@link coverageOf} 的结果。
 * @param time - 事件时间（毫秒）。
 * @param now - 检索时刻（毫秒）。
 * @returns 得分（0..1）。
 */
export function scoreHit(coverage, time, now) {
  const t = typeof time === 'number' && Number.isFinite(time) ? time : 0
  const age = Math.max(0, now - t)
  return coverage * recencyWeight(age)
}

/**
 * 同会话相邻命中聚合：按 seq 升序走一遍，seq 差 ≤ gap 的命中并进同一簇。
 * 簇分 = 成员最高分 + 密度加成 0.05×(n-1)（封顶 +0.2）——
 * 同一回合里连环命中是强信号，但不能让"刷屏"无界抬分。
 * @param hits - 同一会话的命中（元素需含 seq/score 字段；seq<0 的行不参与聚簇）。
 * @param gap - 相邻判定的 seq 差上限。
 * @returns 按簇分降序的簇数组；每簇含 members/best/score。
 */
export function clusterHits(hits, gap) {
  const list = [...(Array.isArray(hits) ? hits : [])]
    .filter((hit) => hit && typeof hit.seq === 'number' && hit.seq >= 0)
    .sort((a, b) => a.seq - b.seq)
  const clusters = []
  for (const hit of list) {
    const last = clusters[clusters.length - 1]
    if (last !== undefined && hit.seq - last.members[last.members.length - 1].seq <= gap) {
      last.members.push(hit)
    } else {
      clusters.push({ members: [hit] })
    }
  }
  for (const cluster of clusters) {
    let best = cluster.members[0]
    for (const member of cluster.members) {
      if (member.score > best.score) best = member
    }
    cluster.best = best
    cluster.score = best.score + Math.min(0.05 * (cluster.members.length - 1), 0.2)
  }
  return clusters.sort((a, b) => b.score - a.score)
}

/**
 * 从会话目录里挑数值最高代的日志文件名（同上游 resolveGenerationInDirectory 的规则）。
 * @param names - 目录里的文件名。
 * @returns 选中的文件名；没有可用代返回 null。
 */
export function pickGenerationFile(names) {
  let best = null
  let bestVersion = -1
  for (const name of Array.isArray(names) ? names : []) {
    const match = /^session(?:\.v([1-9]\d*))?\.jsonl(?:\.zstd)?$/.exec(String(name ?? ''))
    if (match === null) continue
    const version = match[1] === undefined ? 0 : Number(match[1])
    if (!Number.isSafeInteger(version) || version < bestVersion) continue
    if (version === bestVersion && best !== null
      && String(best).endsWith('.zstd') && !String(name).endsWith('.zstd')) continue
    bestVersion = version
    best = name
  }
  return best
}

/**
 * meta 增量判断：mtime 或 size 任一变化、或压根没有记录 → 需要重索引。
 * @param metaRow - meta 表行（mtime/size），无记录传 null。
 * @param stat - 当前文件 fs.statSync 结果。
 * @returns true 表示需重索引。
 */
export function needsReindex(metaRow, stat) {
  if (metaRow === null || metaRow === undefined) return true
  if (typeof stat !== 'object' || stat === null) return false
  // fs.Stats.mtime 是 Date，SQLite 里存的是毫秒数——统一取 mtimeMs（测试对象直接给 mtime 数字）。
  const mtime = typeof stat.mtimeMs === 'number' ? stat.mtimeMs : stat.mtime
  return metaRow.mtime !== mtime || metaRow.size !== stat.size
}

// ── zstd 多帧扫描/解码 ────────────────────────────────────────────────────────

const ZSTD_MAGIC = 0xFD2FB528

/**
 * 结构化扫描拼接式 zstd 流的完整帧（同上游 session-persistence-jsonl/src/zstd.ts:48
 * 的帧结构走法：魔数 → 帧头描述符 → 块序列 → 可选校验和）。
 * 撕裂的尾帧（正在写入/崩溃截断）与遇到非魔数垃圾时停止扫描并保留已得帧——fail-open，
 * 宁可少索引一个尾巴（文件下次 append 时 mtime 变化会整文件重索引），也不让一次脏读炸掉检索。
 * @param buffer - 文件原始字节。
 * @returns frames（start/end 数组）与 torn 标记。
 */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  const len = buffer.length
  while (offset < len) {
    const start = offset
    if (len - offset < 4) return { frames, torn: true }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return { frames, torn: start > 0 }
    offset += 4
    if (offset === len) return { frames, torn: true }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) return { frames, torn: true } // 保留位非零 → 结构不认，停
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const headerRest = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (len - offset < headerRest) return { frames, torn: true }
    offset += headerRest
    for (;;) {
      if (len - offset < 3) return { frames, torn: true }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) return { frames, torn: true } // 保留块类型 → 停
      const payloadBytes = blockType === 0x01 ? 1 : blockSize // RLE 块载荷恒 1 字节
      if (len - offset < payloadBytes) return { frames, torn: true }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (len - offset < 4) return { frames, torn: true }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames, torn: false }
}

/**
 * 把一个会话日志文件解码成文本：.zstd 逐帧解码拼接，普通 .jsonl 直接 utf8。
 * 单帧解码失败时保留已解出的前缀（fail-open，理由同 scanZstdFrames）。
 * @param buffer - 文件原始字节。
 * @param filename - 用于判断压缩后缀。
 * @returns 日志文本。
 */
export function decodeLogFile(buffer, filename) {
  if (!String(filename ?? '').endsWith('.zstd')) return buffer.toString('utf8')
  const { frames } = scanZstdFrames(buffer)
  const parts = []
  for (const frame of frames) {
    try {
      parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
    } catch {
      break // 后续帧失去边界依据，保留前缀
    }
  }
  return Buffer.concat(parts).toString('utf8')
}

// ── 日志解析 → 待索引行 ──────────────────────────────────────────────────────

/** 递归抽取内容块文本（处理 tool/result 在 v3 里多套一层壳的实测形状；reasoning 与未知块跳过）。 */
function blocksText(blocks, depth = 0) {
  if (!Array.isArray(blocks) || depth > 3) return []
  const out = []
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue
    if (block.type === 'text' && typeof block.text === 'string') out.push(block.text)
    else if (block.type === 'tool-call') {
      if (typeof block.name === 'string') out.push(block.name)
      if (typeof block.arguments === 'string') out.push(block.arguments)
    } else if (block.type === 'tool-result') out.push(...blocksText(block.content, depth + 1))
  }
  return out
}

/** 从 tool/result 的 error 字段抠错误名与消息（形状不固定，逐字段试探）。 */
function errorTexts(data) {
  const out = []
  for (const error of [data?.error, data?.message?.error]) {
    if (typeof error === 'string') out.push(error)
    else if (typeof error === 'object' && error !== null) {
      for (const key of ['name', 'code', 'message']) {
        if (typeof error[key] === 'string') out.push(error[key])
      }
    }
  }
  return out
}

/**
 * 解析一个会话日志文本 → sessionId 与待索引行。
 * 抽取语义参照上游 session-query/src/extraction.ts:15-44（user/assistant/tool 三类 +
 * turn/end 错误），外加两个本插件的选择：
 * (1) 递归吃掉 tool/result 的嵌套壳（上游 blockText 对该形状返回空，中文检索吃亏）；
 * (2) turn/end 只取 error 消息，不收 'aborted' 这类状态词（纯噪声，与上游略不同）。
 * 解析失败的行直接跳过——日志尾部可能有撕裂行。
 * @param text - 解码后的日志文本。
 * @param fallbackTime - 行上缺 time 时的兜底时间（用文件 mtime）。
 * @returns sessionId 与 rows；sessionId 取不到时为 ''。
 */
export function parseSessionLog(text, fallbackTime = 0) {
  const rows = []
  let sessionId = ''
  for (const line of String(text ?? '').split('\n')) {
    if (line === '') continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof obj !== 'object' || obj === null || typeof obj.type !== 'string') continue
    if (obj.type === 'session') {
      if (sessionId === '' && typeof obj.id === 'string') sessionId = obj.id
      continue
    }
    const seq = typeof obj.seq === 'number' && Number.isSafeInteger(obj.seq) ? obj.seq : -1
    const time = typeof obj.time === 'number' && Number.isFinite(obj.time) ? obj.time : fallbackTime
    const push = (role, parts, real = false) => {
      const joined = parts.filter((part) => typeof part === 'string' && part !== '').join('\n')
      if (joined !== '') rows.push({ role, seq, time, text: joined, real })
    }
    switch (obj.type) {
      case 'user/message':
        push('user', blocksText(obj.data?.content), obj.data?.source?.kind === 'user')
        break
      case 'assistant/message':
        push('assistant', blocksText(obj.data?.message?.content))
        break
      case 'tool/call':
        push('tool', [obj.data?.name, obj.data?.arguments])
        break
      case 'tool/result':
        push('tool', [...blocksText(obj.data?.message?.content), ...errorTexts(obj.data)])
        break
      case 'todo/write': {
        const todos = Array.isArray(obj.data?.todos) ? obj.data.todos : []
        const parts = []
        for (const todo of todos) {
          if (typeof todo?.content === 'string') parts.push(todo.content)
          if (typeof todo?.status === 'string') parts.push(todo.status)
        }
        push('assistant', parts)
        break
      }
      case 'turn/end': {
        const reason = obj.data?.reason
        if (reason?.kind === 'error') {
          const error = reason.error
          push('system', [
            typeof error === 'string' ? error : error?.message,
            typeof error === 'object' && error !== null ? error.code : undefined,
          ])
        }
        break
      }
      default:
        break // system/message、request/*、结构事件等一律不入索引（样板噪声，上游同样排除）
    }
  }
  return { sessionId, rows }
}

/**
 * 取会话标题：第一条真实用户消息（source.kind === 'user'）前 40 字；
 * 没有真实用户消息（全是插件注入）时退而求其次取第一条 user 消息。
 * 实测真实会话里 runtime-context/skill-catalog 注入都排在真实用户消息之后，
 * 但 at-workspace/context-facts 这类插件注入可能抢跑——按 real 优先更稳。
 * @param rows - parseSessionLog 的 rows。
 * @param titleChars - 截断长度。
 * @returns 标题；没有 user 消息返回 ''。
 */
export function extractTitle(rows, titleChars = 40) {
  const users = (Array.isArray(rows) ? rows : []).filter((row) => row?.role === 'user')
  const chosen = users.find((row) => row.real === true) ?? users[0]
  if (chosen === undefined) return ''
  const cps = Array.from(sanitizeText(chosen.text))
  return cps.length > titleChars ? `${cps.slice(0, titleChars).join('')}…` : cps.join('')
}

/**
 * 摘录窗口：命中处前后各 radius 字符，控制字符已在索引侧清洗，这里再兜底一次。
 * 位置优先取整串命中，取不到再取查询顺序里第一个出现的 trigram。
 * @param text - 存储文本。
 * @param query - 已清洗查询。
 * @param trigrams - trigram 列表。
 * @param radius - 前后窗口。
 * @returns 带省略号的摘录。
 */
export function makeSnippet(text, query, trigrams, radius = 80) {
  const clean = sanitizeText(text)
  const lower = clean.toLowerCase()
  let pos = lower.indexOf(String(query ?? '').toLowerCase())
  let span = String(query ?? '').length
  if (pos < 0) {
    span = 0
    for (const tri of Array.isArray(trigrams) ? trigrams : []) {
      const at = lower.indexOf(tri.toLowerCase())
      if (at >= 0) {
        pos = at
        span = tri.length
        break
      }
    }
  }
  if (pos < 0) {
    pos = 0
    span = 0
  }
  const start = Math.max(0, pos - radius)
  const end = Math.min(clean.length, pos + span + radius)
  const body = clean.slice(start, end)
  return `${start > 0 ? '…' : ''}${body}${end < clean.length ? '…' : ''}`
}

/** Date 到 YYYY-MM-DD HH:MM（本地时区，给模型看的可读时间）。 */
export function fmtDate(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 组装最终输出（硬上限在这一层保证）。
 * 组装时预留截断提示的长度，放不下就停并注明"展示了几/总数"；
 * 最后兜底 slice，任何路径都不会超过 limit。
 * @param parts - header 与已按分数排序、摘录已截好的 sessions（每项含 block 字段）。
 * @param limit - 字符硬上限。
 * @returns 最终文案。
 */
export function renderResult({ header, sessions }, limit) {
  const cap = Math.max(64, Math.floor(limit))
  const total = sessions.length
  let shown = 0
  const noteFor = (shownCount) => `——\n【已截断】输出达到 ${cap} 字符上限：展示 ${shownCount}/${total} 个会话。`
    + '想看更多请换更独特或更短的子串缩小结果。'
  let out = header
  for (let i = 0; i < sessions.length; i++) {
    const block = sessions[i].block
    const note = noteFor(i)
    if (out.length + block.length + note.length > cap) break
    out += block
    shown = i + 1
  }
  if (shown < total) out += noteFor(shown)
  if (out.length > cap) out = `${out.slice(0, Math.max(0, cap - 1))}…`
  return out
}

// ══════════════════════════════════ 索引库（惰性打开） ══════════════════════════════════

/**
 * 打开（或初始化）索引库：application_id 守卫 → WAL + busy_timeout → schema 版本自愈。
 * 每一步失败都抛中文错误——由工具当次调用承接，绝不影响插件装载。
 * @param dbPath - 库文件路径。
 * @returns DatabaseSync 句柄。
 */
export function openIndex(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(dbPath)
  try {
    const foreign = db.prepare('PRAGMA application_id').get()
    const applicationId = Number(foreign?.application_id ?? 0)
    if (applicationId !== 0 && applicationId !== APP_ID) {
      throw new Error(`该数据库属于其它应用（application_id=0x${applicationId.toString(16)}），`
        + `拒绝使用：${dbPath}。删除该文件后重试。`)
    }
    if (applicationId === 0) {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*'")
        .all()
        .map((row) => String(row.name))
      const unknown = tables.filter((table) => !OWNED_TABLES.has(table))
      if (unknown.length > 0) {
        throw new Error(`该数据库不是 session-recall 索引（含未知表 ${unknown.join('、')}）：`
          + `${dbPath}。删除该文件后重试。`)
      }
      db.exec(`PRAGMA application_id = ${APP_ID}`)
    }
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('PRAGMA journal_mode = WAL')
    const versionRow = db.prepare('PRAGMA user_version').get()
    const version = Number(versionRow?.user_version ?? 0)
    if (version !== SCHEMA_VERSION) {
      // 派生索引：版本不符就整库重建（同上游 session-query-sqlite 的 resetDerivedSchema 思路）。
      db.exec('DROP TABLE IF EXISTS msgs')
      db.exec('DROP TABLE IF EXISTS meta')
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        path       TEXT PRIMARY KEY,
        mtime      INTEGER NOT NULL,
        size       INTEGER NOT NULL,
        session_id TEXT NOT NULL DEFAULT '',
        title      TEXT NOT NULL DEFAULT ''
      )
    `)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS msgs USING fts5(
        text,
        session_id UNINDEXED,
        seq UNINDEXED,
        role UNINDEXED,
        time UNINDEXED,
        src UNINDEXED,
        tokenize = 'trigram'
      )
    `)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/**
 * 遍历会话根目录，每个会话目录只挑最高代日志。
 * 跳过点开头的目录（.lazytest 之类）；根目录不存在视为"没有会话"（fail-open）。
 * @param roots - 会话根目录数组。
 * @returns [{ path }]（按路径去重）。
 */
export function discoverLogFiles(roots) {
  const found = new Map()
  for (const root of Array.isArray(roots) ? roots : []) {
    let projectDirs
    try {
      projectDirs = readdirSync(root, { withFileTypes: true })
    } catch {
      continue // 根不存在 → 无会话；权限等错误也降级（检索仍可给出诊断文案）
    }
    for (const project of projectDirs) {
      if (!project.isDirectory() || project.name.startsWith('.')) continue
      let sessionDirs
      try {
        sessionDirs = readdirSync(join(root, project.name), { withFileTypes: true })
      } catch {
        continue
      }
      for (const session of sessionDirs) {
        if (!session.isDirectory()) continue
        const dir = join(root, project.name, session.name)
        let entries
        try {
          entries = readdirSync(dir, { withFileTypes: true })
        } catch {
          continue
        }
        const picked = pickGenerationFile(entries.filter((e) => e.isFile()).map((e) => e.name))
        if (picked !== null) found.set(join(dir, picked), true)
      }
    }
  }
  return [...found.keys()].map((path) => ({ path }))
}

/**
 * 增量同步索引：删掉不再存在的源文件 → 只重索引 mtime/size 变化的文件（新文件优先），
 * 受 budgetMs 时间预算约束（按文件粒度，超了就停、下次续）。
 * @param db - 已打开的索引库。
 * @param files - discoverLogFiles 的结果。
 * @param budgetMs - 时间预算。
 * @param opts - isAborted 协作取消（工具信号）。
 * @returns 统计 selected/indexed/skipped/removed/pending。
 */
export function syncIndex(db, files, budgetMs, opts = {}) {
  const selectedPaths = new Set(files.map((file) => file.path))
  const stats = { selected: files.length, indexed: 0, skipped: 0, removed: 0, pending: 0 }

  // 1) 源文件消失（含 v3 被 v4 顶替、会话目录被删）→ 连行带记录一起清。
  for (const row of db.prepare('SELECT path FROM meta').all()) {
    const path = String(row.path)
    if (selectedPaths.has(path)) continue
    db.prepare('DELETE FROM msgs WHERE src = ?').run(path)
    db.prepare('DELETE FROM meta WHERE path = ?').run(path)
    stats.removed += 1
  }

  // 2) 变化的文件，mtime 新的排前面——预算不够时优先保住最近的会话。
  const candidates = []
  for (const file of files) {
    let st
    try {
      st = statSync(file.path)
    } catch {
      continue // walk 与 stat 之间被删 → 当作不存在
    }
    const meta = db.prepare('SELECT mtime, size FROM meta WHERE path = ?').get(file.path)
    if (needsReindex(meta === undefined ? null : meta, st)) {
      candidates.push({ path: file.path, mtime: st.mtimeMs, size: st.size, stat: st })
    } else {
      stats.skipped += 1
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime)

  // 3) 逐文件重建（单文件一个事务），预算耗尽即停。
  const deadline = Date.now() + Math.max(0, budgetMs)
  const deleteStmt = db.prepare('DELETE FROM msgs WHERE src = ?')
  const insertStmt = db.prepare(
    'INSERT INTO msgs(text, session_id, seq, role, time, src) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const upsertMeta = db.prepare(
    'INSERT INTO meta(path, mtime, size, session_id, title) VALUES (?, ?, ?, ?, ?) '
    + 'ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, size = excluded.size, '
    + 'session_id = excluded.session_id, title = excluded.title',
  )
  for (let i = 0; i < candidates.length; i++) {
    if (Date.now() >= deadline || opts.isAborted?.() === true) {
      stats.pending = candidates.length - i
      break
    }
    const candidate = candidates[i]
    let buffer
    try {
      buffer = readFileSync(candidate.path)
    } catch {
      stats.skipped += 1 // 读失败不写 meta，下次还会试（预算有界，不会失控）
      continue
    }
    const decoded = decodeLogFile(buffer, candidate.path)
    const { sessionId, rows } = parseSessionLog(decoded, candidate.stat.mtimeMs)
    const title = extractTitle(rows, opts.titleChars ?? DEFAULT_CONFIG.titleChars)
    db.exec('BEGIN')
    try {
      deleteStmt.run(candidate.path)
      for (const row of rows) {
        const cps = Array.from(row.text)
        const maxChars = opts.maxMessageChars ?? DEFAULT_CONFIG.maxMessageChars
        const text = cps.length > maxChars
          ? cps.slice(0, maxChars).join('')
          : row.text
        insertStmt.run(text, sessionId, row.seq, row.role, row.time, candidate.path)
      }
      upsertMeta.run(candidate.path, candidate.mtime, candidate.size, sessionId, title)
      db.exec('COMMIT')
      stats.indexed += 1
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // 回滚失败时把原始错误抛出去更重要
      }
      throw error
    }
  }
  return stats
}

// ══════════════════════════════════ 检索 + 重排 + 渲染 ══════════════════════════════════

/** 查询必填校验（raw 注册的工具没有 defineTool 的自动校验，必须自己来）。 */
export function validateQuery(raw) {
  if (typeof raw !== 'string') {
    throw new Error('缺少必填参数 query（string）：给出要检索的普通子串，例如「今天天气」。')
  }
  const query = sanitizeQuery(raw)
  if (query === '') {
    throw new Error('query 不能为空：给出要检索的普通子串，例如「今天天气」。')
  }
  if (cpLength(query) > DEFAULT_CONFIG.maxQueryChars) {
    throw new Error(`query 过长（>${DEFAULT_CONFIG.maxQueryChars} 字）：`
      + '历史检索按子串匹配，取最关键的一段即可。')
  }
  return query
}

/**
 * 候选召回：大于等于 3 字走 FTS5 trigram OR 表达式（按 rank 取前 candidateLimit），
 * 短查询回退 LIKE（按时间倒序取前 candidateLimit——衰减单调，等价于"取最新一批"）。
 * @param db - 索引库。
 * @param query - 已清洗查询。
 * @param trigrams - trigram 列表。
 * @param limit - 候选上限。
 * @returns 行数组 text/session_id/seq/role/time。
 */
export function queryCandidates(db, query, trigrams, limit) {
  const expr = buildFtsExpr(trigrams)
  if (expr !== null) {
    return db.prepare(
      'SELECT text, session_id, seq, role, time FROM msgs WHERE msgs MATCH ? ORDER BY rank LIMIT ?',
    ).all(expr, limit)
  }
  return db.prepare(
    "SELECT text, session_id, seq, role, time FROM msgs WHERE text LIKE ? ESCAPE '\\' ORDER BY time DESC LIMIT ?",
  ).all(likePattern(query), limit)
}

/**
 * 创建检索核心（持有惰性打开的库句柄，可脱离 dsh 单测）。
 * @param config - 见 DEFAULT_CONFIG。
 * @returns recall / close。
 */
export function createSessionRecall(config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) }
  let db = null

  const resolveRoots = () => {
    const roots = []
    const main = cfg.sessionsRoot || join(resolveDshHome(), 'sessions')
    roots.push(main)
    const sibling = join(dirname(main), 'archived-sessions')
    try {
      if (sibling !== main && existsSync(sibling)) roots.push(sibling)
    } catch {
      // 存在性探测失败就不扫，不影响主根
    }
    return roots
  }

  return {
    /**
     * 执行一次中文历史会话检索。
     * @param rawQuery - 模型给的 query。
     * @param opts - now / excludeSessionId / isAborted。
     * @returns text 与 stats。
     */
    recall(rawQuery, opts = {}) {
      const query = validateQuery(rawQuery)
      const now = typeof opts.now === 'number' ? opts.now : Date.now()
      const trigrams = trigramList(query)
      if (db === null) {
        db = openIndex(cfg.dbPath || join(resolveDshHome(), 'cache', 'session-recall.db'))
      }
      const files = discoverLogFiles(resolveRoots())
      const stats = syncIndex(db, files, cfg.indexBudgetMs, { isAborted: opts.isAborted, titleChars: cfg.titleChars,
        maxMessageChars: cfg.maxMessageChars })

      const candidates = queryCandidates(db, query, trigrams, cfg.candidateLimit)
      const hits = []
      for (const row of candidates) {
        if (opts.excludeSessionId !== undefined && opts.excludeSessionId !== ''
          && row.session_id === opts.excludeSessionId) continue
        const coverage = coverageOf(row.text, query, trigrams)
        if (coverage <= 0) continue // 大小写折叠后仍对不上的退化行，丢弃
        hits.push({
          text: row.text,
          sessionId: String(row.session_id),
          seq: Number(row.seq),
          role: String(row.role),
          time: Number(row.time),
          score: scoreHit(coverage, Number(row.time), now),
        })
      }

      // 按会话分组 → 相邻聚簇 → 会话以最强簇排序 → 每簇取最佳命中做一条摘录。
      const bySession = new Map()
      for (const hit of hits) {
        if (!bySession.has(hit.sessionId)) bySession.set(hit.sessionId, [])
        bySession.get(hit.sessionId).push(hit)
      }
      const titles = new Map()
      for (const row of db.prepare('SELECT session_id, title FROM meta WHERE title != ?').all('')) {
        if (!titles.has(String(row.session_id))) {
          titles.set(String(row.session_id), String(row.title))
        }
      }
      const sessions = []
      for (const [sessionId, sessionHits] of bySession) {
        const clusters = clusterHits(sessionHits, cfg.adjacentSeqGap)
        const snippets = []
        for (const cluster of clusters) {
          if (snippets.length >= cfg.snippetsPerSession) break
          const best = cluster.best
          snippets.push({
            label: ROLE_LABELS[best.role] ?? best.role,
            time: best.time,
            text: makeSnippet(best.text, query, trigrams, cfg.snippetRadius),
          })
        }
        const maxTime = sessionHits.reduce((max, hit) => Math.max(max, hit.time), 0)
        sessions.push({
          sessionId,
          title: titles.get(sessionId) ?? '(无标题)',
          maxTime,
          score: clusters.length > 0 ? clusters[0].score : 0,
          hitCount: sessionHits.length,
          snippets,
        })
      }
      sessions.sort((a, b) => b.score - a.score || b.maxTime - a.maxTime)

      const pendingNote = stats.pending > 0
        ? `，还有 ${stats.pending} 个待索引（超出 ${cfg.indexBudgetMs}ms 预算，下次检索自动继续）`
        : ''
      const header = sessions.length === 0
        ? `【中文历史会话检索】查询「${query}」按普通子串匹配（无需检索语法）：没有命中。`
          + '提示：换更短（2 字以上）或更独特的原文片段再试；当前会话不参与检索。'
          + `索引：${stats.selected} 个会话文件，本次同步 ${stats.indexed} 个${pendingNote}。\n`
        : `【中文历史会话检索】查询「${query}」——按普通子串匹配，这就是全部语法（trigram 分词，`
          + `中文词句/代码片段直接写，引号等符号按字面搜）。命中 ${sessions.length} 个会话，`
          + `按「命中覆盖率 × 时间衰减」排序、同会话相邻命中已聚合，每会话最多 ${cfg.snippetsPerSession} 条摘录；`
          + `当前会话已排除。索引：${stats.selected} 个会话文件，本次同步 ${stats.indexed} 个${pendingNote}。\n`

      const blocks = sessions.map((session, index) => {
        const lines = [
          `\n${index + 1}. 《${session.title}》 ${session.sessionId}`
            + ` · 最近命中 ${fmtDate(session.maxTime)} · 得分 ${session.score.toFixed(2)}`
            + ` · 命中 ${session.hitCount} 条`,
        ]
        for (let i = 0; i < session.snippets.length; i++) {
          const snippet = session.snippets[i]
          lines.push(`   ${i + 1}. [${snippet.label} ${fmtDate(snippet.time)}] ${snippet.text}`)
        }
        return `${lines.join('\n')}\n`
      })
      for (let i = 0; i < sessions.length; i++) sessions[i].block = blocks[i]

      return { text: renderResult({ header, sessions }, cfg.outputCharLimit), stats }
    },

    /** 关闭库句柄（插件卸载时调用）。 */
    close() {
      if (db !== null) {
        try {
          db.close()
        } catch {
          // 已关或被别的路径关掉，忽略
        }
        db = null
      }
    },
  }
}

// ══════════════════════════════════ 插件装载 ══════════════════════════════════

/**
 * 装载：只注册 session_recall 工具——不打开数据库、不扫目录（惰性，见文件头取舍）。
 * @param ctx - 插件上下文（host 层插入时为 host 作用域）。
 * @param config - 见 DEFAULT_CONFIG。
 */
export function apply(ctx, config) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) }
  const core = createSessionRecall(cfg)
  const warn = (message) => {
    try {
      console.warn(`[session-search-cn] ${message}`)
    } catch {
      // 日志不可用不能影响装载
    }
  }

  ctx.effect(() => {
    const dispose = ctx.tools.register({
      name: 'session_recall',
      description: '中文友好的历史会话全文检索。query 就是一个普通子串——直接写想找的中文词句、'
        + '报错原文或代码片段（如「今天天气」「news-qq-com」），无需任何检索语法；返回按会话分组的'
        + '摘录（标题 + 最多 3 条命中窗口），按「命中覆盖率 × 时间衰减」排序，当前会话不参与。'
        + '首次调用会增量建立本地索引（有时间预算，超出部分下次调用继续），等待一两秒属正常。'
        + '与 session_search 的区别：那个对中文子串基本失效，本工具专治中文。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '要检索的普通子串（中文词句 / 报错原文 / 站点键等），无需检索语法。',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute(args, exec) {
        const { text } = core.recall(args?.query, {
          excludeSessionId: String(exec?.agent?.id ?? exec?.agent?.session?.id ?? ''),
          isAborted: () => exec?.signal?.aborted === true,
        })
        return text
      },
    })
    return () => {
      try {
        dispose()
      } catch {
        // fiber 卸载时的重复释放可忽略
      }
      core.close()
    }
  })

  warn('已挂载 session_recall（中文 trigram 历史会话检索，惰性索引，'
    + `预算 ${cfg.indexBudgetMs}ms/次，输出上限 ${cfg.outputCharLimit} 字符）`)
}

// ══════════════════════════════════ selftest ══════════════════════════════════

/**
 * 自检：查询构造/转义、重排打分、摘录与截断、meta 增量、zstd 多帧、
 * 以及临时目录上的端到端索引链路（node session-search-cn.mjs --selftest）。
 */
function selftest() {
  const failures = []
  let cases = 0
  const check = (label, condition, actual) => {
    cases += 1
    if (condition !== true) failures.push(`✗ ${label}：${actual}`)
  }

  // ── trigram 构造与转义 ──────────────────────────────────────────────────
  check('4 字查询 → 2 个 trigram', JSON.stringify(trigramList('今天天气')) === JSON.stringify(['今天天', '天天气']),
    JSON.stringify(trigramList('今天天气')))
  check('重复 trigram 去重保序', JSON.stringify(trigramList('aaaa')) === JSON.stringify(['aaa']),
    JSON.stringify(trigramList('aaaa')))
  check('2 字查询 → 空（走 LIKE 回退）', trigramList('天气').length === 0, trigramList('天气').length)
  check('OR 表达式逐项引号包裹', buildFtsExpr(['今天天', '天天气']) === '"今天天" OR "天天气"',
    buildFtsExpr(['今天天', '天天气']))
  check('引号翻倍转义', ftsPhrase('他说"好"') === '"他说""好"""', ftsPhrase('他说"好"'))
  check('空 trigram 列表不产表达式', buildFtsExpr([]) === null, String(buildFtsExpr([])))
  check('LIKE 转义 % 与 _', likePattern('100%_a\\b') === '%100\\%\\_a\\\\b%', likePattern('100%_a\\b'))
  check('查询控制字符清洗为可见空格', sanitizeQuery('  今\n天  ') === '今 天',
    JSON.stringify(sanitizeQuery('  今\n天  ')))
  // ── 重排打分：覆盖率 + 艾宾浩斯分桶 ────────────────────────────────────
  const q = '今天天气不错'
  const tris = trigramList(q)
  check('整串命中覆盖率 1', coverageOf('今天天气不错啊', q, tris) === 1, coverageOf('今天天气不错啊', q, tris))
  check('部分命中覆盖率按比例',
    coverageOf('怎么样，天气不', q, tris) === 0.25, coverageOf('怎么样，天气不', q, tris))
  check('完全不沾覆盖率 0', coverageOf('SELECT 1', q, tris) === 0, coverageOf('SELECT 1', q, tris))
  check('覆盖率大小写不敏感',
    coverageOf('NEWS-QQ-COM home', 'news-qq-com', trigramList('news-qq-com')) === 1,
    coverageOf('NEWS-QQ-COM home', 'news-qq-com', trigramList('news-qq-com')))
  const day = 86_400_000
  const decayCases = [
    [0.5 * day, 1.0], [1 * day, 0.9], [2 * day, 0.8], [4 * day, 0.65], [7 * day, 0.5],
    [15 * day, 0.35], [30 * day, 0.25], [60 * day, 0.15], [180 * day, 0.08], [400 * day, 0.08],
  ]
  let decayOk = true
  let decayActual = ''
  for (const [age, expected] of decayCases) {
    const got = recencyWeight(age)
    if (got !== expected) {
      decayOk = false
      decayActual = `${age / day}d→${got}（应为 ${expected}）`
      break
    }
  }
  check('艾宾浩斯分桶边界（含 30/60/180 天）', decayOk, decayActual)
  // time=0、now=45 天 → 年龄 45 天落在 [30,60) 桶 → 0.25
  check('得分 = 覆盖率 × 衰减', Math.abs(scoreHit(0.5, 0, 45 * day) - 0.5 * 0.25) < 1e-9,
    scoreHit(0.5, 0, 45 * day))
  // ── 相邻聚合 ────────────────────────────────────────────────────────────
  const mk = (seq, score) => ({ seq, score, text: '', role: 'user', time: 0 })
  // seq 10/12 相邻聚簇，25 与 12 差 13 超 gap=10 分开，90 独立 → 按分排序 1/2/1
  const clusters = clusterHits([mk(10, 0.5), mk(12, 0.4), mk(25, 0.3), mk(90, 0.9)], 10)
  check('seq 差 ≤ gap 聚簇', clusters.length === 3 && clusters[0].members.length === 1
    && clusters[1].members.length === 2, clusters.map((c) => c.members.length).join('/'))
  const densityScore = Math.abs(clusters[1].score - 0.55) < 1e-9
  check('簇分 = 最高分 + 密度加成（0.5+0.05）', densityScore, clusters[1].score)
  check('簇按分数降序（0.9 的单簇排前）', clusters[0].members[0].seq === 90, clusters[0].members[0].seq)
  const many = clusterHits(Array.from({ length: 12 }, (_, i) => mk(100 + i, 0.5)), 10)
  const cappedScore = Math.abs(many[0].score - 0.7) < 1e-9
  check('密度加成封顶 +0.2', cappedScore, many[0].score)

  // ── 摘录窗口 ────────────────────────────────────────────────────────────
  const longText = `${'前'.repeat(200)}今天天气${'后'.repeat(200)}`
  const snip = makeSnippet(longText, '今天天气', trigramList('今天天气'), 80)
  check('命中处 ±80 窗口长度受控', cpLength(snip) <= 80 + 4 + 80 + 2, cpLength(snip))
  check('摘录含命中内容', snip.includes('今天天气'), snip.slice(0, 40))
  check('两侧裁剪带省略号', snip.startsWith('…') && snip.endsWith('…'), snip.slice(0, 5))
  const headSnip = makeSnippet('今天天气不错哦', '今天天气', trigramList('今天天气'), 80)
  check('命中在开头不加前省略号', !headSnip.startsWith('…'), headSnip)
  const ctrlSnip = makeSnippet(`a${String.fromCharCode(7)}b${String.fromCharCode(10)}c`, 'abc', [], 80)
  check('摘录里没有控制字符', !ctrlSnip.includes(String.fromCharCode(7))
    && !ctrlSnip.includes(String.fromCharCode(10)), JSON.stringify(ctrlSnip))

  // ── 总上限截断 ──────────────────────────────────────────────────────────
  const fakeSessions = Array.from({ length: 8 }, (_, i) => ({
    block: `${i + 1}. 《标题${i}》\n   1. [用户] ${'内容'.repeat(80)}\n`,
  }))
  const header = '【中文历史会话检索】查询「x」…\n'
  const capped = renderResult({ header, sessions: fakeSessions }, 500)
  check('输出硬上限生效', cpLength(capped) <= 500, cpLength(capped))
  check('截断时注明展示比例', capped.includes('已截断') && capped.includes('/8 个会话'), capped.slice(-80))
  const smallEnough = renderResult({ header, sessions: fakeSessions.slice(0, 1) }, 6000)
  check('未超限不加截断提示', !smallEnough.includes('已截断'), smallEnough.slice(-40))

  // ── meta 增量判断 ───────────────────────────────────────────────────────
  check('无记录 → 需重索引', needsReindex(null, { mtime: 1, size: 2 }) === true, 'false')
  check('mtime/size 都没变 → 跳过', needsReindex({ mtime: 1, size: 2 }, { mtime: 1, size: 2 }) === false, 'true')
  check('mtime 变化 → 重索引', needsReindex({ mtime: 1, size: 2 }, { mtime: 2, size: 2 }) === true, 'false')
  check('size 变化 → 重索引', needsReindex({ mtime: 1, size: 2 }, { mtime: 1, size: 3 }) === true, 'false')

  // ── 最高代选择 ──────────────────────────────────────────────────────────
  const picked = pickGenerationFile(['session.v3.jsonl.zstd', 'session.v4.jsonl.zstd', 'session.jsonl'])
  check('同目录取最高代', picked === 'session.v4.jsonl.zstd', picked)
  const pickedSingle = pickGenerationFile(['session.v3.jsonl.zstd', 'lock.tmp'])
  check('只有一代也能选中', pickedSingle === 'session.v3.jsonl.zstd', pickedSingle)
  const pickedNone = pickGenerationFile(['session.v0.jsonl', 'sessionX.jsonl'])
  check('非法文件名不选', pickedNone === null, String(pickedNone))

  // ── 日志解析与标题 ──────────────────────────────────────────────────────
  const nl = String.fromCharCode(10)
  const sampleLog = [
    '{"type":"session","version":4,"id":"session-t1","createdAt":1,"cwd":"C:/w","isSeeded":false,"delegationDepth":0}',
    '{"type":"user/message","seq":1,"time":1000,"data":{"content":[{"type":"text","text":"Current runtime context."}],"source":{"kind":"runtime-context"},"role":"user"}}',
    '{"type":"user/message","seq":2,"time":1100,"data":{"content":[{"type":"text","text":"帮我把 book 表按站点去重入库"}],"source":{"kind":"user"},"role":"user"}}',
    '{"type":"assistant/message","seq":3,"time":1200,"data":{"message":{"content":[{"type":"reasoning","text":"思考过程"},{"type":"text","text":"好的，先清洗再入库"}]}}}',
    '{"type":"tool/result","seq":4,"time":1300,"data":{"message":{"content":[{"type":"tool-result","content":[{"type":"text","text":"插入 42 行"}]}]}}}',
    '{"type":"turn/end","seq":5,"time":1400,"data":{"reason":{"kind":"error","error":{"message":"连接超时","code":"E_TIMEOUT"}}}}',
    '{撕裂行不是 JSON',
  ].join(nl)
  const parsed = parseSessionLog(sampleLog, 999)
  check('header 的 id 当 sessionId', parsed.sessionId === 'session-t1', parsed.sessionId)
  check('抽取 user/assistant/tool/system 四类行', parsed.rows.length === 5, parsed.rows.length)
  const hasReasoning = parsed.rows.some((r) => r.text.includes('思考过程'))
  check('reasoning 块不入索引', !hasReasoning, JSON.stringify(parsed.rows.map((r) => r.text)))
  const hasNested = parsed.rows.some((r) => r.text.includes('插入 42 行'))
  check('tool/result 嵌套壳被解开', hasNested, String(hasNested))
  const hasError = parsed.rows.some((r) => r.text.includes('连接超时'))
  check('turn/end 错误入索引', hasError, String(hasError))
  const realCount = parsed.rows.filter((r) => r.real).length
  check('真实用户消息标记', realCount === 1, realCount)
  const title = extractTitle(parsed.rows, 40)
  check('标题优先真实用户消息（跳过 runtime-context）', title === '帮我把 book 表按站点去重入库', title)
  const injectedOnly = parseSessionLog([
    '{"type":"session","version":4,"id":"s2","createdAt":1,"isSeeded":false,"delegationDepth":0}',
    '{"type":"user/message","seq":1,"time":1,"data":{"content":[{"type":"text","text":"注入的消息当兜底标题"}],"source":{"kind":"plugin"},"role":"user"}}',
  ].join(nl))
  const fallbackTitle = extractTitle(injectedOnly.rows, 40)
  check('无真实用户消息时退而求其次', fallbackTitle === '注入的消息当兜底标题', fallbackTitle)
  const longTitle = extractTitle([{ role: 'user', real: true, text: '字'.repeat(50) }], 40)
  check('标题超长截断加省略号', longTitle === `${'字'.repeat(40)}…`, longTitle.length)

  // ── zstd 多帧 + 撕裂尾 ──────────────────────────────────────────────────
  const lines = sampleLog.split(nl)
  const frameHeader = zstdCompressSync(Buffer.from(`${lines[0]}${nl}`, 'utf8'))
  const frameBody = zstdCompressSync(Buffer.from(`${lines.slice(1).join(nl)}${nl}`, 'utf8'))
  const tornTail = Buffer.from([0x28, 0xB5, 0x2F, 0xFD, 0x01]) // 半帧：魔数+描述符后戛然而止
  const zstdFile = Buffer.concat([frameHeader, frameBody, tornTail])
  const scanned = scanZstdFrames(zstdFile)
  check('扫出 2 个完整帧并识别撕裂尾', scanned.frames.length === 2 && scanned.torn === true,
    `${scanned.frames.length}/${scanned.torn}`)
  const decodedLog = decodeLogFile(zstdFile, 'session.v4.jsonl.zstd')
  const decodedParsed = parseSessionLog(decodedLog)
  check('多帧解码拼回完整日志', decodedParsed.sessionId === 'session-t1'
    && decodedParsed.rows.length === 5, decodedParsed.rows.length)
  const plain = decodeLogFile(Buffer.from('abc', 'utf8'), 'session.v3.jsonl')
  check('普通 .jsonl 直接解码', plain === 'abc', plain)

  // ── FTS 特殊字符防注入（真库验证） ──────────────────────────────────────
  const probeDb = new DatabaseSync(':memory:')
  try {
    probeDb.exec('CREATE VIRTUAL TABLE msgs USING fts5(text, session_id UNINDEXED, seq UNINDEXED, '
      + 'role UNINDEXED, time UNINDEXED, src UNINDEXED, tokenize = trigram)')
    const nasty = 'He said "hi" OR 1=1 -- NEAR(a,b) 100% _ end'
    const insert = probeDb.prepare(
      'INSERT INTO msgs(text, session_id, seq, role, time, src) VALUES (?, ?, ?, ?, ?, ?)',
    )
    insert.run(nasty, 's1', 1, 'user', 1000, '/x')
    insert.run('无关的另一行', 's2', 2, 'user', 1000, '/y')
    const nastyQuery = sanitizeQuery(nasty)
    const nastyTris = trigramList(nastyQuery)
    let ftsRows = null
    let ftsError = null
    try {
      ftsRows = queryCandidates(probeDb, nastyQuery, nastyTris, 10)
    } catch (error) {
      ftsError = error
    }
    check('含引号/OR/通配符的查询不抛 FTS 语法错误', ftsError === null, String(ftsError))
    const ftsHitIds = ftsRows === null ? [] : ftsRows.map((r) => r.session_id)
    check('特殊字符查询只命中字面行', ftsRows !== null && ftsRows.length === 1 && ftsHitIds[0] === 's1',
      ftsHitIds.join(','))
    const shortRows = queryCandidates(probeDb, '另一行', [], 10)
    const shortIds = shortRows.map((r) => r.session_id)
    check('短查询 LIKE 回退命中', shortRows.length === 1 && shortIds[0] === 's2', shortIds.join(','))
    const likePercent = queryCandidates(probeDb, '100%', [], 10)
    const percentIds = likePercent.map((r) => r.session_id)
    check('LIKE 路径 % 按字面处理', likePercent.length === 1 && percentIds[0] === 's1',
      percentIds.join(','))
    let emptyError = null
    try {
      validateQuery('   ')
    } catch (error) {
      emptyError = error
    }
    const emptyMsg = emptyError === null ? '' : String(emptyError.message)
    check('空查询必填报错', emptyError !== null && emptyMsg.includes('不能为空'), emptyMsg)
    let missingError = null
    try {
      validateQuery(undefined)
    } catch (error) {
      missingError = error
    }
    const missingMsg = missingError === null ? '' : String(missingError.message)
    check('缺 query 参数必填报错', missingError !== null && missingMsg.includes('缺少必填'), missingMsg)
  } finally {
    probeDb.close()
  }

  // ── 临时目录端到端：索引 → 检索 → 增量 → 删除 → 排除当前会话 ───────────
  const tmpRoot = mkdtempSync(join(tmpdir(), 'session-recall-'))
  const sessionsRoot = join(tmpRoot, 'sessions')
  const dbPath = join(tmpRoot, 'cache', 'session-recall.db')
  const writeSession = (project, id, filename, sessionLines) => {
    const dir = join(sessionsRoot, project, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, filename), `${sessionLines.join(nl)}${nl}`, 'utf8')
  }
  const headerLine = (id) => `{"type":"session","version":4,"id":"${id}","createdAt":1000,`
    + '"cwd":"C:/w","isSeeded":false,"delegationDepth":0}'
  try {
    writeSession('--proj--', 'session-aaa', 'session.v4.jsonl', [
      headerLine('session-aaa'),
      `{"type":"user/message","seq":1,"time":${Date.now() - 2 * 3600_000},`
        + '"data":{"content":[{"type":"text","text":"今天天气怎么样，帮我查新闻"}],'
        + '"source":{"kind":"user"},"role":"user"}}',
      `{"type":"assistant/message","seq":2,"time":${Date.now() - 2 * 3600_000 + 5000},`
        + '"data":{"message":{"content":[{"type":"text","text":"天气晴，站点键 news-qq-com 已就绪"}]}}}',
    ])
    writeSession('--proj--', 'session-bbb', 'session.v3.jsonl', [
      headerLine('session-bbb'),
      `{"type":"user/message","seq":1,"time":${Date.now() - 40 * 86_400_000},`
        + '"data":{"content":[{"type":"text","text":"把 book 表导入数据库，天气转凉"}],'
        + '"source":{"kind":"user"},"role":"user"}}',
    ])

    const core = createSessionRecall({ sessionsRoot, dbPath, indexBudgetMs: 5_000, outputCharLimit: 6_000 })
    try {
      const first = core.recall('今天天气', { now: Date.now(), excludeSessionId: 'session-zzz' })
      check('首轮索引把两个会话都建了', first.stats.indexed === 2 && first.stats.pending === 0,
        JSON.stringify(first.stats))
      check('中文子串检索命中标题', first.text.includes('《今天天气怎么样，帮我查新闻》'),
        first.text.slice(0, 200))
      check('输出自包含说明普通子串', first.text.includes('按普通子串匹配'), first.text.slice(0, 120))
      check('按会话分组并带摘录', first.text.includes('《') && first.text.includes('[用户 '),
        first.text.slice(0, 300))
      // 共同子串「天气」（2 字 → LIKE 路径）：两个会话都该在，且新的排前面
      const decayOrder = core.recall('天气', { now: Date.now(), excludeSessionId: 'session-zzz' })
      const recentAt = decayOrder.text.indexOf('《今天天气怎么样')
      const oldAt = decayOrder.text.indexOf('把 book 表导入数据库')
      check('40 天前的会话也召回（衰减 0.25）', recentAt >= 0 && oldAt >= 0,
        `recent=${recentAt}, old=${oldAt}`)
      check('新会话按得分排在旧会话前', recentAt >= 0 && oldAt >= 0 && recentAt < oldAt,
        `recent=${recentAt}, old=${oldAt}`)

      const second = core.recall('今天天气', { now: Date.now(), excludeSessionId: 'session-zzz' })
      check('未变更文件第二次全部跳过（增量）', second.stats.indexed === 0 && second.stats.skipped === 2,
        JSON.stringify(second.stats))

      // 改写 session-aaa（size 变化）→ 只重索引它
      writeSession('--proj--', 'session-aaa', 'session.v4.jsonl', [
        headerLine('session-aaa'),
        `{"type":"user/message","seq":1,"time":${Date.now() - 3600_000},`
          + '"data":{"content":[{"type":"text","text":"今天天气怎么样，帮我查新闻"}],'
          + '"source":{"kind":"user"},"role":"user"}}',
        `{"type":"assistant/message","seq":2,"time":${Date.now() - 3500_000},`
          + '"data":{"message":{"content":[{"type":"text","text":"新增一行：空气质量优"}]}}}',
      ])
      const third = core.recall('空气质量', { now: Date.now(), excludeSessionId: 'session-zzz' })
      check('size 变化后只重索引该文件', third.stats.indexed === 1 && third.stats.skipped === 1,
        JSON.stringify(third.stats))
      check('重索引后新内容可检索', third.text.includes('《今天天气怎么样'), third.text.slice(0, 200))
      check('重索引不产生重复（候选统计自洽）',
        third.stats.indexed + third.stats.skipped === third.stats.selected, JSON.stringify(third.stats))

      // 排除当前会话
      const excluded = core.recall('天气', { now: Date.now(), excludeSessionId: 'session-aaa' })
      check('当前会话被排除', !excluded.text.includes('《今天天气怎么样'), excluded.text.slice(0, 160))
      check('排除后只剩另一个会话', excluded.text.includes('把 book 表导入数据库'),
        excluded.text.slice(0, 300))

      // 删除 session-bbb → meta 与行一并清掉
      rmSync(join(sessionsRoot, '--proj--', 'session-bbb'), { recursive: true, force: true })
      const afterDelete = core.recall('book', { now: Date.now(), excludeSessionId: '' })
      check('源文件删除后索引行被清',
        afterDelete.stats.removed === 1 && afterDelete.text.includes('没有命中'),
        `${afterDelete.stats.removed}/${afterDelete.text.slice(0, 120)}`)

      // 时间预算：0ms 预算 → 有变更也不索引，pending 如实上报
      writeSession('--proj--', 'session-ccc', 'session.v4.jsonl', [
        headerLine('session-ccc'),
        '{"type":"user/message","seq":1,"time":1000,"data":{"content":'
          + '[{"type":"text","text":"预算测试消息"}],"source":{"kind":"user"},"role":"user"}}',
      ])
      const bounded = createSessionRecall({ sessionsRoot, dbPath, indexBudgetMs: 0 })
      try {
        const result = bounded.recall('预算测试', { now: Date.now(), excludeSessionId: '' })
        check('预算 0 时新文件挂起待索引', result.stats.pending === 1 && result.stats.indexed === 0,
          JSON.stringify(result.stats))
        check('待索引状态在文案里注明', result.text.includes('待索引'), result.text.slice(0, 200))
      } finally {
        bounded.close()
      }
    } finally {
      core.close()
    }
  } finally {
    try {
      rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      // Windows 下句柄未散尽导致的清理失败不影响判定
    }
  }

  // ── 插件形态 ────────────────────────────────────────────────────────────
  check('插件名正确', name === 'session-search-cn', name)
  check('声明依赖 tools 服务', Array.isArray(inject) && inject.includes('tools'), JSON.stringify(inject))
  check('默认输出上限 6000', DEFAULT_CONFIG.outputCharLimit === 6000, DEFAULT_CONFIG.outputCharLimit)
  check('默认索引预算 2000ms', DEFAULT_CONFIG.indexBudgetMs === 2000, DEFAULT_CONFIG.indexBudgetMs)
  check('DSH_HOME 环境变量优先', resolveDshHome({ DSH_HOME: 'E:/x/dsh' }) === 'E:/x/dsh',
    resolveDshHome({ DSH_HOME: 'E:/x/dsh' }))
  check('空白 DSH_HOME 视为未设',
    resolveDshHome({ DSH_HOME: '   ' }, () => 'C:/home') === join('C:/home', '.dsh'),
    resolveDshHome({ DSH_HOME: '   ' }, () => 'C:/home'))
  check('无环境变量回退 ~/.dsh', resolveDshHome({}, () => 'C:/home') === join('C:/home', '.dsh'),
    resolveDshHome({}, () => 'C:/home'))

  if (failures.length > 0) {
    console.error(`session-search-cn selftest 失败：${failures.length}/${cases} 项`)
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
    return
  }
  console.log(`session-search-cn selftest 通过：${cases} 项判据全部符合预期`)
}

if (process.argv[1] && process.argv[1].endsWith('session-search-cn.mjs')
  && process.argv.includes('--selftest')) {
  selftest()
}
