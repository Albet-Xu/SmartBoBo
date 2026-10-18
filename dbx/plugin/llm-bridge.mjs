import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKEN_FILE_NAME = '.bobo-llm-token'
const pluginDir = dirname(fileURLToPath(import.meta.url))

export const DEFAULT_ALLOWED_FIELDS = [
  'model', 'messages', 'stream',
  'temperature', 'max_tokens', 'max_completion_tokens', 'stop',
  'tools', 'top_p', 'n', 'user', 'seed',
]

export const DEFAULT_CONFIG = {
  tokenFile: '',
  maxBodyBytes: 8 * 1024 * 1024,
  extraAllowedFields: [],
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function errorPayload(message) {
  return { error: { message: String(message) } }
}

export function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false
  if (provided.length === 0 || expected.length === 0) return false
  const a = createHash('sha256').update(provided, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}

export function pickRequestFields(raw, allowed) {
  const extra = isPlainObject(raw.extra_body) ? raw.extra_body : {}
  const merged = { ...raw, ...extra }
  const out = {}
  for (const key of allowed) {
    if (merged[key] !== undefined) out[key] = merged[key]
  }
  return out
}

export function resolveModel(rawModel, providerIds, fallback) {
  const ids = (Array.isArray(providerIds) ? providerIds : [])
    .filter((entry) => typeof entry === 'string' && entry !== '')
  if (ids.length === 0) throw new Error('没有已注册的模型 provider（设置 → 模型）')
  const fb = isPlainObject(fallback) && typeof fallback.provider === 'string' ? fallback : undefined
  let provider = ''
  let model = typeof rawModel === 'string' ? rawModel.trim() : ''
  const slash = model.indexOf('/')
  if (slash > 0 && ids.includes(model.slice(0, slash))) {
    provider = model.slice(0, slash)
    model = model.slice(slash + 1).trim()
  }
  if (provider === '' && fb && ids.includes(fb.provider)) provider = fb.provider
  if (provider === '' && ids.length === 1) provider = ids[0]
  if (provider === '') {
    throw new Error(`无法确定 provider（已注册：${ids.join(', ')}；请求 model：${rawModel || '空'}）`)
  }
  if (model === '' || model === 'default') {
    model = fb && typeof fb.model === 'string' ? fb.model.trim() : ''
  }
  if (model === '') throw new Error('请求缺少 model，且默认模型也为空')
  return { provider, model }
}

export function buildModelListPayload(rows) {
  const counts = new Map()
  for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1)
  return {
    object: 'list',
    data: rows.map((row) => ({
      id: counts.get(row.id) > 1 ? `${row.provider}/${row.id}` : row.id,
      object: 'model',
      created: 0,
      owned_by: row.provider,
      display_name: row.name,
      name: row.name,
    })),
  }
}

export function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const part of content) {
    if (isPlainObject(part) && part.type === 'text' && typeof part.text === 'string') parts.push(part.text)
  }
  return parts.join('')
}

export function toGenerateMessages(rawMessages, route) {
  const messages = []
  const systemParts = []
  const notes = []
  const list = Array.isArray(rawMessages) ? rawMessages : []
  for (const [index, msg] of list.entries()) {
    if (!isPlainObject(msg)) {
      notes.push(`第 ${index} 条消息不是对象，已忽略`)
      continue
    }
    const text = contentText(msg.content)
    if (msg.role === 'system' || msg.role === 'developer') {
      systemParts.push(text)
      continue
    }
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: [{ type: 'text', text }] })
      continue
    }
    if (msg.role === 'assistant') {
      const blocks = []
      if (text !== '') blocks.push({ type: 'text', text })
      if (Array.isArray(msg.tool_calls)) {
        for (const call of msg.tool_calls) {
          if (!isPlainObject(call) || typeof call.id !== 'string' || !isPlainObject(call.function)) continue
          blocks.push({
            type: 'tool-call',
            id: call.id,
            name: String(call.function.name ?? ''),
            arguments: String(call.function.arguments ?? ''),
          })
        }
      }
      if (blocks.length === 0) blocks.push({ type: 'text', text: '' })
      const entry = { role: 'assistant', content: blocks }
      if (route !== undefined) entry.source = { kind: 'model', provider: route.provider, model: route.model }
      messages.push(entry)
      continue
    }
    if (msg.role === 'tool') {
      const callId = typeof msg.tool_call_id === 'string' ? msg.tool_call_id : ''
      if (callId === '') {
        notes.push(`第 ${index} 条 tool 消息缺少 tool_call_id，已忽略`)
        continue
      }
      messages.push({
        role: 'tool',
        content: [{ type: 'text', text }],
        toolCallId: callId,
        source: { kind: 'tool', callId },
        isError: msg.isError === true,
      })
      continue
    }
    notes.push(`不支持的消息 role="${msg.role}"，已忽略`)
  }
  return { system: systemParts.join('\n\n'), messages, notes }
}

