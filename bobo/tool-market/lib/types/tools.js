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
import { isSkillName } from '@deepseek-ai/dsh-skill';
import { defineTool } from '@deepseek-ai/dsh-tools';
/** Model-visible name of the market search tool. */
export const MARKET_SEARCH_TOOL = 'market_search';
/** Model-visible name of the skill detail tool. */
export const MARKET_DETAIL_TOOL = 'market_detail';
/** Model-visible name of the package file tool. */
export const MARKET_FILE_TOOL = 'market_file';
/** Model-visible name of the install tool. */
export const MARKET_INSTALL_TOOL = 'market_install';
/** Render one canonical tool value as pretty JSON text for the model. */
function renderJson(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}
/**
 * Refuse a frontmatter the skill discoverer would skip, before anything is
 * written to disk. The rules mirror `parseSkillFile` in
 * `packages/skill/skill-filesystem`: `name` and `description` must both be
 * non-empty strings and `name` must satisfy `isSkillName` — anything else
 * makes the skill library silently ignore the installed directory.
 *
 * @param id - the id being installed, quoted back in the refusal.
 * @param detail - the pre-install detail whose frontmatter is checked.
 * @throws {Error} a Chinese refusal naming the offending field; no install follows.
 */
function assertInstallableFrontmatter(id, detail) {
    const { name } = detail.frontmatter;
    if (typeof name !== 'string') {
        throw new Error(`安装前校验失败：${id} 的 SKILL.md frontmatter 缺少 name 字符串——技能库要求非空 kebab-case name，装了也不会显示`);
    }
    if (!isSkillName(name)) {
        throw new Error(`安装前校验失败：${id} 的 frontmatter name "${name}" 不是合法技能名（须为小写 kebab-case，例如 my-skill）——技能库不会显示它`);
    }
    const { description } = detail.frontmatter;
    if (typeof description !== 'string') {
        throw new Error(`安装前校验失败：${id} 的 SKILL.md frontmatter 缺少 description 字符串——技能库不显示没有描述的技能`);
    }
    if (description.length === 0) {
        throw new Error(`安装前校验失败：${id} 的 frontmatter description 为空——技能库不显示没有描述的技能`);
    }
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
export function createMarketTools(getMarket) {
    return [
        defineTool({
            name: MARKET_SEARCH_TOOL,
            description: 'Search the skill market (aggregated ClawHub and SkillHub) for skills. The query matches ' +
                'skill names and their purpose summaries; results carry short summaries only — search with ' +
                'keywords first, pick candidates, then call market_detail to read one skill fully before ' +
                'deciding. Pass the previous page’s nextCursor as cursor to fetch the next page; omit it ' +
                'for the first page.',
            parameters: {
                query: {
                    type: 'string',
                    required: true,
                    description: 'Keywords matched against skill names and purpose summaries.',
                },
                cursor: {
                    type: 'string',
                    description: 'Pagination cursor from the previous market_search result (its nextCursor); omit for the first page.',
                },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        items: {
                            type: 'array',
                            required: true,
                            items: {
                                type: 'object',
                                additionalProperties: true,
                                properties: {
                                    id: { type: 'string' },
                                    source: { type: 'string' },
                                    slug: { type: 'string' },
                                    name: { type: 'string' },
                                    summary: { type: 'string' },
                                    installState: { type: 'string' },
                                    version: { type: 'string' },
                                    stats: {
                                        type: 'object',
                                        additionalProperties: true,
                                        properties: { downloads: { type: 'number' } },
                                    },
                                    tags: { type: 'array', items: { type: 'string' } },
                                },
                            },
                        },
                        nextCursor: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                        sources: { type: 'object', additionalProperties: true, required: true },
                    },
                },
                render: renderJson,
            },
            async execute(args) {
                return await getMarket().search('market', args.query, args.cursor);
            },
        }),
        defineTool({
            name: MARKET_DETAIL_TOOL,
            description: 'Read one market skill in full: the SKILL.md body, its frontmatter, the package file list, ' +
                'the capability disclosures (shell, hooks, secrets, network, writes), trigger phrases, and ' +
                'install state. Call it before market_install — installing without reading the capability ' +
                'disclosure is not allowed. id must be a source:slug id returned by market_search items.',
            parameters: {
                id: {
                    type: 'string',
                    required: true,
                    description: 'The skill id in source:slug form (for example clawhub:pdf-tools), exactly as market_search returned it.',
                },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        id: { type: 'string', required: true },
                        name: { type: 'string', required: true },
                        source: { type: 'string', required: true },
                        summary: { type: 'string', required: true },
                        description: { type: 'string', required: true },
                        skillMd: { type: 'string', required: true },
                        frontmatter: { type: 'object', additionalProperties: true, required: true },
                        files: {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: true,
                                properties: { path: { type: 'string' }, size: { type: 'number' } },
                            },
                            required: true,
                        },
                        capabilities: {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: true,
                                properties: {
                                    kind: { type: 'string' },
                                    severity: { type: 'string' },
                                    label: { type: 'string' },
                                    evidence: { type: 'array', items: { type: 'string' } },
                                },
                            },
                            required: true,
                        },
                        triggers: { type: 'array', items: { type: 'string' }, required: true },
                        installState: { type: 'string', required: true },
                        updateAvailable: { type: 'boolean', required: true },
                        version: { type: 'string' },
                        notInstallableReason: { type: 'string' },
                        installedInfo: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                version: { type: 'string' },
                                installedAt: { type: 'string', required: true },
                                dirName: { type: 'string', required: true },
                            },
                        },
                        cached: { type: 'boolean' },
                    },
                },
                render: renderJson,
            },
            async execute(args) {
                const detail = await getMarket().detail(args.id);
                return {
                    id: detail.id,
                    name: detail.name,
                    source: detail.source,
                    summary: detail.summary,
                    description: detail.description,
                    skillMd: detail.skillMd,
                    frontmatter: detail.frontmatter,
                    files: detail.files,
                    capabilities: detail.capabilities,
                    triggers: detail.triggers,
                    installState: detail.installState,
                    updateAvailable: detail.updateAvailable,
                    ...(detail.version !== undefined ? { version: detail.version } : {}),
                    ...(detail.notInstallableReason !== undefined ? { notInstallableReason: detail.notInstallableReason } : {}),
                    ...(detail.installedInfo !== undefined ? { installedInfo: detail.installedInfo } : {}),
                    ...(detail.cached !== undefined ? { cached: detail.cached } : {}),
                };
            },
        }),
        defineTool({
            name: MARKET_FILE_TOOL,
            description: 'Read one file inside a market skill package — use when you need the exact content of a ' +
                'template, script, or reference listed in market_detail files before installing. Large ' +
                'files are cut off at the preview limit; truncated: true says the preview is partial.',
            parameters: {
                id: {
                    type: 'string',
                    required: true,
                    description: 'The skill id in source:slug form, from market_search or market_detail.',
                },
                path: {
                    type: 'string',
                    required: true,
                    description: 'Package-relative file path from the market_detail files list (for example SKILL.md).',
                },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        path: { type: 'string', required: true },
                        content: { type: 'string', required: true },
                        language: { type: 'string', required: true },
                        size: { type: 'number', required: true },
                        truncated: { type: 'boolean', required: true },
                        cached: { type: 'boolean' },
                    },
                },
                render: renderJson,
            },
            async execute(args) {
                return await getMarket().file(args.id, args.path);
            },
        }),
        defineTool({
            name: MARKET_INSTALL_TOOL,
            description: 'Install a market skill into the user’s skill library under <DSH_HOME>/skills/. Before ' +
                'installing, call market_detail and review its capability disclosures; this tool re-checks ' +
                'the SKILL.md frontmatter (kebab-case name and a non-empty description) and refuses ' +
                'anything the skill library would not display. After installing, tell the user in your ' +
                'reply what was installed, what it is for, and its capability risks. The skill then ' +
                'appears in the skill library (settings page) where the user can delete it manually; this ' +
                'tool cannot delete or uninstall skills.',
            parameters: {
                id: {
                    type: 'string',
                    required: true,
                    description: 'The skill id in source:slug form, from market_search or market_detail.',
                },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        id: { type: 'string', required: true },
                        dirName: { type: 'string', required: true },
                        version: { type: 'string' },
                        fileCount: { type: 'integer', required: true },
                        replaced: { type: 'boolean', required: true },
                        capabilities: {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: true,
                                properties: {
                                    kind: { type: 'string' },
                                    severity: { type: 'string' },
                                    label: { type: 'string' },
                                    evidence: { type: 'array', items: { type: 'string' } },
                                },
                            },
                            required: true,
                        },
                    },
                },
                render: renderJson,
            },
            async execute(args) {
                const market = getMarket();
                const detail = await market.detail(args.id);
                assertInstallableFrontmatter(args.id, detail);
                const installed = await market.installTo(args.id);
                return {
                    id: installed.id,
                    dirName: installed.dirName,
                    ...(installed.version !== undefined ? { version: installed.version } : {}),
                    fileCount: installed.fileCount,
                    replaced: installed.replaced,
                    capabilities: detail.capabilities,
                };
            },
        }),
    ];
}
//# sourceMappingURL=tools.js.map