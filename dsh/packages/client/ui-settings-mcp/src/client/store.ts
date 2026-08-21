/**
 * MCP Tools state management: handles tool configuration, status, and operations.
 * @module @deepseek-ai/dsh-client-ui-settings-mcp/store
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** MCP Tool configuration. */
export interface MCPToolConfig {
  id: string
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  toolCallTimeoutMs?: number
  failOnStartupError?: boolean
  reconnect?: {
    enabled: boolean
    initialDelayMs?: number
    maxDelayMs?: number
    maxAttempts?: number
  }
}

/** MCP Tool status. */
export interface MCPToolStatus {
  id: string
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  toolCount: number
  lastError?: string
  lastConnected?: Date
}

/** Complete MCP Tools state. */
export interface MCPToolsState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  tools: MCPToolConfig[]
  toolStatuses: Map<string, MCPToolStatus>
  error: string | null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Coordinates MCP Tools operations. */
export class MCPToolsStore {
  /** uSES-safe state source. */
  readonly store: SnapshotStore<MCPToolsState> = createSnapshotStore({
    status: 'idle',
    tools: [],
    toolStatuses: new Map(),
    error: null,
  })

  private generation = 0

  constructor(
    _api: Pick<IApiClient, 'settings'>,
  ) {}

  /** Load MCP tools configuration. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    try {
      // 默认MCP工具配置
      const defaultTools: MCPToolConfig[] = [
        {
          id: 'js-reverse',
          serverName: 'js-reverse',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'js-reverse'],
          enabled: true,
          toolCallTimeoutMs: 120000,
          reconnect: {
            enabled: true,
            initialDelayMs: 500,
            maxDelayMs: 30000,
            maxAttempts: 10,
          },
        },
      ]
      
      let tools: MCPToolConfig[] = defaultTools
      
      // 尝试从后端API获取MCP工具配置
      try {
        const response = await fetch('/api/mcp-tools')
        if (response.ok) {
          const data = await response.json()
          if (data.tools && Array.isArray(data.tools) && data.tools.length > 0) {
            tools = data.tools
          }
        }
      } catch {
        // API不存在或请求失败，使用默认配置
      }
      
      const toolStatuses = new Map<string, MCPToolStatus>()
      
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'ready'
        state.tools = tools
        state.toolStatuses = toolStatuses
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

  /** Refresh MCP tools status. */
  refresh(): void {
    if (this.store.getSnapshot().status === 'idle') return
    void this.load()
  }

  /** Toggle MCP tool enabled state. */
  async toggle(id: string, enabled: boolean): Promise<boolean> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      // TODO: Implement actual API call
      if (generation !== this.generation) return false
      this.store.update((state) => {
        state.status = 'ready'
        state.tools = state.tools.map(tool =>
          tool.id === id ? { ...tool, enabled } : tool
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

  /** Batch toggle MCP tools. */
  async batchToggle(ids: string[], enabled: boolean): Promise<boolean> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      // TODO: Implement actual API call
      if (generation !== this.generation) return false
      this.store.update((state) => {
        state.status = 'ready'
        state.tools = state.tools.map(tool =>
          ids.includes(tool.id) ? { ...tool, enabled } : tool
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

  /** Install MCP tool. */
  async install(config: Omit<MCPToolConfig, 'id'>): Promise<string | null> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      // TODO: Implement actual API call
      const id = `mcp-${Date.now()}`
      if (generation !== this.generation) return null
      this.store.update((state) => {
        state.status = 'ready'
        state.tools = [...state.tools, { ...config, id }]
        state.error = null
      })
      return id
    } catch (error) {
      if (generation !== this.generation) return null
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
      return null
    }
  }

  /** Uninstall MCP tool. */
  async uninstall(id: string): Promise<boolean> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      // TODO: Implement actual API call
      if (generation !== this.generation) return false
      this.store.update((state) => {
        state.status = 'ready'
        state.tools = state.tools.filter(tool => tool.id !== id)
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

  /** Batch uninstall MCP tools. */
  async batchUninstall(ids: string[]): Promise<boolean> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      // TODO: Implement actual API call
      if (generation !== this.generation) return false
      this.store.update((state) => {
        state.status = 'ready'
        state.tools = state.tools.filter(tool => !ids.includes(tool.id))
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
}
