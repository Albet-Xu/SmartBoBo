/**
 * client/locales/index.ts — 本插件界面文案（zh / en 双语）。
 *
 * 一个包只声明一次：命名空间 + 双语词典 → `locale.text` / `locale.useLocale` /
 * `locale.registerLocale`。活跃语言是唯一可变事实，收敛在底座共享的 store 里，
 * 插件不再自建 locale 管理器或 revision store。
 */

import type { LocaleKey } from '../types'
import { defineLocale } from 'dsh-tauri/client'
import { PLUGIN_ID } from '../constants'

/** zh 字典（键集合的权威）。 */
const zh = {
  runningChanged: '{count} 个文件已更改',
  binary: '二进制',
  pasteChip: '粘贴的文本 · {count} 字',
  pasteChipTitled: '{title} · {count} 字',
} as const satisfies Record<LocaleKey, string>

/** en 字典，与 zh 键集完全一致（locale 运行时强制双语平衡）。 */
const en: Record<LocaleKey, string> = {
  runningChanged: '{count} file(s) changed',
  binary: 'binary',
  pasteChip: 'Pasted text · {count} chars',
  pasteChipTitled: '{title} · {count} chars',
}

export const locale = defineLocale(PLUGIN_ID, { zh, en })
