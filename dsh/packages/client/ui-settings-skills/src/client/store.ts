/**
 * Skills Library state management: handles skill configuration, status, and operations.
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
  invocation: {
    modelInvocable: boolean
    userInvocable: boolean
  }
  metadata?: Record<string, unknown>
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
  skillStatuses: Map<string, SkillStatus>
  error: string | null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Coordinates Skills Library operations. */
export class SkillsStore {
  /** uSES-safe state source. */
  readonly store: SnapshotStore<SkillsState> = createSnapshotStore({
    status: 'idle',
    skills: [],
    skillStatuses: new Map(),
    error: null,
  })

  private generation = 0

  constructor(
    _api: Pick<IApiClient, 'settings'>,
  ) {}

  /** Load skills configuration. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    try {
      // 默认Skills配置
      const defaultSkills: SkillConfig[] = [
        {
          name: 'summarize',
          description: '内容摘要总结技能，能够对长文本、网页、文档进行智能摘要。',
          source: 'local',
          path: '~/.dsh/skills/summarize/SKILL.md',
          enabled: true,
          invocation: {
            modelInvocable: true,
            userInvocable: true,
          },
        },
      ]
      
      let skills: SkillConfig[] = defaultSkills
      
      // 尝试从后端API获取Skills配置
      try {
        const response = await fetch('/api/skills')
        if (response.ok) {
          const data = await response.json()
          if (data.skills && Array.isArray(data.skills) && data.skills.length > 0) {
            skills = data.skills
          }
        }
      } catch {
        // API不存在或请求失败，使用默认配置
      }
      
      const skillStatuses = new Map<string, SkillStatus>()
      
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'ready'
        state.skills = skills
        state.skillStatuses = skillStatuses
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
      // TODO: Implement actual API call
      if (generation !== this.generation) return false
      this.store.update((state) => {
        state.status = 'ready'
        state.skills = state.skills.map(skill =>
          skill.name === name ? { ...skill, enabled } : skill
        )
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

  /** Batch toggle skills. */
  async batchToggle(names: string[], enabled: boolean): Promise<boolean> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      // TODO: Implement actual API call
      if (generation !== this.generation) return false
      this.store.update((state) => {
        state.status = 'ready'
        state.skills = state.skills.map(skill =>
          names.includes(skill.name) ? { ...skill, enabled } : skill
        )
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

  /** Install skill. */
  async install(config: Omit<SkillConfig, 'enabled'>): Promise<boolean> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      // TODO: Implement actual API call
      if (generation !== this.generation) return false
      this.store.update((state) => {
        state.status = 'ready'
        state.skills = [...state.skills, { ...config, enabled: true }]
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

  /** Uninstall skill. */
  async uninstall(name: string): Promise<boolean> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      // TODO: Implement actual API call
      if (generation !== this.generation) return false
      this.store.update((state) => {
        state.status = 'ready'
        state.skills = state.skills.filter(skill => skill.name !== name)
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

  /** Batch uninstall skills. */
  async batchUninstall(names: string[]): Promise<boolean> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      // TODO: Implement actual API call
      if (generation !== this.generation) return false
      this.store.update((state) => {
        state.status = 'ready'
        state.skills = state.skills.filter(skill => !names.includes(skill.name))
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

  /** Install skill from URL. */
  async installFromUrl(_url: string): Promise<boolean> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      // TODO: Implement actual API call to download and install skill from URL
      if (generation !== this.generation) return false
      this.store.update((state) => {
        state.status = 'ready'
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

  /** Install skill from GitHub repository. */
  async installFromGithub(_repo: string): Promise<boolean> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      // TODO: Implement actual API call to clone and install skill from GitHub
      if (generation !== this.generation) return false
      this.store.update((state) => {
        state.status = 'ready'
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

  /** Install skill from local file. */
  async installFromLocal(_path: string): Promise<boolean> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      // TODO: Implement actual API call to copy and install skill from local file
      if (generation !== this.generation) return false
      this.store.update((state) => {
        state.status = 'ready'
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

  /** Search skills. */
  async search(query: string): Promise<SkillConfig[]> {
    const generation = ++this.generation
    try {
      // TODO: Implement actual API call to search skills
      if (generation !== this.generation) return []
      const state = this.store.getSnapshot()
      return state.skills.filter(skill =>
        skill.name.toLowerCase().includes(query.toLowerCase()) ||
        skill.description?.toLowerCase().includes(query.toLowerCase())
      )
    } catch {
      return []
    }
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