export function toToolSchemas(rawTools) {
  const schemas = []
  for (const tool of rawTools) {
    if (!isPlainObject(tool) || tool.type !== 'function' || !isPlainObject(tool.function)) continue
    const fn = tool.function
    if (typeof fn.name !== 'string' || fn.name === '') continue
    schemas.push({
      name: fn.name,
      description: typeof fn.description === 'string' ? fn.description : '',
      parameters: isPlainObject(fn.parameters) ? fn.parameters : { type: 'object', properties: {} },
    })
  }
  return schemas
}

export function toGenerateOptions(raw, route) {
  const picked = pickRequestFields(raw, DEFAULT_ALLOWED_FIELDS)
  const { system, messages, notes } = toGenerateMessages(picked.messages, route)
  const options = { provider: route.provider, model: route.model, messages }
  if (system !== '') options.system = system
  if (typeof picked.temperature === 'number') options.temperature = picked.temperature
  const maxTokens = picked.max_tokens ?? picked.max_completion_tokens
  if (Number.isFinite(maxTokens)) options.maxTokens = maxTokens
  if (picked.stop !== undefined && picked.stop !== null) {
    const stop = Array.isArray(picked.stop) ? picked.stop : [picked.stop]
    const strings = stop.filter((entry) => typeof entry === 'string')
    if (strings.length > 0) options.stop = strings
  }
  if (Array.isArray(picked.tools)) {
    const tools = toToolSchemas(picked.tools)
    if (tools.length > 0) options.tools = tools
  }
  return { options, notes }
}

export function mapFinishReason(kind) {
  if (kind === 'max-tokens') return 'length'
  if (kind === 'tool-calls') return 'tool_calls'
  return 'stop'
}

export function mapUsage(usage) {
  const prompt = Number(usage.inputTokens) || 0
  const completion = Number(usage.outputTokens) || 0
  const out = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: Number.isFinite(usage.totalTokens) ? usage.totalTokens : prompt + completion,
  }
  if (Number.isFinite(usage.reasoningTokens)) {
    out.completion_tokens_details = { reasoning_tokens: usage.reasoningTokens }
  }
  return out
}

export function newStreamState() {
  return { text: '', finishKind: '', finishFailure: '', usage: null, done: false }
}

export function translateChunk(state, chunk) {
  const frames = []
  if (!isPlainObject(chunk)) return frames
  if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
    state.text += chunk.text
    frames.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: chunk.text } }] })}\n\n`)
    return frames
  }
  if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
    frames.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: chunk.text } }] })}\n\n`)
    return frames
  }
  if (chunk.type === 'usage' && isPlainObject(chunk.usage)) {
    state.usage = chunk.usage
    return frames
  }
  if (chunk.type === 'finish' && isPlainObject(chunk.reason)) {
    state.done = true
    state.finishKind = String(chunk.reason.kind ?? 'stop')
    if (isPlainObject(chunk.reason.failure)) state.finishFailure = String(chunk.reason.failure.message ?? '')
    const finishFrame = { choices: [{ index: 0, delta: {}, finish_reason: mapFinishReason(state.finishKind) }] }
    if (state.usage !== null) finishFrame.usage = mapUsage(state.usage)
    if (state.finishKind === 'error' || state.finishKind === 'aborted') {
      const message = state.finishFailure !== '' ? state.finishFailure : `模型调用${state.finishKind === 'aborted' ? '被中止' : '失败'}`
      frames.push(`data: ${JSON.stringify(errorPayload(message))}\n\n`)
    }
    frames.push(`data: ${JSON.stringify(finishFrame)}\n\n`)
    frames.push('data: [DONE]\n\n')
    return frames
  }
  return frames
}

