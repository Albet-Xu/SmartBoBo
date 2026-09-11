// BoBo 桌面壳 · 老版本遗留用户数据的启动前修复（当前处理 dsh 的凭据文件）
//
// 背景：DSH_HOME/.credentials.yaml 的合法格式是「标识符: 非空字符串」的扁平映射——**没有
// version 之类字段**。老版本 BoBo 留下过 `version: 1` 这种非字符串行，新版 credentials-local
// 解析器会直接抛错，导致整个插件树加载失败（现象：打开后一片空白，bobo-backend.log 里能看到
// "the value for \"version\" ... must be a string"）。
//
// 本模块在启动后端之前清洗该文件：把每个合法条目的值统一归一化成**带引号的字符串**
// （数值/布尔/日期这类会被 YAML 重新识别成非字符串的值因此被救回来，而不是被丢弃），
// 只丢弃解析器根本无法接受的形态（空值、非「标识符: 值」的行）。有改动先备份再原子写回，
// 任何失败都不阻塞启动。
'use strict'

const fs = require('node:fs')
const path = require('node:path')

/** 合法的引用名（与 dsh 的 credentialRef 约定一致：POSIX 标识符）。 */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
/** 一行形如 `ref: value`。 */
const ENTRY = /^([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*(.*)$/
/** 已是 YAML 标量引号形式时原样保留。 */
const QUOTED = /^["']/

/**
 * 把一个值写成 YAML 双引号字符串（转义 `\` 与 `"`）。
 * @param value - 原始值文本（不含首尾空白）。
 * @returns 可安全解析为字符串的值。
 */
function asQuoted(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * 清洗凭据文件文本（纯函数，便于单测）。
 * @param text - 文件原文。
 * @returns `{ text, dropped, repaired, changed }`。
 */
function sanitizeCredentialsText(text) {
  const kept = []
  const dropped = []
  let repaired = 0
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/[ \t]+$/, '')
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      kept.push(line)
      continue
    }
    // 合法格式是**无缩进的**扁平映射：缩进行属于嵌套结构，解析器会拒绝，直接丢弃。
    if (line !== trimmed) {
      dropped.push(trimmed)
      continue
    }
    const match = ENTRY.exec(trimmed)
    if (match === null || !IDENTIFIER.test(match[1])) {
      dropped.push(trimmed)
      continue
    }
    const ref = match[1]
    const value = match[2].trim()
    if (value === '') {
      dropped.push(trimmed)
      continue
    }
    // 老版本写过的 schema 头（`version: 1`）在新版里不是凭据字段，直接丢弃。
    if (ref === 'version' && !QUOTED.test(value)) {
      dropped.push(trimmed)
      continue
    }
    if (QUOTED.test(value)) {
      kept.push(`${ref}: ${value}`)
      continue
    }
    kept.push(`${ref}: ${asQuoted(value)}`)
    repaired += 1
  }
  const next = kept.join('\n').replace(/\n+$/, '') + '\n'
  return { text: next, dropped, repaired, changed: dropped.length > 0 || repaired > 0 }
}

/**
 * 修复 DSH_HOME 下的凭据文件（不存在或已合法时不动）。
 * @param options - `{ dshHome, log }`；`dshHome` 为空时直接返回。
 * @returns `{ skipped, changed, dropped, repaired, backup }`。
 */
function repairCredentialsFile(options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {}
  const result = { skipped: true, changed: false, dropped: 0, repaired: 0, backup: '' }
  if (!options.dshHome) return result
  const file = path.join(options.dshHome, '.credentials.yaml')
  let text
  try {
    if (!fs.existsSync(file)) return result
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    log(`[repairUserData] 读取失败（不影响启动）: ${err.message}`)
    return result
  }
  result.skipped = false
  const { text: next, dropped, repaired, changed } = sanitizeCredentialsText(text)
  result.dropped = dropped.length
  result.repaired = repaired
  if (!changed) return result
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    result.backup = `${file}.bak-${stamp}`
    fs.copyFileSync(file, result.backup)
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, next, 'utf8')
    fs.renameSync(tmp, file)
    result.changed = true
    log(`[repairUserData] 已修复 .credentials.yaml：丢弃 ${dropped.length} 行、归一化 ${repaired} 行（备份 ${path.basename(result.backup)}）`)
  } catch (err) {
    log(`[repairUserData] 写回失败（不影响启动）: ${err.message}`)
  }
  return result
}

module.exports = { repairCredentialsFile, sanitizeCredentialsText }
