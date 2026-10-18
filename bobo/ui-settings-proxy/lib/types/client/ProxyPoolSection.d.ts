/**
 * Proxy Pool settings page: the master switch, the fetch strategy, and the
 * ordered source list the host `/proxy` command draws addresses from.
 *
 * The page edits one draft and commits it as a whole, so a half-typed URL
 * never reaches the host. The host stays the single fact source: an untouched
 * page always renders the last committed value, and a committed draft is
 * dropped in favour of the answer the write returned.
 */
import type { ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ProxyPoolSettings } from 'bobo-proxy-tool';
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client';
import { type ProxyPoolSaveOutcome } from './proxy-pool.ts';
/** Registration-side dependencies of {@link ProxyPoolSection}. */
export interface ProxyPoolSectionInjected {
    /**
     * Resolve the page's first settings answer; a no-op once one is held.
     * @returns settlement of the read this call started, if any.
     */
    load: () => Promise<void>;
    /**
     * Apply one edited pool through the host settings namespace.
     * @param settings - the pool the page currently shows.
     * @returns the write's outcome, which the page turns into its own copy.
     */
    save: (settings: ProxyPoolSettings) => Promise<ProxyPoolSaveOutcome>;
    hooks: {
        /** Shared settings mirror, bound by the UI renderer as `useSettings`. */
        settings: SettingsDescribeFace;
    };
}
/** Full component props: section owner share, locale seat, and inject face. */
export type ProxyPoolSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.proxy'> & InjectFace<ProxyPoolSectionInjected>;
/**
 * Render the Proxy Pool section content.
 * @param props - composed slot props (see {@link ProxyPoolSectionProps}).
 * @returns the settings section element tree.
 */
export declare function ProxyPoolSection(props: ProxyPoolSectionProps): ReactNode;
//# sourceMappingURL=ProxyPoolSection.d.ts.map