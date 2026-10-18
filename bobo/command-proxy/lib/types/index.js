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
import z from '@deepseek-ai/schemastery';
import { z as zod } from 'zod';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
/** Cordis plugin name. */
export const name = 'command-proxy';
/** Services required before the projection, presentation policy, and command are contributed. */
export const inject = ['commands', 'sessionProjections'];
const proxyModeStateSchema = zod.object({ enabled: zod.boolean() }).strict();
/** Projection of the logged proxy-mode switches a session carries. */
export const proxyModeProjectionDefinition = {
    key: 'proxyMode',
    stateVersion: 1,
    stateSchema: proxyModeStateSchema,
    init: () => ({ enabled: false }),
    apply: (state, event) => event.type === 'proxy/enabled' ? { enabled: event.data.enabled } : state,
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
export function foldProxyEnabled(events, end = events.length) {
    let enabled = false;
    let index = 0;
    for (const event of events) {
        if (index >= end)
            break;
        index++;
        if (event.type === 'proxy/enabled')
            enabled = event.data.enabled;
    }
    return enabled;
}
/**
 * Read one session's folded proxy-mode state.
 * @param ctx - context carrying the session projection registry.
 * @param session - session whose `proxy/enabled` events are folded.
 * @returns whether proxy mode is in force.
 * @throws when the `proxyMode` projection is not registered.
 */
function proxyModeOf(ctx, session) {
    const state = ctx.sessionProjections.stateOf(session, 'proxyMode');
    if (state === undefined)
        throw new Error('command-proxy requires the proxyMode session projection');
    return state.enabled;
}
// ── Pool configuration ───────────────────────────────────────────────────
/** Profile entry id whose volatile Config carries the proxy pool this command switches on. */
export const PROXY_POOL_NAMESPACE = 'proxy-pool';
/** Schemastery validation for one {@link ProxySource} entry. */
export const ProxySourceSchema = z.object({
    name: z.string(),
    apiUrl: z.string(),
    apiKey: z.string(),
    pwd: z.string().default(''),
    getnum: z.natural().default(50),
    httptype: z.string().default('http'),
    geshi: z.string().default('2'),
    fenge: z.string().default('1'),
    enabled: z.boolean().default(true),
});
/**
 * Field set of the pool itself, shared by the plugin config below. Each field is
 * `.volatile()` so it appears in the `proxy-pool` entry's settings form.
 */
const proxyPoolDict = {
    sources: z.array(ProxySourceSchema).default([]).volatile(),
    fetchStrategy: z.union([z.const('cache'), z.const('realtime')]).default('cache').volatile(),
    enabled: z.boolean().default(false).volatile(),
    maxRetries: z.natural().default(3).volatile(),
    timeoutMs: z.natural().default(30000).volatile(),
};
/** Runtime validation for {@link Config}. */
export const Config = z.object({
    ...proxyPoolDict,
    namespace: z.boolean().default(true),
    projection: z.boolean().default(true),
    command: z.boolean().default(true),
});
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
export function poolServesAddress(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const { enabled, sources } = value;
    if (enabled !== true || !Array.isArray(sources))
        return false;
    return sources.some((source) => {
        if (typeof source !== 'object' || source === null)
            return false;
        const { apiUrl, enabled: sourceEnabled } = source;
        return sourceEnabled !== false && typeof apiUrl === 'string' && apiUrl !== '';
    });
}
// ── Plugin body ──────────────────────────────────────────────────────────
/** What the user reads when proxy mode is asked for and the pool has no address to serve. */
const POOL_EMPTY_TEXT = '代理池没有可用代理，退出代理模式。';
/**
 * Read the live `proxy-pool` section through the settings service's describe
 * projection: the section is the host entry's volatile Config, so every
 * instance — preset instances included — reads the same values the settings
 * page edits, rather than its own composition defaults.
 * @param settings - the settings service; absent in a deployment that composes none.
 * @param ns - profile entry id carrying the section.
 * @returns the section, or undefined while that entry serves no form.
 */
function poolSectionOf(settings, ns) {
    return settings?.describe().find(descriptor => descriptor.ns === ns)?.value;
}
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
export function apply(ctx, config) {
    const { namespace, projection, command } = config;
    if (projection) {
        ctx.sessionProjections.register(proxyModeProjectionDefinition);
    }
    if (namespace) {
        // The page this entry's form belongs to ships in ui-settings-proxy; tell
        // Settings not to auto-generate one beside it. Optional: the business
        // plugin runs without a Settings service.
        ctx.inject(['settings'], (settingsCtx) => {
            settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
        });
    }
    if (command) {
        ctx.commands.register({
            name: 'proxy',
            description: 'Toggle proxy mode on/off for the current session',
            input: { hint: '[off]' },
            handler: (invocation) => {
                const { agent, rawInput } = invocation;
                // Parse trailing input into an explicit on/off mode plus the remaining
                // content to hand to the model. Bare `/proxy` means ON (idempotent);
                // anything that is not a leading on/off keyword is treated as a crawl
                // / edit intent and forwarded verbatim — it is never swallowed.
                const trimmed = rawInput.trim();
                const m = /^\s*(on|off)\b([\s\S]*)$/i.exec(trimmed);
                let mode;
                let rest;
                if (m !== null) {
                    const [, kw, tail] = m;
                    mode = (kw ?? '').toLowerCase() === 'on';
                    rest = (tail ?? '').trim();
                }
                else {
                    mode = true;
                    rest = trimmed;
                }
                // A mode the pool cannot serve would fail every capture it touches, so
                // the switch is refused here rather than at the first fetch and the
                // session is left off — including a session that already had it on.
                // A pending remainder is not forwarded: the user asked for the proxy,
                // and silently crawling on the local network answers a different ask.
                if (mode && !poolServesAddress(poolSectionOf(ctx.get('settings'), PROXY_POOL_NAMESPACE))) {
                    if (proxyModeOf(ctx, agent.session)) {
                        agent.session.append('proxy/enabled', { enabled: false });
                    }
                    agent.followup(createUserMessage({
                        content: [{
                                type: 'text',
                                text: `代理池没有可用代理，代理模式未开启；请向用户做一句简短说明（例如“${POOL_EMPTY_TEXT}”）。`,
                            }],
                        source: { kind: 'user' },
                    }));
                    return { kind: 'success', text: POOL_EMPTY_TEXT };
                }
                if (mode !== proxyModeOf(ctx, agent.session)) {
                    // Append the state change to the session log.
                    agent.session.append('proxy/enabled', { enabled: mode });
                }
                const stateText = mode
                    ? '代理模式已开启，采集请求将走代理池。'
                    : '代理模式已关闭，采集请求将走本地网络。';
                // Double channel: a short host ack card (deterministic fallback even if
                // the model is unreachable) plus a model turn that speaks to the user.
                if (rest !== '') {
                    // Route the remainder to the model as a normal user message so it
                    // handles the crawl / task through the (now on/off) proxy.
                    agent.followup(createUserMessage({
                        content: [{ type: 'text', text: rest }],
                        source: { kind: 'user' },
                    }));
                }
                else {
                    // Bare on/off: ask the model to confirm the state change aloud.
                    agent.followup(createUserMessage({
                        content: [{ type: 'text', text: mode
                                    ? '用户开启了代理模式，请向用户做一句简短确认（例如“代理模式已开启”）。'
                                    : '用户关闭了代理模式，请向用户做一句简短确认（例如“代理模式已关闭”）。' }],
                        source: { kind: 'user' },
                    }));
                }
                return {
                    kind: 'success',
                    text: rest !== '' ? `${stateText} 已把后续请求转给模型。` : stateText,
                };
            },
        });
    }
}
//# sourceMappingURL=index.js.map