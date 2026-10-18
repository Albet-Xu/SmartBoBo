/**
 * Minimal type declarations for cross-package consumption of
 * `packages/bobo/plugins/market-core.mjs`, which ships no types of its own.
 * This file is maintained alongside the implementation: every interface copies
 * the real return structure of the corresponding `market-core.mjs` function.
 * Only the surface `packages/bobo/tool-market` consumes is declared, so other
 * consumers keep their own local interfaces.
 */

/** Options accepted by `createMarket`; `dshHome` is required and the rest default. */
export interface MarketOptions {
  /** DSH home root; installs resolve under `<dshHome>/skills/`. */
  dshHome: string
  /** ClawHub base URL; defaults to `https://clawhub.ai`. */
  clawhubBase?: string
  /** SkillHub base URL; defaults to `https://api.skillhub.cn`. */
  skillhubBase?: string
  /** Fetch implementation; defaults to `globalThis.fetch`. */
  fetchImpl?: typeof globalThis.fetch
  /** Per-request timeout budget in milliseconds; defaults to 10000. */
  timeoutMs?: number
  /** Clock reading in milliseconds; defaults to `Date.now`. */
  now?: () => number
  /** Page size for list and search requests; defaults to 30. */
  pageSize?: number
}

/** Per-source health as `search` reports it in `sources`. */
export type MarketSourceStatus = 'ok' | 'cached' | 'degraded' | 'failed'

/** One normalized skill row as the search/list normalizers emit it. */
export interface MarketSkillItem {
  /** `source:slug` identifier, the id every other method takes. */
  id: string
  /** Origin registry: `clawhub` or `skillhub`. */
  source: string
  /** Registry-local slug. */
  slug: string
  /** Display name. */
  name: string
  /** One-line summary. */
  summary: string
  /** Publisher handle, plus a display name when the registry reports one. */
  author: { handle: string; displayName?: string }
  /** Popularity counters; `downloads` is always present. */
  stats: { downloads: number; installs?: number; stars?: number }
  /** Topic tags. */
  tags: string[]
  /** Normalized security verdict. */
  securityStatus: string
  /** Disk state annotated against `<dshHome>/skills/`. */
  installState: string
  /** Latest version when the registry reports one. */
  version?: string
  /** Upstream update timestamp in milliseconds. */
  updatedAt?: number
}

/** One merged page returned by `market.search`. */
export interface MarketSearchPage {
  /** Cross-source deduped rows sorted by download count. */
  items: MarketSkillItem[]
  /** Base64url merge cursor for the next page, or null once every source is exhausted. */
  nextCursor: string | null
  /** Health of each source contributing to this page. */
  sources: { clawhub: MarketSourceStatus; skillhub: MarketSourceStatus }
}

/** One capability-disclosure entry derived from SKILL.md and the file list. */
export interface MarketCapability {
  /** Capability class: `shell`, `hooks`, `secrets`, `network`, or `writes`. */
  kind: string
  /** Severity for the class: `high` or `medium`. */
  severity: string
  /** Chinese display label shared with the settings UI. */
  label: string
  /** Up to three verbatim evidence strings (commands, paths, hosts). */
  evidence: string[]
}

/** One file row in a detail's listing. */
export interface MarketFileInfo {
  /** Package-relative path. */
  path: string
  /** Declared size in bytes. */
  size: number
  /** Content hash when the registry reports one. */
  sha256?: string
  /** Content type when the registry reports one. */
  contentType?: string
}

/** Install record embedded in a detail when the skill is already on disk. */
export interface MarketInstalledInfo {
  /** Recorded installed version. */
  version?: string
  /** ISO timestamp of the install. */
  installedAt: string
  /** Directory name under `<dshHome>/skills/`. */
  dirName: string
}

