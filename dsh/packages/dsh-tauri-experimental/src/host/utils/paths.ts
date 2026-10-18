import { isAbsolute, relative, resolve } from 'pathe'

export function resolveInsideWorkspace(worktree: string, path: string): string | null {
  if (path.length === 0 || path.includes('\0') || isAbsolute(path))
    return null
  const absolute = resolve(worktree, path)
  const rel = relative(worktree, absolute)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel))
    return null
  return absolute
}
