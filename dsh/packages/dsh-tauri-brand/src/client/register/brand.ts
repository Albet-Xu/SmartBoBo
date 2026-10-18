import type { ClientContext } from 'dsh-tauri/client'
import { defineRegister } from 'dsh-tauri/client'
import { PLUGIN_ID } from '../../shared/constants'
import { BrandMark } from '../components/brand-mark'
import { BrandName } from '../components/brand-name'
import { HeroBrandMark } from '../components/hero-brand-mark'

const SIDEBAR_BRAND_MARK_SLOT = 'sidebar.brand.mark'
const SIDEBAR_BRAND_NAME_SLOT = 'sidebar.brand.name'
const HERO_BRAND_MARK_SLOT = 'conversation.hero.brand.mark'

const BRAND_PRIORITY = -1

export const brandFeature = defineRegister<ClientContext>((controller, ctx) => {
  controller.add(ctx.slots.inject(SIDEBAR_BRAND_MARK_SLOT as never, () => ctx.slots.inject(
    SIDEBAR_BRAND_NAME_SLOT as never,
    function* () {
      yield ctx.slots.register(
        { name: SIDEBAR_BRAND_MARK_SLOT, registrant: PLUGIN_ID, priority: BRAND_PRIORITY } as never,
        BrandMark as never,
      )
      yield ctx.slots.register(
        { name: SIDEBAR_BRAND_NAME_SLOT, registrant: PLUGIN_ID, priority: BRAND_PRIORITY } as never,
        BrandName as never,
      )
    },
  )))

  controller.add(ctx.slots.inject(HERO_BRAND_MARK_SLOT as never, () => ctx.slots.register(
    { name: HERO_BRAND_MARK_SLOT, registrant: PLUGIN_ID, priority: BRAND_PRIORITY } as never,
    HeroBrandMark as never,
  )))
})
