(function () {
  // 只在帧内工作：壳层顶层文档的 console 已由 src/utils/logger.ts 劫持并直连
  // log_frontend，这里再劫持一次会让每条壳层日志落盘两份。
  if (window === window.top) return
  if (window.__dsh_frame_log_bridge__) return
  window.__dsh_frame_log_bridge__ = true

  var SOURCE = 'dsh-frame-log-bridge'
  var TYPE = 'dsh://frame-log'
  var MAX_CHARS = 2000
  var LIMIT_WINDOW_MS = 1000
  var MAX_PER_WINDOW = 20

  var consoleRef = window.console
  if (!consoleRef) return

  var originalWarn = consoleRef.warn
  var originalError = consoleRef.error
  var windowStart = Date.now()
  var sentInWindow = 0
  var suppressed = 0

  function framePath() {
    try {
      var path = String(window.location.pathname || '')
      return path.length > 80 ? path.slice(0, 80) : path
    } catch (_) {
      return ''
    }
  }

  function isErrorLike(value) {
    return !!value
      && typeof value === 'object'
      && typeof value.message === 'string'
      && typeof value.stack === 'string'
  }

  function errorText(error) {
    var name = error && error.name ? String(error.name) : 'Error'
    var message = error && error.message ? String(error.message) : ''
    var header = message ? name + ': ' + message : name
    var stack = error && typeof error.stack === 'string' ? error.stack : ''
    if (!stack) return header
    return stack.indexOf(header) === 0 ? stack : header + '\n' + stack
  }

  function stringify(value) {
    if (typeof value === 'string') return value
    if (isErrorLike(value)) return errorText(value)
    if (value === undefined) return 'undefined'
    if (typeof value === 'function') return '[Function ' + (value.name || 'anonymous') + ']'
    try {
      var text = JSON.stringify(value, function (key, item) {
        if (typeof item === 'bigint') return String(item) + 'n'
        if (typeof item === 'function') return '[Function ' + (item.name || 'anonymous') + ']'
        if (isErrorLike(item)) return errorText(item)
        return item
      })
      return typeof text === 'string' ? text : String(value)
    } catch (_) {
      try {
        return String(value)
      } catch (_) {
        return '[Unserializable]'
      }
    }
  }

  function compose(args) {
    var parts = []
    for (var index = 0; index < args.length; index += 1) parts.push(stringify(args[index]))
    return parts.join(' ')
  }

  function postPayload(level, message) {
    try {
      var text = String(message)
      if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '…[truncated]'
      window.parent.postMessage({
        source: SOURCE,
        type: TYPE,
        level: level,
        message: text
      }, '*')
    } catch (_) {}
  }

  function sendPayload(level, message) {
    var now = Date.now()
    if (now - windowStart >= LIMIT_WINDOW_MS) {
      windowStart = now
      sentInWindow = 0
      if (suppressed > 0) {
        var dropped = suppressed
        suppressed = 0
        postPayload('warn', dropped + ' frame log entries suppressed')
      }
    }
    if (sentInWindow >= MAX_PER_WINDOW) {
      suppressed += 1
      return
    }
    sentInWindow += 1
    postPayload(level, message)
  }

  function send(level, message) {
    var path = framePath()
    sendPayload(level, path && path !== '/' ? path + ' ' + message : message)
  }

  function capture(level, original, args) {
    try {
      original.apply(consoleRef, args)
    } catch (_) {}
    send(level, compose(args))
  }

  if (typeof originalWarn === 'function') {
    consoleRef.warn = function () {
      capture('warn', originalWarn, arguments)
    }
  }

  if (typeof originalError === 'function') {
    consoleRef.error = function () {
      capture('error', originalError, arguments)
    }
  }

  window.addEventListener('error', function (event) {
    var where = event && event.filename
      ? event.filename + ':' + event.lineno + ':' + event.colno + ' '
      : ''
    var text = event && isErrorLike(event.error)
      ? errorText(event.error)
      : String((event && event.message) || 'unknown error')
    send('error', '[uncaught] ' + where + text)
  })

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event ? event.reason : undefined
    send('error', '[unhandledrejection] ' + stringify(reason))
  })

  // dsh 应用内部还嵌套 iframe（插件面板等），它们的 postMessage 只会到中间那一层
  // 文档；这里逐层向上接力，接力链在「宿主直接内嵌的那一层」终止（顶层文档无本脚本）。
  // 接力同样过本帧的限额与截断：子帧可以伪造 payload 反复直发，不设限就能灌满前台日志。
  window.addEventListener('message', function (event) {
    var data = event && event.data
    if (!data || typeof data !== 'object' || data.source !== SOURCE || data.type !== TYPE) return
    if (event.source === window.parent) return
    if (window.parent === window) return
    if (typeof data.message !== 'string' || data.message === '') return
    sendPayload(data.level === 'error' ? 'error' : 'warn', data.message)
  })
})()
