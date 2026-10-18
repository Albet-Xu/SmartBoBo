/**
 * market-core —— 第三方技能 registry（ClawHub + SkillHub）接入核心（M2）。
 *
 * 职责：双源 provider 层（请求/归一化）→ 聚合（游标分页合并、跨源去重、按下载量
 * 排序）→ 内存缓存（TTL + stale-while-error + 每源健康）→ 详情（文件清单、
 * SKILL.md 正文、能力披露、何时触发）→ 逐文件安装到 `<dshHome>/skills/<dirName>/`。
 * 上游字段形状以**实测**为准（2026 年两次 curl + node 直连确认），参考实现是
 * `bobo-data/cc-haha/src/server/services/market/`（只读）。
 *
 * 设计要点：
 *   - `createProviders({ fetchImpl })` 的 fetch **可注入**：自检用 stub 喂 fixture，
 *     不打真网络；默认 `globalThis.fetch`。
 *   - 聚合游标 = `base64url(JSON({clawhub, skillhub}))`，每个源一个分页游标；
 *     某源缺席即视为该源已翻完。
 *   - 跨源去重：SkillHub 镜像 ClawHub（`source=clawhub` + `upstream_url`）时
 *     ClawHub 条目胜出并吸收镜像 id；合并结果按 `stats.downloads` 降序。
 *   - 缓存：内存 Map + LRU 触碰 + TTL（list 5min / search 2min / detail 10min /
 *     file 30min）；上游失败且有**过期**缓存时返回旧值并标 `cached: true`
 *     （stale-while-error），同时降级每源健康状态。
 *   - 安装全程**不执行任何脚本**：逐文件下载 → 字节复核 → sha256 校验 → 写
 *     staging → **规范化 SKILL.md frontmatter（name/description，只动这两行）**
 *     → 原子换入；同 id 进程内互斥（并发二次安装报 in-progress）。
 *   - 能力披露 `detectCapabilities` 是规则式移植自 cc-haha `skillInsights.ts`
 *     （纯正则，每条带证据），零命中返回空数组——UI 不渲染空面板。
 *
 * 红线：本目录是纯 Node ESM，只 import 内置模块 + 同目录 `repo-core.mjs`
 * （state 读写复用同一份实现，避免两处解析 state.json）。
 *
 * 用法：
 *   node market-core.mjs --selftest   # 自检（acceptance §5 会扫到并跑）
 *
 * @module bobo-market-core
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compareVersions, isMarketSkillId, readState, writeState } from './repo-core.mjs'

/** 双源枚举；聚合、健康、游标都按这份清单遍历。 */
export const MARKET_SOURCES = ['clawhub', 'skillhub']

/** `.market-meta.json` 文件名——「这个目录是市场装的」的凭据，卸载只认它。 */
export const MARKET_META_FILENAME = '.market-meta.json'

/** 缓存 TTL（毫秒）。协议常量，不是部署可调项。 */
export const MARKET_TTL = {
  /** 热门榜列表页。 */
  list: 5 * 60_000,
  /** 搜索结果页。 */
  search: 2 * 60_000,
  /** 单条详情（含文件清单与 SKILL.md）。 */
  detail: 10 * 60_000,
  /** 单文件预览内容。 */
  file: 30 * 60_000,
}

/** 安全与体积上限。安全不变量按 dsh 红线固定，不进 Config。 */
export const MARKET_LIMITS = {
  /** 单文件字节上限（下载与预览同一道闸）。 */
  maxFileSize: 5 * 1024 * 1024,
  /** 整技能字节上限。 */
  maxTotalSize: 20 * 1024 * 1024,
  /** 文件数上限。 */
  maxFileCount: 200,
  /** 预览超过此字节数截断。 */
  previewTruncateBytes: 300 * 1024,
  /** ClawHub 搜索无分页，合并前单源截断。 */
  searchResultCap: 50,
  /** 单条文件路径长度上限。 */
  maxPathLength: 512,
}

/**
 * 每页条数：两个 registry 的分页请求参数（ClawHub `limit` / SkillHub
 * `pageSize`）。这是与上游 API 的约定值，不是部署可变参数，故为常量。
 */
const PAGE_SIZE = 30

/** provider 请求超时默认值（毫秒）。 */
const DEFAULT_TIMEOUT_MS = 10_000

/** 重试次数：超时/网络错误/429/5xx 之后再试 1 次。 */
const RETRIES = 1

/** 缓存条目上限（LRU 淘汰最旧）。 */
const CACHE_MAX_ENTRIES = 500

/** 归一化条目的来源健康取值：新鲜成功 / 过期缓存顶着 / 降级 / 不可用。 */
const SOURCE_STATUS = ['ok', 'cached', 'degraded', 'failed']

/** 能力披露的严重度：shell 与 hooks 属高，其余中。 */
const SEVERITY = { shell: 'high', hooks: 'high', secrets: 'medium', network: 'medium', writes: 'medium' }

/** 能力披露的中文标签（UI 直接展示，不在客户端再造一份文案）。 */
const CAPABILITY_LABELS = {
  shell: '执行 Shell 命令',
  hooks: '注册钩子（hooks）',
  secrets: '使用密钥类环境变量',
  network: '访问外部网络',
  writes: '写入文件',
}

// ── id 与目录名 ──────────────────────────────────────────────────────────────

/**
 * 拼一个市场条目 id：`<source>:<slug>`。
 * @param source - `clawhub` / `skillhub`。
 * @param slug - 上游 slug（保留原样，不消毒）。
 * @returns 全局唯一 id。
 */
export function marketSkillId(source, slug) {
  return `${source}:${slug}`
}

/**
 * 解析市场条目 id。
 * @param id - 形如 `clawhub:pdf` 的 id；冒号取第一处，source 必须是双源之一。
 * @returns `{ source, slug }`。
 * @throws 形状不符（缺前缀、未知 source、slug 含路径危险字符）时抛错。
 */
export function parseMarketId(id) {
  if (typeof id !== 'string') throw new Error(`市场 id 不合法：${JSON.stringify(id)}（须为字符串）`)
  const idx = id.indexOf(':')
  if (idx <= 0) throw new Error(`市场 id 不合法：${JSON.stringify(id)}（须形如 clawhub:<slug>）`)
  const source = id.slice(0, idx)
  const slug = id.slice(idx + 1)
  if (!MARKET_SOURCES.includes(source)) {
    throw new Error(`市场 id 不合法：${JSON.stringify(id)}（source 须为 ${MARKET_SOURCES.join(' | ')}）`)
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) {
    throw new Error(`市场 id 不合法：${JSON.stringify(id)}（slug 须以字母数字开头，只含 . _ -）`)
  }
  return { source, slug }
}

/**
 * slug → 安装目录名：小写字母数字开头 + `._-`，拒绝 `..` 与前导点。
 * 与 cc-haha 的 `sanitizeDirName` 同规则。
 * @param slug - 上游 slug。
 * @returns 可用目录名；不可用返回 `null`。
 */
export function sanitizeDirName(slug) {
  if (typeof slug !== 'string' || slug === '') return null
  const name = slug.toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) return null
  if (name.includes('..')) return null
  return name
}

/**
 * 是否是第三方市场 id（与 `repo-core` 的 `isMarketSkillId` 同一形状）。
 * @param id - 待判定的 id。
 * @returns 带 `clawhub:` / `skillhub:` 前缀且 slug 合法时为 `true`。
 */
export function isMarketId(id) {
  return isMarketSkillId(id)
}

// ── 错误（消息里带英文码 token，自检与调用方按 token 分类）──────────────────

/**
 * 构造带码 token 的错误。
 * @param code - 英文码 token，如 `in-progress`、`checksum-mismatch`。
 * @param message - 中文说明。
 * @returns Error 实例。
 */
function marketError(code, message) {
  const error = new Error(`（${code}）${message}`)
  error.code = code
  return error
}

// ── 游标 ────────────────────────────────────────────────────────────────────

/**
 * 合并游标编码：`{clawhub?, skillhub?}` → base64url(JSON)。
 * @param cursor - 各源的上游游标；空对象表示全部翻完。
 * @returns 游标串；无任何游标返回 `null`（= 最后一页）。
 */
export function encodeCursor(cursor) {
  const keys = Object.keys(cursor ?? {})
  if (keys.length === 0) return null
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

/**
 * 合并游标解码。
 * @param raw - 游标串。
 * @returns 各源游标对象；空/损坏时返回 `undefined`（按第一页处理）。
 */
export function decodeCursor(raw) {
  if (typeof raw !== 'string' || raw === '') return undefined
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (parsed === null || typeof parsed !== 'object') return undefined
    const out = {}
    for (const source of MARKET_SOURCES) {
      const value = parsed[source]
      if (typeof value === 'string' && value !== '') out[source] = value
    }
    return out
  } catch {
    return undefined
  }
}

// ── frontmatter（SKILL.md 头部的最小子集解析）───────────────────────────────

/**
 * 拆 SKILL.md 的 frontmatter 头与正文。
 *
 * 只支持 skill 发现器认的常见形态：`key: value` 标量（可带引号）、`key:` 后接
 * 缩进块（`>` / `|-` 等）与 `- item` 列表；解析不动文本本身，失败就整体当正文。
 * @param text - SKILL.md 全文。
 * @returns `{ frontmatter, body }`；无 frontmatter 头时 frontmatter 为空对象、body 为原文。
 */
