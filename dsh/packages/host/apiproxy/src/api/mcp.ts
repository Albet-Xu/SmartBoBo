/**
 * mcp domain contract: host-backed management of MCP tool servers. Installing
 * an MCP server writes a `mcp-client` plugin instance into the app's home
 * cordis overlay (`$DSH_HOME/cordis.patch.yml`) so it mounts on the next
 * startup, and records the server in the `mcp-tools` settings namespace the
 * web manager renders. Toggling disabled removes that cordis row (so the
 * server stops mounting next launch); toggling enabled re-appends it from the
 * saved config. Uninstall removes both the row and the settings entry.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Automatic reconnect policy of an MCP server, mirroring mcp-client's optional block. */
export interface McpReconnectView {
  /** Whether automatic reconnection is enabled. */
  readonly enabled: boolean
  /** First reconnection delay in milliseconds. */
  readonly initialDelayMs?: number
  /** Maximum reconnection delay in milliseconds. */
  readonly maxDelayMs?: number
  /** Maximum reconnect attempts before giving up. */
  readonly maxAttempts?: number
}

/** Bridge configuration submitted when installing an MCP server (one transport each). */
export interface McpToolConfigView {
  /** Stable unique server namespace (matches `[A-Za-z0-9_-]{1,32}`). */
  readonly serverName: string
  /** Selects the stdio or Streamable HTTP transport. */
  readonly transport: 'stdio' | 'streamable-http'
  /** stdio: child-process executable. */
  readonly command?: string
  /** stdio: arguments passed without shell interpolation. */
  readonly args?: string[]
  /** stdio: extra environment variables merged over the scrubbed ambient env. */
  readonly env?: Record<string, string>
  /** stdio: working directory for the child process. */
  readonly cwd?: string
  /** streamable-http: MCP endpoint URL. */
  readonly url?: string
  /** streamable-http: additional request headers. */
  readonly headers?: Record<string, string>
  /** Per-tool-call timeout in milliseconds. */
  readonly toolCallTimeoutMs?: number
  /** Fail plugin activation when the initial connection or tool sync fails. */
  readonly failOnStartupError?: boolean
  /** Automatic reconnect policy after a lost connection. */
  readonly reconnect?: McpReconnectView
}

/** One persisted mcp-tools settings row (id keys the entry, mirroring serverName). */
export interface McpToolEntryView extends McpToolConfigView {
  /** Stable entry id (equal to serverName). */
  readonly id: string
  /** Whether the web manager shows the server as enabled. */
  readonly enabled: boolean
}

/** The resolved `mcp-tools` settings namespace value. */
export interface McpToolsSettings {
  /** Installed server entries, id-keyed. */
  readonly tools: McpToolEntryView[]
}

/**
 * mcp-domain unary methods (the map keys mcp.* of RpcMethodMap). `install`
 * needs the host settings provider and writes the home cordis overlay; absent
 * either, it fails with `settings-unavailable` or `mcp-config-rejected`.
 */
export interface McpApi {
  /** Write an mcp-client instance to the home cordis overlay and record it in settings. */
  install(request: RpcRequest<{ config: McpToolConfigView }>): Promise<RpcResponse<{ ok: true }>>
  /** Toggle one entry's `enabled` flag in the mcp-tools settings. */
  toggle(request: RpcRequest<{ id: string; enabled: boolean }>): Promise<RpcResponse<{ ok: true }>>
  /** Remove one entry from the mcp-tools settings. */
  uninstall(request: RpcRequest<{ id: string }>): Promise<RpcResponse<{ ok: true }>>
}