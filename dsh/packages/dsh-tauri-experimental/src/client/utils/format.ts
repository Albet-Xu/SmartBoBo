import type { TurnFileChange } from '../types'

export function formatCounts(file: Pick<TurnFileChange, 'insertions' | 'deletions' | 'binary'>, binaryLabel: string): string {
  if (file.binary)
    return binaryLabel
  const insertions = file.insertions ?? 0
  const deletions = file.deletions ?? 0
  return `+${insertions} -${deletions}`
}