export function splitFrontmatter(text) {
  const raw = typeof text === 'string' ? text : ''
  const fence = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (fence === null) return { frontmatter: {}, body: raw }
  const frontmatter = {}
  const lines = fence[1].split(/\r?\n/)
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    index += 1
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (match === null) continue
    const key = match[1]
    const value = match[2].trim()
    if (value === '>' || value === '|>' || value === '|' || value === '|-' || value === '>-' || value === '') {
      const block = []
      while (index < lines.length && /^\s+\S/.test(lines[index])) {
        block.push(lines[index].trim())
        index += 1
      }
      if (value === '' && block.length > 0 && block.every((line) => line === '-' || line.startsWith('- '))) {
        frontmatter[key] = block
          .filter((line) => line !== '-')
          .map((line) => line.slice(2).trim().replace(/^['"]|['"]$/g, ''))
          .filter((line) => line !== '')
        continue
      }
      frontmatter[key] = block.join(' ').trim()
      continue
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key] = value.slice(1, -1).split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter((item) => item !== '')
      continue
    }
    frontmatter[key] = value.replace(/^['"]|['"]$/g, '')
  }
  const body = raw.slice(fence[0].length)
  return { frontmatter, body }
}

/** 合法技能名（与上游 `isSkillName` 同形：kebab-case）。 */
const KEBAB_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** frontmatter 顶格的 `name:` 行。 */
const NAME_KEY_LINE = /^name[ \t]*:/

/** frontmatter 顶格的 `description:` 行。 */
const DESC_KEY_LINE = /^description[ \t]*:/

/**
 * 目录名 → 上游可接受的技能名。
 *
 * 目录名本身是 kebab 就原样（与目录对齐，最常见形态）；含 `.`/`_` 时压成
 * kebab——上游 skill 发现器只校验 name 过 `isSkillName`，**不**校验 name 与
 * 目录名相等（`packages/skill` 全量 grep 无该规则），所以偏离目录名换可见性是
 * 划算的；两头都失败（不可能，dirName 必以字母数字开头）退回 dirName。
 * @param dirName - `sanitizeDirName` 的产物（安装目录名）。
 * @returns 写进 frontmatter 的 name 值。
 */
function skillNameForDir(dirName) {
  if (KEBAB_SKILL_NAME.test(dirName)) return dirName
  const kebab = dirName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return KEBAB_SKILL_NAME.test(kebab) ? kebab : dirName
}

/**
 * 取 `key: value` 行的标量值：去两侧空白、剥一层成对引号；空值与 `#` 起头
 * （YAML 注释）按空串处理——与上游 `stringField` 的「非空字符串才算有值」对齐，
 * 空 description 同样会被发现器当缺失丢弃。
 * @param line - 一行 frontmatter 原文。
 * @returns 标量值；无有效值返回 `''`。
 */
function frontmatterScalar(line) {
  const colon = line.indexOf(':')
  let value = colon < 0 ? '' : line.slice(colon + 1).trim()
  if (value === '' || value.startsWith('#')) return ''
  if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'")) && value.endsWith(value[0])) {
    value = value.slice(1, -1)
  }
  return value.trim()
}

/**
 * 把正文里每一行匹配 `keyRe` 的行替换成 `replacement`：只换行本体，各行自带的
 * 换行分隔符（LF/CRLF）原样保留，其余字节不动。
 * @param body - frontmatter 两道 fence 之间的原文。
 * @param keyRe - 顶格键行的匹配式。
 * @param replacement - 整行替换文本。
 * @returns 替换后的正文（无匹配时原样返回）。
 */
function replaceKeyLines(body, keyRe, replacement) {
  const parts = body.split(/(\r?\n)/)
  for (let index = 0; index < parts.length; index += 2) {
    if (keyRe.test(parts[index] ?? '')) parts[index] = replacement
  }
  return parts.join('')
}

/**
 * 规范化 SKILL.md frontmatter 的 `name` / `description`。
 *
 * 上游 skill 发现器（skill-filesystem 的 `parseSkillFile`）要求两者都是非空
 * 字符串、且 name 过 kebab（`isSkillName`），不合规整个技能被 warn-ignore——
 * 技能库不显示、模型也发现不了。市场条目的上游 frontmatter 常带空格大写 name
 * 或缺 description，所以安装在 staging 内、写 meta 之前做这一步。
 *
 * 改写只碰这两行：既有行**原位替换**（位置、行尾、CRLF 形态不动），缺失行在
 * frontmatter 顶部按文件自身的换行符插入；文件其余部分字节级不变。两值都已
 * 合规时零改动（重装/更新幂等）。无 frontmatter 头时不构造头——保持「装得上、
 * 上游可见性由上游规则决定」的边界，由 `.market-meta.json` 的
 * `normalized: 'no-frontmatter'` 留痕。
 * @param text - staging 里的 SKILL.md 全文（UTF-8 解码）。
 * @param want - `{ name, description }`：`name` 传安装目录名；`description` 传
 *   详情摘要（调用方兜底到名称/目录名，本函数内再防一手空串）。
 * @returns `{ text, changed, originalName, noFrontmatter }`——`originalName` 是
 *   改写前的 name 标量（无该行或空值为 `null`），仅在 `changed` 时写进 meta；
 *   `changed` 为 false 时 `text` 即入参。
 */
function normalizeSkillFrontmatter(text, { name, description }) {
  const fence = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text)
  if (fence === null) return { text, changed: false, originalName: null, noFrontmatter: true }
  const open = fence[1]
  const body = fence[2]
  const suffix = text.slice(open.length + body.length)
  const nl = open.endsWith('\r\n') ? '\r\n' : '\n'
  const lines = body.split(/\r?\n/)
  const nameLine = lines.find((line) => NAME_KEY_LINE.test(line))
  const descLine = lines.find((line) => DESC_KEY_LINE.test(line))
  const originalName = nameLine === undefined ? null : (frontmatterScalar(nameLine) || null)
  const targetName = skillNameForDir(name)
  const summary = typeof description === 'string' ? description.replace(/\s+/g, ' ').trim() : ''
  const descriptionValue = JSON.stringify(summary === '' ? targetName : summary)

  let next = body
  let changed = false
  const insert = []
  if (nameLine === undefined) {
    insert.push(`name: ${targetName}`)
    changed = true
  } else if (frontmatterScalar(nameLine) !== targetName) {
    next = replaceKeyLines(next, NAME_KEY_LINE, `name: ${targetName}`)
    changed = true
  }
  if (descLine === undefined) {
    insert.push(`description: ${descriptionValue}`)
    changed = true
  } else if (frontmatterScalar(descLine) === '') {
    next = replaceKeyLines(next, DESC_KEY_LINE, `description: ${descriptionValue}`)
    changed = true
  }
  if (insert.length > 0) next = `${insert.map((line) => `${line}${nl}`).join('')}${next}`
  if (!changed) return { text, changed: false, originalName, noFrontmatter: false }
  return { text: `${open}${next}${suffix}`, changed: true, originalName, noFrontmatter: false }
}

// ── 缓存（LRU + TTL + stale-while-error）────────────────────────────────────

/** 一条缓存记录：值、过期时刻、写入时刻。 */
class CacheEntry {
  constructor(value, expiresAt, storedAt) {
    this.value = value
    this.expiresAt = expiresAt
    this.storedAt = storedAt
  }
}

/** 内存缓存：LRU 触碰 + TTL；`getStale` 返回**已过期**的值供 stale-while-error 用。 */
class MarketCache {
  constructor(now) {
    this.now = now
    this.entries = new Map()
  }

  /** 当前条目数（`marketStatus` 透出）。 */
  get size() {
    return this.entries.size
  }

  /**
   * 读未过期的值。
   * @param key - 缓存键。
   * @returns 值；未命中（无或过期）返回 `undefined`。
   */
  get(key) {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    if (this.now() > entry.expiresAt) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  /**
   * 读值并附写入时刻，**不要求未过期**——stale-while-error 的兜底来源。
   * @param key - 缓存键。
   * @returns `{ value, storedAt }`；无记录返回 `undefined`。
   */
  getStale(key) {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    return { value: entry.value, storedAt: entry.storedAt }
  }

  /**
   * 写入（超上限时淘汰最旧）。
   * @param key - 缓存键。
   * @param value - 任意可序列化的值。
   * @param ttlMs - 存活时长（毫秒）。
   * @returns 无返回值。
   */
  set(key, value, ttlMs) {
    this.entries.delete(key)
    this.entries.set(key, new CacheEntry(value, this.now() + ttlMs, this.now()))
    if (this.entries.size > CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
  }

  /** 清空全部缓存（自检与调试用）。 */
  clear() {
    this.entries.clear()
  }
}

// ── provider 请求层（超时 + 重试 1 次）──────────────────────────────────────

/**
 * 建 provider 层：两个源的 list / search / detail / listFiles / fetchFile /
 * fetchFileBytes，全部走注入的 `fetchImpl`。
 *
 * 请求语义：`AbortController` 超时（默认 10s）、429/5xx/网络错误重试 1 次、
 * 非 2xx 一律抛错。**健康记账不在这里**——由 market 层按一次逻辑调用的成败记，
 * 避免「重试成功」被记成先失败后成功。
 *
 * @param options - `{ clawhubBase, skillhubBase, fetchImpl, timeoutMs }`；
 *   base 是站点根（尾斜杠会被剥掉），`fetchImpl` 默认 `globalThis.fetch`。
 * @returns `{ clawhub, skillhub }`，每个 provider 带 `source` 与五个读取方法。
 * @throws `fetchImpl` 不是函数、或 base 为空时抛错。
 */
export function createProviders({ clawhubBase, skillhubBase, fetchImpl, timeoutMs } = {}) {
  const base1 = typeof clawhubBase === 'string' && clawhubBase !== '' ? clawhubBase.replace(/\/+$/, '') : ''
  const base2 = typeof skillhubBase === 'string' && skillhubBase !== '' ? skillhubBase.replace(/\/+$/, '') : ''
  if (base1 === '' || base2 === '') throw new Error('createProviders：clawhubBase / skillhubBase 均不可为空')
  const run = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
  if (typeof run !== 'function') throw new Error('createProviders：fetchImpl 缺失且 globalThis.fetch 不可用')
  const timeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS

  /**
   * 一次带超时的请求；429/5xx/网络错误重试 1 次后仍失败则抛错。
   * @param source - 来源名（错误前缀）。
   * @param url - 完整 URL。
   * @returns Response（任何状态码——404 等由调用方按需判 `ok`）。
   * @throws 超时（`upstream-timeout`）或重试耗尽（`upstream-error`）时抛错。
   */
  async function providerFetch(source, url) {
    let lastError = null
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => { controller.abort() }, timeout)
      try {
        const res = await run(url, {
          headers: { Accept: 'application/json, text/plain, */*' },
          redirect: 'follow',
          signal: controller.signal,
        })
        if (res.status === 429 || res.status >= 500) {
          lastError = marketError('upstream-error', `${source} 回了 HTTP ${res.status}（${url}）`)
          continue
        }
        return res
      } catch (error) {
        const isAbort = error instanceof Error && error.name === 'AbortError'
        lastError = isAbort
          ? marketError('upstream-timeout', `${source} 请求超时（>${timeout}ms，${url}）`)
          : marketError('upstream-error', `${source} 请求失败：${error instanceof Error ? error.message : String(error)}（${url}）`)
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError ?? marketError('upstream-error', `${source} 请求失败（${url}）`)
  }

  /**
   * 取 JSON 并强校验 2xx。
   * @param source - 来源名。
   * @param url - 完整 URL。
   * @returns 解析后的对象。
   * @throws 非 2xx（`upstream-error`，404 记 `bad-response`）或非 JSON（`bad-response`）时抛错。
   */
  async function fetchJson(source, url) {
    const res = await providerFetch(source, url)
    if (!res.ok) {
      throw marketError(res.status === 404 ? 'bad-response' : 'upstream-error',
        `${source} 对 ${new URL(url).pathname} 回了 HTTP ${res.status}`)
    }
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      throw marketError('bad-response', `${source} 返回的不是合法 JSON（${url}）`)
    }
  }

  /**
   * 读响应体字节，超限直接拒绝（不把超大响应吞进内存再判断）。
   * @param source - 来源名。
   * @param res - 已是 2xx 的响应。
   * @param maxBytes - 字节上限。
   * @param label - 错误里点名的对象（如文件路径）。
   * @returns 响应体 Buffer。
   * @throws content-length 声明或实际字节超限时抛 `bad-response`。
   */
  async function readBytes(source, res, maxBytes, label) {
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw marketError('bad-response', `${source} ${label} 声明 ${declared} 字节，超过上限 ${maxBytes}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > maxBytes) {
      throw marketError('bad-response', `${source} ${label} 实际 ${buf.length} 字节，超过上限 ${maxBytes}`)
    }
    return buf
  }

  /**
   * 读响应体为 UTF-8 文本（带字节上限）。
   * @param source - 来源名。
   * @param res - 已是 2xx 的响应。
   * @param maxBytes - 字节上限。
   * @param label - 错误里点名的对象。
   * @returns `{ content, size }`，`size` 是实际字节数。
   */
  async function readText(source, res, maxBytes, label) {
    const buf = await readBytes(source, res, maxBytes, label)
    return { content: buf.toString('utf8'), size: buf.length }
  }

  // ── ClawHub ───────────────────────────────────────────────────────────────

  // ClawHub slug 跨 owner 不唯一：单技能端点可带 `?owner=` 消歧。这里维护一份
  // slug → owner 记忆：列表/搜索行带 `ownerHandle` 就记下（用户点开的正是那一行），
  // 详情成功后再校准；没记忆时首读裸 slug，撞 409 AMBIGUOUS_SKILL_SLUG 则取
  // `matches[0].ownerHandle` 重试一次。id 不带 owner 是 wire 定死的（M2 决定），
  // 所以记忆 + 409 回退就是全部消歧手段。
  const clawhubOwners = new Map()

  function withParam(url, key, value) {
    const built = new URL(url)
    built.searchParams.set(key, value)
    return built.toString()
  }

  /**
   * ClawHub 请求：带上已知 owner，409 歧义时解析并重试一次。
   * @param url - 完整 URL（尚无 owner 参数时由本函数补）。
   * @param slug - 本次读取的 slug（无单技能上下文时传 `undefined`）。
   * @returns Response。
   * @throws 已带 owner 仍 409、或 409 无法解析 owner 时抛 `upstream-error`。
   */
  async function clawhubFetch(url, slug) {
    const known = slug !== undefined ? clawhubOwners.get(slug) : undefined
    const target = known !== undefined ? withParam(url, 'owner', known) : url
    const res = await providerFetch('clawhub', target)
    if (res.status !== 409) return res
    if (known !== undefined) {
      throw marketError('upstream-error', `clawhub 对 ${new URL(target).pathname} 回了 409（owner=${known} 仍歧义）`)
    }
    const body = await res.json().catch(() => null)
    const resolved = body?.code === 'AMBIGUOUS_SKILL_SLUG' ? body?.matches?.[0]?.ownerHandle : undefined
    if (typeof resolved !== 'string' || resolved === '') {
      throw marketError('upstream-error', `clawhub 对 ${new URL(target).pathname} 回了 409（slug 歧义且无法消歧）`)
    }
    if (slug !== undefined) clawhubOwners.set(slug, resolved)
    return providerFetch('clawhub', withParam(target, 'owner', resolved))
  }

  async function clawhubJson(url, slug) {
    const res = await clawhubFetch(url, slug)
    if (!res.ok) {
      throw marketError(res.status === 404 ? 'bad-response' : 'upstream-error',
        `clawhub 对 ${new URL(url).pathname} 回了 HTTP ${res.status}`)
    }
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      throw marketError('bad-response', `clawhub 返回的不是合法 JSON（${url}）`)
    }
  }

  /** 列表/搜索行归一化；带 `ownerHandle` 的顺手记进 owner 记忆。 */
  function normalizeClawhubItem(item, fallbackOwner) {
    const owner = typeof item.ownerHandle === 'string' && item.ownerHandle !== ''
      ? item.ownerHandle
      : fallbackOwner ?? ''
    if (owner !== '' && typeof item.slug === 'string') clawhubOwners.set(item.slug, owner)
    const stats = item.stats ?? {}
    return {
      id: marketSkillId('clawhub', item.slug),
      source: 'clawhub',
      slug: item.slug,
      name: item.displayName || item.slug,
      summary: typeof item.summary === 'string' ? item.summary : '',
      author: { handle: owner },
      stats: {
        downloads: typeof stats.downloads === 'number' ? stats.downloads : 0,
        ...(typeof stats.installs === 'number' ? { installs: stats.installs } : {}),
        ...(typeof stats.stars === 'number' ? { stars: stats.stars } : {}),
      },
      tags: Array.isArray(item.topics) ? item.topics.filter((tag) => typeof tag === 'string') : [],
      ...(typeof item.latestVersion?.version === 'string' ? { version: item.latestVersion.version } : {}),
      ...(typeof item.updatedAt === 'number' ? { updatedAt: item.updatedAt } : {}),
      securityStatus: 'unknown',
      installState: 'installable',
    }
  }

  /** 搜索行归一化：owner 在 `ownerHandle` / `owner.handle` / `publisher.handle`。 */
  function normalizeClawhubSearchResult(result) {
    const owner = result.owner?.handle || result.ownerHandle || result.publisher?.handle || ''
    if (owner !== '' && typeof result.slug === 'string') clawhubOwners.set(result.slug, owner)
    const downloads = typeof result.downloads === 'number'
      ? result.downloads
      : (typeof result.native?.skill?.stats?.downloads === 'number' ? result.native.skill.stats.downloads : 0)
    return {
      id: marketSkillId('clawhub', result.slug),
      source: 'clawhub',
      slug: result.slug,
      name: result.displayName || result.slug,
      summary: typeof result.summary === 'string' ? result.summary : '',
      author: {
        handle: owner,
        ...(typeof result.owner?.displayName === 'string' || typeof result.publisher?.displayName === 'string'
          ? { displayName: result.owner?.displayName || result.publisher?.displayName }
          : {}),
      },
      stats: { downloads },
      tags: Array.isArray(result.native?.skill?.topics)
        ? result.native.skill.topics.filter((tag) => typeof tag === 'string')
        : [],
      ...(typeof result.updatedAt === 'number' ? { updatedAt: result.updatedAt } : {}),
      securityStatus: 'unknown',
      installState: 'installable',
    }
  }

  /** ClawHub 版本扫描的总体状态 → 归一化枚举（clean → benign，其余 flagged）。 */
  function mapClawhubSecurity(security) {
    if (typeof security?.status !== 'string' || security.status === '') return 'unknown'
    return security.status === 'clean' ? 'benign' : 'flagged'
  }

  const clawhub = {
    source: 'clawhub',

    /**
     * 热门榜一页。
     * @param params - `{ cursor?, limit }`。
     * @returns `{ items, nextCursor? }`。
     * @throws 缺 `items` 数组时抛 `bad-response`。
     */
    async list({ cursor, limit }) {
      const url = new URL('/api/v1/skills', base1)
      url.searchParams.set('limit', String(limit))
      url.searchParams.set('sort', 'downloads')
      if (typeof cursor === 'string' && cursor !== '') url.searchParams.set('cursor', cursor)
      const data = await clawhubJson(url.toString(), undefined)
      if (!Array.isArray(data?.items)) throw marketError('bad-response', 'clawhub 列表缺 items 数组')
      return {
        items: data.items.filter((item) => item?.slug).map((item) => normalizeClawhubItem(item)),
        ...(typeof data.nextCursor === 'string' && data.nextCursor !== '' ? { nextCursor: data.nextCursor } : {}),
      }
    },

    /**
     * 关键词搜索（无分页；外部聚合结果按 `source`/`install.kind` 过滤掉）。
     * @param params - `{ q, limit }`。
     * @returns `{ items }`，至多 `limit` 条。
     * @throws 缺 `results` 数组时抛 `bad-response`。
     */
    async search({ q, limit }) {
      const url = new URL('/api/v1/search', base1)
      url.searchParams.set('q', q)
      const data = await clawhubJson(url.toString(), undefined)
      if (!Array.isArray(data?.results)) throw marketError('bad-response', 'clawhub 搜索缺 results 数组')
      const native = data.results.filter((result) => result?.slug
        && (result.source === undefined || result.source === 'clawhub')
        && (result.install?.kind === undefined || result.install.kind === 'clawhub'))
      return { items: native.slice(0, limit).map((result) => normalizeClawhubSearchResult(result)) }
    },

    /**
     * 单技能详情（含文件清单与 SKILL.md 正文）。
     * @param slug - 技能 slug。
     * @returns 归一化详情：`{ ...item, skillMd, description, frontmatter, files, totalSize, ... }`。
     * @throws 结构缺 `skill` 时抛 `bad-response`；版本接口失败按「无文件清单」降级。
     */
    async detail(slug) {
      const data = await clawhubJson(new URL(`/api/v1/skills/${encodeURIComponent(slug)}`, base1).toString(), slug)
      if (!data?.skill?.slug) throw marketError('bad-response', 'clawhub 详情缺 skill 对象')
      const owner = typeof data.owner?.handle === 'string' ? data.owner.handle : ''
      if (owner !== '') clawhubOwners.set(slug, owner)
      const version = data.latestVersion?.version || data.skill.latestVersion?.version
      let files = []
      let license = typeof data.latestVersion?.license === 'string' ? data.latestVersion.license : undefined
      let securityStatus = 'unknown'
      if (typeof version === 'string' && version !== '') {
        try {
          const versionUrl = new URL(`/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`, base1)
          const versionData = await clawhubJson(versionUrl.toString(), slug)
          const entry = versionData?.version ?? versionData
          if (Array.isArray(entry?.files)) files = entry.files
          if (typeof entry?.license === 'string' && entry.license !== '') license = entry.license
          securityStatus = mapClawhubSecurity(entry?.security)
        } catch {
          // 版本清单是尽力而为：详情本身仍然可用，安装时会重新拉一次清单。
        }
      }
      const raw = typeof data.skill.description === 'string' ? data.skill.description : ''
      const { frontmatter, body } = splitFrontmatter(raw)
      const item = normalizeClawhubItem(data.skill, owner)
      return {
        ...item,
        author: {
          handle: owner,
          ...(typeof data.owner?.displayName === 'string' ? { displayName: data.owner.displayName } : {}),
        },
        ...(typeof version === 'string' && version !== '' ? { version } : {}),
        securityStatus,
        skillMd: raw,
        description: body,
        frontmatter,
        files: files
          .filter((file) => typeof file?.path === 'string' && typeof file.size === 'number')
          .map((file) => ({
            path: file.path,
            size: file.size,
            ...(typeof file.sha256 === 'string' ? { sha256: file.sha256 } : {}),
            ...(typeof file.contentType === 'string' ? { contentType: file.contentType } : {}),
          })),
        totalSize: files.reduce((sum, file) => sum + (typeof file.size === 'number' ? file.size : 0), 0),
        ...(typeof license === 'string' && license !== '' ? { license } : {}),
        ...(owner !== '' ? { pageUrl: `${base1}/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}` } : {}),
      }
    },

    /**
     * 某版本的文件清单（`version` 缺省时先查最新版本）。
     * @param slug - 技能 slug。
     * @param version - 版本号。
     * @returns `[{ path, size, sha256? }]`。
     */
    async listFiles(slug, version) {
      let resolved = version
      if (typeof resolved !== 'string' || resolved === '') {
        const data = await clawhubJson(new URL(`/api/v1/skills/${encodeURIComponent(slug)}`, base1).toString(), slug)
        resolved = data?.latestVersion?.version || data?.skill?.latestVersion?.version
      }
      if (typeof resolved !== 'string' || resolved === '') return []
      const url = new URL(`/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(resolved)}`, base1)
      const data = await clawhubJson(url.toString(), slug)
      const files = data?.version?.files
      if (!Array.isArray(files)) throw marketError('bad-response', 'clawhub 版本详情缺 files 数组')
      return files
        .filter((file) => typeof file?.path === 'string' && typeof file.size === 'number')
        .map((file) => ({ path: file.path, size: file.size, ...(typeof file.sha256 === 'string' ? { sha256: file.sha256 } : {}) }))
    },

    /**
     * 取单文件文本（预览用）。
     * @param slug - 技能 slug。
     * @param filePath - 包内相对路径。
     * @returns `{ content, size }`。
     */
    async fetchFile(slug, filePath) {
      const url = new URL(`/api/v1/skills/${encodeURIComponent(slug)}/file`, base1)
      url.searchParams.set('path', filePath)
      const res = await clawhubFetch(url.toString(), slug)
      if (!res.ok) {
        throw marketError(res.status === 404 ? 'bad-response' : 'upstream-error',
          `clawhub 取文件失败 HTTP ${res.status}（${filePath}）`)
      }
      return readText('clawhub', res, MARKET_LIMITS.maxFileSize, `文件 ${filePath}`)
    },

    /**
     * 取单文件原始字节（安装用：sha256 按字节算，文本往返会毁掉二进制与哈希）。
     * @param slug - 技能 slug。
     * @param filePath - 包内相对路径。
     * @returns Buffer。
     */
    async fetchFileBytes(slug, filePath) {
      const url = new URL(`/api/v1/skills/${encodeURIComponent(slug)}/file`, base1)
      url.searchParams.set('path', filePath)
      const res = await clawhubFetch(url.toString(), slug)
      if (!res.ok) {
        throw marketError(res.status === 404 ? 'bad-response' : 'upstream-error',
          `clawhub 取文件失败 HTTP ${res.status}（${filePath}）`)
      }
      return readBytes('clawhub', res, MARKET_LIMITS.maxFileSize, `文件 ${filePath}`)
    },
  }

  // ── SkillHub ──────────────────────────────────────────────────────────────

  // 分页参数必须是 `pageSize`（`limit` 会被静默忽略）、搜索参数必须是 `keyword`
  // （`q` 会被静默忽略）——实测确认，与 cc-haha 注释一致。包络是
  // `{code, data:{skills, total}, message}`，`code !== 0` 视为坏响应。
  const SKILLHUB_BENIGN = new Set(['benign', 'safe', 'clean'])

  /** 列表与详情字段名不同（`name`/`description` ↔ `displayName`/`summary`），链式兜底。 */
  function normalizeSkillhubItem(item) {
    const tags = []
    for (const sub of Array.isArray(item.subCategories) ? item.subCategories : []) {
      if (typeof sub?.name === 'string') tags.push(sub.name)
    }
    const stats = item.stats ?? {}
    return {
      id: marketSkillId('skillhub', item.slug),
      source: 'skillhub',
      slug: item.slug,
      name: item.name || item.displayName || item.slug,
      summary: item.description_zh || item.description || item.summary_zh || item.summary || '',
      author: { handle: typeof item.ownerName === 'string' ? item.ownerName : '' },
      stats: {
        downloads: typeof item.downloads === 'number' ? item.downloads
          : (typeof stats.downloads === 'number' ? stats.downloads : 0),
        ...(typeof item.installs === 'number' ? { installs: item.installs }
          : typeof stats.installs === 'number' ? { installs: stats.installs } : {}),
        ...(typeof item.stars === 'number' ? { stars: item.stars }
          : typeof stats.stars === 'number' ? { stars: stats.stars } : {}),
      },
      tags,
      ...(typeof item.category === 'string' ? { category: item.category } : {}),
      ...(typeof item.version === 'string' ? { version: item.version } : {}),
      ...(typeof item.updated_at === 'number' ? { updatedAt: item.updated_at }
        : typeof item.updatedAt === 'number' ? { updatedAt: item.updatedAt } : {}),
      ...(typeof item.iconUrl === 'string' && item.iconUrl !== '' ? { iconUrl: item.iconUrl } : {}),
      // 列表响应不带安全报告：`verified` 是唯一信号，详情再用 securityReports 细分。
      securityStatus: item.verified === true ? 'verified' : 'unknown',
      ...(typeof item.verified === 'boolean' ? { verified: item.verified } : {}),
      ...(parseSkillhubUpstream(item) ?? {}),
      installState: 'installable',
    }
  }

  /** SkillHub 上镜像 ClawHub 的条目：`source=clawhub` + `upstream_url` 尾段即上游 slug。 */
  function parseSkillhubUpstream(item) {
    if (item.source !== 'clawhub' || typeof item.upstream_url !== 'string' || item.upstream_url === '') return undefined
    try {
      const segments = new URL(item.upstream_url).pathname.split('/').filter(Boolean)
      const slug = segments[segments.length - 1]
      if (typeof slug === 'string' && slug !== '') return { upstream: { source: 'clawhub', slug } }
    } catch {
      // URL 都解析不了就当原生条目。
    }
    return undefined
  }

  /** 安全报告集合 → 归一化枚举：任一非 benign → flagged；全 benign → verified/benign。 */
  function mapSkillhubSecurity(reports, verified) {
    const entries = Object.values(reports ?? {}).filter((report) => typeof report?.status === 'string')
    if (entries.length === 0) return 'unknown'
    const anyFlagged = entries.some((report) => !SKILLHUB_BENIGN.has(report.status.toLowerCase()))
    if (anyFlagged) return 'flagged'
    return verified === true ? 'verified' : 'benign'
  }

  async function skillhubPage({ q, cursor, limit }) {
    const page = typeof cursor === 'string' && cursor !== '' ? Math.max(1, Number.parseInt(cursor, 10) || 1) : 1
    const url = new URL('/api/skills', base2)
    url.searchParams.set('page', String(page))
    url.searchParams.set('pageSize', String(limit))
    if (typeof q === 'string' && q !== '') url.searchParams.set('keyword', q)
    const envelope = await fetchJson('skillhub', url.toString())
    if (envelope?.code !== 0 || !Array.isArray(envelope.data?.skills)) {
      throw marketError('bad-response',
        `skillhub 包络不对（code=${String(envelope?.code)}，${String(envelope?.message ?? '缺 data.skills')}）`)
    }
    const items = envelope.data.skills.filter((item) => item?.slug).map((item) => normalizeSkillhubItem(item))
    const total = typeof envelope.data.total === 'number' ? envelope.data.total : 0
    const hasMore = page * limit < total
    return { items, ...(hasMore ? { nextCursor: String(page + 1) } : {}), total }
  }

  const skillhub = {
    source: 'skillhub',

    /**
     * 热门榜一页（按上架顺序/得分，上游自带）。
     * @param params - `{ cursor?, limit }`。
     * @returns `{ items, nextCursor?, total }`。
     */
    list(params) {
      return skillhubPage(params)
    },

    /**
     * 关键词搜索一页。
     * @param params - `{ q, cursor?, limit }`。
     * @returns `{ items, nextCursor?, total }`。
     */
    search(params) {
      return skillhubPage(params)
    },

    /**
     * 单技能详情（文件清单与 SKILL.md 尽力拉取，失败降级不抛）。
     * @param slug - 技能 slug。
     * @returns 归一化详情（`skillMd` 可能为空串，此时 `description` 退回摘要）。
     * @throws 详情结构缺 `skill` 时抛 `bad-response`。
     */
    async detail(slug) {
      const data = await fetchJson('skillhub', new URL(`/api/v1/skills/${encodeURIComponent(slug)}`, base2).toString())
      if (!data?.skill?.slug) throw marketError('bad-response', 'skillhub 详情缺 skill 对象')
      const item = normalizeSkillhubItem(data.skill)
      const owner = typeof data.owner?.handle === 'string' && data.owner.handle !== '' ? data.owner.handle : item.author.handle
      const securityStatus = mapSkillhubSecurity(data.securityReports, data.skill.verified)
      const version = data.latestVersion?.version || item.version
      let files = []
      try {
        files = await skillhub.listFiles(slug)
      } catch {
        // 文件清单尽力而为；安装时会重新拉。
      }
      let skillMd = ''
      if (files.some((file) => file.path === 'SKILL.md')) {
        try {
          skillMd = (await skillhub.fetchFile(slug, 'SKILL.md')).content
        } catch {
          skillMd = ''
        }
      }
      const { frontmatter, body } = splitFrontmatter(skillMd)
      return {
        ...item,
        author: {
          handle: owner,
          ...(typeof data.owner?.displayName === 'string' ? { displayName: data.owner.displayName } : {}),
        },
        ...(typeof version === 'string' && version !== '' ? { version } : {}),
        securityStatus,
        skillMd,
        description: skillMd !== '' ? body : item.summary,
        frontmatter: skillMd !== '' ? frontmatter : {},
        files: files.map((file) => ({
          path: file.path,
          size: file.size,
          ...(typeof file.sha256 === 'string' ? { sha256: file.sha256 } : {}),
        })),
        totalSize: files.reduce((sum, file) => sum + (typeof file.size === 'number' ? file.size : 0), 0),
        ...(typeof data.latestVersion?.changelog === 'string' && data.latestVersion.changelog !== ''
          ? { changelog: { ...(typeof version === 'string' ? { version } : {}), text: data.latestVersion.changelog } }
          : {}),
      }
    },

    /**
     * 文件清单。
     * @param slug - 技能 slug。
     * @returns `[{ path, size, sha256? }]`。
     * @throws 缺 `files` 数组时抛 `bad-response`。
     */
    async listFiles(slug) {
      const data = await fetchJson('skillhub', new URL(`/api/v1/skills/${encodeURIComponent(slug)}/files`, base2).toString())
      if (!Array.isArray(data?.files)) throw marketError('bad-response', 'skillhub 文件接口缺 files 数组')
      return data.files
        .filter((file) => typeof file?.path === 'string' && typeof file.size === 'number')
        .map((file) => ({ path: file.path, size: file.size, ...(typeof file.sha256 === 'string' ? { sha256: file.sha256 } : {}) }))
    },

    /**
     * 取单文件文本（302 跳腾讯 COS，`redirect: 'follow'` 已在请求层带上）。
     * @param slug - 技能 slug。
     * @param filePath - 包内相对路径。
     * @returns `{ content, size }`。
     */
    async fetchFile(slug, filePath) {
      const url = new URL(`/api/v1/skills/${encodeURIComponent(slug)}/file`, base2)
      url.searchParams.set('path', filePath)
      const res = await providerFetch('skillhub', url.toString())
      if (!res.ok) {
        throw marketError(res.status === 404 ? 'bad-response' : 'upstream-error',
          `skillhub 取文件失败 HTTP ${res.status}（${filePath}）`)
      }
      return readText('skillhub', res, MARKET_LIMITS.maxFileSize, `文件 ${filePath}`)
    },

    /**
     * 取单文件原始字节（安装用，理由同 ClawHub 的 `fetchFileBytes`）。
     * @param slug - 技能 slug。
     * @param filePath - 包内相对路径。
     * @returns Buffer。
     */
    async fetchFileBytes(slug, filePath) {
      const url = new URL(`/api/v1/skills/${encodeURIComponent(slug)}/file`, base2)
      url.searchParams.set('path', filePath)
      const res = await providerFetch('skillhub', url.toString())
      if (!res.ok) {
        throw marketError(res.status === 404 ? 'bad-response' : 'upstream-error',
          `skillhub 取文件失败 HTTP ${res.status}（${filePath}）`)
      }
      return readBytes('skillhub', res, MARKET_LIMITS.maxFileSize, `文件 ${filePath}`)
    },
  }

  return { clawhub, skillhub }
}

// ── 能力披露（规则式，移植自 cc-haha skillInsights.ts）──────────────────────

const SCRIPT_EXTENSIONS = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|ps1|pl|php|go|rs)$/i
const SHELL_FENCE = /```(?:bash|sh|shell|zsh|console|terminal)\s*\n([\s\S]*?)```/gi
const ANY_FENCE = /```[^\n]*\n([\s\S]*?)```/g
const ENV_SECRET = /\b([A-Z][A-Z0-9]*_(?:API_KEY|APIKEY|KEY|TOKEN|SECRET|ACCESS_KEY|SECRET_KEY|PASSWORD))\b/g
const URL_HOST = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?[/\w.?=&%-]*/gi
/** 文档链接域，不算「技能会去访问」的网络证据。 */
const DOC_HOSTS = /(^|\.)(github\.com|githubusercontent\.com|clawhub\.ai|skillhub\.cn|npmjs\.com|pypi\.org|wikipedia\.org|example\.com|localhost)$/i
const WRITE_COMMAND = /(^|[\s;&|])(mkdir|touch|tee|cp|mv|rm|printf[^\n]*>|echo[^\n]*>|cat\s*>)\b/m
/** Shell 内建与管道语法，说明不了技能在干什么。 */
const SHELL_NOISE = new Set(['cd', 'echo', 'export', 'set', 'then', 'fi', 'do', 'done', 'else', 'if', 'test', 'true', 'false', 'source', 'cat', 'ls'])

/** 去重并截断证据（每条能力最多 3 条证据）。 */
function unique(values, limit) {
  return [...new Set(values)].slice(0, limit)
}

/**
 * 从 SKILL.md 正文与文件清单里**规则式**识别技能会动用的能力。
 *
 * 每条命中都带证据（命令、路径、变量名、域名原文），不推断文件与正文没有写
 * 的事；零命中返回空数组——UI 据此不渲染面板，也不替技能宣称「无风险」。
 * 规则移植自 cc-haha `desktop/src/lib/skillInsights.ts`（去掉了它面向 Claude
 * frontmatter `metadata.requires` 的 binaries 规则，我们技能格式没有那层）。
 * @param markdown - SKILL.md 正文（可为空串）。
 * @param files - 文件清单，元素为 `{ path }`（也接受裸路径字符串）。
 * @returns `[{ kind, severity, evidence, label }]`，按 `shell → hooks → secrets →
 *   network → writes` 排序；零命中为 `[]`。
 */
export function detectCapabilities(markdown, files) {
  const text = typeof markdown === 'string' ? markdown : ''
  const paths = (Array.isArray(files) ? files : [])
    .map((file) => (typeof file === 'string' ? file : file?.path))
    .filter((path) => typeof path === 'string' && path !== '')
  const found = new Map()
  const add = (kind, evidence) => {
    if (evidence.length > 0) found.set(kind, unique([...(found.get(kind) ?? []), ...evidence], 3))
  }

  // 读者不会去跑测试与钩子脚本本身，所以脚本证据取第一个可执行入口（路径最短者优先）。
  const scripts = paths
    .filter((path) => SCRIPT_EXTENSIONS.test(path) && !/(^|[/.])(test|spec)s?([/.]|$)/i.test(path))
    .filter((path) => !/(^|\/)hooks?\//i.test(path))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)
  const shellBlocks = [...text.matchAll(SHELL_FENCE)].map((match) => match[1] ?? '')
  const firstCommands = shellBlocks
    .flatMap((block) => block.split('\n'))
    .map((line) => line.replace(/^\s*\$\s*/, '').trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .flatMap((line) => line.split(/\s*(?:\|\||&&|;|\|)\s*/))
    .map((segment) => segment.replace(/^\[.*?\]\s*/, '').split(/\s+/)[0] ?? '')
    .filter((command) => /^[a-z][\w.-]*$/i.test(command) && !SHELL_NOISE.has(command))
  add('shell', [...scripts.slice(0, 1), ...unique(firstCommands, 2)])

  // hooks/ 目录算一条，不逐文件报。
  const hookDirs = paths
    .map((path) => /^(.*?(?:^|\/)hooks?\/)/i.exec(path)?.[1])
    .filter((dir) => dir !== undefined)
  add('hooks', unique(hookDirs, 1))
  // 完整的家/项目相对路径（`~/.claude/hooks`），不取路径碎片。
  const hookTarget = /(?:^|[\s`'"(])((?:~|\.)\/[\w./-]*?hooks)\b/i.exec(text)?.[1]
  if (hookTarget !== undefined && /hook/i.test(text)) add('hooks', [hookTarget])

  add('secrets', [...text.matchAll(ENV_SECRET)].map((match) => match[1] ?? ''))

  const code = [...text.matchAll(ANY_FENCE)].map((match) => match[1] ?? '').join('\n')
  const hosts = [...code.matchAll(URL_HOST)]
    .map((match) => (match[1] ?? '').toLowerCase())
    .filter((host) => host !== '' && !DOC_HOSTS.test(host))
  add('network', hosts)

  if (shellBlocks.some((block) => WRITE_COMMAND.test(block))) {
    // 写入证据报落到的目录，不逐文件列。
    const places = shellBlocks
      .flatMap((block) => [...block.matchAll(/(?:mkdir\s+(?:-p\s+)?|>\s*)([.\w~/-]+)/g)].map((match) => match[1] ?? ''))
      .filter((path) => path !== '' && path !== '/dev/null')
      .map((path) => (path.includes('/') ? `${path.split('/').slice(0, -1).join('/')}/`
        : path.startsWith('.') ? `${path}/` : path))
    add('writes', places.length > 0 ? unique(places, 2) : ['files'])
  }

  const order = ['shell', 'hooks', 'secrets', 'network', 'writes']
  return order
    .filter((kind) => found.has(kind))
    .map((kind) => ({ kind, severity: SEVERITY[kind], evidence: found.get(kind) ?? [], label: CAPABILITY_LABELS[kind] }))
}

/**
 * 「何时触发」列表：SKILL.md 描述里常见的 `Use when (1) …` / `当……时使用` 句式。
 * @param description - frontmatter 的 `description` / `whenToUse` 文本。
 * @returns 至多 5 条短语；识别不出返回 `[]`。
 */
export function extractTriggers(description) {
  if (typeof description !== 'string' || description === '') return []
  const text = description.replace(/\s+/g, ' ').trim()
  const english = /\b(?:use|activate|trigger(?:ed)?)\s+(?:it\s+|this\s+)?when\b:?\s*(.+)$/i.exec(text)
  let body = english?.[1]
  if (body === undefined) {
    const chinese = /(?:适用于|使用场景[:：]|触发场景[:：]|当)(.+?)(?:时(?:使用|触发|调用)|$)/.exec(text)
    body = chinese?.[1]
  }
  if (body === undefined) return []
  const numbered = body.split(/\s*\(\d+\)\s*|\s*（\d+）\s*|\s*\d+[.、)]\s+/).map((item) => item.trim()).filter(Boolean)
  const items = numbered.length > 1 ? numbered : body.split(/[;；。]|,\s*or\s+|、/)
  return items
    .map((item) => item.replace(/^(?:or|and|或|以及)\s+/i, '').replace(/[,，;；.。]+$/, '').trim())
    .filter((item) => item.length >= 3)
    .map((item) => (item.length > 64 ? `${item.slice(0, 63)}…` : item))
    .slice(0, 5)
}

/** 详情里的「何时触发」：frontmatter `triggers` 列表优先，其次从描述句式提取。 */
function deriveTriggers(frontmatter) {
  const fm = frontmatter ?? {}
  const declared = Array.isArray(fm.triggers)
    ? fm.triggers.filter((item) => typeof item === 'string' && item !== '')
    : []
  if (declared.length > 0) return declared.slice(0, 5)
  const source = typeof fm.whenToUse === 'string' && fm.whenToUse !== ''
    ? fm.whenToUse
    : (typeof fm.description === 'string' ? fm.description : '')
  return extractTriggers(source)
}

// ── 归一化辅助：文件语言、路径安全、meta ────────────────────────────────────

const LANG_MAP = {
  md: 'markdown', ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', yaml: 'yaml', yml: 'yaml', sh: 'bash', bash: 'bash', zsh: 'bash',
  py: 'python', toml: 'toml', css: 'css', html: 'html',
  txt: 'text', xml: 'xml', sql: 'sql', rs: 'rust', go: 'go', rb: 'ruby',
}

/**
 * 按扩展名给文件一个语言标签（预览着色用）。
 * @param filePath - 包内相对路径。
 * @returns 语言标签，未知扩展统一 `text`。
 */
export function detectLanguage(filePath) {
  const ext = String(filePath).split('.').pop()?.toLowerCase() ?? ''
  return LANG_MAP[ext] ?? 'text'
}

/**
 * 包内相对路径安全校验：拒绝空串/NUL/超长/绝对路径/盘符/`..` 段。
 * @param filePath - 清单里的路径。
 * @returns 安全为 `true`。
 */
export function isSafeFilePath(filePath) {
  if (typeof filePath !== 'string' || filePath === '' || filePath.length > MARKET_LIMITS.maxPathLength) return false
  if (filePath.includes('\0')) return false
  if (filePath.startsWith('/') || filePath.startsWith('\\')) return false
  if (/^[A-Za-z]:/.test(filePath)) return false
  if (filePath.replace(/\\/g, '/').split('/').includes('..')) return false
  return true
}

/** 解析 `.market-meta.json`：market 源 + slug 可消毒 + `id === source:slug` + 归属本目录。 */
function parseMarketMeta(value, dirName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const { source, slug, id, installedAt, fileCount, version } = value
  if (typeof source !== 'string' || !MARKET_SOURCES.includes(source)) return null
  if (typeof slug !== 'string' || slug === '') return null
  if (id !== marketSkillId(source, slug)) return null
  const sanitized = sanitizeDirName(slug)
  if (sanitized === null || sanitized !== dirName) return null
  if (typeof installedAt !== 'string' || installedAt === '') return null
  if (fileCount !== undefined && (!Number.isInteger(fileCount) || fileCount < 0)) return null
  if (version !== undefined && typeof version !== 'string') return null
  const { originalName, normalized } = value
  if (originalName !== undefined && originalName !== null && typeof originalName !== 'string') return null
  if (normalized !== undefined && typeof normalized !== 'string') return null
  return value
}

/**
 * 读一个技能目录的 `.market-meta.json`。
 * @param dir - 技能目录绝对路径。
 * @returns 合法且归属该目录的 meta；缺失/损坏/归属不符返回 `null`。
 */
async function readMarketMeta(dir) {
  let parsed
  try {
    parsed = JSON.parse(await readFile(join(dir, MARKET_META_FILENAME), 'utf8'))
  } catch {
    return null
  }
  return parseMarketMeta(parsed, basename(dir))
}

// ── 文件清单上限 ────────────────────────────────────────────────────────────

/**
 * 把文件清单的体积/结构上限套到详情上（只降级 `installable`，不动已判定项）。
 * @param detail - 归一化详情（含 `files`）。
 * @returns 可能降级为 `not-installable` 的同一形状详情。
 */
function applyFileLimits(detail) {
  if (detail.installState !== 'installable') return detail
  const files = Array.isArray(detail.files) ? detail.files : []
  if (files.length === 0 || !files.some((file) => file.path === 'SKILL.md')) {
    return { ...detail, installState: 'not-installable', notInstallableReason: 'empty-file-list' }
  }
  if (files.length > MARKET_LIMITS.maxFileCount) {
    return { ...detail, installState: 'not-installable', notInstallableReason: 'too-many-files' }
  }
  const total = files.reduce((sum, file) => sum + (typeof file.size === 'number' ? file.size : 0), 0)
  if (files.some((file) => file.size > MARKET_LIMITS.maxFileSize) || total > MARKET_LIMITS.maxTotalSize) {
    return { ...detail, installState: 'not-installable', notInstallableReason: 'file-too-large' }
  }
  return detail
}

/** 安装期同一套清单校验，失败抛 `not-installable`（消息里带具体码）。 */
function assertInstallableFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || !files.some((file) => file.path === 'SKILL.md')) {
    throw marketError('not-installable', '文件清单为空或缺根部 SKILL.md（empty-file-list）')
  }
  if (files.length > MARKET_LIMITS.maxFileCount) {
    throw marketError('not-installable', `文件数 ${files.length} 超过上限 ${MARKET_LIMITS.maxFileCount}（too-many-files）`)
  }
  const total = files.reduce((sum, file) => sum + (typeof file.size === 'number' ? file.size : 0), 0)
  if (files.some((file) => file.size > MARKET_LIMITS.maxFileSize) || total > MARKET_LIMITS.maxTotalSize) {
    throw marketError('not-installable',
      `清单声明体积超限（单文件 ≤ ${MARKET_LIMITS.maxFileSize} 字节，总 ≤ ${MARKET_LIMITS.maxTotalSize} 字节，实际总 ${total}）（file-too-large）`)
  }
}

