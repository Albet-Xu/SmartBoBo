import { describe, expect, it } from 'vitest'
import { readSource } from './setup/read-source'

const BUILDER = readSource('src-tauri/src/desktop/builder.rs')
const SETTING = readSource('src-tauri/src/config/setting.rs')

describe('embedded WebDriver plugin is registered for E2E runs only', () => {
  it('registers tauri-plugin-wdio-webdriver inside the is_e2e_run guard', () => {
    const call = 'tauri_plugin_wdio_webdriver::init()'
    // 全仓只有这一处注册点：多出一处就会绕开守卫，正常会话也开 4445 并接管 script dialog。
    expect(BUILDER.split(call)).toHaveLength(2)

    const builderFn = BUILDER.indexOf('pub fn builder() -> tauri::Builder<tauri::Wry> {')
    expect(builderFn).toBeGreaterThan(-1)

    const guard = BUILDER.indexOf('if crate::config::is_e2e_run() {', builderFn)
    expect(guard).toBeGreaterThan(-1)

    const blockEnd = BUILDER.indexOf('\n    }\n', guard)
    expect(blockEnd).toBeGreaterThan(guard)
    expect(BUILDER.slice(guard, blockEnd)).toContain(call)
  })

  it('keys the guard on the env var the WebDriver service injects when it spawns the app', () => {
    // @wdio/tauri-service 的 embedded provider 拉起应用时注入 TAURI_WEBDRIVER_PORT，
    // 门控与 E2E Store / WebView2 profile 隔离共用同一个判定。
    expect(SETTING).toContain('pub fn is_e2e_run() -> bool {')
    expect(SETTING).toContain('std::env::var_os(E2E_PORT_ENV_VAR).is_some_and(|v| !v.is_empty())')
  })
})
