/**
 * The four model-facing skill-market tools (`market_search`, `market_detail`,
 * `market_file`, `market_install`) over one injectable market instance.
 *
 * The factory takes a `getMarket` accessor instead of a concrete instance so
 * tests can drive every execute path with a fake, while the plugin entry builds
 * the real `createMarket` aggregate once. `market_install` re-validates the
 * SKILL.md frontmatter against the skill discoverer's rules before any bytes
 * land on disk, so a skill the library would silently skip never installs.
 * @module bobo-market-tool/tools
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
/** Model-visible name of the market search tool. */
export declare const MARKET_SEARCH_TOOL = "market_search";
/** Model-visible name of the skill detail tool. */
export declare const MARKET_DETAIL_TOOL = "market_detail";
/** Model-visible name of the package file tool. */
export declare const MARKET_FILE_TOOL = "market_file";
/** Model-visible name of the install tool. */
export declare const MARKET_INSTALL_TOOL = "market_install";
/** Per-source health as a search page reports it. */
export type MarketSourceStatus = 'ok' | 'cached' | 'degraded' | 'failed';
/**
 * One normalized search row: only the fields this package documents are
 * declared; extra registry fields pass through untouched.
 */
export type MarketSkillItem = {
    /** `source:slug` identifier, the id `market_detail` and `market_install` take. */
    id: string;
    /** Origin registry: `clawhub` or `skillhub`. */
    source: string;
    /** Registry-local slug. */
    slug: string;
    /** Display name. */
    name: string;
    /** One-line summary of what the skill does. */
    summary: string;
    /** Popularity counters; `downloads` is always present. */
    stats: {
        downloads: number;
        installs?: number;
        stars?: number;
    };
    /** Topic tags. */
    tags: string[];
    /** Disk state annotated against the local skill library. */
    installState: string;
    /** Latest version when the registry reports one. */
    version?: string;
};
/** One merged page returned by `market.search`. */
export type MarketSearchPage = {
    /** Cross-source deduped rows sorted by download count. */
    items: MarketSkillItem[];
    /** Merge cursor for the next page, or null once every source is exhausted. */
    nextCursor: string | null;
    /** Health of each source that contributed to this page. */
    sources: {
        clawhub: MarketSourceStatus;
        skillhub: MarketSourceStatus;
    };
};
/** One capability-disclosure entry derived from SKILL.md and the file list. */
export type MarketCapability = {
    /** Capability class: `shell`, `hooks`, `secrets`, `network`, or `writes`. */
    kind: string;
    /** Severity for the class: `high` or `medium`. */
    severity: string;
    /** Chinese display label shared with the settings UI. */
    label: string;
    /** Verbatim evidence strings (commands, paths, hosts). */
    evidence: string[];
};
/** One file row in a detail's listing. */
export type MarketFileInfo = {
    /** Package-relative path. */
    path: string;
    /** Declared size in bytes. */
    size: number;
    /** Content hash when the registry reports one. */
    sha256?: string;
    /** Content type when the registry reports one. */
    contentType?: string;
};
/** Install record embedded in a detail when the skill is already on disk. */
export type MarketInstalledInfo = {
    /** Recorded installed version. */
    version?: string;
    /** ISO timestamp of the install. */
    installedAt: string;
    /** Directory name under the skill library. */
    dirName: string;
};
/** Normalized detail returned by `market.detail`, read as these tools present it. */
export type MarketDetail = {
    /** `source:slug` identifier. */
    id: string;
    /** Display name. */
    name: string;
    /** Origin registry. */
    source: string;
    /** One-line summary. */
    summary: string;
    /** SKILL.md body with the frontmatter removed (summary when there is no body). */
    description: string;
    /** Raw SKILL.md text, possibly empty when the registry could not serve it. */
    skillMd: string;
    /** Parsed frontmatter keys; values are scalars or string lists. */
    frontmatter: Record<string, string | string[]>;
    /** Package file listing after the structure and size limits. */
    files: MarketFileInfo[];
    /** Rule-based capability disclosure. */
    capabilities: MarketCapability[];
    /** Derived trigger phrases, at most five. */
    triggers: string[];
    /** Disk state annotated against the local skill library. */
    installState: string;
    /** Whether the upstream version is strictly newer than the installed one. */
    updateAvailable: boolean;
    /** Latest upstream version when reported. */
    version?: string;
    /** Why the entry cannot be installed; present only with `not-installable`. */
    notInstallableReason?: string;
    /** Install record when the skill is already on disk. */
    installedInfo?: MarketInstalledInfo;
    /** True when a stale cache entry answered an upstream failure. */
    cached?: boolean;
};
/** One file preview returned by `market.file`. */
export type MarketFile = {
    /** Package-relative path echoed back. */
    path: string;
    /** UTF-8 text, cut off at the preview byte limit when `truncated`. */
    content: string;
    /** Language derived from the file suffix. */
    language: string;
    /** Full size in bytes before truncation. */
    size: number;
    /** Whether `content` was cut off at the preview limit. */
    truncated: boolean;
    /** True when a stale cache entry answered an upstream failure. */
    cached?: boolean;
};
/** Install receipt returned by `market.installTo`. */
export type MarketInstall = {
    /** `source:slug` identifier that was installed. */
    id: string;
    /** Directory name under the skill library. */
    dirName: string;
    /** Absolute installed directory path. */
    dir: string;
    /** Installed version when the upstream detail reported one. */
    version?: string;
    /** Files written into the directory. */
    fileCount: number;
    /** Whether this install replaced a previous directory of the same id. */
    replaced: boolean;
};
/** The slice of a `createMarket` instance these tools call. */
export interface MarketLike {
    /**
     * Fetch one merged market page.
     * @param scope - only `'market'` is accepted by the implementation.
     * @param query - keywords matched against skill names and summaries.
     * @param cursor - `nextCursor` from the previous page; omit for the first page.
     * @returns the merged page with per-source health.
     */
    search(scope: 'market', query: string, cursor?: string): Promise<MarketSearchPage>;
    /**
     * Read one skill's normalized detail.
     * @param id - `clawhub:<slug>` or `skillhub:<slug>`.
     * @returns the detail including SKILL.md, frontmatter, files, and capability disclosure.
     */
    detail(id: string): Promise<MarketDetail>;
    /**
     * Read one file inside a skill package.
     * @param id - `clawhub:<slug>` or `skillhub:<slug>`.
     * @param path - package-relative file path.
     * @returns the text preview with truncation metadata.
     */
    file(id: string, path: string): Promise<MarketFile>;
    /**
     * Install one skill into the local skill library.
     * @param id - `clawhub:<slug>` or `skillhub:<slug>`.
     * @returns the install receipt.
     */
    installTo(id: string): Promise<MarketInstall>;
}
/**
 * Build the four market tool definitions over one market accessor.
 *
 * Every execute calls `getMarket()` itself, so a caller can supply one shared
 * instance or swap fakes per test without touching the definitions.
 *
 * @param getMarket - returns the market instance a call should use; invoked
 *   once per tool execution.
 * @returns the definitions in `market_search` → `market_detail` →
 *   `market_file` → `market_install` order.
 */
export declare function createMarketTools(getMarket: () => MarketLike): ToolDefinition[];
//# sourceMappingURL=tools.d.ts.map