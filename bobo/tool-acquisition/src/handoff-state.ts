/**
 * The one human handoff a tool call is waiting on, held in memory and shared by
 * the two plugin modules that load in this process.
 *
 * The state lives in one module-level slot rather than in a Cordis service
 * because there is no browser-side push for it: `handoff.ts` registers the
 * handoff before it asks the user, and the right-panel browser plugin polls it
 * back through `bridge.ts`'s `handoff_state` op. Both modules are entries of
 * this package, so a shared import is what makes them read one value instead of
 * one each.
 * @module bobo-crawl-tool/handoff-state
 */

/** One human handoff waiting on the user. */
export interface PendingHandoff {
  /** Address of the page the user is asked to finish by hand. */
  readonly url: string
  /** Title of that page, empty when the page reports none. */
  readonly title: string
  /** What the page still needs from the human, such as 验证码 / 滑块 / 登录. */
  readonly reason: string
  /** Caller-supplied extra instruction shown with the question, empty when none. */
  readonly note: string
  /** `Date.now()` at registration; the panel uses it to tell one handoff from the next. */
  readonly at: number
}

/** The pending handoff, or null while no tool call is waiting on the user. */
let pending: PendingHandoff | null = null

/**
 * Register the handoff the calling tool is about to ask the user about. Called
 * before the question, because the panel's poll is what opens the mirror.
 * @param payload - the page, reason, note, and registration time.
 */
export function setPendingHandoff(payload: PendingHandoff): void {
  pending = payload
}

/**
 * Drop the pending handoff. An entry left behind keeps pulling the panel in
 * front of the user, so every path out of the question clears it.
 */
export function clearPendingHandoff(): void {
  pending = null
}

/**
 * Read the pending handoff.
 * @returns the pending handoff, or null when none is registered.
 */
export function readPendingHandoff(): PendingHandoff | null {
  return pending
}
