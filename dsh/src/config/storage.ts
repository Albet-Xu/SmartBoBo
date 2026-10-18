import type { StoreOptions } from '@tauri-apps/plugin-store'
import { Store } from '@tauri-apps/plugin-store'
import { createStorage, defineDriver } from 'unstorage'

export interface TauriStorageDriverOptions {
  path?: string
  options?: StoreOptions
}

export const tauriStorageDriver = defineDriver<TauriStorageDriverOptions | undefined, never>((options) => {
  const promise = Store.load(options?.path ?? '.store.dat', options?.options)
  // keep:effect 非 Tauri 环境 Store.load 会 reject，先挂 noop 兜底避免 unhandled rejection
  promise.catch(() => {})
  return {
    name: 'tauri-storage',
    options,
    async hasItem(key) {
      return promise.then(store => store.has(key))
    },
    async getItem(key) {
      return promise.then(store => store.get(key))
    },
    async setItem(key, value) {
      return promise.then(store => store.set(key, value))
    },
    async removeItem(key) {
      await promise.then(store => store.delete(key))
    },
    async getKeys() {
      return promise.then(store => store.keys())
    },
    async clear() {
      return promise.then(store => store.clear())
    },
    async watch(callback) {
      return promise.then(store => store.onChange((key, value) => callback(value === null ? 'remove' : 'update', key)))
    },
  }
})

export const storage = createStorage({
  driver: tauriStorageDriver({
    path: (globalThis as typeof globalThis & { __DSH_STORE_FILE__?: string }).__DSH_STORE_FILE__ ?? '.store.dat',
  }),
})
