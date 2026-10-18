/**
 * Proxy pool contract for the settings page: the field set the host
 * `/proxy` command reads, the defaults a new entry starts from, and the pure
 * folds that turn one settings namespace view into the page's state.
 *
 * Field names and types are the host package's own, imported rather than
 * restated, so a rename on either side fails to compile.
 *
 * @module bobo-settings-proxy-ui/proxy-pool
 */
import type { ProxyPoolSettings, ProxySource } from 'bobo-proxy-tool';
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client';
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client';
/** Settings namespace the host `/proxy` command draws proxy addresses from. */
export declare const PROXY_POOL_NAMESPACE = "proxy-pool";
/** Fetch strategies the host schema accepts. */
export declare const FETCH_STRATEGIES: readonly ["cache", "realtime"];
/** Proxy types the host schema records per source. */
export declare const PROXY_HTTP_TYPES: readonly ["http", "socks5"];
/** Fields a source carries before the page adds a name to it. */
export declare const NEW_PROXY_SOURCE: ProxySource;
/** What a settings write answered, as the page renders it. */
export type ProxyPoolSaveOutcome = 
/** Committed; the page's mirror already carries the answer. */
{
    kind: 'written';
}
/** The stored revision moved after the page read it. */
 | {
    kind: 'conflict';
}
/** The host serves no `proxy-pool` namespace to this client. */
 | {
    kind: 'absent';
}
/** Any other refusal, carrying the host's own diagnostic. */
 | {
    kind: 'refused';
    message: string;
};
/**
 * State the page renders from, folded from the shared settings mirror.
 * `failed` distinguishes a document read that answered nothing from a
 * namespace whose value is not the pool object this page edits, because only
 * the first is worth retrying.
 */
export type ProxyPoolPageState = {
    status: 'loading';
}
/** The connection keeps preferences process-local, so no read can ever answer. */
 | {
    status: 'unavailable';
}
/** The document answered, and no live plugin registered `proxy-pool` on it. */
 | {
    status: 'absent';
} | {
    status: 'failed';
    reason: 'read' | 'section';
    detail: string | null;
} | {
    status: 'ready';
    settings: ProxyPoolSettings;
    /** Revision the next write is fenced against. */
    revision: number;
    writable: boolean;
    /** A refresh failure the held view still answers despite; null when the read is clean. */
    staleError: string | null;
};
/**
 * Narrow one redacted settings section to the pool the page edits. The section
 * arrives from the wire, so every field falls back to the value the host
 * schema defaults it to when the section omits or mistypes it.
 * @param section - the `proxy-pool` namespace's resolved value.
 * @returns the pool, or undefined when the section is not an object at all.
 */
export declare function decodeProxyPool(section: unknown): ProxyPoolSettings | undefined;
/**
 * The `proxy-pool` namespace view inside one settings mirror snapshot.
 * @param mirror - the shared describe mirror's snapshot.
 * @returns the namespace view, or undefined while unanswered or unregistered.
 */
export declare function proxyPoolView(mirror: SettingsMirrorSnapshot): SettingsNamespaceView | undefined;
/**
 * Fold one settings mirror snapshot into the page's state.
 * @param mirror - the shared describe mirror's snapshot.
 * @returns the state the section renders.
 */
export declare function proxyPoolPageState(mirror: SettingsMirrorSnapshot): ProxyPoolPageState;
/**
 * Path operations carrying a whole edited pool into its namespace. Every
 * field the page owns is restated, so a field the host adds later keeps its
 * stored value rather than being dropped by this page's write.
 * @param settings - the edited pool.
 * @returns the operations one settings write applies.
 */
export declare function proxyPoolWriteOps(settings: ProxyPoolSettings): SettingsPathOpView[];
/**
 * Move one entry inside a list, leaving every other entry in place.
 * @param entries - the list to reorder; not modified.
 * @param from - index the entry currently sits at.
 * @param to - index the entry moves to.
 * @returns the reordered copy, or the same list when the move is a no-op.
 */
export declare function moveEntry<T>(entries: readonly T[], from: number, to: number): readonly T[];
/**
 * Reorder the source list for a drag that carried one entry from `from` to
 * `to`, told apart from a gesture that asks for no write at all. Ordering is
 * the array's own order, so a drop and the priority buttons apply the same
 * move through {@link moveEntry}.
 * @param sources - the list the drag started from; not modified.
 * @param from - index the carried source occupied when the drag started.
 * @param to - index the drop targets, in that same list.
 * @returns the reordered copy, or null when the drop asks for nothing: the
 *   source dropped back onto itself, or an index outside the list.
 */
export declare function reorderSources(sources: readonly ProxySource[], from: number, to: number): readonly ProxySource[] | null;
/**
 * Shift the open rows of a list that dropped one entry, so the rows around the
 * hole keep the entries they were open on. Row positions are the page's own
 * view state, so they follow every list mutation that moves entries around.
 * @param expanded - row positions open before the removal; not modified.
 * @param index - position the removed entry occupied.
 * @returns the open positions in the shortened list.
 */
export declare function dropExpanded(expanded: ReadonlySet<number>, index: number): ReadonlySet<number>;
/**
 * Shift the open rows of a list that moved one entry, so a row open on the
 * carried entry stays open on it at its new position.
 * @param expanded - row positions open before the move; not modified.
 * @param from - position the moved entry occupied.
 * @param to - position the moved entry takes.
 * @returns the open positions in the reordered list.
 */
export declare function moveExpanded(expanded: ReadonlySet<number>, from: number, to: number): ReadonlySet<number>;
//# sourceMappingURL=proxy-pool.d.ts.map