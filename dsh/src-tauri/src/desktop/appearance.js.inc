(function () {
  if (window.__dsh_appearance_bootstrap__) return
  window.__dsh_appearance_bootstrap__ = true
  // 只有宿主直接内嵌的那一层 frame 参与握手：dsh 应用内部嵌套的 frame 父窗口是 dsh
  // 页面而不是宿主，自报/应答都不该走这套协议（直达宿主的帧里 parent === top）。
  if (window.parent !== window.top) return

  var STYLE_ID = 'dsh-tauri:boot-appearance'
  var acknowledged = false

  // head/documentElement 在 document-start 可能还不存在，等它们出现再补挂。
  function bootStyle() {
    var style = document.getElementById(STYLE_ID)
    if (style) return style
    var target = document.head || document.documentElement
    if (!target) return null
    style = document.createElement('style')
    style.id = STYLE_ID
    target.appendChild(style)
    return style
  }

  // 宿主是 tauri://localhost / http://tauri.localhost，帧内是 http://127.0.0.1:<port>，
  // 跨源回发只能用 '*'（消息可信度由两端的 source 校验保证，请求不含敏感数据）。
  function request() {
    parent.postMessage({ source: 'dsh-desktop', type: 'dsh://appearance:request' }, '*')
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return
    var data = event.data
    if (!data || typeof data !== 'object') return
    if (data.source !== 'dsh-desktop') return
    if (data.type !== 'dsh://appearance') return
    // boot 页由内核在插件加载之前绘出，宿主下发的 CSS 是它唯一的透明来源；样式始终挂在
    // 独立 head style 上，绝不改 boot 节点的 DOM（BootHandoff 只交接 className/innerHTML，
    // 额外 inline style 会被判成 hydration 不匹配）。
    var style = bootStyle()
    if (!style) return
    var css = typeof data.bootCss === 'string' ? data.bootCss : ''
    if (style.textContent !== css) style.textContent = css
    if (acknowledged) return
    acknowledged = true
    parent.postMessage({ source: 'dsh-desktop', type: 'dsh://appearance:applied' }, '*')
  })

  // 帧内导航离开：旧文档的 boot 样式立即失效，别让它短暂作用在新文档上；新文档自己
  // 重新握手（同文档 bfcache 还原走下面的 pageshow，宿主据 leaving 重新隐蔽 iframe）。
  window.addEventListener('pagehide', function () {
    var style = document.getElementById(STYLE_ID)
    if (style) style.remove()
    acknowledged = false
  })

  window.addEventListener('pageshow', function () {
    acknowledged = false
    request()
  })

  request()
})()
