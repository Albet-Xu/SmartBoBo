import type { EventHandlerRequest, H3Event } from 'h3'
import type { RepoNs } from '../../../service/repo.types'
import type { RepoListQuery } from '../index.types'

const NS_VALUES: RepoNs[] = ['presets', 'tools', 'skills']

export function readNs(query: RepoListQuery, event: H3Event<EventHandlerRequest>): RepoNs | null {
  const value = query.ns
  if (typeof value !== 'string' || !NS_VALUES.includes(value as RepoNs)) {
    event.res.status = 400
    return null
  }
  return value as RepoNs
}

export function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
