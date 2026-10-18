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
import type { Context } from '@deepseek-ai/cordis';
import type { CamoufoxBrowserService } from './browser-server.ts';
import { type Deployment } from './deployment.ts';
import { type SessionProxyMode } from './proxy.ts';
/** Model-visible tool name. */
export declare const CRAWL_FETCH_TOOL = "crawl_fetch";
/** Output formats the engine can derive, each from the same rendered document. */
export declare const OUTPUT_FORMATS: readonly ["html", "md", "skeleton"];
/** Dependencies one registration binds. */
export interface CrawlFetchDeps {
    /** Resolved deployment paths. */
    readonly deployment: Deployment;
    /** Lifecycle owner of the browser service this tool drives. */
    readonly browser: CamoufoxBrowserService;
    /** Session-scoped proxy mode, folded from `proxy/enabled`. */
    readonly proxyMode: SessionProxyMode;
    /** Budget for one engine invocation. */
    readonly timeoutMs: number;
    /** Budget for one proxy-pool invocation. */
    readonly proxyTimeoutMs: number;
}
/**
 * Validate the requested output formats.
 *
 * @param requested - the model's `outputFormat` value, comma-separated.
 * @returns the accepted formats in request order without duplicates, or `md`
 *   when the request names none of {@link OUTPUT_FORMATS}.
 */
export declare function parseOutputFormats(requested: string | undefined): string[];
/**
 * Register `crawl_fetch` on the tools registry of the calling plugin instance.
 *
 * @param ctx - context whose `tools` registry receives the registration; the
 *   registration is effect-scoped and leaves with that instance.
 * @param deps - resolved deployment, browser-service owner, proxy fold, and budgets.
 */
export declare function registerCrawlFetchTool(ctx: Context, deps: CrawlFetchDeps): void;
//# sourceMappingURL=crawl-tool.d.ts.map