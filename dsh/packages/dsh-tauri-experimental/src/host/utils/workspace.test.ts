import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'pathe'
import { afterEach, describe, expect, it } from 'vitest'
import { isSystemSensitivePath, workspaceHash, workspaceKey } from './workspace'

const temporaryDirectories: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-running-changes-workspace-'))
  temporaryDirectories.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('isSystemSensitivePath', () => {
  it('rejects the home directory, its ancestors, drive and UNC roots, and fails closed on blanks', () => {
    const home = homedir()
    expect(home.length).toBeGreaterThan(0)
    expect(isSystemSensitivePath(home)).toBe(true)
    expect(isSystemSensitivePath(join(home, '..'))).toBe(true)
    expect(isSystemSensitivePath('C:\\')).toBe(true)
    expect(isSystemSensitivePath('\\\\server\\share')).toBe(true)
    expect(isSystemSensitivePath('   ')).toBe(true)
    expect(isSystemSensitivePath(join(home, 'projects', 'dsh-tauri-desk'))).toBe(false)
  })

  it('accepts an ordinary project directory', async () => {
    const root = await tempRoot()
    expect(isSystemSensitivePath(root)).toBe(false)
  })
})

describe('workspaceKey', () => {
  it('folds casing on Windows so one directory cannot spawn two snapshot domains', () => {
    const upper = workspaceKey('C:\\Repo\\Sub')
    const lower = workspaceKey('c:\\repo\\sub')
    if (process.platform === 'win32')
      expect(lower).toBe(upper)
    else
      expect(lower).not.toBe(upper)
  })
})

describe('workspaceHash', () => {
  it('hashes the canonical workspace key to 24 hex chars', async () => {
    const root = await tempRoot()
    const digest = workspaceHash(root)
    // 期望值由 node:crypto 独立算出（sha256 十六进制前 24 位），不取自被测函数。
    expect(digest).toMatch(/^[0-9a-f]{24}$/)
    expect(digest).toBe(createHash('sha256').update(workspaceKey(root)).digest('hex').slice(0, 24))
    expect(workspaceHash(join(root, 'nested'))).not.toBe(digest)
  })
})
