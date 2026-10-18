/**
 * The model-facing `crawl_fetch` tool: render one page through the deployment's
 * long-lived Camoufox browser service and save every requested output format.
 *
 * One crawl derives all its formats from the same rendered document, so asking
 * for `html,md,skeleton` costs one page load. Artifacts land under the calling
 * session's workspace `data` directory unless the call or the deployment names
 * another target.
 * @module bobo-crawl-tool/crawl-tool
 */
import { join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { captureDir } from "./deployment.js";
import { PythonFailure, runPython } from "./python.js";
import { acquireProxy, proxyPoolOf } from "./proxy.js";
/** Model-visible tool name. */
export const CRAWL_FETCH_TOOL = 'crawl_fetch';
/** Output formats the engine can derive, each from the same rendered document. */
export const OUTPUT_FORMATS = ['html', 'md', 'skeleton'];
/** Characters of the rendered text carried back to the model as a preview. */
const CONTENT_PREVIEW_CHARS = 2_000;
/** Engine script, inside the deployment's scripts directory. */
const CRAWL_ENGINE_SCRIPT = 'run_camoufox.py';
/** Exit code the engine uses when it cannot reach the browser service. */
const SERVICE_UNREACHABLE_EXIT_CODE = 2;
/**
 * Validate the requested output formats.
 *
 * @param requested - the model's `outputFormat` value, comma-separated.
 * @returns the accepted formats in request order without duplicates, or `md`
 *   when the request names none of {@link OUTPUT_FORMATS}.
 */
export function parseOutputFormats(requested) {
    const accepted = (requested ?? 'md')
        .split(',')
        .map(entry => entry.trim().toLowerCase())
        .filter(entry => OUTPUT_FORMATS.includes(entry));
    const unique = [...new Set(accepted)];
    return unique.length > 0 ? unique : ['md'];
}
/** Model-facing detail of one failed run. */
function detailOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Text of one engine report field, or the empty string when the engine sent another type. */
function textOf(value) {
    return typeof value === 'string' ? value : '';
}
/** One engine invocation, without the browser-service retry. */
async function captureOnce(deps, args, signal) {
    const run = await runPython(deps.deployment.pythonBin, args, { timeoutMs: deps.timeoutMs, signal });
    return run.stdout;
}
/**
 * Run one capture, replacing the browser service and retrying once when the
 * engine reports it unreachable.
 *
 * @param deps - registration dependencies.
 * @param proxy - proxy URL the browser service was started with, reused when
 *   the service is relaunched.
 * @param buildArgs - engine arguments for one endpoint.
 * @param signal - caller cancellation.
 * @returns the engine's stdout, one line of JSON.
 * @throws {Error} naming the engine failure; the retry failure names the restart.
 */
async function captureWithServiceRestart(deps, proxy, buildArgs, signal) {
    const endpoint = await deps.browser.endpoint(proxy);
    try {
        return await captureOnce(deps, buildArgs(endpoint), signal);
    }
    catch (error) {
        if (!(error instanceof PythonFailure) || error.code !== SERVICE_UNREACHABLE_EXIT_CODE) {
            throw new Error(`crawl_fetch 后台脚本执行失败: ${detailOf(error)}`);
        }
        // The engine reached no service on the endpoint it was handed: drop the
        // instance and retry once against a freshly launched one.
        deps.browser.dispose();
        const restarted = await deps.browser.endpoint(proxy);
        try {
            return await captureOnce(deps, buildArgs(restarted), signal);
        }
        catch (retryError) {
            throw new Error(`crawl_fetch 后台脚本执行失败（浏览器服务已重启仍不可用）: ${detailOf(retryError)}`);
        }
    }
}
/**
 * Project the engine's one-line JSON report into the tool's canonical value.
 *
 * @param stdout - the engine's stdout.
 * @param requestedFormat - the validated format list, used when the report carries none.
 * @returns the capture report.
 * @throws {Error} when the engine printed no JSON object, which no successful
 *   capture can do.
 */
function reportToValue(stdout, requestedFormat) {
    let reply;
    try {
        reply = JSON.parse(stdout);
    }
    catch {
        throw new Error(`crawl_fetch 后台脚本未返回 JSON 报告: ${stdout.slice(0, 200)}`);
    }
    if (typeof reply !== 'object' || reply === null || Array.isArray(reply)) {
        throw new Error(`crawl_fetch 后台脚本未返回 JSON 报告: ${stdout.slice(0, 200)}`);
    }
    const report = reply;
    const outputs = Array.isArray(report['outputs'])
        ? report['outputs'].map((entry) => {
            const record = typeof entry === 'object' && entry !== null ? entry : {};
            return { format: textOf(record['format']), path: textOf(record['path']) };
        })
        : [];
    const reportedFormat = textOf(report['format']);
    return {
        savedTo: textOf(report['savedTo']),
        status: typeof report['status'] === 'number' ? report['status'] : 0,
        contentPreview: textOf(report['preview']).slice(0, CONTENT_PREVIEW_CHARS),
        format: reportedFormat === '' ? requestedFormat : reportedFormat,
        outputs,
    };
}
/**
 * Register `crawl_fetch` on the tools registry of the calling plugin instance.
 *
 * @param ctx - context whose `tools` registry receives the registration; the
 *   registration is effect-scoped and leaves with that instance.
 * @param deps - resolved deployment, browser-service owner, proxy fold, and budgets.
 */
export function registerCrawlFetchTool(ctx, deps) {
    ctx.tools.register(defineTool({
        name: CRAWL_FETCH_TOOL,
        description: 'Fetch a webpage with the local Python engine, convert the rendered content to one or more ' +
            'chosen output formats, and save them to the local data directory. A single crawl can produce ' +
            'multiple formats (each derived from the same rendered HTML). By default, saves to the current ' +
            'workspace\'s data folder. Returns the saved path(s), HTTP status, chosen format(s) and a short text preview.',
        parameters: {
            url: {
                type: 'string',
                required: true,
                description: 'The target webpage URL to crawl, e.g. https://example.com.',
            },
            selector: {
                type: 'string',
                description: 'Optional CSS selector to narrow extraction; when present, only the first match is returned.',
            },
            outputFormat: {
                type: 'string',
                description: 'One or more output formats, comma-separated: "html" (raw rendered HTML), "md" (Markdown, default), "skeleton" (block-level webpage skeleton). E.g. "html,md,skeleton" returns all three from a single crawl. Extensions: html -> .html, md -> .md, skeleton -> .skeleton.txt.',
            },
            outFile: {
                type: 'string',
                description: 'Optional target filename; default is auto-generated as 站点_标题_时间戳.<ext>. Extension is appended per outputFormat when missing.',
            },
            saveDir: {
                type: 'string',
                description: 'Optional directory to save the file; default is the current workspace\'s data folder.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    savedTo: { type: 'string', required: true },
                    status: { type: 'number', required: true },
                    contentPreview: { type: 'string', required: true },
                    format: { type: 'string', required: true },
                    outputs: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                format: { type: 'string', required: true },
                                path: { type: 'string', required: true },
                            },
                        },
                    },
                },
            },
            render: (_args, value) => {
                const files = value.outputs.length > 0
                    ? value.outputs.map(output => `- ${output.format}: ${output.path}`).join('\n')
                    : `- 已保存: ${value.savedTo}`;
                return [{
                        type: 'text',
                        text: `采集完成:\n${files}\n- HTTP状态: ${value.status}\n- 格式: ${value.format}\n- 预览: ${value.contentPreview}`,
                    }];
            },
        },
        async execute(args, exec) {
            const format = parseOutputFormats(args.outputFormat).join(',');
            const dataDir = captureDir(deps.deployment, args.saveDir, exec.agent?.session.header.cwd);
            // Proxy mode is a session decision; the pool is the deployment's. Both
            // have to hold before any address is fetched.
            const session = exec.agent?.session;
            const pool = session !== undefined && deps.proxyMode.of(session)
                ? proxyPoolOf(ctx.get('settings'))
                : undefined;
            const proxy = pool !== undefined && pool.enabled && pool.sources.length > 0
                ? await acquireProxy(deps.deployment.pythonBin, deps.deployment.scriptsDir, pool, args.url, deps.proxyTimeoutMs, exec.signal)
                : undefined;
            const stdout = await captureWithServiceRestart(deps, proxy, endpoint => [
                join(deps.deployment.scriptsDir, CRAWL_ENGINE_SCRIPT),
                '--url', args.url,
                '--out', join(dataDir, args.outFile ?? 'crawl_auto'),
                '--format', format,
                '--server', endpoint,
                ...(args.outFile === undefined ? ['--auto-name'] : []),
                ...(args.selector === undefined ? [] : ['--selector', args.selector]),
            ], exec.signal);
            return reportToValue(stdout, format);
        },
        // Pending state: a generic card titled by the page, so the UI shows the
        // fetch category without needing a crawl-specific renderer.
        presentCall: (args) => ({
            card: 'generic',
            title: `采集: ${args.url}`,
            rawInput: args.url,
            kind: 'fetch',
        }),
        // The render text already carries the artifact list and preview, so the
        // completed card keeps the pending title and that content.
        presentResult: () => ({ card: 'generic' }),
    }));
}
//# sourceMappingURL=crawl-tool.js.map