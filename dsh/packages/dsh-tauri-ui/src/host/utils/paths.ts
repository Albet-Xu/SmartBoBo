import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

function expandHome(path: string): string {
  if (path === '~')
    return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\'))
    return join(homedir(), path.slice(2))
  return path
}

function resolveDshHome(env: NodeJS.ProcessEnv): string {
  const configured = env.DSH_HOME
  const home = configured !== undefined && configured.trim().length > 0
    ? expandHome(configured)
    : join(homedir(), '.dsh')
  return resolve(home)
}

export function resolveUngroupedSessionPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(env), 'ungrouped')
}
