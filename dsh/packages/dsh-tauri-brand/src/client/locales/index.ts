import { defineLocale } from 'dsh-tauri/client'
import { PLUGIN_ID } from '../../shared/constants'

export const locale = defineLocale(PLUGIN_ID, {
  zh: {
    wordmarkName: 'SmartBoBo',
    wordmarkBadge: 'AGENT',
  },
  en: {
    wordmarkName: 'SmartBoBo',
    wordmarkBadge: 'AGENT',
  },
})
