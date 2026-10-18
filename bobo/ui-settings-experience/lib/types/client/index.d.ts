/**
 * Experience pool settings page, browser half: contributes the Experience
 * Pool section to Settings and owns every call it makes — license activation,
 * status refresh, migration, connection diagnostics, and the settings and
 * credential writes behind them. The gateway URL, device id, and cached
 * license status persist through the `experience-pool` settings namespace the
 * node half registers; the access token and license key persist through the
 * `credentials` Remote namespace and are never echoed back to the page. The
 * session token itself is held in this closure only, so a page reload keeps
 * the cached status display but asks for the key again to go back online.
 *
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type ExperienceLocaleKey } from './locales.ts';
export type { ExperienceSectionInjected, ExperienceSectionProps } from './ExperienceSection.tsx';
export type { ExperienceLocaleKey } from './locales.ts';
export type { ExperienceAuthOutcome, ExperienceCredentialsState, ExperienceGatewayOutcome, ExperienceHealthOutcome, ExperiencePageState, ExperienceSaveOutcome, } from './experience.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Experience pool settings section copy. */
        'settings.experience': ExperienceLocaleKey;
    }
}
/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on that slot through `slots.inject()`.
 */
export declare const inject: string[];
/**
 * Register the Experience Pool section once the `settings.section`
 * declaration is on the ledger, with every gateway call and store write
 * closed over this plugin's context.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map