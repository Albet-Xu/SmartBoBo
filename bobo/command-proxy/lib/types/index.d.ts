/**
 * Human-facing `/proxy` command toggling proxy mode per session, and the
 * `proxy-pool` profile entry it switches on.
 *
 * While proxy mode is on, the acquisition tools route their fetches through
 * the pool this package's `proxy-pool` entry carries as volatile Config
 * fields, edited through the settings forms over that entry id. A session's
 * state is the last `proxy/enabled` event in its log, folded incrementally by
 * the `proxyMode` session projection.
 *
 * The `proxy-pool` entry and the projection are host-wide singletons:
 * `cordis.patch.yml` mounts one instance with `command: false` so the settings
 * page can configure the pool in every mode, shipped ones included, without
 * opening an acquisition-class session first. The command stays a per-preset
 * contribution — the four acquisition-class presets mount their own instance
 * with `namespace: false` and `projection: false`, because a second
 * presentation policy for the same entry fails loud. Preset instances read the
 * pool through the settings service's describe projection (the host entry's
 * live Config), never through their own Config, which carries only defaults.
 *
 * @module bobo-proxy-tool
 */
import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { z as zod } from 'zod';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
/** Cordis plugin name. */
export declare const name = "command-proxy";
/** Services required before the projection, presentation policy, and command are contributed. */
export declare const inject: string[];
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /**
         * Whether proxy mode is in force from this point on: log-only, non-surface,
         * whole-value replace. The last `proxy/enabled` wins; a log with none
         * folds to inactive through the `proxyMode` projection.
         */
        'proxy/enabled': {
            enabled: boolean;
        };
    }
}
/** Folded proxy-mode state of one session log. */
export interface ProxyModeState {
    /** Whether proxy mode is in force after every event folded so far. */
    enabled: boolean;
}
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionStateMap {
        /** Latest logged proxy-mode switch; false before one is logged. */
        proxyMode: ProxyModeState;
    }
}
/** Projection of the logged proxy-mode switches a session carries. */
export declare const proxyModeProjectionDefinition: {
    key: "proxyMode";
    stateVersion: number;
    stateSchema: zod.ZodType<ProxyModeState, unknown, zod.core.$ZodTypeInternals<ProxyModeState, unknown>>;
    init: () => {
        enabled: false;
    };
    apply: (state: NoInfer<ProxyModeState>, event: SessionEvent) => ProxyModeState;
};
/**
 * Whether proxy mode is in force after the given events: the last
 * `proxy/enabled` wins, and no such event means inactive. Consumers holding an
 * event slice fold it here; the `proxyMode` projection applies the same rule
 * incrementally.
 * @param events - session events in log order.
 * @param end - exclusive end index into `events`; defaults to the whole array.
 * @returns whether proxy mode is enabled at that cut.
 */
export declare function foldProxyEnabled(events: readonly SessionEvent[], end?: number): boolean;
/** Profile entry id whose volatile Config carries the proxy pool this command switches on. */
export declare const PROXY_POOL_NAMESPACE = "proxy-pool";
/** One proxy source entry in the pool configuration. */
export interface ProxySource {
    /** Human-readable name for this source. */
    name: string;
    /** The API URL to fetch proxy IPs from (e.g. a dmgetip.asp endpoint). */
    apiUrl: string;
    /** API key / username parameter. */
    apiKey: string;
    /** Password parameter (may be empty for key-only auth). */
    pwd: string;
    /** Number of IPs to fetch per request. */
    getnum: number;
    /** HTTP type: 'http' | 'socks5'. */
    httptype: string;
    /** Response format parameter (e.g. '2' for newline-separated). */
    geshi: string;
    /** Separator parameter (e.g. '1' for newline). */
    fenge: string;
    /** Whether this source is enabled. */
    enabled: boolean;
}
/** Schemastery validation for one {@link ProxySource} entry. */
export declare const ProxySourceSchema: z<ProxySource>;
/** The resolved `proxy-pool` section: the pool a proxy-mode session draws addresses from. */
export interface ProxyPoolSettings {
    /** Proxy sources this pool draws addresses from. */
    sources: ProxySource[];
    /** Fetch strategy: 'cache' = fetch a batch and rotate, 'realtime' = fetch per request. */
    fetchStrategy: 'cache' | 'realtime';
    /** Master switch: whether the pool serves any request at all. */
    enabled: boolean;
    /** Max retries per request before giving up. */
    maxRetries: number;
    /** Request timeout in milliseconds. */
    timeoutMs: number;
}
/**
 * This plugin's cordis.yml config: the pool (volatile, form-edited), plus one
 * switch per contribution this instance makes. Every switch defaults to true,
 * so a row that names no switch keeps contributing all three. The switches
 * stay ordinary (non-volatile) fields: they are deployment composition, not
 * user settings.
 */
