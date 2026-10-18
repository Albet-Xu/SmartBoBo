(function () {
  if (window.__dsh_plugin_boot_reload__) return
  window.__dsh_plugin_boot_reload__ = true
  if (window === window.top) return

  var stopped = false
  var sawSplash = false
  // 只有宿主直接内嵌的那一层 frame 参与帧身份握手：dsh 应用内部还会嵌套 iframe
  // （插件面板等），它们的自报/离开不代表宿主这一层换了文档。
  var shellFrame = window.parent === window.top
  var reportedFrame = false
  var reportedLeaving = false
  var stalledForCurrentSplash = false
  var stalledTimer = null
  var observer = null
  var fallbackTimer = null
  var loadingLabels = ['Loading plugins', 'Loading plugins…', 'Loading plugins...']
  // 品牌补丁可把内核 boot 字标换成 AGENT；两种字标都识别，补丁失败也能探测。
  var wordmarks = ['HARNESS', 'AGENT']

  function normalizedText(node) {
    return ((node && node.textContent) || '').replace(/\s+/g, ' ').trim()
  }

  function rootNode() {
    return document.getElementById('root')
  }

  function hasExactText(root, expected) {
    var nodes = root.querySelectorAll('div, span, p')
    for (var index = 0; index < nodes.length; index++) {
      if (normalizedText(nodes[index]) === expected) return true
    }
    return false
  }

  function hasAnyExactText(root, candidates) {
    for (var index = 0; index < candidates.length; index++) {
      if (hasExactText(root, candidates[index])) return true
    }
    return false
  }

  function isOfficialSplash() {
    var root = rootNode()
    if (!root || root.childElementCount !== 1) return false
    var boot = root.querySelector('[data-dsh-boot]')
    if (!boot || boot.parentElement !== root) return false
    if (root.querySelector('main, nav, [role="main"], button, input, textarea, form, iframe, [contenteditable="true"], [data-dsh-app-shell]')) {
      return false
    }
    var hasLoading = false
    for (var index = 0; index < loadingLabels.length; index++) {
      if (hasExactText(boot, loadingLabels[index])) {
        hasLoading = true
        break
      }
    }
    if (!hasAnyExactText(boot, wordmarks) || !hasLoading) return false
    var compact = normalizedText(boot).replace(/\s+/g, '')
    var compactForms = []
    for (var w = 0; w < wordmarks.length; w++) {
      compactForms.push(wordmarks[w] + 'Loadingplugins')
      compactForms.push(wordmarks[w] + 'Loadingplugins…')
      compactForms.push(wordmarks[w] + 'Loadingplugins...')
    }
    for (var c = 0; c < compactForms.length; c++) {
      if (compact === compactForms[c]) return true
    }
    return false
  }

  function isApplicationShell() {
    var root = rootNode()
    if (!root || isOfficialSplash()) return false
    return root.querySelector('main, nav, [role="main"], button, input, textarea, form, iframe, [contenteditable="true"], [data-dsh-app-shell]') !== null
  }

  // 官方 boot 失败页：wordmark（HARNESS/AGENT）+ “Failed to load plugins” 标题 + 错误明细。
  // 失败页与 splash 同构（#root 下单一 [data-dsh-boot] 根节点），但移除了 Loading
  // plugins 提示且不含应用特征元素——isOfficialSplash/isApplicationShell 均判否，
  // 若不加此分支会走 disarmSplash 静默路径，宿主错误界面永不出现。
  function bootFailureText() {
    var root = rootNode()
    if (!root || root.childElementCount !== 1) return null
    var boot = root.querySelector('[data-dsh-boot]')
    if (!boot || boot.parentElement !== root) return null
    if (!hasExactText(boot, 'Failed to load plugins')) return null
    var text = normalizedText(boot)
    var at = text.indexOf('Failed to load plugins')
    // 去掉 wordmark 前缀，只上报错误段落
    return at >= 0 ? text.slice(at) : text
  }

  function send(type, detail) {
    try {
      window.parent.postMessage({
        source: 'dsh-plugin-boot-bridge',
        type: type,
        detail: detail,
      }, '*')
    }
    catch (_) {}
  }

  function disarmSplash() {
    if (stalledTimer !== null) {
      clearTimeout(stalledTimer)
      stalledTimer = null
    }
    stalledForCurrentSplash = false
  }

  // 帧身份申报（issue #705）：宿主无法从 iframe 的 load 事件区分「dsh 页面已提交」与
  // 「浏览器内部错误页已提交」——代理不可达等网络错误页同样触发 load，而错误页里永远
  // 没有 #root。boot 页的 HTML 自带 #root，所以「子 frame 解析出 #root」是本 frame 正在
  // 承载 dsh 文档的确证；宿主据此区分「页面真的加载了」与「帧里只有一张浏览器错误页」。
  function reportFrame() {
    if (reportedFrame || !shellFrame) return
    if (!rootNode()) return
    reportedFrame = true
    send('dsh://plugin-boot:frame')
  }

  // 文档离开申报：帧内导航（dsh 页面把整帧跳到远端登录/错误页）不会换掉 iframe 元素，
  // 宿主只靠「换帧」清确认是抓不到的。自报过的文档一离开就作废旧确认，新文档要么自己
  // 重新自报，要么被宿主判成「帧里没有 dsh 页面」并给出可重试界面。只申报一次：迟到的
  // 重复 pagehide 不能把新文档刚立起来的确认再次作废。
  function reportLeaving() {
    if (!reportedFrame || reportedLeaving) return
    reportedLeaving = true
    send('dsh://plugin-boot:leaving')
  }

  // bfcache 恢复：文档没有重新执行脚本，宿主已在 leaving 里作废了确认，这里必须替它把
  // 身份重新申报一次，否则被恢复回来的正常页面会在宽限窗后被判成「帧里没有 dsh 页面」。
  function reportRestored(event) {
    if (!event || !event.persisted) return
    reportedFrame = false
    reportedLeaving = false
    reportFrame()
  }

  function stop() {
    if (stopped) return
    stopped = true
    disarmSplash()
    if (fallbackTimer !== null) clearInterval(fallbackTimer)
    if (observer !== null) observer.disconnect()
    window.removeEventListener('pagehide', stop)
  }

  function evaluate() {
    reportFrame()
    if (stopped) return
    var failure = bootFailureText()
    if (failure !== null) {
      // 失败页已渲染：立即上报错误文本并停止观察（与 ready/stalled 同一桥通道，
      // 宿主据此展示壳层错误界面，不再等 stalled 超时兜底）。
      send('dsh://plugin-boot:failed', failure)
      stop()
      return
    }
    if (isApplicationShell()) {
      if (sawSplash) send('dsh://plugin-boot:ready')
      stop()
      return
    }
    if (!isOfficialSplash()) {
      disarmSplash()
      return
    }
    sawSplash = true
    if (stalledTimer !== null || stalledForCurrentSplash) return
    stalledTimer = setTimeout(function () {
      stalledTimer = null
      if (stopped || !isOfficialSplash()) return
      stalledForCurrentSplash = true
      send('dsh://plugin-boot:stalled')
    }, 8000)
  }

  observer = new MutationObserver(evaluate)
  // initialization_script_for_all_frames 可能在文档解析极早期（documentElement 尚为
  // null，如 iframe / about:blank）执行；observe(null) 会抛
  // "Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type
  // 'Node'" 并中断后续 timer 注册。此处防御性跳过 observe，交由 fallbackTimer 轮询
  // 兜底（本就存在，用于 splash 检测与 stall 判定，正确性不依赖 MutationObserver）。
  try {
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  }
  catch (_) {
    observer.disconnect()
    observer = null
  }
  fallbackTimer = setInterval(evaluate, 1000)
  // 离开申报独立注册：stop() 会在观察结束后摘掉自己的 pagehide，而「文档后来导航走了」
  // 恰恰发生在观察结束后（应用 shell 已挂载），那一刻必须还能通知宿主。
  window.addEventListener('pagehide', reportLeaving)
  window.addEventListener('pagehide', stop)
  window.addEventListener('pageshow', reportRestored)
  evaluate()
})()
