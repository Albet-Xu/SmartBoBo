/**
 * skillLibrary domain zod schemas (names derived from map keys:
 * skillLibraryInstallLocal* / skillLibraryToggle* / skillLibraryUninstall* / skillLibraryCreateGroup* /
 * skillLibraryRenameGroup* / skillLibraryDeleteGroup* / skillLibraryMoveToGroup*).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { SkillLibraryEntry } from './skill-library.ts'

/** Shared ok acknowledgement value for every skillLibrary write method. */
export const skillLibraryOkValueSchema = z.object({
  ok: z.literal(true),
}) satisfies z.ZodType<Wire<{ ok: true }>>

// ---- skillLibrary.installLocal ----

/** skillLibrary.installLocal request payload. */
export const skillLibraryInstallLocalRequestSchema = z.object({
  path: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'skillLibrary.installLocal'>>>

/** skillLibrary.installLocal response value. */
export const skillLibraryInstallLocalValueSchema = skillLibraryOkValueSchema satisfies z.ZodType<Wire<ResponseValue<'skillLibrary.installLocal'>>>

// ---- skillLibrary.discover ----

/** One skill-library entry, used to represent an on-disk but unregistered skill. */
export const skillLibraryEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  source: z.enum(['local', 'http', 'github', 'runtime']),
  enabled: z.boolean(),
  group: z.string().nullable(),
  path: z.string().optional(),
}) satisfies z.ZodType<Wire<SkillLibraryEntry>>

/** skillLibrary.discover request payload (empty). */
export const skillLibraryDiscoverRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'skillLibrary.discover'>>>

/** skillLibrary.discover response value. */
export const skillLibraryDiscoverValueSchema = z.object({
  skills: z.array(skillLibraryEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skillLibrary.discover'>>>

// ---- skillLibrary.toggle ----

/** skillLibrary.toggle request payload. */
export const skillLibraryToggleRequestSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
}) satisfies z.ZodType<Wire<RequestPayload<'skillLibrary.toggle'>>>

/** skillLibrary.toggle response value. */
export const skillLibraryToggleValueSchema = skillLibraryOkValueSchema satisfies z.ZodType<Wire<ResponseValue<'skillLibrary.toggle'>>>

// ---- skillLibrary.uninstall ----

/** skillLibrary.uninstall request payload. */
export const skillLibraryUninstallRequestSchema = z.object({
  name: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'skillLibrary.uninstall'>>>

/** skillLibrary.uninstall response value. */
export const skillLibraryUninstallValueSchema = skillLibraryOkValueSchema satisfies z.ZodType<Wire<ResponseValue<'skillLibrary.uninstall'>>>

// ---- skillLibrary.createGroup ----

/** skillLibrary.createGroup request payload. */
export const skillLibraryCreateGroupRequestSchema = z.object({
  name: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'skillLibrary.createGroup'>>>

/** skillLibrary.createGroup response value. */
export const skillLibraryCreateGroupValueSchema = skillLibraryOkValueSchema satisfies z.ZodType<Wire<ResponseValue<'skillLibrary.createGroup'>>>

// ---- skillLibrary.renameGroup ----

/** skillLibrary.renameGroup request payload. */
export const skillLibraryRenameGroupRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'skillLibrary.renameGroup'>>>

/** skillLibrary.renameGroup response value. */
export const skillLibraryRenameGroupValueSchema = skillLibraryOkValueSchema satisfies z.ZodType<Wire<ResponseValue<'skillLibrary.renameGroup'>>>

// ---- skillLibrary.deleteGroup ----

/** skillLibrary.deleteGroup request payload. */
export const skillLibraryDeleteGroupRequestSchema = z.object({
  id: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'skillLibrary.deleteGroup'>>>

/** skillLibrary.deleteGroup response value. */
export const skillLibraryDeleteGroupValueSchema = skillLibraryOkValueSchema satisfies z.ZodType<Wire<ResponseValue<'skillLibrary.deleteGroup'>>>

// ---- skillLibrary.moveToGroup ----

/** skillLibrary.moveToGroup request payload. */
export const skillLibraryMoveToGroupRequestSchema = z.object({
  names: z.array(z.string().min(1)),
  groupId: z.string().min(1).nullable(),
}) satisfies z.ZodType<Wire<RequestPayload<'skillLibrary.moveToGroup'>>>

/** skillLibrary.moveToGroup response value. */
export const skillLibraryMoveToGroupValueSchema = skillLibraryOkValueSchema satisfies z.ZodType<Wire<ResponseValue<'skillLibrary.moveToGroup'>>>