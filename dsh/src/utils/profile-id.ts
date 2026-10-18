/**
 * 档案展示名 → 档案 id 的归一化，与 Rust `service::profile::normalize_profile_id` 一一对应：
 * 小写、仅保留 ASCII 字母数字，`-`/`_`/空格作分隔符（连续分隔符合并），其余字符丢弃，去首尾 `-`。
 *
 * 前端必须与后端用同一套归一化，否则「档案是否已存在」会判错：`0.17` 这类带点的名字在
 * 后端落成 `017`，只按原名匹配会误判为不存在，进而重复调用 create_profile 撞 `PROFILE_EXISTS`。
 */
export function normalizeProfileId(name: string): string {
  let out = ''
  let pendingSeparator = false
  for (const char of name.toLowerCase()) {
    if (/[a-z0-9]/.test(char)) {
      if (pendingSeparator && out)
        out += '-'
      pendingSeparator = false
      out += char
    }
    else if (char === ' ' || char === '-' || char === '_') {
      pendingSeparator = true
    }
  }
  return out.replace(/^-+|-+$/g, '')
}
