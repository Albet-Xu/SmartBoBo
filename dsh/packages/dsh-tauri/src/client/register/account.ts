import { invoke } from '../service/invoke'
import { defineRegister } from './index'

/** 官方账号流中与「自动打开浏览器」相关的最小投影（`AccountView.attempt` 子集）。 */
interface AccountAttemptView {
  phase?: string
  authorizeUrl?: string
}

interface AccountViewLike {
  status?: string
  attempt?: AccountAttemptView | null
}

interface AccountStreamFrame {
  value?: AccountViewLike
  accept?: () => void
}

interface AccountStreamLike extends AsyncIterable<AccountStreamFrame> {
  dispose?: () => Promise<void> | void
}

/** 登录成功后把默认模型落到账号路由所需的宿主方法（`session/initializeDefaultModel`）。 */
interface AccountSessionLike {
  initializeDefaultModel?: () => Promise<unknown>
}

interface AccountRemoteLike {
  account?: {
    watch?: (signal: AbortSignal) => AsyncIterable<AccountViewLike>
  }
  session?: AccountSessionLike
  $stream?: (options: {
    name: string
    open: (signal: AbortSignal) => AsyncIterable<AccountViewLike>
    ended: (accepted: boolean) => Error
  }) => AccountStreamLike
}

/** `ctx.inject` 给出的作用域上下文：只在这里读 `remote` / `remote.account`。 */
interface InjectedScope {
  remote?: AccountRemoteLike
}

/**
 * 官方桌面端由 Electron 主进程监听账号流并把授权地址交给系统浏览器（`shell.openExternal`）；
 * 桌面壳没有主进程，这里在 iframe 内做同一件事：账号尝试进入 `waiting-browser` 时打开系统
 * 浏览器，用户不必再手抄弹窗里的链接（弹窗里那个转圈的主按钮正是 waiting-browser）。
 *
 * 两条必须遵守的约束，都是踩过的坑：
 * - `remote` / `remote.account` 由 `dsh-client-connection` **稍后**提供，且 cordis 的 ctx 代理
 *   对未声明服务直接抛 `cannot get property "remote.account" without inject`。必须用动态
 *   `ctx.inject` 声明依赖，并**只在使用它给出的作用域 ctx** 读服务——用外层 ctx 读会抛。
 * - 订阅走官方 `$stream`（把 `watch()` 的原始值包成带 `accept()` 的帧），与官方
 *   `ui-settings-account` 的消费方式逐字一致。
 *
 * 只在桌面载体生效：浏览器直开没有 `dshDesktop` 标记，也不该替用户开浏览器。
 *
 * 同一处订阅还承担官方账号 UI 的第二个职责：登录成功的那一帧把默认模型落到账号路由
 * （`session/initializeDefaultModel` —— 官方在 `ui-settings-account` 里做同一件事）。
 * 桌面载体比官方多一道风险：签名可能在客户端挂载前就完成（欢迎/账号页先登录），
 * 此时官方那侧的「状态迁移」判定不会触发，默认模型会停在需要 API Key 的
 * `deepseek-official` 路由上，第一条消息即以 MISSING_CREDENTIAL 失败；
 * 这里按官方同一条件补一次（宿主方法自身在「已有任一 provider 密钥」时不改默认，幂等）。
 */
export const accountSignInFeature = defineRegister((controller, ctx) => {
  if (!('dshDesktop' in globalThis))
    return

  let opened: string | undefined
  let wasSignedIn = false

  ctx.inject(['remote', 'remote.account', 'remote.session'], (scoped) => {
    const remote = (scoped as unknown as InjectedScope).remote
    const account = remote?.account
    const watch = account?.watch
    if (typeof watch !== 'function' || typeof remote?.$stream !== 'function') {
      console.warn('[dsh-tauri] account stream unavailable — the authorize url cannot be opened automatically')
      return
    }

    const stream = remote.$stream({
      name: 'account',
      open: signal => watch.call(account, signal),
      ended: () => new Error('account stream ended'),
    })
    controller.add(() => {
      void stream.dispose?.()
    })

    void (async () => {
      for await (const frame of stream) {
        const attempt = frame.value?.attempt
        frame.accept?.()
        const url = attempt?.authorizeUrl
        if (attempt?.phase === 'waiting-browser' && isBrowserUrl(url) && url !== opened) {
          opened = url
          await invoke('open_external_url', { url }).catch((error: unknown) => {
            console.warn('[dsh-tauri] opening the account authorize url failed:', error)
          })
        }
        const signedIn = frame.value?.status === 'credential-stored' && attempt?.phase === 'succeeded'
        if (signedIn && !wasSignedIn)
          void initializeDefaultModel(remote)
        wasSignedIn = signedIn
      }
    })().catch(() => undefined)
  })
})

// --- internal ---

/** 登录成功后按官方条件请求一次默认模型初始化；能力缺席或失败只告警。 */
async function initializeDefaultModel(remote: AccountRemoteLike | undefined): Promise<void> {
  let call: AccountSessionLike['initializeDefaultModel']
  try {
    call = remote?.session?.initializeDefaultModel
  }
  catch (error) {
    console.warn('[dsh-tauri] reading the session remote failed:', error)
    return
  }
  if (typeof call !== 'function')
    return
  try {
    await call.call(remote?.session)
  }
  catch (error) {
    console.warn('[dsh-tauri] initializing the account default model failed:', error)
  }
}

/** 只放行宿主 `open_external_url` 能处理的 http(s) 浏览器地址。 */
function isBrowserUrl(value: unknown): value is string {
  if (typeof value !== 'string')
    return false
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  }
  catch {
    return false
  }
}
