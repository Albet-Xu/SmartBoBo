/**
 * MCP Tools settings surface, node half. The browser half owns the section
 * through exports["./client"]; this host half registers the durable
 * `mcp-tools` settings namespace (the server list the manager renders and the
 * mcp.* RPCs mutate).
 * @module @deepseek-ai/dsh-client-ui-settings-mcp/index
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Durable settings namespace for the web MCP tool manager. */
export const MCP_TOOLS_NAMESPACE = 'mcp-tools'

/** Optional automatic reconnect policy of an MCP server. */
export interface McpReconnect {
  enabled: boolean
  initialDelayMs?: number
  maxDelayMs?: number
  maxAttempts?: number
}

/** One persisted MCP server row (id keys the entry, mirroring serverName). */
export interface McpTool {
  /** Stable entry id (equal to serverName). */
  id: string
  /** Stable unique server namespace. */
  serverName: string
  /** Selects the stdio or Streamable HTTP transport. */
  transport: 'stdio' | 'streamable-http'
  /** stdio: child-process executable. */
  command?: string
  /** stdio: arguments passed without shell interpolation. */
  args?: string[]
  /** stdio: extra environment variables. */
  env?: Record<string, string>
  /** stdio: working directory for the child process. */
  cwd?: string
  /** streamable-http: MCP endpoint URL. */
  url?: string
  /** streamable-http: additional request headers. */
  headers?: Record<string, string>
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs?: number
  /** Fail plugin activation when the initial connection or tool sync fails. */
  failOnStartupError?: boolean
  /** Automatic reconnect policy after a lost connection. */
  reconnect?: McpReconnect
  /** Whether the manager shows the server as enabled. */
  enabled: boolean
}

/** Resolved mcp-tools settings section. */
export interface McpToolsSettings {
  tools: McpTool[]
}

const McpReconnectSchema = z.object({
  enabled: z.boolean().default(true),
  initialDelayMs: z.number(),
  maxDelayMs: z.number(),
  maxAttempts: z.number(),
})

const McpToolSchema = z.object({
  id: z.string().required(),
  serverName: z.string().required(),
  transport: z.union([z.const('stdio'), z.const('streamable-http')]),
  command: z.string(),
  args: z.array(z.string()),
  env: z.dict(z.string()),
  cwd: z.string(),
  url: z.string(),
  headers: z.dict(z.string()),
  toolCallTimeoutMs: z.number(),
  failOnStartupError: z.boolean(),
  reconnect: McpReconnectSchema,
  enabled: z.boolean().default(true),
})

const McpToolsSettingsSchema = z.object({
  tools: z.array(McpToolSchema).default([]),
}) as unknown as z<McpToolsSettings>

/**
 * Register the durable mcp-tools section when a settings provider is composed.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(MCP_TOOLS_NAMESPACE),
      McpToolsSettingsSchema,
    )
  })
}