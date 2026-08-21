/**
 * MCP Tools settings section: manages Model Context Protocol tools installation,
 * configuration, and enable/disable functionality.
 * @module @deepseek-ai/dsh-client-ui-settings-mcp/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { MCPToolsSection } from './MCPToolsSection.tsx'
import type { MCPToolsSectionInjected } from './MCPToolsSection.tsx'
import { MCPToolsStore } from './store.ts'
import { en, zh, type MCPToolsKey } from './locales.ts'

export type { MCPToolsSectionInjected, MCPToolsSectionProps } from './MCPToolsSection.tsx'
export type { MCPToolsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The MCP Tools settings section. */
    'settings.mcp': MCPToolsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.mcp'
export type { MCPToolConfig, MCPToolStatus } from './store.ts'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply.
 */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Register the MCP Tools section once the `settings.section` declaration is on
 * the ledger, wire its store to the connection, and keep it fresh on every
 * pushed invalidation.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-mcp: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new MCPToolsStore(connection.api)

  const sectionInjected = (): MCPToolsSectionInjected => ({
    hooks: {
      mcpTools: controller.store,
    },
    controller,
    api: connection.api,
  })

  // Pushed invalidations converge every open surface without polling
  ctx.effect(() => {
    const refreshModels = (): void => { controller.refresh() }
    const disposers = [
      ctx.remote.$on('settings/document-updated', refreshModels),
      ctx.remote.$on('credentials/updated', refreshModels),
      ctx.on('connection/reset', refreshModels),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-settings-mcp: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp-tools',
    order: 50,
    label: () => 'MCP 工具',
    locale: NS,
    inject: sectionInjected,
  }, MCPToolsSection))
}
