/**
 * Lifecycle owner of the deployment's long-lived Camoufox browser service
 * (`scripts/browser_server.py`).
 *
 * The service is launched on the first capture that needs it, reused by every
 * later capture of the same plugin instance, and stopped when that instance is
 * disposed — so an agent session end closes the browser instead of leaving it
 * running. A service that died is relaunched by the next capture.
 *
 * The module also owns the service's one-command-per-connection wire: {@link
 * sendCommand} is the single place that speaks it, so the bridge's route and
 * the handoff tool reach the service the same way.
 * @module bobo-crawl-tool/browser-server
 */
import type { Deployment } from './deployment.ts';
/**
 * Port derived from the project root, by the same rule as
 * `scripts/crawl_common.py::derive_browser_port`, so every consumer in a
 * deployment reaches one browser instance rather than launching its own.
 *
 * `crc32` returns a signed int32 and Python's `zlib.crc32` an unsigned one;
 * the unsigned shift reconciles them.
 *
 * @param root - BoBo project root.
 * @returns the derived TCP port, inside [{@link PORT_BASE}, {@link PORT_BASE}+{@link PORT_SPAN}).
 */
export declare function deriveBrowserPort(root: string): number;
/**
 * Whether a browser service already answers on `port`.
 * @param port - TCP port to probe.
 * @returns true when the service replied inside {@link PROBE_TIMEOUT_MS}.
 */
export declare function probeBrowserService(port: number): Promise<boolean>;
/**
 * Send one request line to the browser service and read its one-line reply.
 *
 * The service answers one line per connection and then closes, so the reply is
 * complete at its first newline; a connection that never produces one — a
 * refusal, a deadline, a reply past {@link MAX_REPLY_BYTES} — is the null case.
 *
 * @param port - the service's loopback TCP port.
 * @param request - the command object, serialized as one JSON line.
 * @param timeoutMs - budget covering connect, write, and reply.
 * @returns the parsed reply, or null when the service did not answer.
 */
export declare function sendCommand(port: number, request: unknown, timeoutMs: number): Promise<unknown>;
/**
 * Owns one deployment's browser service. Concurrent captures share a single
 * launch; an already running service keeps the proxy it was started with,
 * because the proxy reaches the browser only at service start.
 */
export declare class CamoufoxBrowserService {
    private readonly deployment;
    private readonly startTimeoutMs;
    private child;
    private port;
    private starting;
    /**
     * @param deployment - resolved deployment paths.
     * @param startTimeoutMs - budget for the service to print its READY line.
     */
    constructor(deployment: Deployment, startTimeoutMs: number);
    /**
     * Endpoint of a running service, launching one when none is.
     * @param proxy - proxy URL injected when this call has to launch the
     *   service; ignored by an instance that is already running.
     * @returns the `host:port` endpoint `run_camoufox.py --server` connects to.
     */
    endpoint(proxy: string | undefined): Promise<string>;
    /**
     * Stop the service and the browser processes it owns. Safe to call while
     * none runs, and safe to call twice.
     */
    dispose(): void;
    /** Port of a running service, launching one when none is. */
    private ready;
    /** Attach the service to a port: reuse the derived one when a peer serves it, otherwise spawn one. */
    private launch;
    /** Resolve with the port the service reports on stdout, or reject on timeout or early exit. */
    private awaitReady;
}
//# sourceMappingURL=browser-server.d.ts.map