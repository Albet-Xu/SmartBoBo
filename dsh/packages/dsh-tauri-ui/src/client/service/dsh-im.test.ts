import type { ClientContext } from 'dsh-tauri/client'
import type { DshImClient } from './dsh-im.types'
import { describe, expect, it } from 'vitest'
import { DSH_IM_CLIENT_SERVICE } from '../constants'
import { readDshImClient } from './dsh-im'

const VALID: DshImClient = {
  version: 1,
  render: () => null,
  setSettingsVisible: () => {},
  settingsVisible: () => true,
}

function contextReflecting(get: (name: string) => unknown): ClientContext {
  return { reflect: { get } } as unknown as ClientContext
}

describe('readDshImClient', () => {
  it('reads the published v1 face', () => {
    const ctx = contextReflecting(name => name === DSH_IM_CLIENT_SERVICE ? VALID : undefined)
    expect(readDshImClient(ctx)).toBe(VALID)
  })

  it('rejects an unknown interface version', () => {
    const ctx = contextReflecting(() => ({ ...VALID, version: 2 }))
    expect(readDshImClient(ctx)).toBeUndefined()
  })

  it('rejects a face without render', () => {
    const ctx = contextReflecting(() => ({ ...VALID, render: undefined }))
    expect(readDshImClient(ctx)).toBeUndefined()
  })

  it('rejects a partial face missing the visibility switch', () => {
    expect(readDshImClient(contextReflecting(() => ({ ...VALID, setSettingsVisible: undefined })))).toBeUndefined()
    expect(readDshImClient(contextReflecting(() => ({ ...VALID, settingsVisible: undefined })))).toBeUndefined()
  })

  it('treats an absent service and a throwing registry as unavailable', () => {
    expect(readDshImClient(contextReflecting(() => undefined))).toBeUndefined()
    expect(readDshImClient(contextReflecting(() => {
      throw new Error('registry disposed')
    }))).toBeUndefined()
  })
})
