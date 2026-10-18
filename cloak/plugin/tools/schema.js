/**
 * 工具 `parameters` 的 JSON Schema 标准化。
 *
 * ## 为什么需要它
 *
 * dsh 的 `defineTool()` 会把「参数规格」自动转成标准 JSON Schema
 * （`parameterSchemaSpecToJsonSchema`），但 `ctx.tools.register()` 是**裸注册**：
 * 传进去什么就原样发给模型。本项目里 cloak 插件是唯一裸注册的包，历史上
 * `cloak_fetch` 写成了扁平属性表：
 *
 *   { url: { type: 'string', required: true }, format: { ... } }
 *
 * 这既不是合法 JSON Schema（缺 `type: 'object'` / `properties`），
 * `required` 也放错了位置（应在顶层数组）。OpenCode Zen 严格校验 schema，
 * 一个工具不合法就让**整条 chat 请求** 400（`Provider returned error`）。
 *
 * ## 规则
 *
 * - 已是 `{ type: 'object', properties: {...} }`：只把属性内的 `required: true`
 *   提到顶层 `required` 数组，其余不动；
 * - 形如属性映射（每个 value 是对象，且没有 `type/properties/items/$ref/...` 等
 *   模式关键字）：包成 `{ type: 'object', properties, required }`；
 * - 空对象：补成 `{ type: 'object', properties: {} }`；
 * - 其它：原样返回，不猜测。
 *
 * 纯函数、无副作用，供注册前兜底与自测使用。
 */

/** JSON Schema 顶层可能出现的模式关键字；命中即视为「已是 schema」。 */
const SCHEMA_KEYWORDS = new Set([
  'type', 'properties', 'items', '$ref', 'anyOf', 'oneOf', 'allOf',
  'enum', 'additionalProperties', 'description', 'title', 'default',
  'not', 'if', 'then', 'else', 'patternProperties', 'dependentSchemas',
])

/** 判断一个值是否像「单参数定义」（{ type, description, enum, ... }）。 */
function looksLikePropertySpec(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 把属性内的 `required: true` 剥掉，返回 [新属性, 是否要求] 。 */
function splitRequired(spec) {
  if (!looksLikePropertySpec(spec) || spec.required !== true) return [spec, false]
  const { required: _drop, ...rest } = spec
  return [rest, true]
}

/**
 * 标准化一个工具的 `parameters`。
 * @param parameters 原始参数定义（可能是标准 schema、扁平属性表或空对象）。
 * @returns 标准 JSON Schema；无法识别时原样返回。
 */
export function normalizeToolParameters(parameters) {
  if (parameters === undefined || parameters === null) {
    return { type: 'object', properties: {} }
  }
  if (typeof parameters !== 'object' || Array.isArray(parameters)) return parameters

  // 1) 已是标准 object schema：只修属性内的 required
  if (parameters.type === 'object'
    && parameters.properties !== null
    && typeof parameters.properties === 'object'
    && !Array.isArray(parameters.properties)) {
    const required = Array.isArray(parameters.required) ? [...parameters.required] : []
    const properties = {}
    let changed = false
    for (const [name, spec] of Object.entries(parameters.properties)) {
      const [next, isRequired] = splitRequired(spec)
      properties[name] = next
      if (isRequired) {
        if (!required.includes(name)) required.push(name)
        changed = true
      }
    }
    if (!changed) return parameters
    const out = { ...parameters, properties }
    if (required.length > 0) out.required = required
    return out
  }

  // 2) 扁平属性表：包成 object schema
  const keys = Object.keys(parameters)
  if (keys.length === 0) return { type: 'object', properties: {} }
  const looksFlat = !keys.some((key) => SCHEMA_KEYWORDS.has(key))
    && keys.every((key) => looksLikePropertySpec(parameters[key]))
  if (looksFlat) {
    const properties = {}
    const required = []
    for (const [name, spec] of Object.entries(parameters)) {
      const [next, isRequired] = splitRequired(spec)
      properties[name] = next
      if (isRequired) required.push(name)
    }
    const out = { type: 'object', properties }
    if (required.length > 0) out.required = required
    return out
  }

  // 3) 其它形态（如 oneOf 根、纯字符串 schema）：原样保留
  return parameters
}

/**
 * 标准化一个工具的整个定义；无变化时返回原对象（便于判等与幂等）。
 * @param tool 工具定义 `{ name, description, parameters, ... }`。
 */
export function normalizeTool(tool) {
  if (tool === null || typeof tool !== 'object') return tool
  const normalized = normalizeToolParameters(tool.parameters)
  if (normalized === tool.parameters) return tool
  return { ...tool, parameters: normalized }
}
