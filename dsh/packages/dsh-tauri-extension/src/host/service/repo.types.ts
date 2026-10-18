import type { RepoNs } from './repo/repo-core.mjs'

export type { RepoNs }

export interface RepoEntry {
  ns: RepoNs
  id: string
  name: string
  description: string
  version: string | null
  installedVersion: string | null
  status: 'available' | 'installed' | 'update-available'
  tags: string[]
  requires: string[]
  size: number | null
  target: string
  builtin?: boolean
  scope?: string[]
  category?: string
  unresolved?: string[]
}

export interface RepoDetail {
  id: string
  markdown: string
  cached: boolean
}

export interface RepoInstallReceipt {
  ns: RepoNs
  id: string
  version: string | null
  target: string
  replaced: boolean
  fileCount: number
}

export interface RepoUninstallReceipt {
  ns: RepoNs
  id: string
  followedBy: string[]
}

export interface RepoScopeReceipt {
  toolId: string
  scope: string[]
}

export interface RepoCategoryReceipt {
  id: string
  category: string | null
}

export interface RepoCatalog {
  entries: RepoEntry[]
  generatedAt: string | null
  restored: boolean
}
