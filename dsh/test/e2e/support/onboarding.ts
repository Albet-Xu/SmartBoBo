/**
 * dsh 帧内的阻塞式引导弹层。
 *
 * 首次进入 dsh 会先后弹出两个弹层，二者都走 `OnboardingModal`：
 * - 「内测声明」（`WelcomeNotice`，`headless` 渲染）：正文里只有「继续」一个按钮；
 * - 「添加一个 API Key 开始使用」（`DeepSeekOnboardingDialog`）：取消项是编辑器底部的
 *   「稍后配置」，位于 `EditorFooter` 的 `_editorActions` 容器内。
 *
 * `OnboardingModal` 把帧内 `#root` 设为 `inert`，并把 `Modal.onClose` 写成空实现
 * （`ignoreImplicitDismiss`），因此**点遮罩、按 Esc 都关不掉**：只有点各自的正向按钮
 * 才会 `complete()`。关闭状态还是「按帧内页面加载判定」的插槽状态、**不落盘**，iframe
 * 一旦重建就复发——所以必须是**可重入的闸**，而不是在 `beforeAll` 关一次。
 *
 * 判定用结构与类名后缀，不用文案：文案随语言变，且规范禁止 E2E 依赖文本。
 */

import { SHELL_IFRAME } from './selectors'

/** 帧内弹层根节点（`dsh-client-ui-primitives` 的 `Modal`，`role="dialog"`）。 */
const DIALOG = 'div[role="dialog"][aria-modal="true"]'

/** apiKey 引导的取消按钮（`EditorFooter` 的 `_editorActions` 里第一个按钮）。 */
const EDITOR_CANCEL = 'div[class*="_editorActions"] > button'

/** 关闭当前帧内全部引导弹层；返回本轮实际关掉的弹层种类（用于日志与排错）。 */
export async function dismissDshModals(
  browser: WebdriverIO.Browser,
  timeoutMs = 20_000,
): Promise<string[]> {
  const dismissed: string[] = []
  const iframe = await browser.$(SHELL_IFRAME)
  if (!await iframe.isExisting())
    return dismissed

  const deadline = Date.now() + timeoutMs
  await browser.switchFrame(iframe)
  try {
    while (Date.now() < deadline) {
      const outcome = await browser.execute((dialog: string, cancel: string) => {
        const node = document.querySelector(dialog)
        if (node === null)
          return 'none'
        const target = (node.querySelector(cancel) ?? node.querySelector('button')) as HTMLElement | null
        if (target === null)
          return 'none'
        target.click()
        return node.querySelector(cancel) !== null ? 'onboarding' : 'notice'
      }, DIALOG, EDITOR_CANCEL)

      if (outcome === 'none') {
        // 弹层挂载晚于服务就绪：留一个观察窗，连续两次空才收工。
        await browser.pause(300)
        const stillThere = await browser.execute(
          (dialog: string) => document.querySelector(dialog) !== null,
          DIALOG,
        )
        if (!stillThere)
          return dismissed
        continue
      }

      dismissed.push(outcome)
      await browser.pause(400)
    }
    return dismissed
  }
  finally {
    // 无论成功与否都退回顶层，否则后续所有用例都会在帧上下文里跑。
    await browser.switchFrame(null)
  }
}
