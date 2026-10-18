import type { EventHandlerRequest } from 'h3'
import type { RepoDetail } from '../../../../service/repo.types'
import { defineEventHandler, getQuery } from 'h3'
import { repo } from '../../../../service/repo'
import { readNs, readString } from '../repo.utils'

export default defineEventHandler<EventHandlerRequest, Promise<{ detail: RepoDetail } | { error: string }>>(async (event) => {
  const query = getQuery(event)
  const ns = readNs(query, event)
  if (ns === null)
    return { error: 'ns must be presets | tools | skills' }
  const id = readString(query.id)
  if (id === '') {
    event.res.status = 400
    return { error: 'id is required' }
  }
  try {
    return { detail: await repo.get(ns, id) }
  }
  catch (error) {
    event.res.status = 502
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
