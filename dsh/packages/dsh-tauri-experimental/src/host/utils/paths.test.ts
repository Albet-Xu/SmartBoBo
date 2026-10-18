import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { describe, expect, it } from 'vitest'
import { resolveInsideWorkspace } from './paths'

const worktree = join(tmpdir(), 'dsh-running-changes-paths')

describe('resolveInsideWorkspace', () => {
  it('resolves nested paths inside the workspace', () => {
    expect(resolveInsideWorkspace(worktree, 'src/a.ts')).toBe(join(worktree, 'src/a.ts'))
  })

  it.each(['', '.', '..', '../outside.txt', 'a/../../outside.txt', '/outside.txt', 'C:\\Other\\file.txt', 'src/\0a.ts'])('rejects unsafe path %j', (path) => {
    expect(resolveInsideWorkspace(worktree, path)).toBeNull()
  })
})
