import type { LanguageDetectorModule } from 'i18next'
import { invoke } from '@tauri-apps/api/core'
import { store } from '../store'
import { resources } from './index.resource'

/** 语言偏好持久化 key，与 setting store 保持同步 */
export const LANGUAGE_STORAGE_KEY = 'deepseek-harness-desktop-language'

/** 同步语言探测：优先 localStorage 用户选择，其次内存/后端，最后浏览器语言 */
export const languageDetector: LanguageDetectorModule = {
  type: 'languageDetector',
  detect: () => {
    // 用户上次的显式选择（跨重启持久）优先
    let selectedLanguage = localStorage?.getItem(LANGUAGE_STORAGE_KEY) ?? ''

    // 会话内切换的语言（store 未持久化，仅作为次优先）
    if (!selectedLanguage)
      selectedLanguage = store.setting.language ?? ''

    if (selectedLanguage)
      return selectedLanguage

    // If no saved language, use device locale or fallback
    const deviceLocale = navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'

    // try exact locale match first
    if (deviceLocale in resources)
      selectedLanguage = deviceLocale
    else
      selectedLanguage = 'zh-CN'

    return selectedLanguage
  },
  cacheUserLanguage: (language: string) => {
    localStorage?.setItem(LANGUAGE_STORAGE_KEY, language)
    store.setting.language = language
    invoke('set_language', { lang: language.startsWith('zh') ? 'zh' : 'en' }).catch((err) => {
      console.warn('[i18n] failed to persist language to backend:', err)
    })
  },
}
