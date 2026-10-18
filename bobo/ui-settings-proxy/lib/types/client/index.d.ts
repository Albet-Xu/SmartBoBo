/**
 * Proxy pool settings page, browser half: contributes the Proxy Pool section
 * to Settings over the `proxy-pool` namespace the host `/proxy` command reads.
 * The namespace's data model, its host-side owner, and the session projection
 * that arms it all live in `bobo-proxy-tool`; this package owns
 * only the page, and reads and writes that namespace through the shared
 * settings describe mirror.
 *
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type ProxyPoolKey } from './locales.ts';
export type { ProxyPoolSectionInjected, ProxyPoolSectionProps } from './ProxyPoolSection.tsx';
export type { ProxyPoolKey } from './locales.ts';
export type { ProxyPoolPageState, ProxyPoolSaveOutcome } from './proxy-pool.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The Proxy Pool settings section. */
        'settings.proxy': ProxyPoolKey;
    }
}
/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on that slot through `slots.inject()`.
 */
export declare const inject: string[];
/**
 * Register the Proxy Pool section once the `settings.section` declaration is
 * on the ledger, over the shared settings describe mirror.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map