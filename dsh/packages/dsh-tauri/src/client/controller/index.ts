import { noop } from '@reause/core'

/** 控制器注册的命名生命周期钩子（dispose 为统一清理点）。 */
export interface LifecycleHooks {
  dispose: () => void
}

/** 受控生命周期资源（listener / timer / observer / disposer）的统一归口。 */
export interface LifecycleController {
  /**
   * 注册任意 disposer（dispose 时统一执行；执行失败不中断其他清理）。返回取消注册句柄。
   */
  add: (disposer: () => void) => () => void
  /**
   * 受控 setTimeout：dispose 后不再触发；返回提前取消句柄。
   */
  timeout: (fn: () => void, ms: number) => () => void
  /**
   * 受控 setInterval：dispose 时自动清除；返回提前取消句柄。
   */
  interval: (fn: () => void, ms: number) => () => void
  /**
   * 受控 document 事件监听：dispose 时自动移除；返回移除句柄。
   */
  listen: <K extends keyof DocumentEventMap>(
    type: K,
    fn: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ) => () => void
  /**
   * 受控 window 事件监听：dispose 时自动移除；返回移除句柄。
   */
  listenWindow: <K extends keyof WindowEventMap>(
    type: K,
    fn: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ) => () => void
  /**
   * 受控 MutationObserver：dispose 时自动 disconnect；返回 observer 本体。
   * 观察配置是第三个参数且可省略，默认见 DEFAULT_MUTATION_OPTIONS。
   */
  observe: (target: Node, onMutate: MutationCallback, options?: MutationObserverInit) => MutationObserver
  /**
   * 是否已 dispose（异步续接 Guard）。
   */
  isDisposed: () => boolean
  /**
   * 一次性清理所有已注册资源（幂等）。
   */
  dispose: () => void
}

/** observe 的默认观察配置：目标自身与整棵子树的子节点增删（DOM 补丁最常用的粒度）。 */
const DEFAULT_MUTATION_OPTIONS: MutationObserverInit = { childList: true, subtree: true }

/** 创建生命周期控制器 */
export function createLifecycleController(): LifecycleController {
  let isDisposed = false
  const activeTimeouts = new Set<ReturnType<typeof setTimeout>>()
  const disposers = new Set<LifecycleHooks['dispose']>()
  const controller: LifecycleController = {
    add(disposer) {
      if (isDisposed)
        return noop
      const safeDisposer = () => {
        try {
          disposer()
        }
        catch (error) {
          console.error('[LifecycleController] Unhandled exception in disposer:', error)
        }
      }

      disposers.add(safeDisposer)

      return () => {
        disposers.delete(safeDisposer)
      }
    },

    timeout(fn, ms) {
      if (isDisposed)
        return noop

      const timer = setTimeout(() => {
        activeTimeouts.delete(timer)
        fn()
      }, ms)

      activeTimeouts.add(timer)

      const cancel = () => activeTimeouts.delete(timer) && clearTimeout(timer)

      const unhook = controller.add(cancel)
      return () => {
        cancel()
        unhook()
      }
    },

    interval(fn, ms) {
      if (isDisposed)
        return noop

      const timer = setInterval(fn, ms)
      const cancel = () => clearInterval(timer)

      const unhook = controller.add(cancel)
      return () => {
        cancel()
        unhook()
      }
    },

    listen(type, fn, options) {
      if (isDisposed)
        return noop

      const handler = fn as EventListener
      document.addEventListener(type, handler, options)

      const remove = () => document.removeEventListener(type, handler, options)
      const unhook = controller.add(remove)

      return () => {
        remove()
        unhook()
      }
    },

    listenWindow(type, fn, options) {
      if (isDisposed || typeof window === 'undefined')
        return noop

      const handler = fn as EventListener
      window.addEventListener(type, handler, options)

      const remove = () => window.removeEventListener(type, handler, options)
      const unhook = controller.add(remove)
      return () => {
        remove()
        unhook()
      }
    },

    observe(target, onMutate, options) {
      const observer = new MutationObserver(onMutate)

      if (!isDisposed) {
        observer.observe(target, options ?? DEFAULT_MUTATION_OPTIONS)
        controller.add(() => observer.disconnect())
      }

      return observer
    },

    isDisposed: () => isDisposed,

    dispose() {
      if (isDisposed)
        return

      isDisposed = true

      for (const timer of activeTimeouts)
        clearTimeout(timer)
      activeTimeouts.clear()

      for (const disposer of [...disposers])
        disposer()
      disposers.clear()
    },
  }

  return controller
}
