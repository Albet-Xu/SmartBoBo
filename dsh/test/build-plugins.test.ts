import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isNonRuntimeFile, relativeSpecifiers } from '../scripts/build-plugins'

describe('plugin deployment relative dependencies', () => {
  it('collects static imports and re-exports including side effects', () => {
    expect(relativeSpecifiers(`
      import value from './value.js'
      import './setup.js'
      export { value } from '../shared.js'
      export * from './exports.js'
      import React from 'react'
    `)).toEqual(['./value.js', './setup.js', '../shared.js', './exports.js'])
  })

  it('collects literal require and dynamic import targets', () => {
    expect(relativeSpecifiers(`
      const value = require('./value.cjs')
      const lazy = () => import('../lazy.mjs')
      const template = import(\`./template.js\`)
      require('node:fs')
      import('./dynamic/' + name)
    `)).toEqual(['./value.cjs', '../lazy.mjs', './template.js'])
  })

  it('ignores example code in strings, templates, comments and regular expressions', () => {
    expect(relativeSpecifiers(`
      console.error("const MyComponent = lazy(() => import('./MyComponent'))")
      const quoted = 'require("./quoted")'
      const template = \`export { example } from './template'\`
      // import './comment'
      /* require('./block-comment') */
      const pattern = /require('..')/
      client.require('./method')
      client.from('./other-method')
    `)).toEqual([])
  })

  it('retains real imports inside template substitutions', () => {
    expect(relativeSpecifiers(`const text = \`example \${require('./real.cjs')}\``)).toEqual(['./real.cjs'])
  })

  it.each(['react.development.js', 'react.react-server.development.js'])('does not treat %s diagnostics as missing modules', (file) => {
    const require = createRequire(import.meta.url)
    const root = dirname(require.resolve('react/package.json'))
    const source = readFileSync(join(root, 'cjs', file), 'utf8')
    expect(source).toContain('import(\'./MyComponent\')')
    expect(relativeSpecifiers(source)).not.toContain('./MyComponent')
  })
})

describe('plugin deployment documentation pruning', () => {
  it('prunes documentation, sourcemaps and type declarations', () => {
    expect(isNonRuntimeFile(join('pkg', 'README.md'))).toBe(true)
    expect(isNonRuntimeFile(join('pkg', 'CHANGELOG.md'))).toBe(true)
    expect(isNonRuntimeFile(join('pkg', 'dist', 'index.js.map'))).toBe(true)
    expect(isNonRuntimeFile(join('pkg', 'dist', 'index.d.ts'))).toBe(true)
  })

  it('keeps attribution files and runtime code', () => {
    expect(isNonRuntimeFile(join('pkg', 'LICENSE'))).toBe(false)
    expect(isNonRuntimeFile(join('pkg', 'NOTICE.md'))).toBe(false)
    expect(isNonRuntimeFile(join('pkg', 'dist', 'index.js'))).toBe(false)
  })

  it('keeps skills packaged with a plugin for the skill provider to scan', () => {
    expect(isNonRuntimeFile(join('dsh-tauri-pet', 'skills', 'hatch-dsh-pet', 'SKILL.md'))).toBe(false)
    expect(isNonRuntimeFile(join('dsh-tauri-pet', 'skills', 'hatch-dsh-pet', 'README.md'))).toBe(false)
    expect(isNonRuntimeFile(join('dsh-tauri-pet', 'skills', 'hatch-dsh-pet', 'references', 'sprite-atlas.md'))).toBe(false)
    expect(isNonRuntimeFile(join('dsh-tauri-extension', 'skills', 'skill-creator', 'SKILL.md'))).toBe(false)
    expect(isNonRuntimeFile(join('dsh-tauri-extension', 'skills', 'skill-creator', 'agents', 'grader.md'))).toBe(false)
    expect(isNonRuntimeFile(join('dsh-tauri-extension', 'skills', 'find-skills', 'LICENSE'))).toBe(false)
  })

  it('does not treat a lookalike segment as a skills directory', () => {
    expect(isNonRuntimeFile(join('pkg', 'skills-extra', 'GUIDE.md'))).toBe(true)
  })
})