// ── 更新判定（纯函数）────────────────────────────────────────────────────────

/**
 * 判断一条已安装的市场技能是否落后于上游最新版本。
 *
 * 两侧版本都必须**可解析**（剥掉前导 `v` 后以数字开头），任何一侧缺失或解析
 * 失败一律返回 `false`——解析不出版本时宁可不提示更新，也不给用户一个假的
 * 「有新版本」。可解析时复用 `repo-core` 的 `compareVersions`（简单 semver）。
 * @param latestVersion - 上游最新版本（`marketDetail` 的 `version`）。
 * @param installedVersion - 已装版本（`.market-meta.json` / state 记的版本）。
 * @returns 上游严格更新时为 `true`。
 */
export function computeUpdateAvailable(latestVersion, installedVersion) {
  const parse = (value) => {
    if (typeof value !== 'string') return null
    const text = value.trim().replace(/^[vV]/, '')
    return /^\d/.test(text) ? text : null
  }
  const latest = parse(latestVersion)
  const installed = parse(installedVersion)
  if (latest === null || installed === null) return false
  return compareVersions(latest, installed) > 0
}

// ── 安装态标注（盘上是真相，不进缓存）──────────────────────────────────────

/**
 * 单条安装态：目录不存在 → `installable`；存在且 meta 归属本 id → `installed`；
 * 存在但 meta 缺失/归属他方 → `not-installable`（`name-conflict`，拒绝覆盖）。
 * @param item - 归一化条目。
 * @param dshHome - DSH_HOME。
 * @returns 标注后的条目副本。
 */
