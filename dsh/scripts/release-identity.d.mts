/**
 * `scripts/release-identity.mjs` 的类型声明。
 *
 * 该脚本是给 CI 直接调用的纯 ESM，本身不带类型；这里声明它导出的四个函数，
 * 让 `test/release-identity.test.ts` 的导入在 `pnpm typecheck` 下可解析。
 */

export interface SemverIdentity {
  version: string
  prerelease: string | null
  build: string | null
}

export interface ReleaseIdentity {
  version: string
  semver: SemverIdentity
}

export interface ReleaseMetadata {
  tag: string
  prerelease: boolean
  should_release: boolean
  source_ref: string
}

export function parseSemver(version: unknown, label?: string): SemverIdentity

export function readCargoPackageVersion(content: unknown): string

export function readReleaseIdentity(repo?: string): ReleaseIdentity

export function deriveReleaseMetadata(input: {
  eventName: string
  pushTag?: string
  sourceRef: string
  identity: ReleaseIdentity
}): ReleaseMetadata
