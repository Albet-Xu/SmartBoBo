import type { EventHandlerRequest } from 'h3'
import type { RepoCatalog } from '../../../../service/repo.types'
import { defineEventHandler, getQuery } from 'h3'
import { repo } from '../../../../service/repo'
import { readNs } from '../repo.utils'

export default defineEventHandler<EventHandlerRequest, Promise<{ catalog: RepoCatalog } | { error: string }>>(async (event) => {
  const ns = readNs(getQuery(event), event)
  if (ns === null)
    return { error: 'ns must be presets | tools | skills' }
  try {
    return { catalog: await repo.list(ns) }
  }
  catch (error) {
    event.res.status = 502
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
