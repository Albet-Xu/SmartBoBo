/**
 * Model-facing `crawl_fetch`: renders one page through the deployment's
 * long-lived Camoufox browser service and saves the formats the call asks for.
 *
 * The plugin owns two things beyond the tool registration: the browser service
 * the captures share (stopped when this plugin instance is disposed, so a
 * session end closes the browser) and the session proxy fold a capture reads.
 * @module bobo-crawl-tool
 */
import z from '@deepseek-ai/schemastery';
import { CamoufoxBrowserService } from "./browser-server.js";
import { registerCrawlFetchTool } from "./crawl-tool.js";
import { resolveDeployment } from "./deployment.js";
import { SessionProxyMode } from "./proxy.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-acquisition';
/** Services required before the tool can be registered. */
export const inject = ['tools'];
export const Config = z.object({
    // Left blank rather than defaulted: an absent value is what lets the plugin
    // locate the BoBo project root from its own position.
    pythonBin: z.string(),
    scriptsDir: z.string(),
    dataDir: z.string().default(''),
    timeoutMs: z.natural().min(1_000).default(120_000),
    serverStartTimeoutMs: z.natural().min(1_000).default(60_000),
    proxyFetchTimeoutMs: z.natural().min(1_000).default(15_000),
});
/** Reject a configured budget that is not whole positive milliseconds. */
function assertBudget(name, value) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`tool-acquisition: ${name} must be a positive integer number of milliseconds`);
    }
}
/**
 * Register `crawl_fetch` and take ownership of the browser service it drives.
 *
 * @param ctx - context whose `tools` registry receives the tool; the
 *   registration and the browser service both leave with this plugin instance.
 * @param config - deployment paths and budgets, validated by {@link Config}.
 * @throws {Error} when a configured budget is not whole positive milliseconds.
 */
export function apply(ctx, config) {
    const resolved = config;
    assertBudget('timeoutMs', resolved.timeoutMs);
    assertBudget('serverStartTimeoutMs', resolved.serverStartTimeoutMs);
    assertBudget('proxyFetchTimeoutMs', resolved.proxyFetchTimeoutMs);
    const deployment = resolveDeployment({
        pythonBin: resolved.pythonBin,
        scriptsDir: resolved.scriptsDir,
        dataDir: resolved.dataDir,
    });
    const browser = new CamoufoxBrowserService(deployment, resolved.serverStartTimeoutMs);
    ctx.effect(() => () => { browser.dispose(); }, 'tool-acquisition.browser-server');
    registerCrawlFetchTool(ctx, {
        deployment,
        browser,
        proxyMode: new SessionProxyMode(ctx),
        timeoutMs: resolved.timeoutMs,
        proxyTimeoutMs: resolved.proxyFetchTimeoutMs,
    });
}
//# sourceMappingURL=index.js.map