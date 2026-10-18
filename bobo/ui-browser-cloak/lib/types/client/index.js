import { CloakPanel } from "./CloakPanel.js";
import { CLOAK_ID, cloakDefinition, CloakTitle } from "./definition.js";
import { watchHandoffs } from "./handoff-watch.js";
import { en, zh } from "./locales.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'browserCloak';
/** Required services: the slot seats, the dictionary registry, the tab-type registry, and the column the watcher surfaces. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'];
/**
 * Register the built-in browser type, its copy, its body, its title, and the
 * watcher that surfaces it for a handoff.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx) {
    const t = ctx.locale.bind(NS);
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-browser-cloak: dictionaries');
    ctx.effect(() => ctx.sidebarRightTabs.register(cloakDefinition(t)), 'ui-browser-cloak: type');
    ctx.effect(() => watchHandoffs(ctx), 'ui-browser-cloak: handoff watcher');
    // Registration goes through `slots.inject`: the body slot is declared by the
    // right Sidebar's own entry, whose load order is not this plugin's business.
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: CLOAK_ID,
        locale: NS,
    }, CloakPanel)), 'ui-browser-cloak: body');
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: CLOAK_ID,
    }, CloakTitle)), 'ui-browser-cloak: title');
}
//# sourceMappingURL=index.js.map