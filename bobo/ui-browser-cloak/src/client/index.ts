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
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { CloakPanel } from './CloakPanel.tsx'
import { CLOAK_ID, cloakDefinition, CloakTitle } from './definition.tsx'
import { watchHandoffs } from './handoff-watch.ts'
import { en, zh } from './locales.ts'

export type { CloakPanelProps } from './CloakPanel.tsx'
export type { CloakTitleProps } from './definition.tsx'
export type { BrowserCloakKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'browserCloak'

/** Required services: the slot seats, the dictionary registry, the tab-type registry, and the column the watcher surfaces. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']

/**
 * Register the built-in browser type, its copy, its body, its title, and the
 * watcher that surfaces it for a handoff.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-browser-cloak: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register(cloakDefinition(t)), 'ui-browser-cloak: type')
  ctx.effect(() => watchHandoffs(ctx), 'ui-browser-cloak: handoff watcher')
  // Registration goes through `slots.inject`: the body slot is declared by the
  // right Sidebar's own entry, whose load order is not this plugin's business.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: CLOAK_ID,
    locale: NS,
  }, CloakPanel)), 'ui-browser-cloak: body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: CLOAK_ID,
  }, CloakTitle)), 'ui-browser-cloak: title')
}
