import type { EventHandlerRequest } from 'h3'
import type { RepoScopeReceipt } from '../../../../service/repo.types'
import type { RepoScopeBody } from '../../index.types'
import { defineEventHandler, readBody } from 'h3'
import { repo } from '../../../../service/repo'
import { readString, readStringList } from '../repo.utils'

export default defineEventHandler<EventHandlerRequest, Promise<{ receipt: RepoScopeReceipt } | { error: string }>>(async (event) => {
  const body = await readBody<RepoScopeBody>(event, { type: 'json' })
  const toolId = readString(body?.toolId)
  if (toolId === '') {
    event.res.status = 400
    return { error: 'toolId is required' }
  }
  try {
    return { receipt: await repo.setScope(toolId, readStringList(body?.scope)) }
  }
  catch (error) {
    event.res.status = 422
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
