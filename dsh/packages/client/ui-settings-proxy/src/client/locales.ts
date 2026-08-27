/**
 * Proxy Pool section locales.
 * @module @deepseek-ai/dsh-client-ui-settings-proxy/locales
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '代理池',
  'title': '代理池管理',
  'description': '管理代理 API 源、取用策略和相关配置。',
  'addSource': '新增代理源',
  'deleteSource': '删除',
  'editSource': '编辑',
  'enable': '启用',
  'disable': '禁用',
  'fetchStrategy': '取用策略',
  'cacheStrategy': '缓存轮询',
  'realtimeStrategy': '实时拉取',
  'testConnection': '测试连通',
  'sourceName': '名称',
  'apiUrl': 'API 地址',
  'apiKey': 'API Key',
  'pwd': '密码',
  'getnum': '每次获取数量',
  'httptype': '代理类型',
  'geshi': '格式参数',
  'fenge': '分隔参数',
  'enabled': '总开关',
  'maxRetries': '最大重试次数',
  'timeoutMs': '超时(毫秒)',
  'save': '保存',
  'cancel': '取消',
} as const

/** English dictionary (minimal, for completeness). */
export const en = {
  'nav': 'Proxy Pool',
  'title': 'Proxy Pool Management',
  'description': 'Manage proxy API sources, fetch strategies, and related configuration.',
  'addSource': 'Add Source',
  'deleteSource': 'Delete',
  'editSource': 'Edit',
  'enable': 'Enable',
  'disable': 'Disable',
  'fetchStrategy': 'Fetch Strategy',
  'cacheStrategy': 'Cache & Rotate',
  'realtimeStrategy': 'Realtime Fetch',
  'testConnection': 'Test Connection',
  'sourceName': 'Name',
  'apiUrl': 'API URL',
  'apiKey': 'API Key',
  'pwd': 'Password',
  'getnum': 'Batch Size',
  'httptype': 'Proxy Type',
  'geshi': 'Format',
  'fenge': 'Separator',
  'enabled': 'Master Switch',
  'maxRetries': 'Max Retries',
  'timeoutMs': 'Timeout (ms)',
  'save': 'Save',
  'cancel': 'Cancel',
} as const

/** Locale key type derived from the zh dictionary. */
export type ProxyPoolKey = keyof typeof zh