export function buildCompletion(model, state) {
  const payload = {
    id: `chatcmpl-${randomBytes(8).toString('hex')}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: state.text },
      finish_reason: mapFinishReason(state.finishKind || 'stop'),
    }],
  }
  if (state.usage !== null) payload.usage = mapUsage(state.usage)
  return payload
}

function dshHome() {
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  if (fromEnv !== '') return resolve(fromEnv)
  return resolve(pluginDir, '../../.dsh')
}

function tokenFilePath(config) {
  const configured = String(config.tokenFile ?? '').trim()
  if (configured !== '') return resolve(configured)
  return join(dshHome(), TOKEN_FILE_NAME)
}

async function ensureToken(file) {
  try {
    const existing = (await readFile(file, 'utf8')).trim()
    if (existing.length >= 32) return existing
  } catch {}
  const fresh = randomBytes(32).toString('hex')
  try {
    await writeFile(file, `${fresh}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return fresh
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      const winner = (await readFile(file, 'utf8')).trim()
      if (winner.length >= 32) return winner
    }
    throw error
  }
}

function bearerToken(req) {
  const header = req.headers.authorization
  if (typeof header !== 'string') return ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match === null ? '' : match[1].trim()
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

function sendError(res, status, message) {
  sendJson(res, status, errorPayload(message))
}

async function readBoundedBody(req, maxBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) {
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

export function apply(ctx, config = {}) {
  const merged = { ...DEFAULT_CONFIG, ...(isPlainObject(config) ? config : {}) }
  const prefix = String(merged.bridgePrefix ?? '/bobo-llm').replace(/\/+$/, '') || '/bobo-llm'
  const tokenFile = tokenFilePath(merged)
  const maxBodyBytes = Number(merged.maxBodyBytes) > 0 ? Number(merged.maxBodyBytes) : DEFAULT_CONFIG.maxBodyBytes
  const allowed = new Set([...DEFAULT_ALLOWED_FIELDS, ...(Array.isArray(merged.extraAllowedFields) ? merged.extraAllowedFields : [])])

  try {
    mkdirSync(dirname(tokenFile), { recursive: true })
    ensureToken(tokenFile).catch((error) => {
      console.warn(`[dsh-dbx] 桥 token 生成失败 ${tokenFile}: ${error.message}`)
    })
  } catch (error) {
    console.warn(`[dsh-dbx] 桥 token 目录创建失败 ${tokenFile}: ${error.message}`)
  }

  const unauthorized = async (req, res) => {
    let expected = ''
    try {
      expected = await ensureToken(tokenFile)
    } catch (error) {
      sendError(res, 500, `桥 token 文件不可用: ${error.message}`)
      return true
    }
    if (tokenMatches(bearerToken(req), expected)) return false
    sendError(res, 401, '桥 token 校验失败：请在 DBX 设置 > AI 中重新执行「从 API 获取模型列表」，或等待插件自动补种配置')
    return true
  }

  const handleModels = async (req, res) => {
    if (req.method !== 'GET') {
      sendError(res, 405, '只接受 GET')
      return
    }
    if (await unauthorized(req, res)) return
    const llm = ctx.get('llm')
    if (llm === undefined) {
      sendError(res, 503, 'llm 服务不可用')
      return
    }
    try {
      const rows = []
      for (const entry of llm.listProviders()) {
        for (const model of await llm.listModels(entry.id)) {
          rows.push({ id: model.id, name: model.name, provider: entry.id })
        }
      }
      sendJson(res, 200, buildModelListPayload(rows))
    } catch (error) {
      sendError(res, 502, `模型目录读取失败: ${error.message}`)
    }
  }

  const handleChat = async (req, res) => {
    if (req.method !== 'POST') {
      sendError(res, 405, '只接受 POST')
      return
    }
    if (await unauthorized(req, res)) return
    let text
    try {
      text = await readBoundedBody(req, maxBodyBytes)
    } catch {
      sendError(res, 400, '请求体读取失败')
      return
    }
    if (text === null) {
      sendError(res, 413, `请求体超过 ${maxBodyBytes} 字节上限`)
      return
    }
    let raw
    try {
      raw = JSON.parse(text)
    } catch {
      sendError(res, 400, '请求体必须是合法 JSON')
      return
    }
    if (!isPlainObject(raw)) {
      sendError(res, 400, '请求体必须是 JSON 对象')
      return
    }

    const llm = ctx.get('llm')
    if (llm === undefined) {
      sendError(res, 503, 'llm 服务不可用')
      return
    }
    let route
    let options
    let notes
    try {
      const providerIds = llm.listProviders().map((entry) => entry.id)
      const service = ctx.get('agentDefaultModel')
      let fallback
      try {
        fallback = service === undefined ? undefined : service.currentSelection()
      } catch {
        fallback = undefined
      }
      route = resolveModel(raw.model, providerIds, fallback)
      const converted = toGenerateOptions(raw, route)
      options = converted.options
      notes = converted.notes
    } catch (error) {
      sendError(res, 503, error.message)
      return
    }
    if (options.messages.length === 0) {
      const detail = notes.length > 0 ? `；${notes.join('；')}` : ''
      sendError(res, 400, `messages 为空或全部不可用${detail}`)
      return
    }
    if (notes.length > 0) console.warn(`[dsh-dbx] 请求消息转换提示：${notes.join('；')}`)

    const wantsStream = raw.stream === true
    const abort = new AbortController()
    const onClientClose = () => {
      if (!res.writableEnded) abort.abort()
    }
    res.on('close', onClientClose)
    const streamOptions = { ...options, signal: abort.signal }
    const state = newStreamState()

    try {
      if (!wantsStream) {
        for await (const chunk of llm.stream(streamOptions)) {
          translateChunk(state, chunk)
          if (state.done) break
        }
        res.off('close', onClientClose)
        if (abort.signal.aborted) return
        sendJson(res, 200, buildCompletion(raw.model ? String(raw.model) : `${route.provider}/${route.model}`, state))
        return
      }

      let headersSent = false
      const ensureHeaders = () => {
        if (headersSent) return
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
        })
        headersSent = true
      }
      for await (const chunk of llm.stream(streamOptions)) {
        const frames = translateChunk(state, chunk)
        for (const frame of frames) {
          ensureHeaders()
          res.write(frame)
        }
        if (state.done) break
      }
      if (!abort.signal.aborted) {
        if (!state.done) {
          ensureHeaders()
          res.write('data: [DONE]\n\n')
        } else if (!headersSent) {
          ensureHeaders()
          res.write('data: [DONE]\n\n')
        }
      }
    } catch (error) {
      if (abort.signal.aborted) return
      if (res.headersSent) {
        try {
          res.write(`data: ${JSON.stringify(errorPayload(`模型调用失败: ${error.message}`))}\n\n`)
          res.write('data: [DONE]\n\n')
        } catch {}
      } else {
        sendError(res, 502, `模型调用失败: ${error.message}`)
      }
    } finally {
      res.off('close', onClientClose)
      if (!res.writableEnded) res.end()
    }
  }

  ctx.effect(() => {
    const webServer = ctx.get('webServer')
    const dispose = webServer.register({
      kind: 'prefix',
      path: prefix,
      handler: async (req, res) => {
        const pathname = new URL(String(req.url), 'http://localhost').pathname
        if (pathname === `${prefix}/health`) {
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, error: '只接受 GET' })
            return
          }
          sendJson(res, 200, { ok: true })
          return
        }
        if (pathname === `${prefix}/models`) {
          await handleModels(req, res)
          return
        }
        if (pathname === `${prefix}/chat/completions`) {
          await handleChat(req, res)
          return
        }
        sendError(res, 404, `未知路径: ${pathname}`)
      },
    }, `dsh-dbx: ${prefix}`)
    return dispose
  }, 'dsh-dbx: llm bridge')
}

