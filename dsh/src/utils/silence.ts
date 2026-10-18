/**
 * Shared utility for intentionally swallowed errors in catch blocks.
 *
 * Use in catch blocks where the error is intentionally swallowed because it's
 * already handled elsewhere (e.g., by an error boundary, mutation onError, or
 * app error state).
 *
 * In dev mode, logs to console.warn with the reason for visibility.
 * In production, does nothing (truly silent).
 */
export function silence(error: unknown, reason?: string): void {
  if (import.meta.env.DEV) {
    console.warn(reason ? `[silenced] ${reason}` : '[silenced]', error)
  }
}
