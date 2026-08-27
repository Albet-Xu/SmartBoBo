/**
 * Proxy Pool settings section: manages proxy API sources and strategies.
 * @module @deepseek-ai/dsh-client-ui-settings-proxy/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ProxyPoolSection } from './ProxyPoolSection.tsx'
import { ProxyPoolStore } from './store.ts'
import { zh, en, type ProxyPoolKey } from './locales.ts'

export type { ProxyPoolSectionInjected, ProxyPoolSectionProps } from './ProxyPoolSection.tsx'
export type { ProxyPoolKey } from './locales.ts'

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
 * ui-settings' apply.
 */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Register the Proxy Pool section once the `settings.section` declaration is on
 * the ledger, wire its store to the connection, and keep it fresh on every
 * pushed invalidation.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Register locale dictionaries
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-proxy: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new ProxyPoolStore(connection.api)

  const sectionInjected = () => ({
    hooks: {
      config: controller.store,
    },
    controller,
    api: connection.api,
  })

  // Pushed invalidations converge every open surface without polling
  ctx.effect(() => {
    const refresh = (): void => { controller.refresh() }
    const disposers = [
      ctx.remote.$on('settings/document-updated', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-settings-proxy: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'proxy-pool',
    order: 70, // After skills-library (order 60)
    label: () => '代理池',
    locale: NS,
    inject: sectionInjected,
  }, ProxyPoolSection))
}
