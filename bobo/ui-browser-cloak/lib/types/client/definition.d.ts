/**
 * Static built-in browser tab type, its guide entry, and its chip title.
 *
 * The type carries no address patterns: it is a page type, opened by kind from
 * the guide entry below or from the Sidebar's own new-tab affordance.
 */
import type { ReactNode } from 'react';
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client';
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Built-in browser tab kind. */
export declare const CLOAK_KIND = "cloak";
/** Built-in browser implementation identity and keyed Slot dispatch key. */
export declare const CLOAK_ID = "bobo-browser-ui";
/**
 * Build the built-in browser type with locale-live copy.
 * @param t - translate function of the `browserCloak` namespace.
 * @returns the tab type, its guide entry, and its chip title.
 */
export declare function cloakDefinition(t: TranslateNS<'browserCloak'>): SidebarRightTabDefinition;
/** Chip title props assembled by the Sidebar title seat. */
export type CloakTitleProps = PropsRuntime<'sidebar.right.pane.tab.title'>;
/**
 * Chip content: the panel glyph plus the title the layout captured when the tab
 * opened. The page's own title lives in the panel's status row, which the frame
 * loop refreshes; the chip has no store to read and stays the type's name.
 * @param props - title-seat props from the framework.
 * @returns the glyph and the tab's recorded title.
 */
export declare function CloakTitle({ useTabInfo }: CloakTitleProps): ReactNode;
//# sourceMappingURL=definition.d.ts.map