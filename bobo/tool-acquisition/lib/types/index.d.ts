/**
 * Model-facing `crawl_fetch`: renders one page through the deployment's
 * long-lived Camoufox browser service and saves the formats the call asks for.
 *
 * The plugin owns two things beyond the tool registration: the browser service
 * the captures share (stopped when this plugin instance is disposed, so a
 * session end closes the browser) and the session proxy fold a capture reads.
 * @module bobo-crawl-tool
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "tool-acquisition";
/** Services required before the tool can be registered. */
export declare const inject: string[];
/** Plugin config: deployment paths and the waits one capture may spend. */
export interface Config {
    /** Python interpreter path; blank or absent locates the project root's `.venv`. */
    pythonBin?: string;
    /** Directory holding the capture scripts; blank or absent locates `<project root>/scripts`. */
    scriptsDir?: string;
    /** Capture directory; blank or absent saves into the calling session's workspace `data`. */
    dataDir?: string;
    /** Budget for one crawl engine invocation, in milliseconds. Defaults to 120000. */
    timeoutMs?: number;
    /** Budget for the browser service to report itself ready after a launch, in milliseconds. Defaults to 60000. */
    serverStartTimeoutMs?: number;
    /** Budget for one proxy-pool invocation, in milliseconds. Defaults to 15000. */
    proxyFetchTimeoutMs?: number;
}
export declare const Config: z<Config>;
/**
 * Register `crawl_fetch` and take ownership of the browser service it drives.
 *
 * @param ctx - context whose `tools` registry receives the tool; the
 *   registration and the browser service both leave with this plugin instance.
 * @param config - deployment paths and budgets, validated by {@link Config}.
 * @throws {Error} when a configured budget is not whole positive milliseconds.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map