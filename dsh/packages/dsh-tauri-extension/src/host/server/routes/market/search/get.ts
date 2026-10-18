import type { EventHandlerRequest } from 'h3'
import type { MarketSearchPage } from '../../../../service/repo/market-core.mjs'
import type { MarketSearchQuery } from '../../index.types'
import { defineEventHandler, getQuery } from 'h3'
import { market } from '../../../../service/market'

export default defineEventHandler<EventHandlerRequest, Promise<{ page: MarketSearchPage } | { error: string }>>(async (event) => {
  const query = getQuery<MarketSearchQuery>(event)
  const text = typeof query.q === 'string' ? query.q : ''
  const cursor = typeof query.cursor === 'string' && query.cursor !== '' ? query.cursor : undefined
  try {
    return { page: await market.search(text, cursor) }
  }
  catch (error) {
    event.res.status = 502
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
