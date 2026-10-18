/**
 * client/constants/index.ts — 客户端静态常量（跨 half 协议常量见 shared/constants.ts）。
 */

import { PLUGIN_ID } from '../../shared/constants'

export { PLUGIN_ID } from '../../shared/constants'

/**
 * 输入框上方独占一行的 dock 槽（list 型、可叠加）：运行中提示条的位置。
 *
 * dock 按 order 升序渲染；官方 `todo`（0）、`goal`（10）、`queue`（20）与工作树横幅（-10）
 * 都在这一槽里。提示条必须压在这些条目之上——它是当前这一轮正在发生的改动读数。
 */
export const RUNNING_CHANGES_INPUT_DOCK_SLOT = 'conversation.input.dock'

export const RUNNING_CHANGES_RUNNING_CHIP_ID = `${PLUGIN_ID}-running-changes`
export const RUNNING_CHANGES_RUNNING_CHIP_ORDER = -30

/** 运行中提示条的客户端轮询间隔；宿主端另有 1.5s 的 git 刷新节奏。 */
export const RUNNING_CHANGES_LIVE_POLL_INTERVAL_MS = 1200

/** 提示条的 css-render style id。 */
export const RUNNING_CHANGES_CHIP_STYLE_ID = `${PLUGIN_ID}/RunningChangesChip.module.css`
export const RUNNING_CHANGES_COUNTS_STYLE_ID = `${PLUGIN_ID}/ChangeCounts.module.css`

/** effect 标签（诊断/日志）。 */
export const RUNNING_CHANGES_LOCALE_EFFECT = `${PLUGIN_ID}: locale`
export const RUNNING_CHANGES_RUNNING_CHIP_EFFECT = `${PLUGIN_ID}: running chip`
export const PASTE_COLLAPSE_EFFECT = `${PLUGIN_ID}: paste collapse`

/**
 * 折叠粘贴的引用源名：既是官方引用注册表里的唯一键，也是官方 chip 宿主元素写的
 * `data-composer-chip` 值（C 浏览器层的断言锚点）。
 */
export const PASTE_CHIP_SOURCE = `${PLUGIN_ID}-paste`
