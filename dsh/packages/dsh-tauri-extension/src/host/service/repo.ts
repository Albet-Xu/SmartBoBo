import type { RepoCatalog, RepoCategoryReceipt, RepoDetail, RepoEntry, RepoInstallReceipt, RepoScopeReceipt, RepoUninstallReceipt } from './repo.types'
import type { RepoIndex, RepoIndexEntry, RepoNs } from './repo/repo-core.mjs'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineService, DSH_HOME } from 'dsh-tauri'
import { dirname, join, resolve } from 'pathe'
import {
  setCategory as coreSetCategory,
  setScope as coreSetScope,
  download,
  fetchIndex,
  installPreset,
  installSkill,
  installTool,
  listInstalled,
  mergeListing,
  readDetailCache,
  satisfyRequires,
  uninstallPreset,
  uninstallSkill,
  uninstallTool,
  writeDetailCache,
} from './repo/repo-core.mjs'

const BASE_URL: string = 'http://47.102.138.180'

const TOKEN: string = '550b1a7e3635e6b2b4851b18da514177'

const REPO_ROOT = process.env.BOBO_ROOT ?? dirname(DSH_HOME)

const BOBO_ROOT = join(REPO_ROOT, 'bobo')

const RESOLVE_FROM: string[] = kernelResolveAnchors()

const indexCache = new Map<RepoNs, { at: number, doc: RepoIndex }>()

export const repo = defineService({
  async list(ns: RepoNs): Promise<RepoCatalog> {
    const index = await loadIndex(ns)
    const installed = await listInstalled({ dshHome: DSH_HOME })
    const rows = mergeListing({ ns, indexEntries: index.doc.plugins, installed, categories: installed.categories })
    // 已提供工具集 = 市场已装工具 id + 本地 bobo/ 包名（预设可 file:/// 直挂本地包，
    // 包名即 npm name，如 bobo-crawl-tool = bobo/tool-acquisition）。不过滤的话，
    // 远程目录的静态 requires 会把「本地已提供」误报成「依赖缺失」。
    const provided = new Set<string>(installed.tools.map((tool) => tool.id))
    for (const pkgName of localToolPackageNames()) provided.add(pkgName)
    const entries = rows.map((row): RepoEntry => {
      const entry: RepoEntry = {
        ns,
        id: row.id,
        name: row.name,
        description: row.description,
        version: row.version,
        installedVersion: row.installedVersion,
        status: row.status as RepoEntry['status'],
        tags: row.tags,
        requires: ns === 'presets' ? satisfyRequires(row.requires, provided) : row.requires,
        size: row.size,
        target: targetOf(ns, row.id),
      }
      if (row.builtin !== undefined)
        entry.builtin = row.builtin
      if (row.scope !== undefined)
        entry.scope = row.scope
      if (row.category !== undefined)
        entry.category = row.category
      if (ns === 'presets' && row.installedVersion !== null) {
        const missing = unresolvedRows(join(DSH_HOME, '.agent-presets', row.id))
        if (missing.length > 0)
          entry.unresolved = missing
      }
      return entry
    })
    return { entries, generatedAt: index.doc.generatedAt ?? null, restored: index.restored }
  },

  async get(ns: RepoNs, id: string): Promise<RepoDetail> {
    const index = await loadIndex(ns)
    const entry = requireEntry(index.doc, id)
    const key = detailCacheKey(index.doc, entry)
    const cached = await readDetailCache({ dshHome: DSH_HOME, id, key })
    if (cached !== null)
      return { id, markdown: cached, cached: true }
    if (entry.detailUrl === undefined || entry.detailUrl === '')
      throw new Error(`目录条目缺 detailUrl：${id}`)
    const response = await fetch(entry.detailUrl, { headers: TOKEN === '' ? {} : { 'x-repo-token': TOKEN } })
    if (!response.ok)
      throw new Error(`拉取详情失败：HTTP ${response.status} ${entry.detailUrl}`)
    const markdown = await response.text()
    await writeDetailCache({ dshHome: DSH_HOME, id, key, text: markdown })
    return { id, markdown, cached: false }
  },

  async install(ns: RepoNs, id: string, scope: string[] = []): Promise<RepoInstallReceipt> {
    const index = await loadIndex(ns)
    const entry = requireEntry(index.doc, id)
    if (entry.downloadUrl === undefined || entry.downloadUrl === '')
      throw new Error(`目录条目缺 downloadUrl：${id}`)
    if (entry.sha256 === undefined || entry.sha256 === '')
      throw new Error(`目录条目缺 sha256：${id}`)
    const zipPath = join(DSH_HOME, '.bobo-market', 'downloads', `${ns}-${id}-${entry.version ?? '0'}.zip`)
    await download(entry.downloadUrl, TOKEN, zipPath, entry.sha256)
    if (ns === 'presets') {
      const receipt = await installPreset({ zipPath, dshHome: DSH_HOME, appRoot: REPO_ROOT, boboRoot: BOBO_ROOT, resolveFrom: RESOLVE_FROM, id, version: entry.version })
      return { ns, id: receipt.id, version: receipt.version, target: receipt.dir, replaced: receipt.existed, fileCount: receipt.entryCount }
    }
    if (ns === 'tools') {
      const receipt = await installTool({ zipPath, dshHome: DSH_HOME, appRoot: REPO_ROOT, scope })
      return { ns, id: receipt.id, version: receipt.version, target: receipt.dir, replaced: false, fileCount: receipt.mounts.length }
    }
    const receipt = await installSkill({ zipPath, dshHome: DSH_HOME, id, version: entry.version })
    return { ns, id: receipt.id, version: receipt.version, target: receipt.dir, replaced: false, fileCount: receipt.fileCount }
  },

  async uninstall(ns: RepoNs, id: string): Promise<RepoUninstallReceipt> {
    if (ns === 'presets') {
      const receipt = await uninstallPreset({ id, dshHome: DSH_HOME })
      return { ns, id: receipt.id, followedBy: receipt.toolsAdjusted }
    }
    if (ns === 'tools') {
      const receipt = await uninstallTool({ id, dshHome: DSH_HOME })
      return { ns, id: receipt.id, followedBy: [] }
    }
    const receipt = await uninstallSkill({ id, dshHome: DSH_HOME })
    return { ns, id: receipt.id, followedBy: [] }
  },

  async setScope(toolId: string, scope: string[]): Promise<RepoScopeReceipt> {
    const receipt = await coreSetScope({ toolId, scope, dshHome: DSH_HOME, appRoot: REPO_ROOT })
    return { toolId: receipt.toolId, scope: receipt.scope }
  },

  async setCategory(id: string, category: string): Promise<RepoCategoryReceipt> {
    const receipt = await coreSetCategory({ dshHome: DSH_HOME, id, category })
    return { id: receipt.id, category: receipt.category }
  },
})