async function annotateOne(item, dshHome) {
  const dirName = sanitizeDirName(item.slug)
  if (dirName === null) {
    return { ...item, installState: 'not-installable', notInstallableReason: 'invalid-name' }
  }
  const dir = join(dshHome, 'skills', dirName)
  if (!existsSync(dir)) {
    const clean = { ...item, installState: 'installable' }
    delete clean.notInstallableReason
    delete clean.installedInfo
    return clean
  }
  const meta = await readMarketMeta(dir)
  if (meta !== null && meta.id === item.id) {
    const installed = { ...item, installState: 'installed' }
    delete installed.notInstallableReason
    installed.installedInfo = {
      ...(typeof meta.version === 'string' ? { version: meta.version } : {}),
      installedAt: meta.installedAt,
      dirName,
    }
    return installed
  }
  const conflict = { ...item, installState: 'not-installable', notInstallableReason: 'name-conflict' }
  delete conflict.installedInfo
  return conflict
}

/**
 * 一页安装态：一次 `readdir` 拿现存目录，命中的再逐条读 meta。
 * @param items - 归一化条目数组。
 * @param dshHome - DSH_HOME。
 * @returns 标注后的条目数组（新对象，不改入参）。
 */
async function annotateMany(items, dshHome) {
  let existing
  try {
    existing = new Set(await readdir(join(dshHome, 'skills')))
  } catch {
    existing = new Set()
  }
  const out = []
  for (const item of items) {
    const dirName = sanitizeDirName(item.slug)
    if (dirName === null) {
      out.push({ ...item, installState: 'not-installable', notInstallableReason: 'invalid-name' })
      continue
    }
    if (!existing.has(dirName)) {
      const clean = { ...item, installState: 'installable' }
      delete clean.notInstallableReason
      delete clean.installedInfo
      out.push(clean)
      continue
    }
    out.push(await annotateOne(item, dshHome))
  }
  return out
}

// ── 跨源去重 ────────────────────────────────────────────────────────────────

/**
 * SkillHub 镜像 ClawHub（`upstream` 指回上游 slug）且同页有原条目时合并：
 * ClawHub 条目胜（数据更新鲜），吸收镜像 id 与 SkillHub 独有字段。
 * 不改入参——页对象在缓存里，原地改会把 `mirrors` 越叠越多。
 * @param items - 双源合并后的条目（ClawHub 在前，来源顺序保证）。
 * @returns 去重后的条目数组。
 */
export function dedupeSkills(items) {
  const out = []
  const clawhubPos = new Map()
  for (const item of items) {
    if (item.source === 'clawhub') {
      clawhubPos.set(item.slug, out.length)
      out.push({ ...item })
      continue
    }
    if (item.source === 'skillhub' && item.upstream?.slug !== undefined) {
      const pos = clawhubPos.get(item.upstream.slug)
      if (pos !== undefined) {
        const original = out[pos]
        out[pos] = {
          ...original,
          mirrors: [...(original.mirrors ?? []), item.id],
          ...(original.iconUrl === undefined && item.iconUrl !== undefined ? { iconUrl: item.iconUrl } : {}),
          ...(original.securityStatus === 'unknown' && item.securityStatus !== 'unknown'
            ? { securityStatus: item.securityStatus }
            : {}),
          ...(original.tags.length === 0 && item.tags.length > 0 ? { tags: [...item.tags] } : {}),
        }
        continue
      }
    }
    out.push({ ...item })
  }
  return out
}

/** 目录移动（EXDEV 跨设备时退回 copy+rm，目标非空时同路）。 */
async function moveDir(src, dest) {
  try {
    await rename(src, dest)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code !== 'EXDEV' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error
    await cp(src, dest, { recursive: true })
    await rm(src, { recursive: true, force: true })
  }
}

// ── market 实例 ─────────────────────────────────────────────────────────────

/**
 * 建一个市场聚合实例：双源 provider + 内存缓存 + 每源健康 + 同 id 安装锁。
 *
 * 实例持有 `dshHome`，安装态标注、落盘都以它为根——自检用临时家、host 插件用
 * `resolveDshHome()`，两者互不干扰。
 * @param options - `{ dshHome, clawhubBase, skillhubBase, fetchImpl, timeoutMs,
 *   now, pageSize }`；`fetchImpl` 默认 `globalThis.fetch`，`now` 默认 `Date.now`
 *   （自检注入假时钟推 TTL），`pageSize` 默认 {@link PAGE_SIZE}。
 * @returns 实例：`{ dshHome, providers, cache, health, locks, search, detail, file,
 *   status, installTo, clearCache, ... }`。
 * @throws `dshHome` 缺失或 base 为空时抛错。
 */
