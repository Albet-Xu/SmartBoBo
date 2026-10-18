import process from 'node:process'
import { assertPreconditions, purgeStaleHomes, WEBDRIVER_PORT } from './support/desktop'

/**
 * `desktop` project 的 globalSetup：车道级前置与清理，整条车道只做一次。
 *
 * 应用实例仍由各用例文件自己 `startDesktopApp()`（`fileParallelism: false` 保证串行、
 * 一次只有一个实例）；这里只做「一次就够」的事——清掉上一轮遗留的 scratch 根，并校验
 * debug 二进制存在、WebDriver 与 debug 端口空闲。这样「端口被占 / 二进制缺失」会在车道
 * 开始前一次性报出来，而不是让每个用例文件各报一次同样的错。
 *
 * 端口可用 `TAURI_WEBDRIVER_PORT` 覆盖：本机若已跑着另一个桌面实例（它同样占着默认
 * 4445），用它另开一路即可并存，无需结束那个实例。
 */
export default async function setup(): Promise<void> {
  await purgeStaleHomes()
  await assertPreconditions()
  process.stdout.write(`[desktop-setup] WebDriver 端口 ${WEBDRIVER_PORT} 空闲，debug 二进制就绪\n`)
}
