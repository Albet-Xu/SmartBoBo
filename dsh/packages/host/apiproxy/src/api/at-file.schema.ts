/**
 * at-file domain zod schemas (names derived from map keys).
 */

import { z } from 'zod'
import type { AtFileEntry } from './at-file.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** atFile.list request payload; absent path lists the current workspace root. */
export const atFileListRequestSchema = z.object({
  path: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'atFile.list'>>>

/** One at-file entry (files + directories). */
export const atFileEntrySchema = z.object({
  path: z.string(),
  rel: z.string(),
  name: z.string(),
  isDir: z.boolean(),
}) satisfies z.ZodType<Wire<AtFileEntry>>

/** atFile.list response value. */
export const atFileListValueSchema = z.object({
  path: z.string(),
  entries: z.array(atFileEntrySchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'atFile.list'>>>