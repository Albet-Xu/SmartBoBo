/**
 * 从 BoBo-Handyman 移植的 `repo-core.mjs`（纯 Node ESM，无框架依赖）的最小类型声明。
 * 仅声明本包实际消费的面；实现变动时两处一起改。
 */

export declare const PRESET_ID_RE: RegExp
export declare const SKILL_DIR_RE: RegExp

export type RepoNs = 'presets' | 'tools' | 'skills'

export interface RepoIndexEntry {
  id: string
  pkg?: string
  name?: string
  description?: string
  version?: string
  type?: string
  author?: string
  tags?: string[]
  minAppVersion?: string
  requires?: string[]
  sha256?: string
  size?: number
  downloadUrl?: string
  detailUrl?: string
  detailSha256?: string
}

export interface RepoIndex {
  schema?: number
  generatedAt?: string
  plugins: RepoIndexEntry[]
}

export interface InstalledPreset {
  id: string
  dir: string
  hasComposition: boolean
  version: string | null
  installedAt: string | null
  inState: boolean
  builtin?: boolean
  missing?: boolean
}

export interface InstalledTool {
  id: string
  dir: string
  path: string
  version: string | null
  builtin: boolean | null
  scope: string[]
  inState: boolean
  manifestBroken?: boolean
  missing?: boolean
}

export interface InstalledSkill {
  id: string
  dir: string
  dirName: string
  version: string | null
  installedAt: string | null
  inState: boolean
  source?: string
}

export interface InstalledSnapshot {
  presets: InstalledPreset[]
  tools: InstalledTool[]
  skills: InstalledSkill[]
  categories: Record<string, string>
}

export interface RepoRow {
  ns: RepoNs
  id: string
  name: string
  description: string
  version: string | null
  tags: string[]
  requires: string[]
  sha256: string | null
  size: number | null
  status: string
  installedVersion: string | null
  detailUrl: string | null
  builtin?: boolean
  scope?: string[]
  category?: string
}

export interface RepoManifest {
  id: string
  dir: string
  version: string
  builtin: string
  mount: Array<{ id: string, name: string }>
  [key: string]: unknown
}

export interface RewriteHit {
  from: string
  to: string
}

export declare function isMarketSkillId(id: unknown): boolean
export declare function fetchIndex(baseUrl: string, token: string, ns: RepoNs): Promise<RepoIndex>
export declare function download(url: string, token: string, destPath: string, sha256: string): Promise<{ bytes: number, sha256: string }>
export declare function parseManifest(text: string): RepoManifest
export declare function compareVersions(a: unknown, b: unknown): number
export declare function readState(dshHome: string): Promise<{ presets: Record<string, { version?: string, installedAt?: string }>, tools: Record<string, { dir?: string, version?: string, builtin?: boolean, scope?: string[] }>, skills: Record<string, { version?: string, installedAt?: string, dirName?: string, source?: string }>, categories: Record<string, string> }>
export declare function readDetailCache(fields: { dshHome: string, id: string, key: string }): Promise<string | null>
export declare function writeDetailCache(fields: { dshHome: string, id: string, key: string, text: string }): Promise<string>
export declare function rewritePresetPaths(text: string, appRoot: string, boboRoot?: string, resolveFrom?: string[]): { text: string, rewrites: RewriteHit[] }
export declare function installPreset(options: { zipPath: string, dshHome: string, appRoot: string, boboRoot?: string, resolveFrom?: string[], id?: string, version?: string }): Promise<{ id: string, version: string, dir: string, existed: boolean, entryCount: number, rewrites: RewriteHit[] }>
export declare function installTool(options: { zipPath: string, dshHome: string, appRoot: string, scope?: string[] }): Promise<{ id: string, dir: string, version: string, builtin: boolean, scope: string[], entryCount: number, mounts: Array<{ id: string, url: string }>, blocksWritten: number, blocksCleared: number }>
export declare function uninstallPreset(options: { id: string, dshHome: string }): Promise<{ id: string, toolsAdjusted: string[] }>
export declare function uninstallTool(options: { id: string, dshHome: string }): Promise<{ id: string, dir: string, blocksRemoved: number }>
export declare function setScope(options: { toolId: string, scope: string[], dshHome: string, appRoot: string }): Promise<{ toolId: string, scope: string[], added: string[], removed: string[] }>
export declare function setCategory(fields: { dshHome: string, id: string, category: string }): Promise<{ id: string, category: string | null }>
export declare function listInstalled(options: { dshHome: string }): Promise<InstalledSnapshot>
export declare function installSkill(options: { zipPath: string, dshHome: string, id?: string, version?: string }): Promise<{ id: string, version: string, dir: string, entryCount: number, fileCount: number }>
export declare function uninstallSkill(options: { id: string, dshHome: string }): Promise<{ id: string, dirName: string }>
export declare function mergeListing(fields: { ns: RepoNs, indexEntries: RepoIndexEntry[], installed: InstalledSnapshot, categories?: Record<string, string> }): RepoRow[]
export declare function selftest(): Promise<unknown>
