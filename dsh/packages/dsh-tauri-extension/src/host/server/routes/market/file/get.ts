import type { EventHandlerRequest } from 'h3'
import type { MarketFileContent } from '../../../../service/repo/market-core.mjs'
import type { MarketFileQuery } from '../../index.types'
import { defineEventHandler, getQuery } from 'h3'
import { market } from '../../../../service/market'

export default defineEventHandler<EventHandlerRequest, Promise<{ file: MarketFileContent } | { error: string }>>(async (event) => {
  const query = getQuery<MarketFileQuery>(event)
  const id = typeof query.id === 'string' ? query.id : ''
  const path = typeof query.path === 'string' ? query.path : ''
  if (id === '' || path === '') {
    event.res.status = 400
    return { error: 'id and path are required' }
  }
  try {
    return { file: await market.read(id, path) }
  }
  catch (error) {
    event.res.status = 502
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
