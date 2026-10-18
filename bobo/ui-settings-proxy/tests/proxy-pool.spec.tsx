// The drag and the priority buttons share one reorder fold: a drop names the
// two ends of a move, and a gesture that asks for nothing must reach the draft
// as no write at all rather than as an identity write.
//
// Fixtures are real `ProxySource` records (not bare names) so the fold is
// exercised on the shape the settings page actually holds; assertions compare
// the `name` field to keep the intent readable.
//
// Named `.spec.tsx`, not `.spec.ts`/`.client.spec.ts`: our client packages are
// deliberately absent from both upstream tsconfig solutions, and each solution
// globs one of those two names into a project that cannot see this package's
// src (TS6307). The `.tsx` glob exists only in the client project, and that one
// matches `.client.spec.tsx` only. vitest collects `*.spec.tsx` either way.
import { describe, expect, it } from 'vitest'
import type { ProxySource } from 'bobo-proxy-tool'
import { dropExpanded, moveEntry, moveExpanded, reorderSources } from '../src/client/proxy-pool.ts'

/** One minimal valid pool entry, distinguished by name. */
function source(name: string): ProxySource {
  return {
    name,
    apiUrl: `https://${name}.example/dmgetip.asp`,
    apiKey: '',
    pwd: '',
    getnum: 1,
    httptype: 'http',
    geshi: '2',
    fenge: '1',
    enabled: true,
  }
}

/** The names of a reorder result, or null when the fold asked for no write. */
function names(reordered: readonly ProxySource[] | null): readonly string[] | null {
  return reordered === null ? null : reordered.map(entry => entry.name)
}

const list = [source('a'), source('b'), source('c')] as const

describe('reorderSources', () => {
  it('moves the carried entry onto the target index', () => {
    expect(names(reorderSources(list, 0, 2))).toEqual(['b', 'c', 'a'])
    expect(names(reorderSources(list, 2, 0))).toEqual(['c', 'a', 'b'])
  })

  it('leaves the input list untouched', () => {
    const sources = [source('a'), source('b'), source('c')]

    expect(names(reorderSources(sources, 0, 1))).toEqual(['b', 'a', 'c'])
    expect(sources.map(entry => entry.name)).toEqual(['a', 'b', 'c'])
  })

  it('asks for no write when the drop lands on the carried entry itself', () => {
    expect(reorderSources(list, 1, 1)).toBeNull()
  })

  it('asks for no write for an index outside the list', () => {
    expect(reorderSources(list, 3, 0)).toBeNull()
    expect(reorderSources(list, 0, 3)).toBeNull()
    expect(reorderSources(list, -1, 0)).toBeNull()
    expect(reorderSources([], 0, 0)).toBeNull()
  })

  it('agrees with the fold the priority buttons apply', () => {
    expect(names(reorderSources(list, 0, 1))).toEqual(names(moveEntry(list, 0, 1)))
  })
})

/** The names an expanded position set still holds open, read off a list. */
function openNames(expanded: ReadonlySet<number>, sources: readonly ProxySource[]): readonly string[] {
  return sources.filter((_entry, at) => expanded.has(at)).map(entry => entry.name)
}

describe('dropExpanded', () => {
  it('closes the dropped row and shifts the rows below it up', () => {
    const short = list.filter(entry => entry.name !== 'b')

    expect(openNames(dropExpanded(new Set([1, 2]), 1), short)).toEqual(['c'])
  })

  it('keeps a row open on its own entry when an earlier row is dropped', () => {
    const short = list.filter(entry => entry.name !== 'a')

    expect(openNames(dropExpanded(new Set([2]), 0), short)).toEqual(['c'])
    expect(openNames(dropExpanded(new Set([0]), 2), list)).toEqual(['a'])
  })

  it('leaves an empty set and its input untouched', () => {
    const expanded = new Set([1, 2])

    expect(dropExpanded(new Set(), 0).size).toBe(0)
    dropExpanded(expanded, 1)
    expect([...expanded]).toEqual([1, 2])
  })
})

describe('moveExpanded', () => {
  it('stays on the entry a move carries, and on the entries it passes', () => {
    const moved = moveEntry(list, 0, 2)

    expect(openNames(moveExpanded(new Set([0]), 0, 2), moved)).toEqual(['a'])
    expect(openNames(moveExpanded(new Set([1]), 0, 2), moved)).toEqual(['b'])
    expect(openNames(moveExpanded(new Set([2]), 0, 2), moved)).toEqual(['c'])
  })

  it('shifts an open row the carried entry travels over toward the hole', () => {
    // The entry at 0 moves onto 2: 1 and 2 close up onto 0 and 1.
    expect(openNames(moveExpanded(new Set([1, 2]), 0, 2), moveEntry(list, 0, 2))).toEqual(['b', 'c'])
    expect(openNames(moveExpanded(new Set([0, 2]), 0, 1), moveEntry(list, 0, 1))).toEqual(['a', 'c'])
    // Carried from below: the rows it travels under close down onto their entries.
    expect(openNames(moveExpanded(new Set([0]), 2, 0), moveEntry(list, 2, 0))).toEqual(['a'])
  })

  it('leaves a position the move never reaches where it is', () => {
    const four = [source('a'), source('b'), source('c'), source('d')]

    expect(openNames(moveExpanded(new Set([3]), 0, 2), moveEntry(four, 0, 2))).toEqual(['d'])
  })

  it('leaves an empty set and its input untouched', () => {
    const expanded = new Set([1])

    expect(moveExpanded(new Set(), 0, 2).size).toBe(0)
    moveExpanded(expanded, 0, 2)
    expect([...expanded]).toEqual([1])
  })
})
