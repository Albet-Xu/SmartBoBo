#!/usr/bin/env node
/* eslint-disable no-console -- CLI 探针：stdout/stderr 为其主要输出通道 */

/**
 * D0 临时探针：验证 debug 二进制内嵌的 WebDriver server 能否被纯 HTTP 驱动。
 * 保留为不依赖 WDIO 的最小诊断通道之一（测试协议见 docs/specs/plugin.test.md）。
 */

import type { ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import { createConnection } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

// 常量配置
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const APP_PATH = path.join(ROOT, 'src-tauri', 'target', 'debug', 'deepseek-harness-desktop.exe')
const LOG_PATH = path.join(ROOT, '.temp-wdio-probe-app.log')

const APP_PORT = 3081
const WD_PORT = 4445
const BASE_URL = `http://127.0.0.1:${WD_PORT}`

const TIMEOUT_START_MS = 120_000
const TIMEOUT_SESSION_MS = 30_000
const POLL_INTERVAL_MS = 500

/**
 * 打印失败日志并退出程序
 */
function fail(message: string): never {
  console.error(`[probe] FAIL: ${message}`)
  process.exit(1)
}

/**
 * 检查指定端口是否已被占用
 */
function isPortBusy(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })

    const cleanup = (isBusy: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(isBusy)
    }

    socket.setTimeout(1000)
    socket.once('connect', () => cleanup(true))
    socket.once('timeout', () => cleanup(false))
    socket.once('error', () => cleanup(false))
  })
}

/**
 * 发送 HTTP 请求并自动解析 JSON 结果
 */
async function request<T = Record<string, unknown>>(
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number, json: T | string }> {
  const headers = body !== undefined ? { 'content-type': 'application/json' } : undefined
  const res = await fetch(`${BASE_URL}${route}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  try {
    return { status: res.status, json: JSON.parse(text) as T }
  }
  catch {
    return { status: res.status, json: text }
  }
}

/**
 * 高效获取日志文件的最后 N 行（不一次性加载大文件到内存）
 */
function logTail(maxLines = 15): string {
  if (!existsSync(LOG_PATH))
    return '(无应用日志)'

  try {
    const stats = statSync(LOG_PATH)
    const fd = openSync(LOG_PATH, 'r')
    const bufferSize = Math.min(1024 * 8, stats.size) // 默认读取 8KB
    const buffer = Buffer.alloc(bufferSize)

    readSync(fd, buffer, 0, bufferSize, stats.size - bufferSize)
    closeSync(fd)

    const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean)
    return lines.slice(-maxLines).join('\n')
  }
  catch {
    return '(读取日志失败)'
  }
}

/**
 * 等待 WebDriver 服务就绪
 */
async function waitForStatus(child: ChildProcess) {
  const deadline = Date.now() + TIMEOUT_START_MS
  let lastStatus = '(尚未连上)'

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(`应用在就绪前退出（exitCode=${child.exitCode}）。应用日志尾部：\n${logTail()}`)
    }

    try {
      const res = await request<{ value?: { ready?: boolean } }>('GET', '/status')
      lastStatus = `${res.status} ${JSON.stringify(res.json)}`

      if (res.status === 200 && typeof res.json === 'object' && res.json?.value?.ready === true) {
        return res
      }
    }
    catch (error) {
      lastStatus = `请求失败：${(error as Error).message}`
    }

    await sleep(POLL_INTERVAL_MS)
  }

  fail(`等待 WebDriver server 就绪超时（${TIMEOUT_START_MS}ms）。最后一次 /status：${lastStatus}`)
}

/**
 * 创建 WebDriver 会话
 */
async function createSession(child: ChildProcess): Promise<string> {
  const deadline = Date.now() + TIMEOUT_SESSION_MS
  let lastResponse = ''

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(`应用在建会话前退出（exitCode=${child.exitCode}）。应用日志尾部：\n${logTail()}`)
    }

    const res = await request<{ value?: { sessionId?: string } }>('POST', '/session', { capabilities: {} })
    const sessionId = typeof res.json === 'object' ? res.json?.value?.sessionId : undefined

    if (res.status === 200 && sessionId) {
      return sessionId
    }

    lastResponse = `${res.status} ${JSON.stringify(res.json)}`
    await sleep(POLL_INTERVAL_MS)
  }

  fail(`POST /session 未返回 sessionId。最后一次响应：${lastResponse}`)
}

/**
 * 安全且彻底地停止应用子进程
 */
async function stopApp(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined)
    return

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' })
      killer.once('exit', () => resolve())
      killer.once('error', () => resolve())
    })
  }
  else {
    child.kill('SIGKILL')
  }

  // 等待进程完全释放
  for (let i = 0; i < 40 && child.exitCode === null; i++) {
    await sleep(250)
  }
}

/**
 * 主执行逻辑
 */
async function main() {
  // 1. 环境与前置预检
  if (!existsSync(APP_PATH)) {
    fail(`二进制不存在：${APP_PATH}\n先运行：cargo build --manifest-path src-tauri/Cargo.toml`)
  }
  if (await isPortBusy(APP_PORT)) {
    fail(`${APP_PORT} 已被监听（debug 固定端口）。请先停掉 dev/debug 实例；探针不自动杀进程。`)
  }
  if (await isPortBusy(WD_PORT)) {
    fail(`WebDriver 端口 ${WD_PORT} 已被监听。请先释放该端口。`)
  }

  // 2. 启动子进程并重定向输出日志
  const fd = openSync(LOG_PATH, 'w')
  const child = spawn(APP_PATH, [], {
    cwd: ROOT,
    env: { ...process.env, TAURI_WEBDRIVER_PORT: String(WD_PORT) },
    stdio: ['ignore', fd, fd],
  })
  closeSync(fd)

  try {
    // 3. 执行 WebDriver 协议验证
    const status = await waitForStatus(child)
    console.log(`[probe] status: ok (${JSON.stringify((status.json as any).value)})`)

    const sessionId = await createSession(child)
    console.log(`[probe] sessionId: ${sessionId}`)

    const handles = await request<{ value?: string[] }>('GET', `/session/${sessionId}/window/handles`)
    console.log(`[probe] windows: ${JSON.stringify(handles.json)}`)

    // 销毁会话
    await request('DELETE', `/session/${sessionId}`)

    // 验证窗口数量及标识
    const list = typeof handles.json === 'object' ? handles.json?.value : undefined
    if (!Array.isArray(list) || list.length !== 1 || list[0] !== 'main') {
      console.error(`[probe] FAIL: 期望窗口集合恰为 ["main"]，实际 ${JSON.stringify(list)}`)
      console.error(`应用日志尾部：\n${logTail()}`)
      process.exitCode = 1
      return
    }

    console.log('[probe] PASS: 内嵌 WebDriver server 可被纯 HTTP 驱动')
  }
  finally {
    // 4. 清理资源
    await stopApp(child)
    if (await isPortBusy(APP_PORT)) {
      console.warn(`[probe] WARN: 收尾后 ${APP_PORT} 仍被监听，可能有残留 harness 存活`)
    }
  }
}

// 启动执行
main().catch((error: unknown) => {
  const err = error as Error
  console.error(`[probe] FAIL: 未捕获异常 ${err?.stack ?? err}`)
  process.exit(1)
})
