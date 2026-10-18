import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveUngroupedSessionPath } from './paths'

describe('resolveUngroupedSessionPath', () => {
  it('resolves to the ungrouped directory inside DSH_HOME, not the core install dir', () => {
    expect(resolveUngroupedSessionPath({ DSH_HOME: 'D:\\harness' } as NodeJS.ProcessEnv))
      .toBe(resolve('D:\\harness', 'ungrouped'))
  })

  it('defaults to ~/.dsh/ungrouped when DSH_HOME is unset', () => {
    expect(resolveUngroupedSessionPath({} as NodeJS.ProcessEnv))
      .toBe(join(homedir(), '.dsh', 'ungrouped'))
  })
})
