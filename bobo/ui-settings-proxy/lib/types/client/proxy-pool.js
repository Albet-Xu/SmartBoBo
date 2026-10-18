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
/** Settings namespace the host `/proxy` command draws proxy addresses from. */
export const PROXY_POOL_NAMESPACE = 'proxy-pool';
/** Fetch strategies the host schema accepts. */
export const FETCH_STRATEGIES = ['cache', 'realtime'];
/** Proxy types the host schema records per source. */
export const PROXY_HTTP_TYPES = ['http', 'socks5'];
/** Fields a source carries before the page adds a name to it. */
export const NEW_PROXY_SOURCE = {
    name: '',
    apiUrl: '',
    apiKey: '',
    pwd: '',
    getnum: 50,
    httptype: 'http',
    geshi: '2',
    fenge: '1',
    enabled: true,
};
/** Plain-object view of a wire value, or undefined for anything else. */
function asRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
/** A wire string, or the host schema's own default for a missing or mistyped field. */
function text(value, fallback) {
    return typeof value === 'string' ? value : fallback;
}
/** A wire count, or the fallback for a value the host schema could not have produced. */
function natural(value, fallback) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}
/** One source entry, or undefined when the wire entry is not an object. */
function decodeSource(value, defaults) {
    const row = asRecord(value);
    if (row === undefined)
        return undefined;
    return {
        name: text(row.name, defaults.name),
        apiUrl: text(row.apiUrl, defaults.apiUrl),
        apiKey: text(row.apiKey, defaults.apiKey),
        pwd: text(row.pwd, defaults.pwd),
        getnum: natural(row.getnum, defaults.getnum),
        httptype: text(row.httptype, defaults.httptype),
        geshi: text(row.geshi, defaults.geshi),
        fenge: text(row.fenge, defaults.fenge),
        enabled: typeof row.enabled === 'boolean' ? row.enabled : defaults.enabled,
    };
}
/**
 * Narrow one redacted settings section to the pool the page edits. The section
 * arrives from the wire, so every field falls back to the value the host
 * schema defaults it to when the section omits or mistypes it.
 * @param section - the `proxy-pool` namespace's resolved value.
 * @returns the pool, or undefined when the section is not an object at all.
 */
export function decodeProxyPool(section) {
    const row = asRecord(section);
    if (row === undefined)
        return undefined;
    const sources = Array.isArray(row.sources) ? row.sources : [];
    const strategy = row.fetchStrategy === 'realtime' ? 'realtime' : 'cache';
    return {
        sources: sources.flatMap((entry) => {
            const source = decodeSource(entry, NEW_PROXY_SOURCE);
            return source === undefined ? [] : [source];
        }),
        fetchStrategy: strategy,
        enabled: typeof row.enabled === 'boolean' ? row.enabled : false,
        maxRetries: natural(row.maxRetries, 3),
        timeoutMs: natural(row.timeoutMs, 30000),
    };
}
/**
 * The `proxy-pool` namespace view inside one settings mirror snapshot.
 * @param mirror - the shared describe mirror's snapshot.
 * @returns the namespace view, or undefined while unanswered or unregistered.
 */
export function proxyPoolView(mirror) {
    return mirror.view?.namespaces.find(row => row.ns === PROXY_POOL_NAMESPACE);
}
/**
 * Fold one settings mirror snapshot into the page's state.
 * @param mirror - the shared describe mirror's snapshot.
 * @returns the state the section renders.
 */
export function proxyPoolPageState(mirror) {
    // Terminator before the held view: a remote browser keeps preferences
    // process-local, so no read can ever answer here.
    if (mirror.status === 'unavailable')
        return { status: 'unavailable' };
    if (mirror.view === undefined) {
        return mirror.error === null
            ? { status: 'loading' }
            : { status: 'failed', reason: 'read', detail: mirror.error };
    }
    const view = proxyPoolView(mirror);
    if (view === undefined)
        return { status: 'absent' };
    const settings = decodeProxyPool(view.value);
    if (settings === undefined)
        return { status: 'failed', reason: 'section', detail: null };
    return {
        status: 'ready',
        settings,
        revision: view.revision,
        writable: mirror.view.writable,
        staleError: mirror.error,
    };
}
/**
 * Path operations carrying a whole edited pool into its namespace. Every
 * field the page owns is restated, so a field the host adds later keeps its
 * stored value rather than being dropped by this page's write.
 * @param settings - the edited pool.
 * @returns the operations one settings write applies.
 */
export function proxyPoolWriteOps(settings) {
    return [
        { op: 'set', path: ['sources'], value: settings.sources },
        { op: 'set', path: ['fetchStrategy'], value: settings.fetchStrategy },
        { op: 'set', path: ['enabled'], value: settings.enabled },
        { op: 'set', path: ['maxRetries'], value: settings.maxRetries },
        { op: 'set', path: ['timeoutMs'], value: settings.timeoutMs },
    ];
}
/**
 * Move one entry inside a list, leaving every other entry in place.
 * @param entries - the list to reorder; not modified.
 * @param from - index the entry currently sits at.
 * @param to - index the entry moves to.
 * @returns the reordered copy, or the same list when the move is a no-op.
 */
export function moveEntry(entries, from, to) {
    if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length)
        return entries;
    const next = [...entries];
    const [moved] = next.splice(from, 1);
    if (moved === undefined)
        return entries;
    next.splice(to, 0, moved);
    return next;
}
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
export function reorderSources(sources, from, to) {
    const next = moveEntry(sources, from, to);
    return next === sources ? null : next;
}
// ── Expanded row positions ───────────────────────────────────────────────
/**
 * Shift the open rows of a list that dropped one entry, so the rows around the
 * hole keep the entries they were open on. Row positions are the page's own
 * view state, so they follow every list mutation that moves entries around.
 * @param expanded - row positions open before the removal; not modified.
 * @param index - position the removed entry occupied.
 * @returns the open positions in the shortened list.
 */
export function dropExpanded(expanded, index) {
    const next = new Set();
    for (const at of expanded) {
        if (at === index)
            continue;
        next.add(at > index ? at - 1 : at);
    }
    return next;
}
/**
 * Shift the open rows of a list that moved one entry, so a row open on the
 * carried entry stays open on it at its new position.
 * @param expanded - row positions open before the move; not modified.
 * @param from - position the moved entry occupied.
 * @param to - position the moved entry takes.
 * @returns the open positions in the reordered list.
 */
export function moveExpanded(expanded, from, to) {
    const next = new Set();
    for (const at of expanded)
        next.add(movedPosition(at, from, to));
    return next;
}
/**
 * Where one row position lands once the entry at `from` moves onto `to`: the
 * carried position moves to the target, and the positions it travels over
 * shift by one toward the hole it left.
 * @param at - the position to map.
 * @param from - position the moved entry occupied.
 * @param to - position the moved entry takes.
 * @returns the position that entry occupies in the reordered list.
 */
function movedPosition(at, from, to) {
    if (at === from)
        return to;
    if (from < at && at <= to)
        return at - 1;
    if (to <= at && at < from)
        return at + 1;
    return at;
}
//# sourceMappingURL=proxy-pool.js.map