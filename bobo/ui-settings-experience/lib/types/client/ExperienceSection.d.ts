/**
 * Experience pool settings section: the license card (one key input, or the
 * connected plan facts derived from the server clock plus refresh and
 * change-key), the migration card (the two-step transfer of the license to
 * this device), and the connection diagnostics card (gateway URL plus
 * `/v1/health` reachability). All three fold, and all three start folded: each
 * head keeps its own title — the diagnostics head also keeps its re-check
 * button — while the notices stay outside the cards, so a page folded shut
 * still shows what the last action reported.
 *
 * The page never renders a saved key or token — those live in the credential
 * store and this plugin's memory only — and every gateway failure becomes
 * either the server's own description or localized copy from this section's
 * dictionary.
 *
 * @module bobo-settings-experience-ui/ExperienceSection
 */
import type { ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { ExperiencePoolSettings } from '../experience-pool.ts';
import { type ExperienceAuthOutcome, type ExperienceCredentialsState, type ExperienceGatewayOutcome, type ExperienceHealthOutcome, type ExperienceSaveOutcome } from './experience.ts';
/** Registration-side dependencies of {@link ExperienceSection}. */
export interface ExperienceSectionInjected {
    /** Resolve the page's first settings answer; a no-op once one is held. */
    load: () => Promise<void>;
    /**
     * Apply one partial settings edit (gateway URL, device id, license cache)
     * through the host namespace.
     * @param patch - the fields this write sets.
     * @returns the write's outcome, which the page turns into its own copy.
     */
    save: (patch: Partial<ExperiencePoolSettings>) => Promise<ExperienceSaveOutcome>;
    /**
     * Exchange one license key for a session token over `POST /v1/license/activate`.
     * @param key - the trimmed license key the user typed.
     * @returns the license state to show, or why the call did not produce one.
     */
    activate: (key: string) => Promise<ExperienceAuthOutcome>;
    /** Re-read the license over `GET /v1/license/me` with the in-memory token. */
    refresh: () => Promise<ExperienceAuthOutcome>;
    /**
     * Ask the gateway to send the migration confirmation email. The page shows
     * one fixed message on any HTTP success, whether or not the email exists.
     * @param email - the email bound to the previous device.
     * @param recoveryCode - the recovery code from that license.
     */
    migrateRequest: (email: string, recoveryCode: string) => Promise<ExperienceGatewayOutcome>;
    /**
     * Complete the migration over `POST /v1/license/migrate/complete`.
     * @param email - the email bound to the previous device.
     * @param recoveryCode - the recovery code from that license.
     * @param code - the confirmation code from the email.
     */
    migrateComplete: (email: string, recoveryCode: string, code: string) => Promise<ExperienceAuthOutcome>;
    /** Probe `GET /v1/health` and classify gateway and upstream reachability. */
    health: () => Promise<ExperienceHealthOutcome>;
    /** Read whether the key and token references are configured; values never ride. */
    credentialsState: () => Promise<ExperienceCredentialsState | null>;
    hooks: {
        /** Shared settings mirror, bound by the UI renderer as `useSettings`. */
        settings: SettingsDescribeFace;
    };
}
/** Full component props: section owner share, locale seat, and inject face. */
export type ExperienceSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.experience'> & InjectFace<ExperienceSectionInjected>;
/**
 * Render the experience pool section content.
 * @param props - composed slot props (see {@link ExperienceSectionProps}).
 * @returns the settings section element tree.
 */
export declare function ExperienceSection(props: ExperienceSectionProps): ReactNode;
//# sourceMappingURL=ExperienceSection.d.ts.map