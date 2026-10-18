import type { EventHandlerRequest } from 'h3'
import type { RepoCategoryReceipt } from '../../../../service/repo.types'
import type { RepoCategoryBody } from '../../index.types'
import { defineEventHandler, readBody } from 'h3'
import { repo } from '../../../../service/repo'
import { readString } from '../repo.utils'

export default defineEventHandler<EventHandlerRequest, Promise<{ receipt: RepoCategoryReceipt } | { error: string }>>(async (event) => {
  const body = await readBody<RepoCategoryBody>(event, { type: 'json' })
  const id = readString(body?.id)
  if (id === '') {
    event.res.status = 400
    return { error: 'id is required' }
  }
  try {
    return { receipt: await repo.setCategory(id, readString(body?.category)) }
  }
  catch (error) {
    event.res.status = 422
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
