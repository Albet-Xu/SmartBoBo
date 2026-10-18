// 旧版 WebKit（没有全局 Iterator）下补齐 ES2025 iterator helpers。
//
// 背景（issue #539）：dsh 内置插件 dsh-client-ui-sidebar-documentpreview 内联的 pdf.js
// 在模块顶层执行 `typeof Iterator.prototype.join !== 'function'`。`Iterator` 是 ES2025
// iterator helpers 才引入的全局对象（Safari 18.4 / WebKit 2163、Chrome 122 起），
// macOS 14 / 15.3 随附的系统 WebKit 没有它，该表达式直接抛
// `Can't find variable: Iterator`，插件 import 失败，桌面端启动即报
// “Failed to load plugins: failed to import loader entry …”。
//
// 关键点：helper 必须挂在真实的 %IteratorPrototype%（生成器与 Array/Map/Set 迭代器
// 原型链的共同祖先）上，否则调用方在生成器上直接 `.join(',')` 解析不到——pdf.js 的
// 补丁正是假设 `Iterator.prototype` 就是那个共享原型。
//
// 只做「缺失才补」的加法：`Iterator` 已存在（原生，或宿主页面自带 polyfill）时整体让位；
// 每个 helper 也先按 typeof 判断，绝不覆盖已有实现。幂等守卫
// `window.__dsh_iterator_helpers__`，重复注入安全。
//
// 实现用生成器（ES2015）而不是 ES5 循环：本垫片必须返回真正的迭代器对象（原型链里有
// %IteratorPrototype% 才能继续链式调用），而缺少 `Iterator` 的运行时（Safari 10+ /
// WebKitGTK 2.6+）都支持生成器。
(function () {
  if (window.__dsh_iterator_helpers__) return
  // typeof 对未声明的标识符不抛错：存在原生 Iterator 就让位。
  if (typeof Iterator !== 'undefined') return
  if (typeof Symbol === 'undefined' || !Symbol.iterator) return

  var iteratorPrototype = null
  try {
    // 取 [Symbol.iterator]() 返回值（如 %ArrayIteratorPrototype%）的上一级原型。
    iteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()))
  }
  catch (_) {}
  if (!iteratorPrototype || typeof iteratorPrototype !== 'object') return

  function define(name, helper) {
    if (typeof iteratorPrototype[name] === 'function') return
    try {
      Object.defineProperty(iteratorPrototype, name, {
        configurable: true,
        writable: true,
        value: helper,
      })
    }
    catch (_) {}
  }

  function callable(fn, method) {
    if (typeof fn !== 'function') {
      throw new TypeError('Iterator.prototype.' + method + ' requires a callable argument')
    }
    return fn
  }

  // 取一个可迭代对象（或「裸迭代器」，即只有 next 的对象）的迭代器。
  function iterableOf(value, message) {
    if (typeof value[Symbol.iterator] === 'function') return value[Symbol.iterator]()
    if (typeof value.next === 'function') return value
    throw new TypeError(message)
  }

  // 与 pdf.js 内联的补丁同形（[...this].join(separator)），改用显式 next() 循环。
  define('join', function (separator) {
    var values = []
    for (var step = this.next(); !step.done; step = this.next()) values.push(step.value)
    return values.join(separator)
  })

  define('toArray', function () {
    var values = []
    for (var step = this.next(); !step.done; step = this.next()) values.push(step.value)
    return values
  })

  define('forEach', function (fn, thisArg) {
    var callback = callable(fn, 'forEach')
    var index = 0
    for (var step = this.next(); !step.done; step = this.next()) {
      callback.call(thisArg, step.value, index++)
    }
  })

  define('some', function (predicate, thisArg) {
    var fn = callable(predicate, 'some')
    var index = 0
    for (var step = this.next(); !step.done; step = this.next()) {
      if (fn.call(thisArg, step.value, index++)) return true
    }
    return false
  })

  define('every', function (predicate, thisArg) {
    var fn = callable(predicate, 'every')
    var index = 0
    for (var step = this.next(); !step.done; step = this.next()) {
      if (!fn.call(thisArg, step.value, index++)) return false
    }
    return true
  })

  define('find', function (predicate, thisArg) {
    var fn = callable(predicate, 'find')
    var index = 0
    for (var step = this.next(); !step.done; step = this.next()) {
      if (fn.call(thisArg, step.value, index++)) return step.value
    }
    return undefined
  })

  define('reduce', function (reducer, initialValue) {
    var fn = callable(reducer, 'reduce')
    // arguments.length 区分「没有初值」与「初值为 undefined」。
    var hasAccumulator = arguments.length > 1
    var accumulator = initialValue
    var index = 0
    for (var step = this.next(); !step.done; step = this.next()) {
      if (hasAccumulator) accumulator = fn(accumulator, step.value, index)
      else {
        accumulator = step.value
        hasAccumulator = true
      }
      index++
    }
    if (!hasAccumulator) throw new TypeError('Reduce of empty iterator with no initial value')
    return accumulator
  })

  define('map', function* (mapper) {
    var fn = callable(mapper, 'map')
    var index = 0
    for (var step = this.next(); !step.done; step = this.next()) yield fn(step.value, index++)
  })

  define('filter', function* (predicate) {
    var fn = callable(predicate, 'filter')
    var index = 0
    for (var step = this.next(); !step.done; step = this.next()) {
      var value = step.value
      if (fn(value, index++)) yield value
    }
  })

  // take/drop 的 limit 语义与原生一致：ToNumber 后 NaN 或负值抛 RangeError。
  function toLimit(limit, method) {
    var message = 'Iterator.prototype.' + method + ' limit must be a non-negative number'
    var number = Number(limit)
    if (number !== number) throw new RangeError(message)
    var integer = number === Infinity || number === -Infinity ? number : Math.trunc(number)
    if (integer < 0) throw new RangeError(message)
    return integer
  }

  define('take', function* (limit) {
    var remaining = toLimit(limit, 'take')
    for (var step = this.next(); !step.done && remaining > 0; step = this.next()) {
      yield step.value
      remaining--
    }
  })

  define('drop', function* (limit) {
    var remaining = toLimit(limit, 'drop')
    for (var step = this.next(); !step.done; step = this.next()) {
      if (remaining > 0) {
        remaining--
        continue
      }
      yield step.value
    }
  })

  define('flatMap', function* (mapper) {
    var fn = callable(mapper, 'flatMap')
    var index = 0
    for (var step = this.next(); !step.done; step = this.next()) {
      var value = fn(step.value, index++)
      // 与原生一致：mapper 的返回值必须是对象，且该对象必须可迭代
      // （字符串原始值不展开——展开只发生在 `Object('ab')` 这类对象包装上）。
      if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
        throw new TypeError('Iterator.prototype.flatMap mapper must return an object')
      }
      var inner = iterableOf(value, 'Iterator.prototype.flatMap mapper must return an iterable')
      for (var innerStep = inner.next(); !innerStep.done; innerStep = inner.next()) {
        yield innerStep.value
      }
    }
  })

  // Iterator 本体：抽象类，只提供 `prototype`（指向真实 %IteratorPrototype%）与 `from`。
  var IteratorConstructor = function Iterator() {
    throw new TypeError('Abstract class Iterator not directly constructable')
  }
  IteratorConstructor.prototype = iteratorPrototype
  IteratorConstructor.from = function (value) {
    if (value === null || value === undefined) {
      throw new TypeError('Iterator.from called on non-object')
    }
    // 已经是迭代器（自带 next）就原样返回，不再多包一层。
    if (typeof value.next === 'function') return value
    // 其余情况与原生一致：推迟到真正取下一个值时才判定是否可迭代。
    return (function* () {
      var inner = iterableOf(value, 'Iterator.from called on a non-iterable value')
      for (var step = inner.next(); !step.done; step = inner.next()) yield step.value
    })()
  }

  try {
    Object.defineProperty(window, 'Iterator', {
      configurable: true,
      writable: true,
      value: IteratorConstructor,
    })
  }
  catch (_) {
    try {
      window.Iterator = IteratorConstructor
    }
    catch (_) {}
  }
  window.__dsh_iterator_helpers__ = true
})()
