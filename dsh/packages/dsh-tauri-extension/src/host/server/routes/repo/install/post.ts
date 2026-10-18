import type { EventHandlerRequest } from 'h3'
import type { RepoInstallReceipt } from '../../../../service/repo.types'
import type { RepoInstallBody } from '../../index.types'
import { defineEventHandler, readBody } from 'h3'
import { repo } from '../../../../service/repo'
import { readNs, readString, readStringList } from '../repo.utils'

export default defineEventHandler<EventHandlerRequest, Promise<{ receipt: RepoInstallReceipt } | { error: string }>>(async (event) => {
  const body = await readBody<RepoInstallBody>(event, { type: 'json' })
  const ns = readNs(body ?? {}, event)
  if (ns === null)
    return { error: 'ns must be presets | tools | skills' }
  const id = readString(body?.id)
  if (id === '') {
    event.res.status = 400
    return { error: 'id is required' }
  }
  try {
    return { receipt: await repo.install(ns, id, readStringList(body?.scope)) }
  }
  catch (error) {
    event.res.status = 422
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
