/**
 * Skills Library settings surface, node half. The browser half owns the section
 * through exports["./client"]; this host half registers the durable
 * `skill-library` settings namespace (the skills/groups lists the manager
 * renders and the skillLibrary.* RPCs mutate).
 * @module @deepseek-ai/dsh-client-ui-settings-skills/index
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Durable settings namespace for the web skill-library manager. */
export const SKILL_LIBRARY_NAMESPACE = 'skill-library'

/** One skill-library group row. */
export interface SkillLibraryGroup {
  /** Stable group id referenced by a skill entry's `group`. */
  id: string
  /** Human-readable group label. */
  name: string
}

/** One skill-library skill row. */
export interface SkillLibrarySkill {
  /** Kebab-case skill name. */
  name: string
  /** Routing description from frontmatter, when present. */
  description?: string
  /** How the skill reached the library. */
  source: 'local' | 'http' | 'github' | 'runtime'
  /** Whether the manager shows it as enabled. */
  enabled: boolean
  /** Owning group id, or null when ungrouped. */
  group: string | null
  /** Absolute SKILL.md path of the bundled skill, when known. */
  path?: string
}

/** Resolved skill-library settings section. */
export interface SkillLibrarySettings {
  skills: SkillLibrarySkill[]
  groups: SkillLibraryGroup[]
}

const SkillLibrarySkillSchema = z.object({
  name: z.string().required(),
  description: z.string(),
  source: z.union([z.const('local'), z.const('http'), z.const('github'), z.const('runtime')]).default('local'),
  enabled: z.boolean().default(true),
  group: z.string(),
  path: z.string(),
})

const SkillLibraryGroupSchema = z.object({
  id: z.string().required(),
  name: z.string().required(),
})

const SkillLibrarySettingsSchema = z.object({
  skills: z.array(SkillLibrarySkillSchema).default([]),
  groups: z.array(SkillLibraryGroupSchema).default([]),
}) as unknown as z<SkillLibrarySettings>

/**
 * Register the durable skill-library section when a settings provider is composed.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(SKILL_LIBRARY_NAMESPACE),
      SkillLibrarySettingsSchema,
    )
  })
}