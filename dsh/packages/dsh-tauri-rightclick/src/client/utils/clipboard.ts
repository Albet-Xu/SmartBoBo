import { invoke } from 'dsh-tauri/client'

export async function writeClipboard(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    }
    catch {}
  }
  return legacyCopy(value)
}

export async function readClipboard(): Promise<string | null> {
  // macOS 的 WKWebView 从不授权 Web Clipboard 读取，右键「粘贴」因此在调用前就注定失败
  // （issue #858）；桌面载体的读取能力同步判定后直接走原生命令，不靠捕获拒绝兜底。
  if ('dshDesktop' in globalThis) {
    try {
      return await invoke<string | null>('read_clipboard_text')
    }
    catch {
      return null
    }
  }
  if (navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText()
    }
    catch {}
  }
  return null
}

// --- internal ---

/** Clipboard API 不可写时的兜底：临时 textarea + execCommand。 */
function legacyCopy(value: string): boolean {
  const field = document.createElement('textarea')
  field.value = value
  field.setAttribute('readonly', '')
  field.style.cssText = 'position:fixed;left:-9999px;top:0'
  document.body.appendChild(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  return copied
}
