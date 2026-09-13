/**
 * at-file domain contract: workspace file/directory listing for the `@` reference UX.
 *
 * One level, name-sorted, bounded; the client drills into directories by
 * re-requesting with the child path. Files and directories both come back so
 * a composer `@` source can offer either to the model (files inject content,
 * directories inject a listing, per the at-workspace host plugin).
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One at-file entry. */
export interface AtFileEntry {
  /** Absolute host path (the client never joins path segments itself). */
  path: string
  /** Relative-to-listed-directory path used as the `@<rel>` token (forward-slash). */
  rel: string
  /** Base name shown in the menu row. */
  name: string
  /** True for a directory (drill into it); false for a regular file. */
  isDir: boolean
}

/** atFile.list response value: one directory level (files + subdirectories). */
export interface AtFileListing {
  /** Absolute path of the listed directory. */
  path: string
  /** Direct children, name-sorted; directories first. Bounded at the backend cut. */
  entries: AtFileEntry[]
  /** True when the backend cut `entries` at its complete-result bound. */
  truncated: boolean
}

/** at-file unary methods. */
export interface AtFileApi {
  /**
   * List one directory level (files + subdirectories) for the `@` reference
   * menu. Absent path lists the current workspace root. Hidden/skipped
   * directories (node_modules, .git, .venv, ...) are omitted alongside the
   * at-workspace injection plugin's skip list. Unreadable or missing targets
   * fail with `directory-unreadable`.
   */
  list(request: RpcRequest<{ path?: string }>, signal: AbortSignal): Promise<RpcResponse<AtFileListing>>
}