function selftest() {
  let failed = 0
  let passed = 0
  const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    if (ok) {
      passed += 1
    } else {
      failed += 1
      console.error(`✗ ${label}：${JSON.stringify(actual)}（期望 ${JSON.stringify(expected)}）`)
    }
  }

  const tok = randomBytes(32).toString('hex')
  const other = tok.slice(0, -1) + (tok.endsWith('0') ? '1' : '0')
  check('token 一致', tokenMatches(tok, tok), true)
  check('token 不一致', tokenMatches(tok, other), false)
  check('token 空串拒绝', tokenMatches('', tok), false)
  check('token 反向空串拒绝', tokenMatches(tok, ''), false)

  const providers = ['p1', 'p2']
  const fb = { provider: 'p1', model: 'm-default' }
  check('provider/id 拆分', resolveModel('p2/mx', providers, fb), { provider: 'p2', model: 'mx' })
  check('裸 id 回落默认 provider', resolveModel('mx', providers, fb), { provider: 'p1', model: 'mx' })
  check('空 model 回落默认模型', resolveModel('', providers, fb), { provider: 'p1', model: 'm-default' })
  check('default 回落默认模型', resolveModel('default', providers, fb), { provider: 'p1', model: 'm-default' })
  check('单 provider 兜底', resolveModel('mx', ['only'], undefined), { provider: 'only', model: 'mx' })
  let threw = ''
  try { resolveModel('', [], undefined) } catch (error) { threw = error.message }
  check('无 provider 报错', threw.includes('没有已注册'), true)
  threw = ''
  try { resolveModel('default', ['only'], undefined) } catch (error) { threw = error.message }
  check('缺 model 报错', threw.includes('缺少 model'), true)

  const picked = pickRequestFields(
    { model: 'm1', messages: [], stream: true, bogus_field: 1, extra_body: { chat_template_kwargs: { enable_thinking: false } } },
    new Set(DEFAULT_ALLOWED_FIELDS),
  )
  check('白名单保留标准字段', picked.model, 'm1')
  check('白名单丢弃未知字段', picked.bogus_field, undefined)
  check('extra_body 方言被丢弃', picked.chat_template_kwargs, undefined)
  check('extra_body 本身不透传', picked.extra_body, undefined)

  const route = { provider: 'p1', model: 'm-default' }
  const conv = toGenerateMessages([
    { role: 'system', content: 'sys1' },
    { role: 'developer', content: 'sys2' },
    { role: 'user', content: 'hi' },
    { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    { role: 'assistant', content: 'ok' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'f', arguments: '{}' } }] },
    { role: 'tool', content: 'result', tool_call_id: 'c1' },
    { role: 'weird', content: '?' },
  ], route)
  check('system 提取合并', conv.system, 'sys1\n\nsys2')
  check('user 字符串映射', conv.messages[0], { role: 'user', content: [{ type: 'text', text: 'hi' }] })
  check('user 数组 text 拼接', conv.messages[1].content[0].text, 'ab')
  check('assistant 映射', conv.messages[2].content, [{ type: 'text', text: 'ok' }])
  check('assistant source 注入', conv.messages[2].source, { kind: 'model', provider: 'p1', model: 'm-default' })
  check('assistant tool_calls 映射', conv.messages[3].content[0], { type: 'tool-call', id: 'c1', name: 'f', arguments: '{}' })
  check('tool 消息尽力映射', [conv.messages[4].role, conv.messages[4].toolCallId], ['tool', 'c1'])
  check('未知 role 记入 notes', conv.notes, ['不支持的消息 role="weird"，已忽略'])

  const { options, notes } = toGenerateOptions({
    model: 'ignored',
    messages: [{ role: 'user', content: 'q' }],
    temperature: 0.2,
    max_tokens: 100,
    stop: ['x'],
    tools: [{ type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object' } } }, { type: 'image' }],
    extra_body: { foo: 1 },
  }, route)
  check('options provider/model 来自路由', [options.provider, options.model], ['p1', 'm-default'])
  check('temperature 透传', options.temperature, 0.2)
  check('max_tokens → maxTokens', options.maxTokens, 100)
  check('stop 数组透传', options.stop, ['x'])
  check('tools 转 ToolSchema', options.tools, [{ name: 'f', description: 'd', parameters: { type: 'object' } }])
  check('转换无 notes', notes, [])

  const payload = buildModelListPayload([
    { id: 'kimi-k2', name: 'Kimi K2', provider: 'p1' },
    { id: 'shared', name: 'A', provider: 'p1' },
    { id: 'shared', name: 'B', provider: 'p2' },
  ])
  check('单 provider 裸 id', payload.data[0].id, 'kimi-k2')
  check('display_name 取自目录', payload.data[0].display_name, 'Kimi K2')
  check('跨 provider 重名加前缀', [payload.data[1].id, payload.data[2].id], ['p1/shared', 'p2/shared'])
  check('object 字段', payload.object, 'list')

  check('错误体形状', errorPayload('x'), { error: { message: 'x' } })
  check('finish 映射 length', mapFinishReason('max-tokens'), 'length')
  check('finish 映射 tool_calls', mapFinishReason('tool-calls'), 'tool_calls')
  check('finish 映射默认 stop', mapFinishReason('aborted'), 'stop')

  const state = newStreamState()
  const f1 = translateChunk(state, { type: 'text-delta', index: 0, text: 'He' })
  const f2 = translateChunk(state, { type: 'text-delta', index: 0, text: 'llo' })
  check('text-delta 帧1', f1, ['data: {"choices":[{"index":0,"delta":{"content":"He"}}]}\n\n'])
  check('text-delta 帧2', f2, ['data: {"choices":[{"index":0,"delta":{"content":"llo"}}]}\n\n'])
  translateChunk(state, { type: 'usage', usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 } })
  const f3 = translateChunk(state, { type: 'finish', reason: { kind: 'stop' } })
  check('finish 帧数', f3.length, 2)
  const finishPayload = JSON.parse(f3[0].slice('data: '.length))
  check('finish_reason', finishPayload.choices[0].finish_reason, 'stop')
  check('usage 并入收尾帧', finishPayload.usage, { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 })
  check('DONE 帧', f3[1], 'data: [DONE]\n\n')
  check('state 累积文本', state.text, 'Hello')
  check('state done', state.done, true)

  const errState = newStreamState()
  translateChunk(errState, { type: 'text-delta', index: 0, text: 'x' })
  const e1 = translateChunk(errState, { type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } })
  check('error finish 先错误帧', JSON.parse(e1[0].slice('data: '.length)), { error: { message: 'boom' } })
  check('error finish 后收尾帧', JSON.parse(e1[1].slice('data: '.length)).choices[0].finish_reason, 'stop')

  const completion = buildCompletion('p1/m-default', state)
  check('completion object', completion.object, 'chat.completion')
  check('completion content', completion.choices[0].message, { role: 'assistant', content: 'Hello' })
  check('completion finish_reason', completion.choices[0].finish_reason, 'stop')
  check('completion usage', completion.usage, { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 })
  check('completion model 回显', completion.model, 'p1/m-default')

  const ignored = translateChunk(newStreamState(), { type: 'block-start', index: 0, blockType: 'text' })
  check('非翻译块无帧', ignored, [])

  if (failed > 0) {
    console.error(`dsh-dbx llm-bridge selftest 失败：${failed} 项失败，${passed} 项通过`)
    process.exitCode = 1
    return
  }
  console.log(`dsh-dbx llm-bridge selftest 通过：${passed} 个用例`)
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invokedDirectly && process.argv.includes('--selftest')) selftest()
