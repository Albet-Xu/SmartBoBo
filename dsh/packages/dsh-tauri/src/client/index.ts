import { PLUGIN_ID } from './constants'

export { apply } from './apply'

export * from './controller'

export * from './hooks/use-invoke'
export * from './hooks/use-listen'
export * from './hooks/use-listen-parent'

export * from './locale'

export * from './modules/css-render'
export * from './modules/date-fns'
export * from './modules/hookable'
export * from './modules/lodash-es'
export * from './modules/reause'
export * from './modules/tailwind-variants'
export * from './modules/valtio-define'

export * from './panel'
export * from './register'
export * from './request'

export * from './service/invoke'
export * from './service/invoke-parent'
export * from './service/listen'
export * from './service/listen-parent'

export type * from './types/adapter'
export type * from './types/bridge'
export type * from './types/harness'
export type * from './types/iframe'
export type * from './types/tauri'

export * from './utils/device'

export const name = PLUGIN_ID

export const inject = ['layout', 'theme']
