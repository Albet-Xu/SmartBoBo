/**
 * Skills Library state management: coordinates the web skill-library manager.
 * All mutations go through the `skillLibrary.*` RPCs, which persist to the
 * host `skill-library` settings namespace; `load` reads that namespace via
 * `settings.describe`. Locally installed skills enter the library through
 * `installLocal`, so the settings section is the authoritative UI source.
 * @module @deepseek-ai/dsh-client-ui-settings-skills/store
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Skill configuration. */
export interface SkillConfig {
  name: string
  description?: string
  source: 'local' | 'http' | 'github' | 'runtime'
  path?: string
  url?: string
  githubRepo?: string
  enabled: boolean
  /** Owning group id, or null/absent when ungrouped. */
  group?: string | null
  invocation: {
    modelInvocable: boolean
    userInvocable: boolean
  }
  metadata?: Record<string, unknown>
}

/** A named skill group the manager offers. */
export interface SkillGroup {
  id: string
  name: string
}

/** Skill status. */
export interface SkillStatus {
  name: string
  status: 'active' | 'inactive' | 'error'
  provider: string
  lastUsed?: Date
  usageCount?: number
}

/** Complete Skills state. */
export interface SkillsState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  skills: SkillConfig[]
  groups: SkillGroup[]
  skillStatuses: Map<string, SkillStatus>
  error: string | null
}

const SOURCES = ['local', 'http', 'github', 'runtime'] as const

