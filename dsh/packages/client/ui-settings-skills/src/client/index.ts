/**
 * Skills Library settings section: manages skill packages installation,
 * configuration, and enable/disable functionality.
 * @module @deepseek-ai/dsh-client-ui-settings-skills/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { SkillsSection } from './SkillsSection.tsx'
import type { SkillsSectionInjected } from './SkillsSection.tsx'
import { SkillsStore } from './store.ts'
import { en, zh, type SkillsKey } from './locales.ts'

export type { SkillsSectionInjected, SkillsSectionProps } from './SkillsSection.tsx'
export type { SkillsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Skills Library settings section. */
    'settings.skills': SkillsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.skills'
export type { SkillConfig, SkillStatus } from './store.ts'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply.
 */
export const inject = ['slots', 'locale', 'connection', 'remote']

/**
 * Register the Skills Library section once the `settings.section` declaration is on
 * the ledger, wire its store to the connection, and keep it fresh on every
 * pushed invalidation.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-skills: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new SkillsStore(connection.api)

  const sectionInjected = (): SkillsSectionInjected => ({
    hooks: {
      skills: controller.store,
    },
    controller,
    api: connection.api,
  })

  // Pushed invalidations converge every open surface without polling
  ctx.effect(() => {
    const refreshSkills = (): void => { controller.refresh() }
    const disposers = [
      ctx.remote.$on('settings/document-updated', refreshSkills),
      ctx.remote.$on('credentials/updated', refreshSkills),
      ctx.on('connection/reset', refreshSkills),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-settings-skills: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skills-library',
    order: 60,
    label: () => '技能库',
    locale: NS,
    inject: sectionInjected,
  }, SkillsSection))
}
