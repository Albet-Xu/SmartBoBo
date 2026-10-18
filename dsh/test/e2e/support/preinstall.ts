/**
 * 首次装配的「安装推荐插件」引导（`src/layout/components/setup-preinstall.tsx`）。
 *
 * 引导页由 `preinstall_pending()` 门控（`src-tauri/src/service/plugin/preset.rs:532-545`）：
 * `.store.test.dat` 的 `preinstall_done` 为假、或 preset 指纹与当前内容不一致时出现，
 * 用户装完/跳过后才拉起服务。harness 每次启动都会删掉 `.store.test.dat`
 * （`resetTestStore()`），所以桌面端冒烟必然先过这一关——不过关就没有
 * `serviceHealthy`，也就没有 iframe。
 *
 * 引导页自身的用例归批次 `08`；这里只做「跳过它并让启动继续」。
 */

import { SETUP_PREINSTALL_SKIP, SHELL_IFRAME } from './selectors'

/**
 * 若出现预装引导则跳过，直到服务被拉起（或发现服务已就绪）。
 *
 * 返回前只保证「引导被跳过」；iframe 何时挂载由调用方自己等。
 */
export async function completePreinstall(browser: WebdriverIO.Browser, timeoutMs = 300_000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    // 已经过了引导（store 里有指纹基线）时直接返回
    if (await (await browser.$(SHELL_IFRAME)).isExisting())
      return

    const skip = await browser.$(SETUP_PREINSTALL_SKIP)
    if (await skip.isExisting() && await skip.isDisplayed()) {
      await skip.waitForClickable()
      await skip.click()
      return
    }

    await browser.pause(1000)
  }

  throw new Error(
    '首次装配未完成：既没有出现预装引导，也没有拉起服务。'
    + '检查 DSH_DOWNLOAD_CACHE_DIR 是否可装配（空目录且无网络时装配会停在这之前）。',
  )
}
