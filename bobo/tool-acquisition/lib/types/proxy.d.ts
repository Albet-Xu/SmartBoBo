/**
 * Proxy state for one capture: whether the calling session turned proxy mode
 * on, and the pool configuration a capture asks for an address.
 *
 * Session state is folded from the `proxy/enabled` session events, last value
 * winning. The pool configuration is read from the `proxy-pool` profile entry
 * through the settings service's describe projection — the sibling
 * `bobo-proxy-tool` plugin's entry carries it as volatile Config fields, and
 * this plugin reads that entry's live section rather than instantiating the
 * pool itself — then narrows the fields `scripts/proxy_pool.py` consumes.
 * @module bobo-crawl-tool/proxy
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import type SettingsForms from '@deepseek-ai/dsh-settings';
/** Profile entry id carrying the proxy pool sources and strategy. */
export declare const PROXY_POOL_NAMESPACE = "proxy-pool";
/** How the pool serves an address: a reused batch of validated IPs, or one fetched per request. */
export type ProxyFetchStrategy = 'cache' | 'realtime';
/** One proxy source, in the shape `scripts/proxy_pool.py` consumes. */
export interface ProxySource {
    /** Human-readable name, used in pool diagnostics only. */
    readonly name: string;
    /** Endpoint the IPs are fetched from. */
    readonly apiUrl: string;
    /** API key or username parameter. */
    readonly apiKey: string;
    /** Password parameter; empty for key-only authentication. */
    readonly pwd: string;
    /** IPs requested per fetch. */
    readonly getnum: number;
    /** Proxy protocol, `http` or `socks5`. */
    readonly httptype: string;
    /** Response-format parameter of the source API. */
    readonly geshi: string;
    /** Separator parameter of the source API. */
    readonly fenge: string;
    /** Whether this source may be used. */
    readonly enabled: boolean;
}
/** The `proxy-pool` section fields one capture reads. */
export interface ProxyPool {
    /** Master switch of the pool. */
    readonly enabled: boolean;
    /** Configured sources, enabled or not. */
    readonly sources: readonly ProxySource[];
    /** Address reuse strategy. */
    readonly fetchStrategy: ProxyFetchStrategy;
    /** Per-request timeout the pool applies while validating a candidate, in milliseconds. */
    readonly timeoutMs: number;
}
/** Proxy mode of one session, folded from that session's committed events. */
export declare class SessionProxyMode {
    private readonly enabled;
    /**
     * @param ctx - context whose fiber owns the session-event subscription, so
     *   the fold stops with the plugin instance.
     */
    constructor(ctx: Context);
    /**
     * Whether proxy mode is on for `session` after its committed events. A
     * session whose `proxy/enabled` events were appended before this plugin
     * subscribed — a resumed session — reads as off until its next one.
     * @param session - the session to read.
     * @returns the last committed value; off when the session logged none.
     */
    of(session: Session): boolean;
}
/**
 * Read the resolved `proxy-pool` section for one capture.
 *
 * The section is another plugin entry's volatile Config, so it arrives
 * through the settings service's describe projection: this finds the
 * descriptor whose ns is the `proxy-pool` entry id and narrows the fields the
 * pool script consumes, rather than forwarding a malformed candidate.
 *
 * @param settings - the settings service; absent in a deployment that composes none.
 * @returns the pool, or undefined while no `proxy-pool` entry serves a form.
 * @throws {Error} when the section is registered but does not carry this plugin's fields.
 */
export declare function proxyPoolOf(settings: SettingsForms | undefined): ProxyPool | undefined;
/**
 * Ask the deployment's proxy pool for one address usable for `targetUrl`.
 *
 * @param pythonBin - interpreter running the pool script.
 * @param scriptsDir - directory holding `proxy_pool.py`.
 * @param pool - the resolved pool section.
 * @param targetUrl - the page the address has to reach.
 * @param timeoutMs - budget for the pool script itself.
 * @param signal - caller cancellation.
 * @returns the proxy URL, with scheme, to inject into the browser service.
 * @throws {Error} when the pool reports that every candidate failed or that
 *   none is available; the message is the question the model relays to the user.
 */
export declare function acquireProxy(pythonBin: string, scriptsDir: string, pool: ProxyPool, targetUrl: string, timeoutMs: number, signal: AbortSignal | undefined): Promise<string>;
//# sourceMappingURL=proxy.d.ts.map