/**
 * MCP Tools state management: coordinates the web MCP tool manager. All
 * mutations go through the `mcp.*` RPCs — `install` writes an mcp-client row
 * to the home cordis overlay plus the host `mcp-tools` settings namespace;
 * `load` reads that namespace via `settings.describe`.
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

function isStringMap(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && Object.values(value).every(item => typeof item === 'string')
}

type MCPReconnect = NonNullable<MCPToolConfig['reconnect']>

function isReconnect(value: unknown): value is MCPReconnect {
  if (typeof value !== 'object' || value === null) return false
  const rec = value as Record<string, unknown>
  return typeof rec['enabled'] === 'boolean'
}

/** Narrow one settings row to a {@link MCPToolConfig}, or none when malformed. */
function toMcpTool(raw: unknown): MCPToolConfig[] {
  if (typeof raw !== 'object' || raw === null) return []
  const rec = raw as Record<string, unknown>
  if (typeof rec['id'] !== 'string' || typeof rec['serverName'] !== 'string') return []
  const transport = rec['transport'] === 'streamable-http' ? 'streamable-http' : 'stdio'
  const reconnect = rec['reconnect']
  return [{
    id: rec['id'],
    serverName: rec['serverName'],
    transport,
    ...typeof rec['command'] === 'string' ? { command: rec['command'] } : {},
    ...Array.isArray(rec['args']) ? { args: rec['args'] as string[] } : {},
    ...isStringMap(rec['env']) ? { env: rec['env'] } : {},
    ...typeof rec['cwd'] === 'string' ? { cwd: rec['cwd'] } : {},
    ...typeof rec['url'] === 'string' ? { url: rec['url'] } : {},
    ...isStringMap(rec['headers']) ? { headers: rec['headers'] } : {},
    ...typeof rec['toolCallTimeoutMs'] === 'number' ? { toolCallTimeoutMs: rec['toolCallTimeoutMs'] } : {},
    ...typeof rec['failOnStartupError'] === 'boolean' ? { failOnStartupError: rec['failOnStartupError'] } : {},
    ...isReconnect(reconnect) ? { reconnect: reconnect } : {},
    enabled: typeof rec['enabled'] === 'boolean' ? rec['enabled'] : true,
  }]
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
    private readonly api: Pick<IApiClient, 'settings' | 'mcp'>,
  ) {}

  /** Load MCP tools from the host `mcp-tools` settings namespace. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    try {
      const response = await this.api.settings.describe({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      let toolsRaw: unknown[] = []
      const ns = response.result.value.namespaces.find(candidate => candidate.ns === 'mcp-tools')
      if (ns !== undefined && typeof ns.value === 'object' && ns.value !== null) {
        const section = ns.value as { tools?: unknown }
        if (Array.isArray(section.tools)) toolsRaw = section.tools
      }
      const tools = toolsRaw.flatMap(toMcpTool)
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'ready'
        state.tools = tools
        state.toolStatuses = new Map()
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
      const response = await this.api.mcp.toggle({ id, enabled })
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (generation !== this.generation) return false
      this.store.update((state) => {
        state.status = 'ready'
        state.tools = state.tools.map(tool => tool.id === id ? { ...tool, enabled } : tool)
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

  /** Batch toggle MCP tools, then reload the authoritative list. */
  async batchToggle(ids: string[], enabled: boolean): Promise<boolean> {
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      for (const id of ids) {
        const response = await this.api.mcp.toggle({ id, enabled })
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

  /** Install MCP tool: write mcp-client config and record it in settings. */
  async install(config: Omit<MCPToolConfig, 'id'>): Promise<string | null> {
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      // `enabled` is a manager-list concept; the RPC sets it true on install.
      const { enabled: _enabled, ...connection } = config
      const response = await this.api.mcp.install({ config: connection })
      if (!response.result.ok) throw new Error(response.result.error.message)
      const id = connection.serverName
      await this.load()
      return id
    } catch (error) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
      return null
    }
  }

  /** Uninstall MCP tool (removes it from the settings list). */
  async uninstall(id: string): Promise<boolean> {
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      const response = await this.api.mcp.uninstall({ id })
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

  /** Batch uninstall MCP tools. */
  async batchUninstall(ids: string[]): Promise<boolean> {
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      for (const id of ids) {
        const response = await this.api.mcp.uninstall({ id })
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
}