export function createMarket(options = {}) {
  const dshHome = options.dshHome
  if (typeof dshHome !== 'string' || dshHome === '') throw new Error('createMarket：需要 dshHome')
  const providers = createProviders({
    // 双 registry 的公开端点是协议默认值；host 插件用 cordis Config 覆盖
    // （repo.mjs 的 clawhubBase / skillhubBase），这里只作裸调用的兜底。
    clawhubBase: options.clawhubBase ?? 'https://clawhub.ai',
    skillhubBase: options.skillhubBase ?? 'https://api.skillhub.cn',
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  })
  const now = typeof options.now === 'function' ? options.now : Date.now
  const pageSize = typeof options.pageSize === 'number' && options.pageSize > 0 ? options.pageSize : PAGE_SIZE
  const cache = new MarketCache(now)
  const health = {
    clawhub: { status: 'ok' },
    skillhub: { status: 'ok' },
  }
  const locks = new Map()

  /** 一次逻辑请求成功：该源回到 `ok` 并记时间。 */
  const recordSuccess = (source) => {
    health[source] = { status: 'ok', lastOkAt: now() }
  }

  /**
   * 一次逻辑请求失败：有过成功 → `degraded`，否则（含连续失败）→ `failed`。
   * @param source - 来源名。
   * @param message - 失败原因（进 `marketStatus`）。
   */
  const recordFailure = (source, message) => {
    const prev = health[source]
    health[source] = {
      status: prev.status === 'ok' && prev.lastOkAt !== undefined ? 'degraded' : 'failed',
      ...(prev.lastOkAt !== undefined ? { lastOkAt: prev.lastOkAt } : {}),
      lastError: message,
    }
  }

  /**
   * 取一页（先查缓存；上游失败时 stale-while-error 顶一次并记健康）。
   * @param source - 来源名。
   * @param params - `{ q, cursor, limit }`。
   * @returns `{ page, status, fromCache, error? }`；`page` 为 `null` 表示无数据可回。
   */
  async function fetchPage(source, { q, cursor, limit }) {
    const isSearch = typeof q === 'string' && q !== ''
    const key = isSearch
      ? `search:${source}:${q}:${cursor ?? ''}:${limit}`
      : `list:${source}:${cursor ?? ''}:${limit}`
    const ttl = isSearch ? MARKET_TTL.search : MARKET_TTL.list
    const hit = cache.get(key)
    if (hit !== undefined) return { page: hit, status: 'ok', fromCache: true }
    try {
      const page = isSearch
        ? await providers[source].search({ q, cursor, limit })
        : await providers[source].list({ cursor, limit })
      recordSuccess(source)
      cache.set(key, page, ttl)
      return { page, status: 'ok', fromCache: false }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      recordFailure(source, message)
      const stale = cache.getStale(key)
      if (stale !== undefined) return { page: stale.value, status: 'cached', fromCache: true, error: message }
      return { page: null, status: health[source].status, error: message }
    }
  }

  /**
   * 全市场一页：双源并行、游标分页合并、跨源去重、按下载量降序。
   *
   * 某源缺席于游标 = 该源已翻完（不发请求、状态 `ok`）；所有活跃源都失败且无
   * 过期缓存兜底时**抛错**（两个源全挂返回空表会把故障伪装成「没内容」）。
   * @param scope - 目前仅 `'market'`。
   * @param query - 搜索词；空串 = 按下载量热门榜。
   * @param cursor - 上一页返回的 `nextCursor`；空 = 第一页。
   * @returns `{ items, nextCursor, sources }`；`nextCursor` 为 `null` 表示翻完，
   *   `sources` 每源取 `ok | cached | degraded | failed`。
   * @throws scope 非法、入参类型不对、或双源全失败时抛错。
   */
  async function search(scope, query, cursor) {
    if (scope !== 'market') {
      throw new Error(`marketSearch：未知 scope ${JSON.stringify(scope)}（当前仅支持 'market'）`)
    }
    if (query !== undefined && query !== null && typeof query !== 'string') {
      throw new Error('marketSearch：query 须是字符串')
    }
    if (cursor !== undefined && cursor !== null && cursor !== '' && typeof cursor !== 'string') {
      throw new Error('marketSearch：cursor 须是字符串')
    }
    const q = typeof query === 'string' ? query.trim() : ''
    const raw = typeof cursor === 'string' && cursor !== '' ? cursor : undefined
    const decoded = decodeCursor(raw)
    const first = raw === undefined
    const outcomes = await Promise.all(MARKET_SOURCES.map(async (source) => {
      if (!first && decoded?.[source] === undefined) {
        return { source, page: null, status: 'ok', exhausted: true }
      }
      const limit = q !== '' && source === 'clawhub' ? MARKET_LIMITS.searchResultCap : pageSize
      const result = await fetchPage(source, { q, cursor: decoded?.[source], limit })
      return { ...result, source }
    }))
    const sources = {}
    const next = {}
    const errors = {}
    let live = 0
    let failed = 0
    let merged = []
    for (const outcome of outcomes) {
      sources[outcome.source] = outcome.status
      if (outcome.exhausted === true) continue
      if (outcome.page === null) {
        failed += 1
        errors[outcome.source] = outcome.error ?? '未知错误'
        continue
      }
      live += 1
      merged.push(...outcome.page.items)
      if (typeof outcome.page.nextCursor === 'string' && outcome.page.nextCursor !== '') {
        next[outcome.source] = outcome.page.nextCursor
      }
    }
    if (live === 0 && failed > 0) {
      throw new Error(`两个技能市场源均拉取失败：${MARKET_SOURCES.map((source) => `${source}: ${errors[source] ?? '—'}`).join('；')}`)
    }
    merged = dedupeSkills(merged)
    merged.sort((left, right) => (right.stats.downloads ?? 0) - (left.stats.downloads ?? 0))
    merged = await annotateMany(merged, dshHome)
    return { items: merged, nextCursor: encodeCursor(next), sources }
  }

  /**
   * 单条详情：归一化字段 + 文件清单 + SKILL.md 正文 + 能力披露 + 何时触发 + 更新判定。
   *
   * 上游数据进缓存（10min），安装态/体积上限/能力披露/`updateAvailable` 每次现算——
   * 盘上事实不缓存。`updateAvailable` 用 {@link computeUpdateAvailable} 比较上游
   * `version` 与已装版本（`.market-meta.json` 经 `installedInfo` 透出），任一侧
   * 版本解析失败降级为 `false`。
   * @param id - `clawhub:<slug>` / `skillhub:<slug>`。
   * @returns 详情对象（JSON 可序列化）；过期缓存顶住上游故障时带 `cached: true`。
   * @throws id 非法、上游失败且无缓存时抛错。
   */
  async function detail(id) {
    const { source, slug } = parseMarketId(id)
    const key = `detail:${source}:${slug}`
    let raw
    let cached = false
    const hit = cache.get(key)
    if (hit !== undefined) {
      raw = hit
    } else {
      try {
        raw = await providers[source].detail(slug)
        recordSuccess(source)
        cache.set(key, raw, MARKET_TTL.detail)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        recordFailure(source, message)
        const stale = cache.getStale(key)
        if (stale === undefined) throw error
        raw = stale.value
        cached = true
      }
    }
    const annotated = await annotateOne(raw, dshHome)
    const limited = applyFileLimits(annotated)
    const skillMd = typeof limited.skillMd === 'string' ? limited.skillMd : ''
    return {
      ...limited,
      updateAvailable: computeUpdateAvailable(limited.version, limited.installedInfo?.version),
      triggers: deriveTriggers(limited.frontmatter ?? splitFrontmatter(skillMd).frontmatter),
      capabilities: detectCapabilities(skillMd, limited.files ?? []),
      ...(cached ? { cached: true } : {}),
    }
  }

  /**
   * 单文件预览内容（截断到 {@link MARKET_LIMITS.previewTruncateBytes}）。
   * @param id - 条目 id。
   * @param path - 包内相对路径。
   * @returns `{ path, content, language, size, truncated, cached? }`；`size` 是完整字节数。
   * @throws id/路径非法、上游失败且无缓存时抛错。
   */
  async function file(id, path) {
    const { source, slug } = parseMarketId(id)
    if (!isSafeFilePath(path)) throw new Error(`文件路径不安全：${JSON.stringify(path)}`)
    const key = `file:${source}:${slug}:${path}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    try {
      const fetched = await providers[source].fetchFile(slug, path)
      recordSuccess(source)
      const buf = Buffer.from(fetched.content, 'utf8')
      let content = fetched.content
      let truncated = false
      if (buf.length > MARKET_LIMITS.previewTruncateBytes) {
        content = buf.subarray(0, MARKET_LIMITS.previewTruncateBytes).toString('utf8')
        truncated = true
      }
      const result = { path, content, language: detectLanguage(path), size: fetched.size, truncated }
      cache.set(key, result, MARKET_TTL.file)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      recordFailure(source, message)
      const stale = cache.getStale(key)
      if (stale === undefined) throw error
      return { ...stale.value, cached: true }
    }
  }

  /**
   * 各源健康与缓存统计（诊断面，不受 `thirdParty` 总开关影响）。
   * @returns `{ sources: { clawhub, skillhub }, cache: { entries } }`。
   */
  function status() {
    const snapshot = (record) => ({
      status: record.status,
      ...(record.lastOkAt !== undefined ? { lastOkAt: record.lastOkAt } : {}),
      ...(record.lastError !== undefined ? { lastError: record.lastError } : {}),
    })
    return {
      sources: { clawhub: snapshot(health.clawhub), skillhub: snapshot(health.skillhub) },
      cache: { entries: cache.size },
    }
  }

  const market = {
    dshHome,
    providers,
    cache,
    health,
    locks,
    now,
    pageSize,
    recordSuccess,
    recordFailure,
    search,
    detail,
    file,
    status,
    clearCache: () => { cache.clear() },
    installTo: (id) => marketInstallTo(market, id),
  }
  return market
}

// ── 安装（逐文件下载 → 校验 → 原子换入）─────────────────────────────────────

/**
 * 安装一个市场技能到 `<dshHome>/skills/<dirName>/`，并写 state skills 桶。
 *
 * 流程（全程**不执行任何脚本**）：
 *   1. 同 id 进程内互斥——锁已占用时直接抛 `in-progress`；
 *   2. 取详情 + 重新拉文件清单，套用结构/体积上限（根部必须有 `SKILL.md`）；
 *   3. staging `<dshHome>/.bobo-market/tmp/mkt-<id>-*`：逐文件路径安全校验 →
 *      下载字节 → 实际字节复核 → sha256 校验（清单带哈希时）→ 写盘；
 *   4. 规范化 staging 的 `SKILL.md` frontmatter（见 {@link normalizeSkillFrontmatter}）：
 *      name 不合规改写/缺失插入、缺失 description 用详情摘要插入，只动这两行；
 *      无 frontmatter 头不构造，靠 meta 留痕；
 *   5. 写 `.market-meta.json` `{id, source, slug, version?, installedAt, fileCount,
 *      originalName?（改写过 name 时）, normalized?（无 frontmatter 头时）}`；
 *   6. 原子 rename 到 `<dshHome>/skills/<dirName>/`：目标已存在且 meta 归属本 id
 *      → 先移开旧目录再换入（覆盖更新）；无 meta 或归属他方 → `name-conflict`；
 *   7. 成功后写 state skills 桶 `{id, dirName, version, installedAt, source}`；
 *      任何失败清理 staging，不留半截目录。
 * @param market - {@link createMarket} 的实例。
 * @param id - `clawhub:<slug>` / `skillhub:<slug>`。
 * @returns `{ id, dirName, dir, version?, fileCount, replaced }`。
 * @throws id 非法、并发安装（`in-progress`）、清单不合法（`not-installable` 含
 *   具体码）、路径不安全（`unsafe-path`）、sha256 不符（`checksum-mismatch`）、
 *   名字冲突（`name-conflict`）、落盘失败（`disk-error`）、上游失败时抛错。
 */
export async function marketInstallTo(market, id) {
  const { source, slug } = parseMarketId(id)
  const dirName = sanitizeDirName(slug)
  if (dirName === null) {
    throw marketError('not-installable', `slug 不能用作目录名：${slug}（invalid-name）`)
  }
  if (market.locks.has(id)) throw marketError('in-progress', `已有安装进行中：${id}`)
  const task = performInstall(market, { id, source, slug, dirName })
  market.locks.set(id, task.then(() => undefined, () => undefined))
  try {
    return await task
  } finally {
    market.locks.delete(id)
  }
}

/**
 * 一次安装的实体（锁内执行）。
 * @param market - 市场实例。
 * @param fields - 已解析的 `{ id, source, slug, dirName }`。
 * @returns 同 {@link marketInstallTo} 的返回值。
 */
async function performInstall(market, { id, source, slug, dirName }) {
  const { dshHome, providers } = market
  const detailResult = await market.detail(id)
  if (detailResult.installState === 'not-installable') {
    throw marketError('not-installable', `${id} 不可安装（${detailResult.notInstallableReason ?? 'unknown'}）`)
  }
  let files
  try {
    files = await providers[source].listFiles(slug, detailResult.version)
    market.recordSuccess(source)
  } catch (error) {
    market.recordFailure(source, error instanceof Error ? error.message : String(error))
    throw error
  }
  assertInstallableFiles(files)

  const skillsRoot = join(dshHome, 'skills')
  const target = join(skillsRoot, dirName)
  let replace = false
  if (existsSync(target)) {
    const meta = await readMarketMeta(target)
    if (meta === null || meta.id !== id) {
      throw marketError('name-conflict', `目标目录已存在且不是本 id 的安装：${target}`)
    }
    replace = true
  }

  const stagingParent = join(dshHome, '.bobo-market', 'tmp')
  await mkdir(stagingParent, { recursive: true })
  const staging = await mkdtemp(join(stagingParent, `mkt-${id.replace(/[^A-Za-z0-9._-]+/g, '-')}-`))
  let backup = null
  try {
    let actualTotal = 0
    for (const file of files) {
      if (!isSafeFilePath(file.path)) {
        throw marketError('not-installable', `清单里的路径不安全：${JSON.stringify(file.path)}（unsafe-path）`)
      }
      let bytes
      try {
        bytes = await providers[source].fetchFileBytes(slug, file.path)
        market.recordSuccess(source)
      } catch (error) {
        market.recordFailure(source, error instanceof Error ? error.message : String(error))
        throw error
      }
      if (bytes.length > MARKET_LIMITS.maxFileSize) {
        throw marketError('not-installable', `${file.path} 实际 ${bytes.length} 字节，超过单文件上限（file-too-large）`)
      }
      actualTotal += bytes.length
      if (actualTotal > MARKET_LIMITS.maxTotalSize) {
        throw marketError('not-installable', `${id} 实际总字节 ${actualTotal}，超过总上限（file-too-large）`)
      }
      if (typeof file.sha256 === 'string' && file.sha256 !== '') {
        const actual = createHash('sha256').update(bytes).digest('hex')
        if (actual !== file.sha256.toLowerCase()) {
          throw marketError('checksum-mismatch',
            `${file.path} sha256 不匹配（清单 ${file.sha256}，实际 ${actual}），中止安装`)
        }
      }
      const dest = join(staging, file.path)
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, bytes)
    }

    // 上游发现器对 name/description 有硬校验（非空 + name 过 kebab），市场条目
    // 常不满足——在 staging 内规范化这两行，其余字节保持上游原样；sha256 校验
    // 发生在改写之前（校验的是上游字节，改写是安装方的刻意动作，meta 留痕）。
    const skillMdPath = join(staging, 'SKILL.md')
    const originalSkillMd = await readFile(skillMdPath, 'utf8')
    const descriptionFallback = typeof detailResult.summary === 'string' && detailResult.summary.trim() !== ''
      ? detailResult.summary
      : (typeof detailResult.name === 'string' && detailResult.name.trim() !== '' ? detailResult.name : dirName)
    const normalized = normalizeSkillFrontmatter(originalSkillMd, { name: dirName, description: descriptionFallback })
    if (normalized.changed) await writeFile(skillMdPath, normalized.text)

    const installedAt = new Date().toISOString()
    const meta = {
      id,
      source,
      slug,
      ...(typeof detailResult.version === 'string' ? { version: detailResult.version } : {}),
      installedAt,
      fileCount: files.length,
      ...(normalized.noFrontmatter ? { normalized: 'no-frontmatter' } : {}),
      ...(normalized.changed ? { originalName: normalized.originalName } : {}),
    }
    await writeFile(join(staging, MARKET_META_FILENAME), `${JSON.stringify(meta, null, 2)}\n`)

    await mkdir(skillsRoot, { recursive: true })
    // 最后一刻复查（与手工安装赛跑的窗口）。
    if (existsSync(target)) {
      const metaNow = await readMarketMeta(target)
      if (metaNow === null || metaNow.id !== id) {
        throw marketError('name-conflict', `目标目录在安装期间出现且非本 id：${target}`)
      }
      replace = true
    }
    if (replace) {
      backup = `${target}.old-${randomUUID().slice(0, 8)}`
      await rename(target, backup)
    }
    try {
      await moveDir(staging, target)
    } catch (error) {
      if (backup !== null) {
        // 换入失败：清掉可能的半截目标，把旧目录挪回去；恢复不了就留在 backup，
        // 绝不在失败路径上删掉用户原有的安装。
        await rm(target, { recursive: true, force: true }).catch(() => {})
        try {
          await rename(backup, target)
          backup = null
        } catch {
          // 旧目录保留在 `<target>.old-*`，等人工处理。
        }
      }
      throw marketError('disk-error', `写入技能目录失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (backup !== null) {
      await rm(backup, { recursive: true, force: true }).catch(() => {})
      backup = null
    }

    const state = await readState(dshHome)
    state.skills[id] = {
      id,
      dirName,
      ...(typeof detailResult.version === 'string' ? { version: detailResult.version } : {}),
      installedAt,
      source,
    }
    await writeState(dshHome, state)
    return {
      id,
      dirName,
      dir: target,
      ...(typeof detailResult.version === 'string' ? { version: detailResult.version } : {}),
      fileCount: files.length,
      replaced: replace,
    }
  } finally {
    // 成功时 staging 已被 rename 走（这里 force 忽略不存在）；失败时清掉半截目录。
    // backup 的清理只发生在上面的成功/恢复路径，失败且恢复不了时保留现场。
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}

// ── 自检 ────────────────────────────────────────────────────────────────────

/** JSON 响应快捷构造。 */
function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

/** 纯文本响应快捷构造。 */
function textResponse(value, status = 200) {
  return new Response(value, { status, headers: { 'content-type': 'text/plain' } })
}

/**
 * 造一个可注入 `fetchImpl` 的路由表：`match(url)` 命中后 `respond(url)` 出响应，
 * `broken` 置真时任何请求直接抛错（模拟上游整体故障），全程零真实网络。
 * @param routes - `[{ match, respond }]`，按顺序命中第一条。
 * @returns `{ fetchImpl, calls, broken }`；`calls` 记录每个请求 URL。
 */
function makeRouter(routes) {
  const state = { broken: false, calls: [] }
  const fetchImpl = async (url) => {
    const target = String(url)
    state.calls.push(target)
    if (state.broken) throw new Error('模拟上游故障')
    for (const route of routes) {
      if (route.match(target)) return await route.respond(target)
    }
    return new Response('no fixture', { status: 404 })
  }
  return { fetchImpl, state }
}

/**
 * 阶段 M2 自检：归一化/合并去重/游标/搜索过滤、缓存 TTL 与 stale-while-error、
 * 健康降级、详情与能力披露、安装全链路（成功/校验失败/路径穿越/超限/冲突/并发锁）、
 * 卸载兜底。全程 stub fetch + 临时目录，不打真网络、不碰真实 DSH_HOME。
 * 失败时 `process.exitCode = 1`。
 * @returns 已跑完全部用例（结果看打印与退出码）。
 */
export async function selftest() {
  const { mkdtemp: mkdtempCb, rm: rmCb, writeFile: writeCb, readFile: readCb, mkdir: mkdirCb, readdir: readdirCb } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  let cases = 0
  const failures = []
  const check = (label, ok, detail) => {
    cases += 1
    if (ok) {
      console.log(`✔ ${label}`)
    } else {
      const line = `✘ ${label}${detail === undefined ? '' : ` — ${detail}`}`
      failures.push(line)
      console.log(line)
    }
  }

  const sha = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
  const sandbox = await mkdtempCb(join(tmpdir(), 'bobo-market-selftest-'))
  try {
    // ── fixture ──
    const SKILL_MD_ALPHA = [
      '---',
      'name: alpha',
      'description: Use when (1) 需要演示安装，(2) 需要演示卸载。',
      '---',
      '',
      '# alpha',
      '',
      '```bash',
      'rm -rf ./build',
      '```',
      '',
    ].join('\n')
    const NOTES_MD = '# 补充说明\n'
    const BIG_TXT = 'x'.repeat(310 * 1024)
    const DELTA_MD = [
      '---',
      'name: delta',
      'description: 当需要写英文段落时使用。',
      '---',
      '',
      '# delta',
      '',
      '```sh',
      'curl https://api.mycorp.io/v1/ping',
      '```',
      '',
    ].join('\n')

    /** ClawHub 主路由：热门榜两页 + 搜索 + alpha 详情/版本/文件。 */
    const clawhubRoutes = () => [
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills' && !new URL(url).searchParams.has('cursor'),
        respond: () => jsonResponse({
          items: [
            { slug: 'alpha', displayName: 'Alpha 技能', summary: '演示用技能', topics: ['demo'], stats: { downloads: 100, installs: 5, stars: 9 }, ownerHandle: 'own-a', updatedAt: 1000, latestVersion: { version: '1.0.0' } },
            { slug: 'beta', displayName: 'Beta', summary: '第二个', topics: [], stats: { downloads: 50 }, ownerHandle: 'own-b', updatedAt: 900 },
          ],
          nextCursor: 'ch2',
        }),
      },
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills' && new URL(url).searchParams.get('cursor') === 'ch2',
        respond: () => jsonResponse({
          items: [{ slug: 'gamma', displayName: 'Gamma', stats: { downloads: 30 }, ownerHandle: 'own-c', updatedAt: 800 }],
        }),
      },
      {
        match: (url) => new URL(url).pathname === '/api/v1/search',
        respond: () => jsonResponse({
          results: [
            { slug: 'pdf', displayName: 'Pdf', summary: 'PDF 工具', downloads: 49917, ownerHandle: 'awspace', source: 'clawhub', install: { kind: 'clawhub' }, updatedAt: 5 },
            { slug: 'extlib', displayName: '外部聚合结果', source: 'github', install: { kind: 'github' } },
            { slug: 'legacy', displayName: 'Legacy', downloads: 10, ownerHandle: 'own-l' },
          ],
        }),
      },
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills/alpha',
        respond: () => jsonResponse({
          skill: { slug: 'alpha', displayName: 'Alpha 技能', summary: '演示用技能', description: SKILL_MD_ALPHA, topics: ['demo'], stats: { downloads: 100, installs: 5, stars: 9 }, updatedAt: 1000 },
          latestVersion: { version: '1.0.0', license: 'MIT', changelog: '首个版本', createdAt: 111 },
          owner: { handle: 'own-a', displayName: 'Own A' },
        }),
      },
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills/alpha/versions/1.0.0',
        respond: () => jsonResponse({
          version: {
            version: '1.0.0',
            license: 'MIT',
            files: [
              { path: 'SKILL.md', size: Buffer.byteLength(SKILL_MD_ALPHA), sha256: sha(SKILL_MD_ALPHA), contentType: 'text/markdown' },
              { path: 'refs/notes.md', size: Buffer.byteLength(NOTES_MD), sha256: sha(NOTES_MD) },
            ],
            security: { status: 'clean', hasWarnings: false },
          },
        }),
      },
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills/alpha/file' && new URL(url).searchParams.get('path') === 'SKILL.md',
        respond: () => textResponse(SKILL_MD_ALPHA),
      },
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills/alpha/file' && new URL(url).searchParams.get('path') === 'refs/notes.md',
        respond: () => textResponse(NOTES_MD),
      },
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills/alpha/file' && new URL(url).searchParams.get('path') === 'big.txt',
        respond: () => textResponse(BIG_TXT),
      },
    ]

    /** SkillHub 主路由：两页列表 + delta 详情/文件清单/文件。 */
    const skillhubRoutes = () => [
      {
        match: (url) => new URL(url).pathname === '/api/skills' && new URL(url).searchParams.has('keyword'),
        respond: () => jsonResponse({
          code: 0,
          data: {
            skills: [{ slug: 'pdf', name: 'Pdf 镜像', description: 'PDF 镜像', downloads: 49917, source: 'clawhub', upstream_url: 'https://clawhub.ai/awspace/pdf' }],
            total: 1,
          },
          message: 'success',
        }),
      },
      {
        match: (url) => new URL(url).pathname === '/api/skills' && new URL(url).searchParams.get('page') === '1' && !new URL(url).searchParams.has('keyword'),
        respond: () => jsonResponse({
          code: 0,
          data: {
            skills: [
              { slug: 'alpha', name: 'Alpha 镜像', description: '镜像条目', downloads: 100, ownerName: 'mirror-owner', subCategories: [{ name: '效率' }], source: 'clawhub', upstream_url: 'https://clawhub.ai/own-a/alpha', version: '1.0.0', updated_at: 1000 },
              { slug: 'delta', name: 'Delta 原生', description: '原生技能', downloads: 40, ownerName: 'own-d', subCategories: [{ name: '写作' }], version: '2.0.0', updated_at: 700, verified: true },
            ],
            total: 31,
          },
          message: 'success',
        }),
      },
      {
        match: (url) => new URL(url).pathname === '/api/skills' && new URL(url).searchParams.get('page') === '2' && !new URL(url).searchParams.has('keyword'),
        respond: () => jsonResponse({
          code: 0,
          data: { skills: [{ slug: 'epsilon', name: 'Epsilon', description: '第三页', downloads: 20, ownerName: 'own-e' }], total: 31 },
          message: 'success',
        }),
      },
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills/delta',
        respond: () => jsonResponse({
          skill: { slug: 'delta', displayName: 'Delta 原生', summary: 'Delta 的摘要', description: 'Delta 的摘要', category: 'writing', downloads: 40, ownerName: 'own-d', version: '2.0.0', updated_at: 700, verified: true, subCategories: [{ name: '写作' }] },
          owner: { handle: 'own-d', displayName: 'Owner D' },
          latestVersion: { version: '2.0.0', changelog: 'Initial release', createdAt: 700 },
          securityReports: { keen: { status: 'benign', statusText: '安全，无风险' }, sanbu: { status: 'safe' } },
        }),
      },
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills/delta/files',
        respond: () => jsonResponse({
          count: 2,
          files: [
            { path: 'SKILL.md', size: Buffer.byteLength(DELTA_MD), sha256: sha(DELTA_MD) },
            { path: 'helpers/run.py', size: 12, sha256: sha('print("hi")\n\n') },
          ],
        }),
      },
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills/delta/file' && new URL(url).searchParams.get('path') === 'SKILL.md',
        respond: () => textResponse(DELTA_MD),
      },
    ]

    // ── 1. id / 目录名 / 游标 / frontmatter 的纯函数 ──
    check('parseMarketId：合法 id 解析', JSON.stringify(parseMarketId('clawhub:pdf')) === '{"source":"clawhub","slug":"pdf"}')
    check('parseMarketId：未知 source 拒绝',
      (() => { try { parseMarketId('github:pdf'); return false } catch (error) { return /不合法/.test(String(error?.message)) } })())
    check('parseMarketId：空 slug 与越权 slug 拒绝',
      (() => { try { parseMarketId('clawhub:'); return false } catch { return true } })()
      && (() => { try { parseMarketId('clawhub:../evil'); return false } catch { return true } })())
    check('sanitizeDirName：小写化且拒绝 .. 与空串',
      sanitizeDirName('MySkill') === 'myskill' && sanitizeDirName('..bad') === null && sanitizeDirName('') === null)
    check('isMarketId：与 repo-core 同形', isMarketId('skillhub:alpha') && !isMarketId('alpha') && !isMarketId('clawhub:'))
    const roundtrip = decodeCursor(encodeCursor({ clawhub: 'c1', skillhub: '2' }))
    check('游标往返：base64url(JSON) 可还原', roundtrip?.clawhub === 'c1' && roundtrip?.skillhub === '2')
    check('游标：空对象编码为 null、坏游标按第一页',
      encodeCursor({}) === null && decodeCursor('!!!') === undefined && decodeCursor('') === undefined)
    const split = splitFrontmatter('---\nname: x\ndescription: 说明\ntriggers:\n  - 当 A 时\n  - 当 B 时\n---\n\n# 正文\n')
    check('splitFrontmatter：标量与列表都解析、正文保留',
      split.frontmatter.name === 'x' && split.frontmatter.description === '说明'
      && JSON.stringify(split.frontmatter.triggers) === '["当 A 时","当 B 时"]'
      && split.body.trim() === '# 正文', JSON.stringify(split))
    check('splitFrontmatter：无头文本整体为正文',
      splitFrontmatter('# 纯正文').frontmatter.name === undefined && splitFrontmatter('# 纯正文').body === '# 纯正文')
    check('computeUpdateAvailable：上游更新才提示',
      computeUpdateAvailable('1.1.0', '1.0.0') === true
      && computeUpdateAvailable('1.0.0', '1.0.0') === false
      && computeUpdateAvailable('1.0.0', '1.1.0') === false
      && computeUpdateAvailable('v2.0.0', '1.9.0') === true)
    check('computeUpdateAvailable：任一侧版本缺失或解析失败都降级为不提示',
      computeUpdateAvailable(undefined, '1.0.0') === false
      && computeUpdateAvailable('1.0.0', null) === false
      && computeUpdateAvailable('latest', '1.0.0') === false
      && computeUpdateAvailable('1.0.0', 'not-a-version') === false)

    // ── 2. 归一化 / 双源合并去重 / 游标分页 / 搜索过滤 ──
    const homeMain = join(sandbox, 'home-main')
    await mkdirCb(homeMain, { recursive: true })
    const clock = { t: 1_700_000_000_000 }
    const main = makeRouter([...clawhubRoutes(), ...skillhubRoutes()])
    const m1 = createMarket({ dshHome: homeMain, fetchImpl: main.fetchImpl, now: () => clock.t })

    const page1 = await m1.search('market', '', '')
    check('合并首页：双源条目按 downloads 降序',
      page1.items.map((item) => item.id).join(',') === 'clawhub:alpha,clawhub:beta,skillhub:delta',
      JSON.stringify(page1.items.map((item) => [item.id, item.stats.downloads])))
    check('归一化：ClawHub 条目带 owner/版本/标签',
      page1.items[0]?.author.handle === 'own-a' && page1.items[0]?.version === '1.0.0'
      && JSON.stringify(page1.items[0]?.tags) === '["demo"]', JSON.stringify(page1.items[0]))
    check('归一化：SkillHub 条目带分类标签与 verified 状态',
      page1.items[2]?.id === 'skillhub:delta' && JSON.stringify(page1.items[2]?.tags) === '["写作"]'
      && page1.items[2]?.securityStatus === 'verified', JSON.stringify(page1.items[2]))
    const alphaRow = page1.items[0]
    check('跨源去重：SkillHub 镜像被 ClawHub 条目吸收',
      alphaRow?.mirrors !== undefined && alphaRow.mirrors.includes('skillhub:alpha')
      && !page1.items.some((item) => item.id === 'skillhub:alpha'),
      JSON.stringify(page1.items.map((item) => item.id)))
    check('合并首页：双源状态 ok 且带游标',
      SOURCE_STATUS.includes(page1.sources.clawhub) && page1.sources.clawhub === 'ok'
      && page1.sources.skillhub === 'ok' && typeof page1.nextCursor === 'string',
      JSON.stringify(page1.sources))
    const page1Again = await m1.search('market', '', '')
    check('缓存命中：重复首页不重新请求且 mirrors 不叠加',
      main.state.calls.length === 2
      && page1Again.items[0]?.mirrors?.length === 1,
      `calls=${main.state.calls.length}, mirrors=${JSON.stringify(page1Again.items[0]?.mirrors)}`)

    const page2 = await m1.search('market', '', page1.nextCursor)
    check('第二页：ClawHub 翻新页、SkillHub 按游标翻页',
      page2.items.map((item) => item.id).join(',') === 'clawhub:gamma,skillhub:epsilon',
      JSON.stringify(page2.items.map((item) => item.id)))
    check('第二页：双源都翻完后 nextCursor 为 null', page2.nextCursor === null, String(page2.nextCursor))

    const searched = await m1.search('market', 'pdf', '')
    check('搜索：ClawHub 外部聚合结果被过滤、原生结果保留',
      searched.items.some((item) => item.id === 'clawhub:pdf')
      && !searched.items.some((item) => item.id === 'clawhub:extlib'),
      JSON.stringify(searched.items.map((item) => item.id)))
    check('搜索：双源去重后 ClawHub 胜出并带镜像',
      searched.items.length === 2 && searched.items[0]?.id === 'clawhub:pdf'
      && searched.items[0]?.mirrors?.includes('skillhub:pdf'),
      JSON.stringify(searched.items.map((item) => item.id)))
    let scopeError = null
    try {
      await m1.search('catalog', '', '')
    } catch (caught) {
      scopeError = caught
    }
    check('搜索：非 market scope 拒绝', scopeError !== null && /未知 scope/.test(String(scopeError?.message)),
      scopeError?.message)

    // ── 3. 缓存 TTL 与 stale-while-error ──
    const callsBefore = main.state.calls.length
    clock.t += MARKET_TTL.list + 1
    await m1.search('market', '', '')
    check('TTL：列表过期后重新请求双源',
      main.state.calls.length === callsBefore + 2, `calls ${callsBefore} → ${main.state.calls.length}`)
    clock.t += MARKET_TTL.list + 1
    main.state.broken = true
    const stalePage = await m1.search('market', '', '')
    check('stale-while-error：上游挂了返回过期缓存并标 cached',
      stalePage.items.length === 3 && stalePage.sources.clawhub === 'cached' && stalePage.sources.skillhub === 'cached',
      JSON.stringify(stalePage.sources))
    check('健康：连续失败后两源 degraded',
      m1.status().sources.clawhub.status === 'degraded' && m1.status().sources.skillhub.status === 'degraded',
      JSON.stringify(m1.status().sources))
    const freshBroken = makeRouter([])
    freshBroken.state.broken = true
    const mBroken = createMarket({ dshHome: homeMain, fetchImpl: freshBroken.fetchImpl, now: () => clock.t })
    let bothFail = null
    try {
      await mBroken.search('market', '', '')
    } catch (caught) {
      bothFail = caught
    }
    check('双源全挂且无缓存：抛错而不是返回空表',
      bothFail !== null && /均拉取失败/.test(String(bothFail?.message)), bothFail?.message)
    check('健康：从未成功过的源直接 failed',
      mBroken.status().sources.clawhub.status === 'failed' && mBroken.status().sources.skillhub.status === 'failed',
      JSON.stringify(mBroken.status().sources))
    main.state.broken = false

    // 部分失败：SkillHub 挂、ClawHub 活 → 返回 ClawHub 数据 + skillhub failed。
    const partial = makeRouter([...clawhubRoutes()])
    const mPartialSkillhub = createMarket({
      dshHome: homeMain,
      now: () => clock.t,
      fetchImpl: async (url) => {
        if (String(url).includes('skillhub')) throw new Error('skillhub 模拟故障')
        return partial.fetchImpl(url)
      },
    })
    const partialPage = await mPartialSkillhub.search('market', '', '')
    check('部分失败：单源故障仍返回另一源数据并报告 failed',
      partialPage.sources.clawhub === 'ok' && partialPage.sources.skillhub === 'failed'
      && partialPage.items.every((item) => item.source === 'clawhub'),
      JSON.stringify(partialPage.sources))

    // 重试：500 后第二次成功。
    let retried = 0
    const retryRouter = makeRouter([
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills',
        respond: () => {
          retried += 1
          return retried === 1 ? new Response('boom', { status: 500 }) : jsonResponse({ items: [] })
        },
      },
      {
        match: (url) => new URL(url).pathname === '/api/skills',
        respond: () => jsonResponse({ code: 0, data: { skills: [], total: 0 } }),
      },
    ])
    const mRetry = createMarket({ dshHome: homeMain, fetchImpl: retryRouter.fetchImpl, now: () => clock.t })
    const retriedPage = await mRetry.search('market', '', '')
    check('providerFetch：5xx 重试 1 次后成功且源回 ok',
      retriedPage.sources.clawhub === 'ok' && retried === 2
      && mRetry.status().sources.clawhub.status === 'ok',
      `attempts=${retried}, sources=${JSON.stringify(retriedPage.sources)}`)

    // ── 4. 详情 / 文件预览 / 能力披露 ──
    const alphaDetail = await m1.detail('clawhub:alpha')
    check('详情：文件清单带 sha256、totalSize 合计',
      alphaDetail.files.length === 2 && typeof alphaDetail.files[0].sha256 === 'string'
      && alphaDetail.files[0].path === 'SKILL.md'
      && alphaDetail.totalSize === Buffer.byteLength(SKILL_MD_ALPHA) + Buffer.byteLength(NOTES_MD),
      JSON.stringify(alphaDetail.files))
    check('详情：SKILL.md 正文与去头后的 description 分开返回',
      alphaDetail.skillMd === SKILL_MD_ALPHA && alphaDetail.description.includes('# alpha')
      && !alphaDetail.description.startsWith('---'), JSON.stringify(alphaDetail.description.slice(0, 40)))
    check('详情：版本/许可证/安全状态来自版本接口',
      alphaDetail.version === '1.0.0' && alphaDetail.license === 'MIT' && alphaDetail.securityStatus === 'benign',
      JSON.stringify({ version: alphaDetail.version, license: alphaDetail.license, securityStatus: alphaDetail.securityStatus }))
    check('详情：何时触发从 description 句式提取',
      JSON.stringify(alphaDetail.triggers) === '["需要演示安装","需要演示卸载"]',
      JSON.stringify(alphaDetail.triggers))
    check('详情：能力披露命中 shell 与 writes 且带证据与中文标签',
      alphaDetail.capabilities.map((cap) => cap.kind).join(',') === 'shell,writes'
      && alphaDetail.capabilities[0].evidence.includes('rm')
      && alphaDetail.capabilities[0].severity === 'high'
      && alphaDetail.capabilities[0].label === '执行 Shell 命令',
      JSON.stringify(alphaDetail.capabilities))
    check('详情：未安装时 installState=installable', alphaDetail.installState === 'installable', alphaDetail.installState)
    check('详情：未安装时 updateAvailable=false', alphaDetail.updateAvailable === false,
      JSON.stringify(alphaDetail.updateAvailable))
    const detailCallsBefore = main.state.calls.length
    const alphaDetailAgain = await m1.detail('clawhub:alpha')
    check('详情缓存：第二次不再请求上游',
      main.state.calls.length === detailCallsBefore && alphaDetailAgain.id === 'clawhub:alpha',
      `calls ${detailCallsBefore} → ${main.state.calls.length}`)

    const deltaDetail = await m1.detail('skillhub:delta')
    check('SkillHub 详情：安全报告 → verified、SKILL.md 正文拉取',
      deltaDetail.securityStatus === 'verified' && deltaDetail.skillMd === DELTA_MD
      && deltaDetail.author.handle === 'own-d' && deltaDetail.version === '2.0.0',
      JSON.stringify({ securityStatus: deltaDetail.securityStatus, author: deltaDetail.author, version: deltaDetail.version }))
    check('SkillHub 详情：网络证据来自代码块（排除文档域）',
      deltaDetail.capabilities.some((cap) => cap.kind === 'network' && cap.evidence.includes('api.mycorp.io')),
      JSON.stringify(deltaDetail.capabilities))

    const preview = await m1.file('clawhub:alpha', 'refs/notes.md')
    check('文件预览：内容/语言/字节数',
      preview.content === NOTES_MD && preview.language === 'markdown'
      && preview.size === Buffer.byteLength(NOTES_MD) && preview.truncated === false,
      JSON.stringify({ language: preview.language, size: preview.size, truncated: preview.truncated }))
    const bigPreview = await m1.file('clawhub:alpha', 'big.txt')
    check('文件预览：超 300KB 截断且 size 保留完整字节',
      bigPreview.truncated === true && bigPreview.content.length === MARKET_LIMITS.previewTruncateBytes
      && bigPreview.size === BIG_TXT.length,
      JSON.stringify({ truncated: bigPreview.truncated, len: bigPreview.content.length, size: bigPreview.size }))
    let unsafePathError = null
    try {
      await m1.file('clawhub:alpha', '../etc/passwd')
    } catch (caught) {
      unsafePathError = caught
    }
    check('文件预览：路径穿越拒绝', unsafePathError !== null && /不安全/.test(String(unsafePathError?.message)),
      unsafePathError?.message)

    // ── 5. 能力披露规则逐类命中与零命中 ──
    const capShell = detectCapabilities('```bash\nrm -rf ./build\n```', [])
    check('能力披露：shell 命中', capShell[0]?.kind === 'shell' && capShell[0].evidence.includes('rm'), JSON.stringify(capShell))
    const capHooks = detectCapabilities('', [{ path: 'hooks/pre.py' }])
    check('能力披露：hooks 命中（目录算一条）',
      capHooks.length === 1 && capHooks[0].kind === 'hooks' && capHooks[0].evidence[0]?.includes('hooks/'),
      JSON.stringify(capHooks))
    const capSecrets = detectCapabilities('export ACME_API_KEY=1', [])
    check('能力披露：secrets 命中', capSecrets.some((cap) => cap.kind === 'secrets' && cap.evidence.includes('ACME_API_KEY')),
      JSON.stringify(capSecrets))
    const capNetwork = detectCapabilities('```sh\ncurl https://api.mycorp.io/v1\n```', [])
    check('能力披露：network 命中且文档域被排除',
      capNetwork.some((cap) => cap.kind === 'network' && cap.evidence.includes('api.mycorp.io'))
      && !detectCapabilities('```sh\nopen https://github.com/x\n```', []).some((cap) => cap.kind === 'network'),
      JSON.stringify(capNetwork))
    const capWrites = detectCapabilities('```bash\nmkdir -p out/report\n```', [])
    check('能力披露：writes 命中并报目录',
      capWrites.some((cap) => cap.kind === 'writes' && cap.evidence.includes('out/')), JSON.stringify(capWrites))
    const capNone = detectCapabilities('# 只有说明文字\n普通段落，无命令。\n', [{ path: 'SKILL.md' }, { path: 'notes.md' }])
    check('能力披露：零命中返回空数组', Array.isArray(capNone) && capNone.length === 0, JSON.stringify(capNone))
    check('extractTriggers：识别不出返回空', extractTriggers('随便一句没有触发句式的话').length === 0)

    // ── 6. 安装全链路 ──
    const homeInstall = join(sandbox, 'home-install')
    await mkdirCb(homeInstall, { recursive: true })
    const installRouter = makeRouter([...clawhubRoutes(), ...skillhubRoutes()])
    const mInstall = createMarket({ dshHome: homeInstall, fetchImpl: installRouter.fetchImpl, now: () => clock.t })

    const installed = await mInstall.installTo('clawhub:alpha')
    check('installTo：落盘 SKILL.md 与引用文件',
      installed.dirName === 'alpha' && installed.fileCount === 2 && installed.replaced === false
      && existsSync(join(homeInstall, 'skills', 'alpha', 'SKILL.md'))
      && existsSync(join(homeInstall, 'skills', 'alpha', 'refs', 'notes.md')),
      JSON.stringify(installed))
    const installMeta = JSON.parse(await readCb(join(homeInstall, 'skills', 'alpha', '.market-meta.json'), 'utf8'))
    check('installTo：.market-meta.json 字段齐全',
      installMeta.id === 'clawhub:alpha' && installMeta.source === 'clawhub' && installMeta.slug === 'alpha'
      && installMeta.version === '1.0.0' && installMeta.fileCount === 2 && typeof installMeta.installedAt === 'string',
      JSON.stringify(installMeta))
    const installStateDoc = JSON.parse(await readCb(join(homeInstall, '.bobo-market', 'state.json'), 'utf8'))
    check('installTo：state skills 桶记录 dirName/version/source',
      installStateDoc.skills['clawhub:alpha']?.dirName === 'alpha'
      && installStateDoc.skills['clawhub:alpha']?.version === '1.0.0'
      && installStateDoc.skills['clawhub:alpha']?.source === 'clawhub',
      JSON.stringify(installStateDoc.skills))
    const stagingLeft = await readdirCb(join(homeInstall, '.bobo-market', 'tmp')).catch(() => ['<missing>'])
    check('installTo：staging 清理干净', stagingLeft.length === 0, JSON.stringify(stagingLeft))
    const installedDetail = await mInstall.detail('clawhub:alpha')
    check('installTo：详情安装态变 installed 且带 installedInfo',
      installedDetail.installState === 'installed' && installedDetail.installedInfo?.dirName === 'alpha',
      JSON.stringify({ installState: installedDetail.installState, installedInfo: installedDetail.installedInfo }))
    check('详情：已装同版本 updateAvailable=false',
      installedDetail.updateAvailable === false && installedDetail.installedInfo?.version === '1.0.0',
      JSON.stringify({ updateAvailable: installedDetail.updateAvailable, installedInfo: installedDetail.installedInfo }))
    const installedMetaPath = join(homeInstall, 'skills', 'alpha', '.market-meta.json')
    const installedMeta = JSON.parse(await readCb(installedMetaPath, 'utf8'))
    installedMeta.version = '0.9.0'
    await writeCb(installedMetaPath, `${JSON.stringify(installedMeta, null, 2)}\n`)
    const staleInstalled = await mInstall.detail('clawhub:alpha')
    check('详情：已装版本落后于上游 → updateAvailable=true',
      staleInstalled.updateAvailable === true && staleInstalled.installedInfo?.version === '0.9.0',
      JSON.stringify({ updateAvailable: staleInstalled.updateAvailable, installedInfo: staleInstalled.installedInfo }))
    installedMeta.version = 'not-a-version'
    await writeCb(installedMetaPath, `${JSON.stringify(installedMeta, null, 2)}\n`)
    const unparsableInstalled = await mInstall.detail('clawhub:alpha')
    check('详情：已装版本解析失败 → 不提示更新',
      unparsableInstalled.updateAvailable === false,
      JSON.stringify({ updateAvailable: unparsableInstalled.updateAvailable, installedInfo: unparsableInstalled.installedInfo }))
    installedMeta.version = '1.0.0'
    await writeCb(installedMetaPath, `${JSON.stringify(installedMeta, null, 2)}\n`)

    // 覆盖更新：用一个内容可变的独立安装实例——v1 多一个文件，换成 v2 后旧文件消失、内容更新。
    const homeUpdate = join(sandbox, 'home-update')
    await mkdirCb(homeUpdate, { recursive: true })
    let updateBody = '# v1\n'
    let updateHasOldFile = true
    const updateSha = () => sha(updateBody)
    const updateRouter = makeRouter([
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills/upd',
        respond: () => jsonResponse({
          skill: { slug: 'upd', displayName: 'Upd', summary: '更新演示', description: `---\nname: upd\ndescription: 更新演示。\n---\n\n${updateBody}`, stats: { downloads: 1 }, ownerHandle: 'own-u', updatedAt: 1 },
          latestVersion: { version: '1.0.0', changelog: '', createdAt: 1 },
          owner: { handle: 'own-u' },
        }),
      },
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills/upd/versions/1.0.0',
        respond: () => jsonResponse({
          version: {
            version: '1.0.0',
            files: [
              { path: 'SKILL.md', size: Buffer.byteLength(updateBody), sha256: updateSha() },
              ...(updateHasOldFile ? [{ path: 'old-only.txt', size: 4, sha256: sha('old\n') }] : []),
            ],
          },
        }),
      },
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills/upd/file' && new URL(url).searchParams.get('path') === 'SKILL.md',
        respond: () => textResponse(updateBody),
      },
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills/upd/file' && new URL(url).searchParams.get('path') === 'old-only.txt',
        respond: () => textResponse('old\n'),
      },
    ])
    const mUpdate = createMarket({ dshHome: homeUpdate, fetchImpl: updateRouter.fetchImpl, now: () => clock.t })
    await mUpdate.installTo('clawhub:upd')
    check('覆盖更新：首装落两个文件', existsSync(join(homeUpdate, 'skills', 'upd', 'old-only.txt')))
    updateBody = '# v2 内容\n'
    updateHasOldFile = false
    mUpdate.clearCache()
    const updated = await marketInstallTo(mUpdate, 'clawhub:upd')
    check('覆盖更新：再次安装 replaced=true、旧文件被移除、内容更新',
      updated.replaced === true
      && !existsSync(join(homeUpdate, 'skills', 'upd', 'old-only.txt'))
      && (await readCb(join(homeUpdate, 'skills', 'upd', 'SKILL.md'), 'utf8')) === updateBody,
      JSON.stringify(updated))

    // sha256 不匹配：中止且不留残目录。
    const homeSha = join(sandbox, 'home-sha')
    await mkdirCb(homeSha, { recursive: true })
    const shaRouter = makeRouter([
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills/badsha',
        respond: () => jsonResponse({
          skill: { slug: 'badsha', displayName: 'BadSha', summary: '坏摘要', description: '---\nname: badsha\ndescription: x\n---\n正文', stats: { downloads: 1 }, ownerHandle: 'own-x' },
          latestVersion: { version: '1.0.0' },
          owner: { handle: 'own-x' },
        }),
      },
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills/badsha/versions/1.0.0',
        respond: () => jsonResponse({
          version: { version: '1.0.0', files: [{ path: 'SKILL.md', size: 10, sha256: 'deadbeef'.repeat(8) }] },
        }),
      },
      {
        match: (url) => new URL(url).pathname === '/api/v1/skills/badsha/file',
        respond: () => textResponse('---\nname: badsha\ndescription: x\n---\n正文'),
      },
    ])
    const mSha = createMarket({ dshHome: homeSha, fetchImpl: shaRouter.fetchImpl, now: () => clock.t })
    let shaError = null
    try {
      await mSha.installTo('clawhub:badsha')
    } catch (caught) {
      shaError = caught
    }
    check('安装：sha256 不匹配中止（checksum-mismatch）',
      shaError !== null && /checksum-mismatch/.test(String(shaError?.message)), shaError?.message)
    check('安装：失败后无残目录、staging 清空',
      !existsSync(join(homeSha, 'skills', 'badsha'))
      && (await readdirCb(join(homeSha, '.bobo-market', 'tmp')).catch(() => ['<missing>'])).length === 0,
      JSON.stringify(await readdirCb(join(homeSha, 'skills')).catch(() => ['<missing>'])))

    // 清单级拒绝：路径穿越 / 缺 SKILL.md / 文件数 / 单文件超限 / 总量超限。
    const rejectCase = async (label, slug, files, expect) => {
      const home = join(sandbox, `home-${slug}`)
      await mkdirCb(home, { recursive: true })
      const router = makeRouter([
        {
          match: (url) => new URL(url).pathname === `/api/v1/skills/${slug}`,
          respond: () => jsonResponse({
            skill: { slug, displayName: slug, summary: 'x', description: '---\nname: x\ndescription: x\n---\n', stats: { downloads: 1 }, ownerHandle: 'own-r' },
            latestVersion: { version: '1.0.0' },
            owner: { handle: 'own-r' },
          }),
        },
        {
          match: (url) => new URL(url).pathname === `/api/v1/skills/${slug}/versions/1.0.0`,
          respond: () => jsonResponse({ version: { version: '1.0.0', files } }),
        },
        {
          match: (url) => new URL(url).pathname === `/api/v1/skills/${slug}/file`,
          respond: () => textResponse('内容'),
        },
      ])
      const market = createMarket({ dshHome: home, fetchImpl: router.fetchImpl, now: () => clock.t })
      let caught = null
      try {
        await market.installTo(`clawhub:${slug}`)
      } catch (error) {
        caught = error
      }
      const tmpLeft = await readdirCb(join(home, '.bobo-market', 'tmp')).catch(() => [])
      check(label, caught !== null && expect.test(String(caught?.message)) && tmpLeft.length === 0,
        `${caught?.message}；tmp=${JSON.stringify(tmpLeft)}`)
      return home
    }
    const homeTraversal = await rejectCase('安装：清单路径穿越拒绝（unsafe-path）',
      'slip', [{ path: '../escape.txt', size: 4 }, { path: 'SKILL.md', size: 4 }], /unsafe-path/)
    check('安装：路径穿越没有落越权文件',
      !existsSync(join(homeTraversal, 'escape.txt'))
      && !existsSync(join(homeTraversal, 'skills', 'escape.txt')))
    await rejectCase('安装：缺根部 SKILL.md 拒绝（empty-file-list）',
      'noskill', [{ path: 'refs/notes.md', size: 4 }], /empty-file-list/)
    const manyFiles = Array.from({ length: 201 }, (_, index) => ({ path: `f${index}.txt`, size: 1 }))
    manyFiles.push({ path: 'SKILL.md', size: 4 })
    await rejectCase('安装：文件数超限拒绝（too-many-files）', 'many', manyFiles, /too-many-files/)
    await rejectCase('安装：单文件超限拒绝（file-too-large）',
      'bigsingle', [{ path: 'SKILL.md', size: MARKET_LIMITS.maxFileSize + 1 }], /file-too-large/)
    const heavyFiles = Array.from({ length: 5 }, (_, index) => ({ path: `chunk${index}.bin`, size: 5 * 1024 * 1024 }))
    heavyFiles.push({ path: 'SKILL.md', size: 10 })
    await rejectCase('安装：总体积超限拒绝（file-too-large）', 'heavy', heavyFiles, /file-too-large/)

    // 名字冲突：目标无 meta / meta 归属他方。
    const homeConflict = join(sandbox, 'home-conflict')
    await mkdirCb(join(homeConflict, 'skills', 'alpha'), { recursive: true })
    await writeCb(join(homeConflict, 'skills', 'alpha', 'manual.txt'), '手工放的')
    const conflictRouter = makeRouter([...clawhubRoutes()])
    const mConflict = createMarket({ dshHome: homeConflict, fetchImpl: conflictRouter.fetchImpl, now: () => clock.t })
    let conflictError = null
    try {
      await mConflict.installTo('clawhub:alpha')
    } catch (caught) {
      conflictError = caught
    }
    check('安装：目标目录无 meta 报 name-conflict 且不覆盖',
      conflictError !== null && /name-conflict/.test(String(conflictError?.message))
      && (await readCb(join(homeConflict, 'skills', 'alpha', 'manual.txt'), 'utf8')) === '手工放的',
      conflictError?.message)
    // meta 归属他方（如本目录是别的 id 装的）同样拒绝。
    await writeCb(join(homeConflict, 'skills', 'alpha', '.market-meta.json'),
      `${JSON.stringify({ id: 'skillhub:alpha', source: 'skillhub', slug: 'alpha', installedAt: 'now', fileCount: 1 }, null, 2)}\n`)
    conflictError = null
    try {
      await mConflict.installTo('clawhub:alpha')
    } catch (caught) {
      conflictError = caught
    }
    check('安装：meta 归属他方也报 name-conflict',
      conflictError !== null && /name-conflict/.test(String(conflictError?.message)), conflictError?.message)

    // 并发锁：同一 id 第二次安装立即报 in-progress。
    const homeLock = join(sandbox, 'home-lock')
    await mkdirCb(homeLock, { recursive: true })
    const lockRouter = makeRouter([...clawhubRoutes()])
    const mLock = createMarket({ dshHome: homeLock, fetchImpl: lockRouter.fetchImpl, now: () => clock.t })
    const firstInstall = mLock.installTo('clawhub:alpha')
    let lockError = null
    try {
      await mLock.installTo('clawhub:alpha')
    } catch (caught) {
      lockError = caught
    }
    const firstResult = await firstInstall
    check('并发锁：第二次安装报 in-progress',
      lockError !== null && /in-progress/.test(String(lockError?.message)), lockError?.message)
    check('并发锁：第一次安装照常完成', firstResult.dirName === 'alpha' && firstResult.fileCount === 2,
      JSON.stringify(firstResult))
    let invalidInstallId = null
    try {
      await marketInstallTo(mLock, 'clawhub:../evil')
    } catch (caught) {
      invalidInstallId = caught
    }
    check('安装：非法 id 在动盘前拒绝', invalidInstallId !== null && /不合法/.test(String(invalidInstallId?.message)),
      invalidInstallId?.message)

    // ── 7. 卸载兜底（带 : 的 id 走 state → meta 校验）──
    const { uninstallSkill, listInstalled } = await import('./repo-core.mjs')
    const uninstalled = await uninstallSkill({ id: 'clawhub:alpha', dshHome: homeLock })
    check('卸载兜底：市场 id 按 state 定位目录并删除',
      uninstalled.id === 'clawhub:alpha' && uninstalled.dirName === 'alpha'
      && !existsSync(join(homeLock, 'skills', 'alpha')),
      JSON.stringify(uninstalled))
    const listedAfterInstall = await listInstalled({ dshHome: homeLock })
    check('卸载兜底：卸载后列表不再有该市场条目',
      !listedAfterInstall.skills.some((item) => item.id === 'clawhub:alpha'),
      JSON.stringify(listedAfterInstall.skills))
    const homeGhost = join(sandbox, 'home-ghost')
    await mkdirCb(join(homeGhost, '.bobo-market'), { recursive: true })
    await writeCb(join(homeGhost, '.bobo-market', 'state.json'),
      `${JSON.stringify({ presets: {}, tools: {}, skills: { 'clawhub:ghost': { id: 'clawhub:ghost', dirName: 'ghost', source: 'clawhub' } }, categories: {} }, null, 2)}\n`)
    await mkdirCb(join(homeGhost, 'skills', 'ghost'), { recursive: true })
    await writeCb(join(homeGhost, 'skills', 'ghost', 'SKILL.md'), '手工放的，没有 meta')
    let ghostError = null
    try {
      await uninstallSkill({ id: 'clawhub:ghost', dshHome: homeGhost })
    } catch (caught) {
      ghostError = caught
    }
    check('卸载兜底：state 有记录但目录无 meta 报 notManaged 且目录保留',
      ghostError !== null && /notManaged/.test(String(ghostError?.message))
      && existsSync(join(homeGhost, 'skills', 'ghost', 'SKILL.md')), ghostError?.message)
    let noStateError = null
    try {
      await uninstallSkill({ id: 'clawhub:nostate', dshHome: homeGhost })
    } catch (caught) {
      noStateError = caught
    }
    check('卸载兜底：state 无记录报 notManaged',
      noStateError !== null && /notManaged/.test(String(noStateError?.message)), noStateError?.message)

    // ── 8. frontmatter 规范化（上游发现器要求 name/description 非空 + name kebab）──
    // 每个用例换一个干净的家与一份 stub 路由：normBody 是当前用例的上游 SKILL.md，
    // versions/file 两条路由都在响应时取它，sha 随之计算。
    let normBody = ''
    const runNormInstall = async (label) => {
      const home = join(sandbox, `home-norm-${label}`)
      await mkdirCb(home, { recursive: true })
      const router = makeRouter([
        {
          match: (url) => new URL(url).pathname === '/api/v1/skills/norm',
          respond: () => jsonResponse({
            skill: { slug: 'norm', displayName: 'Norm', summary: '市场摘要文本', description: '占位正文', stats: { downloads: 1 }, ownerHandle: 'own-n' },
            latestVersion: { version: '1.0.0' },
            owner: { handle: 'own-n' },
          }),
        },
        {
          match: (url) => new URL(url).pathname === '/api/v1/skills/norm/versions/1.0.0',
          respond: () => jsonResponse({
            version: {
              version: '1.0.0',
              files: [{ path: 'SKILL.md', size: Buffer.byteLength(normBody), sha256: sha(normBody) }],
            },
          }),
        },
        {
          match: (url) => new URL(url).pathname === '/api/v1/skills/norm/file',
          respond: () => textResponse(normBody),
        },
      ])
      const market = createMarket({ dshHome: home, fetchImpl: router.fetchImpl, now: () => clock.t })
      await market.installTo('clawhub:norm')
      const text = await readCb(join(home, 'skills', 'norm', 'SKILL.md'), 'utf8')
      const meta = JSON.parse(await readCb(join(home, 'skills', 'norm', '.market-meta.json'), 'utf8'))
      return { text, meta }
    }

    // name 不合规（带空格大写，上游 isSkillName 直接丢弃）+ CRLF：只换 name 一行。
    normBody = [
      '---',
      'name: "Investment Researcher Digital Employee"',
      'description: 原有描述。',
      '---',
      '',
      '# 正文不动',
    ].join('\r\n')
    const normA = await runNormInstall('a')
    const expectedA = normBody.replace('name: "Investment Researcher Digital Employee"', 'name: norm')
    check('规范化：name 不合规改写为目录名，其余字节（CRLF/引号风格/正文）不变',
      normA.text === expectedA, JSON.stringify(normA.text.slice(0, 140)))
    check('规范化：meta 记 originalName 为改写前的原值',
      normA.meta.originalName === 'Investment Researcher Digital Employee', JSON.stringify(normA.meta))

    // 两值都已合规：字节零改动，meta 不带新键（形状向后兼容）。
    normBody = ['---', 'name: norm', 'description: 有描述。', '---', '', '# 正文'].join('\n')
    const normB = await runNormInstall('b')
    check('规范化：已合规 → SKILL.md 字节不变且 meta 无 originalName/normalized',
      normB.text === normBody && !('originalName' in normB.meta) && !('normalized' in normB.meta),
      JSON.stringify({ text: normB.text, meta: normB.meta }))

    // name 缺失：frontmatter 顶部按文件换行符插入，originalName 记 null。
    normBody = ['---', 'description: 有描述。', '---', '', '# 正文'].join('\n')
    const normC = await runNormInstall('c')
    const expectedC = ['---', 'name: norm', 'description: 有描述。', '---', '', '# 正文'].join('\n')
    check('规范化：name 缺失 → 顶部插入且其余不变、originalName=null',
      normC.text === expectedC && normC.meta.originalName === null,
      JSON.stringify({ text: normC.text, originalName: normC.meta.originalName }))

    // description 缺失：插入详情摘要（带引号的双引号标量），name 未动也留痕 originalName。
    normBody = ['---', 'name: norm', '---', '', '# 正文'].join('\n')
    const normD = await runNormInstall('d')
    const expectedD = ['---', `description: ${JSON.stringify('市场摘要文本')}`, 'name: norm', '---', '', '# 正文'].join('\n')
    check('规范化：description 缺失 → 用详情摘要插入、originalName 记原 name',
      normD.text === expectedD && normD.meta.originalName === 'norm',
      JSON.stringify({ text: normD.text, originalName: normD.meta.originalName }))

    // 幂等：对已规范化的文本再跑一次零变化。
    const again = normalizeSkillFrontmatter(normA.text, { name: 'norm', description: '市场摘要文本' })
    const againD = normalizeSkillFrontmatter(normD.text, { name: 'norm', description: '市场摘要文本' })
    check('规范化：已规范化的文本再跑一次零变化（幂等）',
      again.changed === false && again.text === normA.text
      && againD.changed === false && againD.text === normD.text,
      JSON.stringify({ again: again.changed, againD: againD.changed }))

    // 无 frontmatter 头：照常安装（装得上，可见性由上游规则决定）、字节不变、meta 留痕。
    normBody = ['# 没有 frontmatter 的技能', '', '正文。'].join('\n')
    const normF = await runNormInstall('f')
    check('规范化：无 frontmatter 头 → 照常安装、字节不变、meta 记 normalized:no-frontmatter',
      normF.text === normBody && normF.meta.normalized === 'no-frontmatter' && !('originalName' in normF.meta),
      JSON.stringify({ meta: normF.meta }))
  } catch (error) {
    failures.push(`✘ 自检过程异常：${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    console.error(failures.at(-1))
  } finally {
    await rmCb(sandbox, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    console.error(`market-core selftest 失败：${failures.length}/${cases} 项`)
    process.exitCode = 1
    return
  }
  console.log(`market-core selftest 通过：${cases} 个用例`)
}

// 直接 `node market-core.mjs --selftest` 时自跑（与同目录插件同款入口约定）。
const invokedDirectly = await (async () => {
  if (process.argv[1] === undefined) return false
  return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
})()
if (invokedDirectly && process.argv.includes('--selftest')) await selftest()
