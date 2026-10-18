/**
 * The manual-handoff watcher: the browser half of one human takeover.
 *
 * A handoff is the host bridge's record of an interaction the agent cannot get
 * through on its own — a captcha, a login wall — together with the page it
 * stopped on. The bridge answers for it on the panel's own route, out of memory,
 * under the `handoff_state` op: that answer opens no browser and no page, so a
 * poll costs one round trip to the same origin and nothing else.
 *
 * The host cannot push. The deployment's host-to-page event allowlist is fixed
 * and its one `registerRemoteEvents` seat is already taken, so polling is the
 * whole channel. What a handoff asks of the browser is a single thing: put the
 * built-in browser panel in front of the user, so they answer where the page
 * lives — the panel mirrors the very page the agent is stuck on, and carries the
 * input that gets through it.
 *
 * Silence is this module's contract with the user. Every answer that is not a
 * pending handoff — an op the bridge does not allow, a browser service that is
 * not running, the trust fence refusing this caller, a socket that never answers
 * — leaves the screen exactly as it was, because none of them is anything the
 * user can act on and a background poll that draws attention is worse than a
 * missed pop.
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * Watch for pending manual handoffs and surface the panel for each new one.
 *
 * One poll is in flight at a time. A handoff is recorded as surfaced only after
 * the call that placed the panel returned, so a poll that landed while no
 * session surface was mounted — the user is on another panel, or the app just
 * booted — is retried on the next tick rather than being dropped.
 *
 * @param ctx - the plugin context.
 * @returns the disposer that stops the loop; the caller's effect scope owns it.
 */
export declare function watchHandoffs(ctx: Context): () => void;
//# sourceMappingURL=handoff-watch.d.ts.map