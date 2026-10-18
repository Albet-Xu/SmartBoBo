/**
 * Experience pool contract for the settings page: the pure folds that turn
 * one settings mirror snapshot into the page's state, the path operations one
 * settings write applies, and the outcome vocabulary the inject face answers
 * with. No fetch, no ctx — components and the apply closure share these.
 *
 * @module bobo-settings-experience-ui/experience
 */
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client';
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client';
import { type ExperienceLicenseCache, type ExperiencePoolSettings } from '../experience-pool.ts';
import type { GatewayFailure } from './license-api.ts';
/** What a settings write answered, as the page renders it. */
export type ExperienceSaveOutcome = 
/** Committed; the page's mirror already carries the answer. */
{
    readonly kind: 'written';
}
/** The stored revision moved after the page read it. */
 | {
    readonly kind: 'conflict';
}
/** The host serves no `experience-pool` namespace to this client. */
 | {
    readonly kind: 'absent';
}
/** Any other refusal, carrying the host's own diagnostic. */
 | {
    readonly kind: 'refused';
    readonly message: string;
};
/** Credential-store facts the page shows as a hint; values never ride. */
export interface ExperienceCredentialsState {
    /** Whether the license key reference is configured. */
    readonly key: boolean;
    /** Whether the access-token reference is configured. */
    readonly token: boolean;
}
/** Reachability answers one diagnostics run produces. */
export interface ExperienceHealthOutcome {
    /** Whether an HTTP answer came back from the gateway. */
    readonly gateway: 'up' | 'down';
    /** Whether the upstream Qdrant answer is known and what it said. */
    readonly qdrant: 'up' | 'down' | 'unknown';
    /** The server's own description when an HTTP answer carried one. */
    readonly detail?: string;
}
/** Result of a settings-free gateway action (send the migration email). */
export type ExperienceGatewayOutcome = {
    readonly kind: 'ok';
} | {
    readonly kind: 'gateway';
    readonly failure: GatewayFailure;
};
/**
 * Result of an action that ends in a license state: activation, refresh, or
 * migration completion. `ok` carries the license to display plus how the two
 * local stores answered, so the page can say what did not persist.
 */
export type ExperienceAuthOutcome = {
    readonly kind: 'ok';
    readonly license: ExperienceLicenseCache;
    readonly settingsStorage: ExperienceSaveOutcome;
    readonly credentialsStorage: string | null;
}
/** The device id could not be persisted, so the call was never sent. */
 | {
    readonly kind: 'device';
}
/** A refresh with no in-memory token (a saved token is not readable). */
 | {
    readonly kind: 'no-token';
}
/** The gateway call itself failed. */
 | {
    readonly kind: 'gateway';
    readonly failure: GatewayFailure;
};
/**
 * State the page renders from, folded from the shared settings mirror.
 * `failed` distinguishes a document read that answered nothing from a
 * namespace whose value is not the section object this page edits, because
 * only the first is worth retrying.
 */
export type ExperiencePageState = {
    readonly status: 'loading';
}
/** The connection keeps preferences process-local, so no read can ever answer. */
 | {
    readonly status: 'unavailable';
}
/** The document answered, and no live plugin registered `experience-pool` on it. */
 | {
    readonly status: 'absent';
} | {
    readonly status: 'failed';
    readonly reason: 'read' | 'section';
    readonly detail: string | null;
} | {
    readonly status: 'ready';
    readonly settings: ExperiencePoolSettings;
    /** Revision the next write is fenced against. */
    readonly revision: number;
    readonly writable: boolean;
    /** A refresh failure the held view still answers despite; null when the read is clean. */
    readonly staleError: string | null;
};
/**
 * Narrow one redacted settings section to the section the page edits. The
 * section arrives from the wire, so every field falls back to the value the
 * host schema defaults it to when the section omits or mistypes it; a
 * malformed cache drops to absent rather than failing the page.
 * @param section - the `experience-pool` namespace's resolved value.
 * @returns the settings, or undefined when the section is not an object at all.
 */
export declare function decodeExperience(section: unknown): ExperiencePoolSettings | undefined;
/**
 * The `experience-pool` namespace view inside one settings mirror snapshot.
 * @param mirror - the shared describe mirror's snapshot.
 * @returns the namespace view, or undefined while unanswered or unregistered.
 */
export declare function experienceView(mirror: SettingsMirrorSnapshot): SettingsNamespaceView | undefined;
/**
 * Fold one settings mirror snapshot into the page's state.
 * @param mirror - the shared describe mirror's snapshot.
 * @returns the state the section renders.
 */
export declare function experiencePageState(mirror: SettingsMirrorSnapshot): ExperiencePageState;
/**
 * Path operations carrying one partial edit into the namespace. Only the
 * provided fields are written, so a field the page does not touch keeps its
 * stored value.
 * @param patch - the fields this write sets.
 * @returns the operations one settings write applies.
 */
export declare function experienceWriteOps(patch: Partial<ExperiencePoolSettings>): SettingsPathOpView[];
//# sourceMappingURL=experience.d.ts.map