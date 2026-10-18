import type { EventHandlerRequest } from 'h3'
import type { MarketInstallResult } from '../../../../service/repo/market-core.mjs'
import type { MarketInstallBody } from '../../index.types'
import { defineEventHandler, readBody } from 'h3'
import { market } from '../../../../service/market'

export default defineEventHandler<EventHandlerRequest, Promise<{ receipt: MarketInstallResult } | { error: string }>>(async (event) => {
  const body = await readBody<MarketInstallBody>(event, { type: 'json' })
  const id = typeof body?.id === 'string' ? body.id : ''
  if (id === '') {
    event.res.status = 400
    return { error: 'id is required' }
  }
  try {
    return { receipt: await market.install(id) }
  }
  catch (error) {
    event.res.status = 422
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
