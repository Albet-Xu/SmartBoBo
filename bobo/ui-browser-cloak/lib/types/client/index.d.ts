/**
 * Browser half of the built-in browser panel: registers the `cloak` tab
 * type, its guide entry, the panel body, and the chip title in the right
 * Sidebar.
 *
 * Beyond the panel it runs the handoff watcher, which surfaces that panel when
 * the host reports a manual takeover waiting (`handoff-watch.ts`).
 *
 * Every contribution is an effect. Registering from the plugin body without
 * `ctx.effect` installs the contribution in the caller's active effect scope
 * and stalls the browser boot, so each `register` (and the dictionary it needs)
 * is owned by its own effect here.
 *
 * The panel needs no store and no injected business face: all its state is
 * local to the component, and its only input is the locale `t` seat, which the
 * body registration's `locale` declaration supplies.
 */
import type { Context } from '@deepseek-ai/cordis';
export type { CloakPanelProps } from './CloakPanel.tsx';
export type { CloakTitleProps } from './definition.tsx';
export type { BrowserCloakKey } from './locales.ts';
/** Required services: the slot seats, the dictionary registry, the tab-type registry, and the column the watcher surfaces. */
export declare const inject: string[];
/**
 * Register the built-in browser type, its copy, its body, its title, and the
 * watcher that surfaces it for a handoff.
 * @param ctx - the browser plugin context.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map