// --- internal ---

/**
 * 裸包名的解析锚点：用**宿主自己那个 kernel 入口**去解析，因此拿到的是内核的同一份
 * 模块实例。预设声明挂在 `<DSH_HOME>/.agent-presets/` 下，loader 的自带解析通道覆盖不到
 * 那个位置，`@deepseek-ai/dsh-agent-preset` 这类裸名必须在装包时改写成 file URL —— 否则
 * 预设会挂成 "preset-<id>: failed to import"（8 条全部不激活）。
 * 解析锚点若不可用就返回空数组，装包核心会把裸名原样保留（退化成不激活，而不是改坏路径）。
 */
function kernelResolveAnchors(): string[] {
  const entry = process.argv[1]
  if (entry === undefined || entry === '')
    return []
  try {
    createRequire(entry).resolve('@deepseek-ai/dsh-agent-preset')
    return [entry]
  }
  catch {
    return []
  }
}

/**
 * 本地 `bobo/` 下各包的 npm name（如 `bobo-crawl-tool` / `bobo-proxy-tool`）。
 *
 * 预设用 `file:///` 直挂这些本地包，包不经市场安装、不在 state 里，但功能
 * 已就位——收集其包名供 `satisfyRequires` 判定「依赖已提供」。
 */
function localToolPackageNames(): string[] {
  const names: string[] = []
  if (!existsSync(BOBO_ROOT)) return names
  let children: string[]
  try {
    children = readdirSync(BOBO_ROOT, { withFileTypes: true })
      .filter((child) => child.isDirectory())
      .map((child) => child.name)
  }
  catch {
    return names
  }
  for (const dir of children) {
    const manifest = join(BOBO_ROOT, dir, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }
      if (typeof pkg.name === 'string' && pkg.name !== '') names.push(pkg.name)
    }
    catch {
      // 坏 manifest 跳过：一个包读不出来不该拖垮整个列表
    }
  }
  return names
}

/**
 * 拉目录。**不做 TTL 记忆** —— 每次调用都真去拉，失败才回落到上次成功的文档。
 * 曾经这里是 60 秒内存缓存，结果是云端更新完点「刷新」也刷不出来（缓存没到期就直接返回旧文档），
 * 用户看到的是「刷新没反应」。目录只在打开 tab / 点刷新时读，按需拉取的量可以接受。
 */
async function loadIndex(ns: RepoNs): Promise<{ doc: RepoIndex, restored: boolean }> {
  const hit = indexCache.get(ns)
  try {
    const doc = await fetchIndex(BASE_URL, TOKEN, ns)
    indexCache.set(ns, { at: Date.now(), doc })
    return { doc, restored: false }
  }
  catch (error) {
    if (hit === undefined)
      throw error
    return { doc: hit.doc, restored: true }
  }
}

function requireEntry(doc: RepoIndex, id: string): RepoIndexEntry {
  const entry = doc.plugins.find(candidate => candidate.id === id)
  if (entry === undefined)
    throw new Error(`目录里没有这个条目：${id}`)
  return entry
}

function detailCacheKey(doc: RepoIndex, entry: RepoIndexEntry): string {
  return `${entry.version ?? '0'}:${entry.detailSha256 ?? ''}:${doc.generatedAt ?? ''}`
}

function targetOf(ns: RepoNs, id: string): string {
  if (ns === 'presets')
    return join(DSH_HOME, '.agent-presets', id)
  if (ns === 'skills')
    return join(DSH_HOME, 'skills', id)
  return join(DSH_HOME, '.bobo-market', 'tools', id)
}

function unresolvedRows(presetDir: string): string[] {
  const file = join(presetDir, 'agent.cordis.yml')
  if (!existsSync(file))
    return []
  const missing: string[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*name:\s*['"]?([^\s'"#]+)/.exec(line)
    if (match === null)
      continue
    const value = match[1]
    const target = value.startsWith('../../')
      ? resolve(BOBO_ROOT, value.slice('../../'.length))
      : value.startsWith('file:')
        ? fileURLToPath(value)
        : undefined
    if (target !== undefined && !existsSync(target))
      missing.push(value)
  }
  return missing
}
