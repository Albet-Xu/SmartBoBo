import { describe, expect, it } from 'vitest'
import { formatCounts } from './format'

describe('formatCounts', () => {
  it('renders +N -M and falls back to the binary label', () => {
    expect(formatCounts({ insertions: 5, deletions: 3, binary: false }, 'binary')).toBe('+5 -3')
    expect(formatCounts({ insertions: null, deletions: null, binary: true }, 'binary')).toBe('binary')
    expect(formatCounts({ insertions: null, deletions: null, binary: false }, 'binary')).toBe('+0 -0')
  })
})
