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

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry)
// and the ctx.configForms Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.remote merge and the forwarded settings-invalidation key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ProxyPoolSettings } from 'bobo-proxy-tool'
import { ProxyPoolSection } from './ProxyPoolSection.tsx'
import type { ProxyPoolSectionInjected } from './ProxyPoolSection.tsx'
import { PROXY_POOL_NAMESPACE, proxyPoolView, proxyPoolWriteOps, type ProxyPoolSaveOutcome } from './proxy-pool.ts'
import { en, zh, type ProxyPoolKey } from './locales.ts'

export type { ProxyPoolSectionInjected, ProxyPoolSectionProps } from './ProxyPoolSection.tsx'
export type { ProxyPoolKey } from './locales.ts'
export type { ProxyPoolPageState, ProxyPoolSaveOutcome } from './proxy-pool.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Proxy Pool settings section. */
    'settings.proxy': ProxyPoolKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.proxy'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on that slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'configForms']

/**
 * Register the Proxy Pool section once the `settings.section` declaration is
 * on the ledger, over the shared settings describe mirror.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-proxy: dictionaries')

  const describeFace = ctx.configForms.describe()
  const t = ctx.locale.bind(NS)

  const load = async (): Promise<void> => { await describeFace.ensure() }

  const save = async (settings: ProxyPoolSettings): Promise<ProxyPoolSaveOutcome> => {
    // Read the revision at write time, not at draft time: the fence only has
    // to cover the window in which another writer could have moved the section.
    const view = proxyPoolView(describeFace.getSnapshot())
    if (view === undefined) return { kind: 'absent' }
    try {
      const response = await ctx.remote.settings.mutate(
        PROXY_POOL_NAMESPACE,
        proxyPoolWriteOps(settings),
        view.revision,
      )
      if (response.ok) {
        describeFace.acceptView(response.value)
        return { kind: 'written' }
      }
      return response.error.code === 'settings/conflict'
        ? { kind: 'conflict' }
        : { kind: 'refused', message: response.error.message }
    } catch (error) {
      return { kind: 'refused', message: error instanceof Error ? error.message : String(error) }
    }
  }

  const injected = (): ProxyPoolSectionInjected => ({ load, save, hooks: { settings: describeFace } })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'proxy-pool',
    order: 70,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, ProxyPoolSection))
}
