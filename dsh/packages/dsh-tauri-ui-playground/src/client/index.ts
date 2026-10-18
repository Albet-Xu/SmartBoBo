import type { ClientContext } from 'dsh-tauri/client'
import { PLUGIN_ID } from '../shared/constants'
import { LOCALE_EFFECT, UI_COMPONENTS_EFFECT } from './constants'
import { locale } from './locales'
import { registerUiComponentsPanel } from './register/components-playground'

export const name = PLUGIN_ID

export const inject = ['slots', 'layout', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(locale.registerLocale, LOCALE_EFFECT)
  ctx.effect(registerUiComponentsPanel, UI_COMPONENTS_EFFECT)
}
