import type { ReactNode } from 'react';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/**
 * The one bridge route, shared with the handoff watcher that asks the bridge for
 * a waiting handoff on it; same-origin, so the browser attaches the session
 * cookie by itself.
 */
export declare const COMMAND_URL = "/bobo-cloak/cmd";
/** Panel props assembled by the Sidebar body seat. */
export type CloakPanelProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'browserCloak'>;
/**
 * Render the built-in browser panel.
 * @param props - body-seat props from the framework; this panel uses only the `t` copy seat.
 * @returns the toolbar, status row, frame surface, and input controls.
 */
export declare function CloakPanel({ t }: CloakPanelProps): ReactNode;
//# sourceMappingURL=CloakPanel.d.ts.map