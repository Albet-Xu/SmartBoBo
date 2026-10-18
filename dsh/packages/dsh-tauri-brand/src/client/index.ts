import type { ClientContext } from 'dsh-tauri/client'
import { PLUGIN_ID } from '../shared/constants'
import { locale } from './locales'
import { brandFeature } from './register/brand'

const LOCALE_EFFECT = `${PLUGIN_ID}: dictionaries`
const BRAND_EFFECT = `${PLUGIN_ID}: brand slots`

export const name = PLUGIN_ID

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(locale.registerLocale, LOCALE_EFFECT)
  ctx.effect(brandFeature, BRAND_EFFECT)
}
