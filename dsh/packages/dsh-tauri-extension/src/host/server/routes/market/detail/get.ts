import type { EventHandlerRequest } from 'h3'
import type { MarketSkillDetail } from '../../../../service/repo/market-core.mjs'
import type { MarketDetailQuery } from '../../index.types'
import { defineEventHandler, getQuery } from 'h3'
import { market } from '../../../../service/market'

export default defineEventHandler<EventHandlerRequest, Promise<{ detail: MarketSkillDetail } | { error: string }>>(async (event) => {
  const query = getQuery<MarketDetailQuery>(event)
  const id = typeof query.id === 'string' ? query.id : ''
  if (id === '') {
    event.res.status = 400
    return { error: 'id is required' }
  }
  try {
    return { detail: await market.describe(id) }
  }
  catch (error) {
    event.res.status = 502
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