/** Normalized detail returned by `market.detail`. */
export interface MarketSkillDetail {
  /** `source:slug` identifier. */
  id: string
  /** Display name. */
  name: string
  /** Origin registry. */
  source: string
  /** One-line summary. */
  summary: string
  /** SKILL.md body with the frontmatter block removed (summary when there is no body). */
  description: string
  /** Raw SKILL.md text, possibly empty when the registry could not serve it. */
  skillMd: string
  /** Parsed frontmatter keys; values are scalars or string lists. */
  frontmatter: Record<string, string | string[]>
  /** Package file listing after the structure and size limits. */
  files: MarketFileInfo[]
  /** Rule-based capability disclosure. */
  capabilities: MarketCapability[]
  /** Derived trigger phrases, at most five. */
  triggers: string[]
  /** Disk state annotated against `<dshHome>/skills/`. */
  installState: string
  /** Whether the upstream version is strictly newer than the installed one. */
  updateAvailable: boolean
  /** Latest upstream version when reported. */
  version?: string
  /** Why the entry cannot be installed, present only with `installState: 'not-installable'`. */
  notInstallableReason?: string
  /** Install record when the skill is already on disk. */
  installedInfo?: MarketInstalledInfo
  /** True when a stale cache entry answered an upstream failure. */
  cached?: boolean
}

/** One file preview returned by `market.file`. */
export interface MarketFileContent {
  /** Package-relative path echoed back. */
  path: string
  /** UTF-8 text, cut off at the preview byte limit when `truncated`. */
  content: string
  /** Language derived from the file suffix. */
  language: string
  /** Full size in bytes before truncation. */
  size: number
  /** Whether `content` was cut off at the preview limit. */
  truncated: boolean
  /** True when a stale cache entry answered an upstream failure. */
  cached?: boolean
}

/** Install receipt returned by `market.installTo`. */
export interface MarketInstallResult {
  /** `source:slug` identifier that was installed. */
  id: string
  /** Directory name under `<dshHome>/skills/`. */
  dirName: string
  /** Absolute installed directory path. */
  dir: string
  /** Installed version when the upstream detail reported one. */
  version?: string
  /** Files written into the directory. */
  fileCount: number
  /** Whether this install replaced a previous directory of the same id. */
  replaced: boolean
}

/** The market instance `createMarket` returns; only the consumed methods are declared. */
export interface Market {
  /** The DSH home root every install resolves against. */
  readonly dshHome: string
  /**
   * Fetch one merged market page.
   * @param scope - only `'market'` is accepted.
   * @param query - keywords; an empty string lists the most-downloaded skills.
   * @param cursor - `nextCursor` from the previous page; omit for the first page.
   * @returns the merged page with per-source health.
   * @throws on an unknown scope, non-string inputs, or both sources failing without a stale cache.
   */
  search(scope: 'market', query: string, cursor?: string): Promise<MarketSearchPage>
  /**
   * Read one skill's normalized detail.
   * @param id - `clawhub:<slug>` or `skillhub:<slug>`.
   * @returns the detail including SKILL.md, frontmatter, files, and capability disclosure.
   * @throws on a malformed id, or an upstream failure with no cache to fall back on.
   */
  detail(id: string): Promise<MarketSkillDetail>
  /**
   * Read one file inside a skill package.
   * @param id - `clawhub:<slug>` or `skillhub:<slug>`.
   * @param path - package-relative file path.
   * @returns the text preview with truncation metadata.
   * @throws on a malformed id, an unsafe path, or an upstream failure with no cache.
   */
  file(id: string, path: string): Promise<MarketFileContent>
  /**
   * Install one skill into `<dshHome>/skills/<dirName>/`.
   * @param id - `clawhub:<slug>` or `skillhub:<slug>`.
   * @returns the install receipt.
   * @throws on a malformed id, an in-progress install, a manifest or path that
   *   fails the install limits, a name conflict, or an upstream/disk failure.
   */
  installTo(id: string): Promise<MarketInstallResult>
}

/**
 * Build one market aggregate instance over the ClawHub and SkillHub registries.
 * Construction touches no network; only the instance methods do.
 * @param options - construction options; `dshHome` is required.
 * @returns the market instance.
 * @throws when `dshHome` is missing or empty.
 */
export function createMarket(options: MarketOptions): Market