function isSource(value: unknown): value is SkillConfig['source'] {
  return SOURCES.includes(value as SkillConfig['source'])
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Narrow one settings row to a {@link SkillConfig}, or none when it is malformed. */
function toSkillConfig(raw: unknown): SkillConfig[] {
  if (typeof raw !== 'object' || raw === null) return []
  const record = raw as Record<string, unknown>
  if (typeof record['name'] !== 'string' || record['name'].length === 0) return []
  return [{
    name: record['name'],
    ...typeof record['description'] === 'string' ? { description: record['description'] } : {},
    source: isSource(record['source']) ? record['source'] : 'local',
    ...typeof record['path'] === 'string' ? { path: record['path'] } : {},
    ...typeof record['group'] === 'string' ? { group: record['group'] } : {},
    enabled: typeof record['enabled'] === 'boolean' ? record['enabled'] : true,
    invocation: { modelInvocable: true, userInvocable: true },
  }]
}

/** Narrow one settings group row to a {@link SkillGroup}, or none when malformed. */
function toSkillGroup(raw: unknown): SkillGroup[] {
  if (typeof raw !== 'object' || raw === null) return []
  const record = raw as Record<string, unknown>
  if (typeof record['id'] !== 'string' || typeof record['name'] !== 'string') return []
  return [{ id: record['id'], name: record['name'] }]
}

/** Coordinates Skills Library operations. */
export class SkillsStore {
  /** uSES-safe state source. */
  readonly store: SnapshotStore<SkillsState> = createSnapshotStore({
    status: 'idle',
    skills: [],
    groups: [],
    skillStatuses: new Map(),
    error: null,
  })

  private generation = 0

  constructor(
    private readonly api: Pick<IApiClient, 'settings' | 'skillLibrary'>,
  ) {}

  /** Load skills and groups from the host `skill-library` settings namespace. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    try {
      const response = await this.api.settings.describe({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      let skillsRaw: unknown[] = []
      let groupsRaw: unknown[] = []
      const ns = response.result.value.namespaces.find(candidate => candidate.ns === 'skill-library')
      if (ns !== undefined && typeof ns.value === 'object' && ns.value !== null) {
        const section = ns.value as { skills?: unknown; groups?: unknown }
        if (Array.isArray(section.skills)) skillsRaw = section.skills
        if (Array.isArray(section.groups)) groupsRaw = section.groups
      }
      const skills = skillsRaw.flatMap(toSkillConfig)
      const groups = groupsRaw.flatMap(toSkillGroup)
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'ready'
        state.skills = skills
        state.groups = groups
        state.skillStatuses = new Map()
        state.error = null
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
    }
  }

  /** Refresh skills status. */
  refresh(): void {
    if (this.store.getSnapshot().status === 'idle') return
    void this.load()
  }

  /** Toggle skill enabled state. */
  async toggle(name: string, enabled: boolean): Promise<boolean> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      const response = await this.api.skillLibrary.toggle({ name, enabled })
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (generation !== this.generation) return false
      this.store.update((state) => {
        state.status = 'ready'
        state.skills = state.skills.map(skill => skill.name === name ? { ...skill, enabled } : skill)
        state.error = null
      })
      return true
    } catch (error) {
      if (generation !== this.generation) return false
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
      return false
    }
  }

  /** Batch toggle skills, then reload the authoritative list. */
  async batchToggle(names: string[], enabled: boolean): Promise<boolean> {
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      for (const name of names) {
        const response = await this.api.skillLibrary.toggle({ name, enabled })
        if (!response.result.ok) throw new Error(response.result.error.message)
      }
      await this.load()
      return true
    } catch (error) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
      return false
    }
  }

  /** Uninstall a skill (settings entry + its bundled folder). */
  async uninstall(name: string): Promise<boolean> {
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      const response = await this.api.skillLibrary.uninstall({ name })
      if (!response.result.ok) throw new Error(response.result.error.message)
      await this.load()
      return true
    } catch (error) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
      return false
    }
  }

  /** Batch uninstall skills. */
  async batchUninstall(names: string[]): Promise<boolean> {
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      for (const name of names) {
        const response = await this.api.skillLibrary.uninstall({ name })
        if (!response.result.ok) throw new Error(response.result.error.message)
      }
      await this.load()
      return true
    } catch (error) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
      return false
    }
  }

  /** Install skill from a picked local folder. */
  async installFromLocal(path: string): Promise<boolean> {
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      const response = await this.api.skillLibrary.installLocal({ path })
      if (!response.result.ok) throw new Error(response.result.error.message)
      await this.load()
      return true
    } catch (error) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
      return false
    }
  }

  /** Append a named group to the library. */
  async createGroup(name: string): Promise<boolean> {
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      const response = await this.api.skillLibrary.createGroup({ name })
      if (!response.result.ok) throw new Error(response.result.error.message)
      await this.load()
      return true
    } catch (error) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
      return false
    }
  }

  /** Rename an existing group. */
  async renameGroup(id: string, name: string): Promise<boolean> {
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      const response = await this.api.skillLibrary.renameGroup({ id, name })
      if (!response.result.ok) throw new Error(response.result.error.message)
      await this.load()
      return true
    } catch (error) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
      return false
    }
  }

  /** Delete a group; its skills become ungrouped. */
  async deleteGroup(id: string): Promise<boolean> {
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      const response = await this.api.skillLibrary.deleteGroup({ id })
      if (!response.result.ok) throw new Error(response.result.error.message)
      await this.load()
      return true
    } catch (error) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
      return false
    }
  }

  /** Assign (or clear, with a null group) the group on the named skills. */
  async moveToGroup(names: string[], groupId: string | null): Promise<boolean> {
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      const response = await this.api.skillLibrary.moveToGroup({ names, groupId })
      if (!response.result.ok) throw new Error(response.result.error.message)
      await this.load()
      return true
    } catch (error) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
      return false
    }
  }

  /** Install skill from URL. */
  async installFromUrl(_url: string): Promise<boolean> {
    this.store.update((state) => { state.status = 'error'; state.error = 'URL 安装尚未接入后端' })
    return false
  }

  /** Install skill from GitHub repository. */
  async installFromGithub(_repo: string): Promise<boolean> {
    this.store.update((state) => { state.status = 'error'; state.error = 'GitHub 安装尚未接入后端' })
    return false
  }

  /** Search skills. */
  async search(query: string): Promise<SkillConfig[]> {
    const state = this.store.getSnapshot()
    return state.skills.filter(skill =>
      skill.name.toLowerCase().includes(query.toLowerCase()) ||
      skill.description?.toLowerCase().includes(query.toLowerCase())
    )
  }

  /** Filter skills by status. */
  filterByStatus(filter: 'all' | 'enabled' | 'disabled'): SkillConfig[] {
    const state = this.store.getSnapshot()
    switch (filter) {
      case 'enabled':
        return state.skills.filter(skill => skill.enabled)
      case 'disabled':
        return state.skills.filter(skill => !skill.enabled)
      default:
        return state.skills
    }
  }

  /** Filter skills by source. */
  filterBySource(filter: 'all' | 'local' | 'http' | 'github' | 'runtime'): SkillConfig[] {
    const state = this.store.getSnapshot()
    if (filter === 'all') return state.skills
    return state.skills.filter(skill => skill.source === filter)
  }
}