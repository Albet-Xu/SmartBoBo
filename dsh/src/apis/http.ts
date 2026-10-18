import { invoke } from '@tauri-apps/api/core'

export interface FetchOptions {
  baseURL?: string
  method?: string
  params?: object
  body?: unknown
}

export function ofetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  return invoke<T>('remote', {
    method: `${(options.method ?? 'get').toUpperCase()} ${options.baseURL ?? ''}${path}`,
    payload: options.params ?? options.body ?? null,
  })
}
