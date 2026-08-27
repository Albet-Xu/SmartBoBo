/**
 * ProxyPoolStore: manages proxy-pool settings state via the settings namespace.
 * @module @deepseek-ai/dsh-client-ui-settings-proxy/store
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'

/**
 * Proxy source configuration.
 */
export interface ProxySource {
  name: string
  apiUrl: string
  apiKey: string
  pwd: string
  getnum: number
  httptype: string
  geshi: string
  fenge: string
  enabled: boolean
}

/**
 * Full proxy pool settings.
 */
export interface ProxyPoolConfig {
  sources: ProxySource[]
  fetchStrategy: 'cache' | 'realtime'
  enabled: boolean
  maxRetries: number
  timeoutMs: number
}

/**
 * Proxy pool store state snapshot.
 */
export interface ProxyPoolState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  config: ProxyPoolConfig
  error: string | null
}

const DEFAULT_CONFIG: ProxyPoolConfig = {
  sources: [],
  fetchStrategy: 'cache',
  enabled: false,
  maxRetries: 3,
  timeoutMs: 30000,
}

/**
 * Store controller for proxy pool settings.
 */
export class ProxyPoolStore {
  readonly store: ReturnType<typeof createSnapshotStore<ProxyPoolState>>
  private loadGeneration = 0

  constructor(private readonly api: Pick<IApiClient, 'settings'>) {
    this.store = createSnapshotStore<ProxyPoolState>({
      status: 'idle',
      config: DEFAULT_CONFIG,
      error: null,
    })
  }

  /**
   * Load current settings from the backend.
   */
  async load(): Promise<void> {
    const generation = ++this.loadGeneration
    this.store.update(draft => { draft.status = 'loading' })
    try {
      const response = await this.api.settings.describe({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      const ns = response.result.value.namespaces.find(n => n.ns === 'proxy-pool')
      if (ns === undefined || generation !== this.loadGeneration) {
        this.store.update(draft => { draft.status = 'ready'; draft.config = DEFAULT_CONFIG })
        return
      }
      const config = ns.value as Partial<ProxyPoolConfig>
      this.store.update(draft => {
        draft.status = 'ready'
        draft.config = {
          sources: Array.isArray(config.sources) ? config.sources : [],
          fetchStrategy: config.fetchStrategy ?? 'cache',
          enabled: config.enabled ?? false,
          maxRetries: config.maxRetries ?? 3,
          timeoutMs: config.timeoutMs ?? 30000,
        }
      })
    } catch (error: unknown) {
      this.store.update(draft => { draft.status = 'error'; draft.error = String(error) })
    }
  }

  /**
   * Refresh the current settings (calls load).
   */
  refresh(): void {
    void this.load()
  }

  /**
   * Save updated config to the backend.
   */
  async save(config: ProxyPoolConfig): Promise<void> {
    try {
      await this.api.settings.mutate({
        ns: 'proxy-pool',
        ops: [{ op: 'set', path: ['sources'], value: config.sources },
              { op: 'set', path: ['fetchStrategy'], value: config.fetchStrategy },
              { op: 'set', path: ['enabled'], value: config.enabled },
              { op: 'set', path: ['maxRetries'], value: config.maxRetries },
              { op: 'set', path: ['timeoutMs'], value: config.timeoutMs }],
      })
      this.store.update(draft => { draft.config = config; draft.error = null })
    } catch (error: unknown) {
      this.store.update(draft => { draft.error = String(error) })
    }
  }
}
