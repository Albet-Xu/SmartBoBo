/**
 * skillLibrary domain contract: host-backed management of the user's skill
 * library. The "library" is a distinct concern from the read-only `skills`
 * catalog: it owns the `skill-library` settings namespace (the `skills`/
 * `groups` lists the web manager renders) plus the host filesystem side of
 * installing and uninstalling local skills. Every method is write-side and
 * resolves against the settings namespace as it stands at call time, so the
 * browser never edits the section wholesale.
 *
 * Skill install is a host filesystem operation surfaced as `installLocal`: the
 * client first asks the host to pick a directory (`host.pickDirectory`), then
 * names that absolute path here. The host validates the folder is a skill
 * bundle (a `SKILL.md` with frontmatter), copies it under the harness's user
 * skills root, records it in settings, and lets the skills watcher discover it.
 * Toggle/group/uninstall mutate the same settings namespace.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Source vocabulary for a skill-library entry, mirroring the discovery roots. */
export type SkillLibrarySource = 'local' | 'http' | 'github' | 'runtime'

/** One group id → name mapping in the library's `groups` list. */
export interface SkillLibraryGroup {
  /** Stable group id referenced by entry `group`; kebab-case. */
  readonly id: string
  /** Human-readable group label shown in the manager. */
  readonly name: string
}

/** One persisted skill-library entry (the resolved `skill-library` namespace row). */
export interface SkillLibraryEntry {
  /** Kebab-case skill name (the folder/discovery name). */
  readonly name: string
  /** Routing description from frontmatter, when present. */
  readonly description?: string
  /** How the skill reached the library. */
  readonly source: SkillLibrarySource
  /** Whether the web manager shows it as enabled. */
  readonly enabled: boolean
  /** Owning group id, or null when ungrouped. */
  readonly group: string | null
  /** Absolute `SKILL.md` path of the bundled skill, when known. */
  readonly path?: string
}

/** The resolved `skill-library` settings namespace value. */
export interface SkillLibrarySettings {
  /** Installed entries, name-keyed by convention. */
  readonly skills: SkillLibraryEntry[]
  /** Named groups the manager offers. */
  readonly groups: SkillLibraryGroup[]
}

/**
 * skillLibrary-domain unary methods (the map keys skillLibrary.* of
 * RpcMethodMap). All operations persist to the `skill-library` settings
 * namespace and need the host settings provider; absent it, each method fails
 * with `settings-unavailable`.
 */
export interface SkillLibraryApi {
  /** Copy a picked local skill folder under the user skills root and record it. */
  installLocal(request: RpcRequest<{ path: string }>): Promise<RpcResponse<{ ok: true }>>
  /** Return on-disk skills under the user skills root that are not yet registered in the library. */
  discover(request: RpcRequest<{}>): Promise<RpcResponse<{ skills: readonly SkillLibraryEntry[] }>>
  /** Toggle one entry's `enabled` flag. */
  toggle(request: RpcRequest<{ name: string; enabled: boolean }>): Promise<RpcResponse<{ ok: true }>>
  /** Remove an entry from the library and delete its bundled skill folder. */
  uninstall(request: RpcRequest<{ name: string }>): Promise<RpcResponse<{ ok: true }>>
  /** Append a named group to the library. */
  createGroup(request: RpcRequest<{ name: string }>): Promise<RpcResponse<{ ok: true }>>
  /** Rename an existing group in place. */
  renameGroup(request: RpcRequest<{ id: string; name: string }>): Promise<RpcResponse<{ ok: true }>>
  /** Delete a group; entries that referenced it become ungrouped. */
  deleteGroup(request: RpcRequest<{ id: string }>): Promise<RpcResponse<{ ok: true }>>
  /** Assign (or, with a null `groupId`, clear) the group on the named entries. */
  moveToGroup(
    request: RpcRequest<{ names: string[]; groupId: string | null }>,
  ): Promise<RpcResponse<{ ok: true }>>
}