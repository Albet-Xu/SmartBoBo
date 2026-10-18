import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mcp } from './mcp'
import { normalizeStdioCommand, splitCommandLine } from './mcp.utils'

describe('splitCommandLine', () => {
  it('keeps quoted segments intact', () => {
    expect(splitCommandLine('"C:/Program Files/node.exe" --experimental')).toEqual(['C:/Program Files/node.exe', '--experimental'])
    expect(splitCommandLine('\'a b\' c')).toEqual(['a b', 'c'])
  })

  it('drops empty segments', () => {
    expect(splitCommandLine('  npx   -y   ')).toEqual(['npx', '-y'])
  })
})

describe('normalizeStdioCommand', () => {
  it('splits a whole command line into command and args', () => {
    expect(normalizeStdioCommand('npx -y @heroui/react-mcp@latest', undefined))
      .toEqual({ command: 'npx', args: ['-y', '@heroui/react-mcp@latest'] })
  })

  it('splits when args is present but empty', () => {
    expect(normalizeStdioCommand('npx -y @heroui/react-mcp@latest', []))
      .toEqual({ command: 'npx', args: ['-y', '@heroui/react-mcp@latest'] })
  })

  it('keeps explicit args untouched', () => {
    expect(normalizeStdioCommand('npx', ['-y', '@heroui/react-mcp@latest']))
      .toEqual({ command: 'npx', args: ['-y', '@heroui/react-mcp@latest'] })
  })

  it('leaves a bare executable alone', () => {
    expect(normalizeStdioCommand('node', undefined)).toEqual({ command: 'node' })
    expect(normalizeStdioCommand('', undefined)).toEqual({ command: '' })
  })

  it('leaves an existing path containing spaces alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh mcp '))
    const executable = join(dir, 'my server.exe')
    writeFileSync(executable, '')
    expect(normalizeStdioCommand(executable, undefined)).toEqual({ command: executable })
  })
})

describe('mcp.save', () => {
  it('persists a whole command line as command plus args', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-save-'))
    mcp.save(dir, {
      id: '',
      serverName: 'heroui-react',
      transport: 'stdio',
      command: 'npx -y @heroui/react-mcp@latest',
    })
    const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('command: npx')
    expect(patch).not.toContain('npx -y @heroui')
    expect(patch).toContain('@heroui/react-mcp@latest')
  })
})
