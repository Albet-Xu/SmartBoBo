export type ModelCompatDraft = Record<string, unknown>

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export const DEFAULT_THINKING_EFFORTS: Readonly<Record<string, string | null>> = {
  off: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
}

export const TEMPLATE_THINKING_FORMAT = 'chat-template'
export const TEMPLATE_THINKING_KWARG = 'reasoning_effort'
export const TEMPLATE_THINKING_EFFORT_VAR = 'thinking.effort'

/**
 * 「关闭 Developer 角色」只对 chat completions 协议有意义：pi-ai 的 compat 逐协议校验，
 * `thinkingFormat` 与 `chatTemplateKwargs` 写到 Responses/Anthropic 路由上会让配置解析失败。
 * 路由没有显式协议时无法判断，因此调用方用 `api === TEMPLATE_COMPAT_PROTOCOL` 决定是否渲染。
 */
export const TEMPLATE_COMPAT_PROTOCOL = 'openai-completions'

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return {}
  return value as Record<string, unknown>
}

function compatOf(model: ModelCompatDraft): Record<string, unknown> {
  return recordOf(model.compat)
}

export function thinkingEffortsOf(model: ModelCompatDraft): Record<string, string | null> {
  const efforts = model.reasoningEfforts
  if (typeof efforts !== 'object' || efforts === null || Array.isArray(efforts))
    return {}
  return efforts as Record<string, string | null>
}

export function declaredThinkingLevels(model: ModelCompatDraft): string[] {
  return Object.keys(thinkingEffortsOf(model))
}

export function supportsThinking(model: ModelCompatDraft): boolean {
  return Object.keys(thinkingEffortsOf(model)).some(level => level !== 'off')
}

export function enableThinking(model: ModelCompatDraft): Record<string, string | null> {
  const current = thinkingEffortsOf(model)
  const graded = Object.keys(current).filter(level => level !== 'off')
  return graded.length === 0 ? { ...DEFAULT_THINKING_EFFORTS } : current
}

/**
 * 取消到空表时写 `false`（显式「不支持思考」）而不是空对象：空表会被 schema 判为非法声明。
 */
export function toggleThinkingLevel(
  efforts: Readonly<Record<string, string | null>>,
  level: string,
  enabled: boolean,
): Record<string, string | null> | false {
  const next = { ...efforts }
  if (enabled)
    next[level] = level === 'off' ? null : level
  else
    delete next[level]
  return Object.keys(next).length === 0 ? false : next
}

export function supportsTemplateThinking(model: ModelCompatDraft): boolean {
  const compat = compatOf(model)
  return compat.thinkingFormat === TEMPLATE_THINKING_FORMAT && compat.supportsDeveloperRole === false
}

/**
 * 打开时写入 vLLM 这类端点需要的三项事实（思考参数走 chat_template_kwargs、档位由下拉框动态填入、
 * 系统提示保持 system 角色）；关闭只摘掉这三项，条目里其它 compat 键与 chat template 参数原样保留。
 * compat 被摘空时返回 undefined，让调用方删掉整个字段。
 */
export function templateThinkingCompat(
  model: ModelCompatDraft,
  next: boolean,
): Record<string, unknown> | undefined {
  const compat = { ...compatOf(model) }
  const kwargs = { ...recordOf(compat.chatTemplateKwargs) }
  delete kwargs[TEMPLATE_THINKING_KWARG]
  if (next) {
    compat.chatTemplateKwargs = { ...kwargs, [TEMPLATE_THINKING_KWARG]: { $var: TEMPLATE_THINKING_EFFORT_VAR } }
    compat.thinkingFormat = TEMPLATE_THINKING_FORMAT
    compat.supportsDeveloperRole = false
  }
  else {
    delete compat.thinkingFormat
    delete compat.supportsDeveloperRole
    if (Object.keys(kwargs).length === 0)
      delete compat.chatTemplateKwargs
    else
      compat.chatTemplateKwargs = kwargs
  }
  return Object.keys(compat).length === 0 ? undefined : compat
}
