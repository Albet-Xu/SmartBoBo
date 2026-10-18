/**
 * Locale-owned copy for the built-in browser panel.
 *
 * The Simplified Chinese dictionary is the key-set authority; the English one
 * is checked against it, so a key added to one without the other is a compile
 * error.
 */

/** Copy for the right Sidebar's built-in browser tab. */
export const zh = {
  'type.label': '内置浏览器',
  'guide.title': '内置浏览器',
  'guide.description': 'BoBo内置的CloakBrowser浏览器',
  'phase.probing': '正在连接…',
  'phase.idle': '未启动',
  'phase.live': '已连接',
  'phase.paused': '画面已暂停',
  'start': '启动浏览器',
  'start.pending': '正在启动浏览器…',
  'address.placeholder': '输入网址，回车前往',
  go: '前往',
  reload: '刷新',
  'nopage': '输入网址开始浏览',
  'tabs.label': '标签页',
  'tabs.close': '关闭标签页',
  'frame.label': '浏览器画面',
  'keyboard.hint': '点击画面后可键盘输入',
  'insert.placeholder': '文本（中文可直接输入）',
  'insert.send': '发送文本',
  'error.notRunning': '浏览器服务未启动。',
  'error.frame': '画面获取失败。',
  'error.pageClosed': '页面已关闭。',
  'error.denied': '操作被拒绝。',
  'error.request': '操作未送达，请重试。',
} satisfies Record<string, string>

/** The `browserCloak` namespace key union. */
export type BrowserCloakKey = keyof typeof zh

/** English copy, keyed by the same keys as {@link zh}. */
export const en = {
  'type.label': 'Built-in browser',
  'guide.title': 'Built-in browser',
  'guide.description': "BoBo's built-in CloakBrowser",
  'phase.probing': 'Connecting…',
  'phase.idle': 'Not started',
  'phase.live': 'Connected',
  'phase.paused': 'Frames paused',
  'start': 'Start browser',
  'start.pending': 'Starting the browser…',
  'address.placeholder': 'Enter a URL and press Enter',
  go: 'Go',
  reload: 'Reload',
  'nopage': 'Enter a URL to start browsing',
  'tabs.label': 'Tabs',
  'tabs.close': 'Close tab',
  'frame.label': 'Browser frame',
  'keyboard.hint': 'Click the frame to type',
  'insert.placeholder': 'Text (Chinese input supported)',
  'insert.send': 'Send text',
  'error.notRunning': 'The browser service is not running.',
  'error.frame': 'Could not capture the frame.',
  'error.pageClosed': 'The page was closed.',
  'error.denied': 'The operation was refused.',
  'error.request': 'The operation did not reach the browser service.',
} satisfies Record<BrowserCloakKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Built-in browser panel: type name, controls, states, and failures. */
    browserCloak: BrowserCloakKey
  }
}
