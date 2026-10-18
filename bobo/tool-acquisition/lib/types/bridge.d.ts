/**
 * Host half of the right-panel browser mirror: one POST route carrying the
 * panel's commands to the deployment's long-lived Camoufox browser service
 * (`scripts/browser_server.py`) and back.
 *
 * The bridge owns no browser. `status` and every forwarded command address the
 * deployment's derived port, so the panel drives the very session page a
 * capture or a debug session already holds, and an idle panel starts no
 * process. `start` is the single op that may launch the service, through the
 * same derived-port-then-spawn path a capture takes, so both reach one browser
 * instead of two.
 *
 * Security has one home, as on every host route: the composition's `connection`
 * service answers `requestRejection` first, so its Host/Origin fence plus the
 * browser authentication gate every command before its body is read.
 * @module bobo-crawl-tool/bridge
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "bobo-browser-bridge";
/** The route carrier and the trust fence every command passes before it is read. */
export declare const inject: string[];
/** Bridge config: the waits one command may spend, all in whole milliseconds. */
export interface Config {
    /** Budget for one ordinary forwarded command to answer. Defaults to 15000. */
    opTimeoutMs?: number;
    /** Budget for one `screenshot` frame, which renders and encodes a JPEG. Defaults to 30000. */
    screenshotTimeoutMs?: number;
    /** Budget for one `debug_navigate`, which loads a whole page. Defaults to 120000. */
    timeoutMs?: number;
    /** Budget for the browser service to report itself ready after a launch, in milliseconds. Defaults to 60000. */
    serverStartTimeoutMs?: number;
}
export declare const Config: z<Config>;
/**
 * Register the panel's command route.
 *
 * @param ctx - context whose `webServer` receives the route and whose
 *   `connection` decides every caller's trust; the route leaves with this
 *   plugin instance.
 * @param config - command budgets, validated by {@link Config}.
 * @throws {Error} when a configured budget is not whole positive milliseconds.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=bridge.d.ts.map