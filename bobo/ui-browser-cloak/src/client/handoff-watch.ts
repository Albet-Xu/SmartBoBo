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
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { COMMAND_URL } from './CloakPanel.tsx'
import { CLOAK_KIND } from './definition.tsx'

/**
 * Interval between two handoff polls.
 *
 * This is what the user feels between the agent giving up and the panel
 * arriving, so it cannot be a minute; it is also a round trip that every open
 * window repeats forever, so it cannot be the panel's frame rate. Four seconds
 * is shorter than reading the question the user is being asked, and the bridge
 * answers this op from memory — no browser, no page — so the cost at that
 * cadence is one request.
 * Tune here; nothing else depends on the value.
 */
const HANDOFF_POLL_MS = 4000

/**
 * Budget for one poll, covering the request and its answer.
 *
 * The bridge answers `handoff_state` without touching the browser, so this
 * bounds only a bridge that accepted the connection and then stopped talking;
 * without a bound, one such socket would hold the loop's single in-flight slot
 * until the plugin unloads.
 */
const HANDOFF_TIMEOUT_MS = 10_000

/** A JSON object, or null for an array, a scalar, or a parse failure. */
function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * A reply's `at` field read as epoch milliseconds; anything else is absent.
 *
 * An unrecognizable stamp is the same answer as no handoff at all: the stamp is
 * how this watcher tells one handoff from the next, and a handoff it cannot name
 * is one it would put in front of the user again on every poll.
 * @param value - the `at` field of a `handoff_state` reply.
 * @returns the stamp, or undefined when there is nothing to compare against.
 */
function asStamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Ask the bridge whether a handoff is waiting.
 *
 * Never rejects. The trust fence refusing this caller (401/403), an op this
 * bridge does not allow, a browser service that is not running, a timeout, a
 * socket failure, and an unreadable body all collapse into "no handoff", because
 * the watcher has no line of its own to write any of them into.
 *
 * Only the stamp is read from the reply: this watcher adds no copy, so the rest
 * of what the bridge reports about the handoff has no reader here.
 *
 * @param signal - the watcher's lifetime; aborting it cancels the request.
 * @returns the pending handoff's `at` stamp, or undefined when there is none.
 */
async function readPending(signal: AbortSignal): Promise<number | undefined> {
  const controller = new AbortController()
  const relay = (): void => { controller.abort() }
  signal.addEventListener('abort', relay, { once: true })
  const timer = window.setTimeout(relay, HANDOFF_TIMEOUT_MS)
  try {
    const response = await fetch(COMMAND_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'handoff_state' }),
      credentials: 'same-origin',
      signal: controller.signal,
    })
    // 401/403 are the connection service's trust fence, not a bridge failure.
    if (response.status === 401 || response.status === 403) return undefined
    const body = asObject(JSON.parse(await response.text()) as unknown)
    // `ok: false` is the bridge refusing the caller: an op it does not allow, or
    // a browser service that is not running. Both are the same absent handoff.
    if (body === null || body.ok !== true) return undefined
    const pending = asObject(body.pending)
    return pending === null ? undefined : asStamp(pending.at)
  } catch {
    // Swallows transport failures and unreadable bodies — offline, timeout,
    // abort, a route this deployment does not mount, an HTML error page: each is
    // the same watcher-level "no handoff".
    return undefined
  } finally {
    window.clearTimeout(timer)
    signal.removeEventListener('abort', relay)
  }
}

/**
 * Put the built-in browser panel in front of the user.
 *
 * A cloak tab already open in the column *is* the panel, so it is focused
 * rather than joined by a second one: the kind registers `multiple: true`, so
 * `openTab` would add another panel mirroring the same shared page, and every
 * later handoff would add one more. `focus` leaves a tab that is not in the
 * mounted session's layout alone, so the whole open-tab inventory can be handed
 * to it and only this session's tab reacts.
 *
 * Opening content expands the column in the same step, so a handoff that opens a
 * tab needs no separate expansion call.
 *
 * @param ctx - the plugin context; only its right-Sidebar face is read.
 */
function placePanel(ctx: Context): void {
  const open = ctx.sidebarRight.openTabs.getSnapshot().filter(tab => tab.kind === CLOAK_KIND)
  if (open.length === 0) {
    ctx.sidebarRight.openTab(CLOAK_KIND)
    return
  }
  for (const tab of open) ctx.sidebarRight.focus(tab.tabId)
}

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
export function watchHandoffs(ctx: Context): () => void {
  // The stamp of the handoff already placed in front of the user. A stamp is
  // epoch milliseconds, so 0 reads as "none yet" and no reply collides with it.
  let surfaced = 0
  let inFlight = false
  const lifetime = new AbortController()

  const poll = async (): Promise<void> => {
    if (inFlight) return
    inFlight = true
    try {
      const at = await readPending(lifetime.signal)
      if (at === undefined || at === surfaced) return
      // `sidebarRight` writes throw with no session surface mounted — the user is
      // not on the conversation page. There is nothing here to draw the panel in
      // and nothing to tell them, so the handoff stays unsurfaced and the next
      // poll tries again.
      try { placePanel(ctx) } catch (_unmountedSeat) { return }
      surfaced = at
    } finally {
      inFlight = false
    }
  }

  const timer = window.setInterval(() => { void poll() }, HANDOFF_POLL_MS)
  void poll()
  return () => {
    lifetime.abort()
    window.clearInterval(timer)
  }
}
