import { readdirSync } from 'node:fs'
import { lstat, mkdir, rename, rm, rmdir } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { get } from 'lodash-es'
import { dirname } from 'pathe'

const OUTER_REMOVE_ATTEMPTS = 3
const OUTER_REMOVE_RETRY_DELAY = 2_000

export const REMOVE_TREE_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 10,
  retryDelay: 100,
} as const

export interface RemoveDirectoryDependencies {
  lstat: (path: string) => Promise<unknown>
  mkdir: (path: string) => Promise<unknown>
  rename: (from: string, to: string) => Promise<void>
  rm: (path: string, options: typeof REMOVE_TREE_OPTIONS) => Promise<void>
  delay: (milliseconds: number) => Promise<unknown>
}

const defaultDependencies: RemoveDirectoryDependencies = {
  lstat,
  mkdir: path => mkdir(path, { recursive: true }),
  rename,
  rm,
  delay,
}

/** 枚举目录下的子目录名；目录不存在时返回空数组，其余读取失败如实抛出交给调用方。 */
export function listDirectoryNames(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  }
  catch (error) {
    const code = get(error, 'code')
    if (code === 'ENOENT' || code === 'ENOTDIR')
      return []
    throw error
  }
}

/** 尽力删除空目录；非空或被占用时静默跳过。 */
export async function removeEmptyDirectories(paths: readonly string[]): Promise<void> {
  for (const path of paths)
    await rmdir(path).catch(() => {})
}

/** 尽力整树删除；被占用时静默跳过，交由后续重试。 */
export async function removeDirectoryTree(path: string): Promise<void> {
  await rm(path, REMOVE_TREE_OPTIONS).catch(() => {})
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function errorMessage(error: unknown): string {
  return get(error, 'message', String(error))
}

async function pathExists(path: string, dependencies: RemoveDirectoryDependencies): Promise<boolean> {
  try {
    await dependencies.lstat(path)
    return true
  }
  catch (error) {
    if (isMissing(error))
      return false
    throw error
  }
}

async function removeTree(path: string, dependencies: RemoveDirectoryDependencies): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < OUTER_REMOVE_ATTEMPTS; attempt += 1) {
    try {
      await dependencies.rm(path, REMOVE_TREE_OPTIONS)
      return
    }
    catch (error) {
      lastError = error
      if (attempt + 1 < OUTER_REMOVE_ATTEMPTS)
        await dependencies.delay(OUTER_REMOVE_RETRY_DELAY)
    }
  }
  throw lastError
}

/**
 * 把工作树目录搬进回收站并删除。Windows 上目录作为进程工作目录（或句柄未释放）时
 * `rename` 与 `rm` 都会失败，此时 `rm` 通常已清空内容——搬运随即可能成功，于是
 * `worktrees/` 不再堆积残渣，回收站残留交由启动清扫处理。
 *
 * 判定成功只以「源路径消失」为准：内容留在回收站不算失败。
 */
export async function removeDirectoryReliably(
  sourcePath: string,
  trashPath: string,
  dependencies: RemoveDirectoryDependencies = defaultDependencies,
): Promise<void> {
  // 上次残留的回收站内容先清掉；清不掉也继续，否则会永远卡在 rename 目标已存在
  if (await pathExists(trashPath, dependencies))
    await removeTree(trashPath, dependencies).catch(() => {})

  if (!await pathExists(sourcePath, dependencies))
    return

  await dependencies.mkdir(dirname(trashPath))

  let renamed = false
  let renameError: unknown
  try {
    await dependencies.rename(sourcePath, trashPath)
    renamed = true
  }
  catch (error) {
    renameError = error
  }

  let removeError: unknown
  try {
    await removeTree(renamed ? trashPath : sourcePath, dependencies)
  }
  catch (error) {
    removeError = error
  }

  if (!renamed && removeError) {
    // rm 已尽量清空内容，清空后的空壳往往能被搬走，再试一次让 worktrees/ 保持干净
    try {
      await dependencies.rename(sourcePath, trashPath)
      renamed = true
    }
    catch {}
  }

  if (!await pathExists(sourcePath, dependencies))
    return

  const renameContext = renameError ? ` (rename-to-trash failed: ${errorMessage(renameError)})` : ''
  throw new Error(`Failed to remove worktree directory ${sourcePath}: ${errorMessage(removeError ?? renameError)}${renameContext}`)
}
