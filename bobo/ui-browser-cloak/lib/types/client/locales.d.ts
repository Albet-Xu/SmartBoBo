/**
 * Locale-owned copy for the built-in browser panel.
 *
 * The Simplified Chinese dictionary is the key-set authority; the English one
 * is checked against it, so a key added to one without the other is a compile
 * error.
 */
/** Copy for the right Sidebar's built-in browser tab. */
export declare const zh: {
    'type.label': string;
    'guide.title': string;
    'guide.description': string;
    'phase.probing': string;
    'phase.idle': string;
    'phase.live': string;
    'phase.paused': string;
    start: string;
    'start.pending': string;
    'address.placeholder': string;
    go: string;
    reload: string;
    nopage: string;
    'tabs.label': string;
    'tabs.close': string;
    'frame.label': string;
    'keyboard.hint': string;
    'insert.placeholder': string;
    'insert.send': string;
    'error.notRunning': string;
    'error.frame': string;
    'error.pageClosed': string;
    'error.denied': string;
    'error.request': string;
};
/** The `browserCloak` namespace key union. */
export type BrowserCloakKey = keyof typeof zh;
/** English copy, keyed by the same keys as {@link zh}. */
export declare const en: {
    'type.label': string;
    'guide.title': string;
    'guide.description': string;
    'phase.probing': string;
    'phase.idle': string;
    'phase.live': string;
    'phase.paused': string;
    start: string;
    'start.pending': string;
    'address.placeholder': string;
    go: string;
    reload: string;
    nopage: string;
    'tabs.label': string;
    'tabs.close': string;
    'frame.label': string;
    'keyboard.hint': string;
    'insert.placeholder': string;
    'insert.send': string;
    'error.notRunning': string;
    'error.frame': string;
    'error.pageClosed': string;
    'error.denied': string;
    'error.request': string;
};
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Built-in browser panel: type name, controls, states, and failures. */
        browserCloak: BrowserCloakKey;
    }
}
//# sourceMappingURL=locales.d.ts.map