export type Config = {
    [K in keyof ProxyPoolSettings]: Volatile<ProxyPoolSettings[K]>;
} & {
    /** Whether this instance owns the `proxy-pool` entry's settings presentation. */
    namespace: boolean;
    /** Whether this instance registers the `proxyMode` session projection. */
    projection: boolean;
    /** Whether this instance registers the `/proxy` command. */
    command: boolean;
};
/** Runtime validation for {@link Config}. */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    namespace: z<boolean, boolean, "defined">;
    projection: z<boolean, boolean, "defined">;
    command: z<boolean, boolean, "defined">;
    sources: z<NoInfer<ProxySource[]>, NoInfer<ProxySource[]>, "volatile-defined">;
    fetchStrategy: z<"cache" | "realtime", "cache" | "realtime", "volatile-defined">;
    enabled: z<boolean, boolean, "volatile-defined">;
    maxRetries: z<number, number, "volatile-defined">;
    timeoutMs: z<number, number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    namespace: z<boolean, boolean, "defined">;
    projection: z<boolean, boolean, "defined">;
    command: z<boolean, boolean, "defined">;
    sources: z<NoInfer<ProxySource[]>, NoInfer<ProxySource[]>, "volatile-defined">;
    fetchStrategy: z<"cache" | "realtime", "cache" | "realtime", "volatile-defined">;
    enabled: z<boolean, boolean, "volatile-defined">;
    maxRetries: z<number, number, "volatile-defined">;
    timeoutMs: z<number, number, "volatile-defined">;
}>>, "plain">;
/**
 * Whether a resolved `proxy-pool` value can hand a capture at least one
 * address: the pool switch is on and some source is enabled behind a non-empty
 * API URL.
 *
 * The value arrives untyped from the settings service, and the predicate
 * mirrors the filter `scripts/proxy_pool.py` applies while screening
 * (`enabled` absent or true, `apiUrl` non-empty), so proxy mode is never
 * switched on for a pool the pool script would skip whole.
 *
 * @param value - the resolved `proxy-pool` section; undefined while no
 *   `proxy-pool` entry serves a form (no settings service, or no such entry).
 * @returns whether the pool has an address to draw from.
 */
export declare function poolServesAddress(value: unknown): boolean;
/**
 * Contribute the parts this instance is switched on for: the `proxyMode`
 * projection, the `proxy-pool` entry's settings presentation policy, and the
 * `/proxy` command.
 *
 * The host layer mounts one instance with `command: false`, so the settings
 * page can configure the pool in every mode. The four acquisition-class
 * presets (crawl, reverse, workflow, empirical) mount their own instance with
 * `namespace: false` and `projection: false`: those two are host-wide
 * singletons, and a second presentation policy for the same entry fails loud.
 *
 * @param ctx - context providing the command registry and session projections.
 * @param config - the pool's volatile Config plus the switches above; preset
 *   instances ignore their own pool fields and read the host entry's section.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map