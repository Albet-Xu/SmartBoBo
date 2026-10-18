import { defineLocale } from 'dsh-tauri/client'
import { PLUGIN_ID } from '../../shared/constants'

export const locale = defineLocale(PLUGIN_ID, {
  zh: {
    uiComponents: 'UI 组件',
  },
  en: {
    uiComponents: 'UI components',
  },
})
