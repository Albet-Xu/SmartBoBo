/**
 * mcp domain zod schemas (names derived from map keys: mcpInstall* / mcpToggle* / mcpUninstall*).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { McpReconnectView, McpToolConfigView } from './mcp.ts'

/** Shared ok acknowledgement value for every mcp write method. */
export const mcpOkValueSchema = z.object({
  ok: z.literal(true),
}) satisfies z.ZodType<Wire<{ ok: true }>>

/** Optional reconnect policy mirroring mcp-client's block. */
export const mcpReconnectConfigSchema = z.object({
  enabled: z.boolean(),
  initialDelayMs: z.number().optional(),
  maxDelayMs: z.number().optional(),
  maxAttempts: z.number().optional(),
}) satisfies z.ZodType<Wire<McpReconnectView>>

/** Bridge configuration accepted by mcp.install (one transport each). */
export const mcpToolConfigSchema = z.union([
  z.object({
    serverName: z.string().min(1).max(32),
    transport: z.literal('stdio'),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
    toolCallTimeoutMs: z.number().optional(),
    failOnStartupError: z.boolean().optional(),
    reconnect: mcpReconnectConfigSchema.optional(),
  }),
  z.object({
    serverName: z.string().min(1).max(32),
    transport: z.literal('streamable-http'),
    url: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    toolCallTimeoutMs: z.number().optional(),
    failOnStartupError: z.boolean().optional(),
    reconnect: mcpReconnectConfigSchema.optional(),
  }),
]) as z.ZodType<Wire<McpToolConfigView>>

/** mcp.install request payload. */
export const mcpInstallRequestSchema = z.object({
  config: mcpToolConfigSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'mcp.install'>>>

/** mcp.install response value. */
export const mcpInstallValueSchema = mcpOkValueSchema satisfies z.ZodType<Wire<ResponseValue<'mcp.install'>>>

// ---- mcp.toggle ----

/** mcp.toggle request payload. */
export const mcpToggleRequestSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
}) satisfies z.ZodType<Wire<RequestPayload<'mcp.toggle'>>>

/** mcp.toggle response value. */
export const mcpToggleValueSchema = mcpOkValueSchema satisfies z.ZodType<Wire<ResponseValue<'mcp.toggle'>>>

// ---- mcp.uninstall ----

/** mcp.uninstall request payload. */
export const mcpUninstallRequestSchema = z.object({
  id: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'mcp.uninstall'>>>

/** mcp.uninstall response value. */
export const mcpUninstallValueSchema = mcpOkValueSchema satisfies z.ZodType<Wire<ResponseValue<'mcp.uninstall'>>>