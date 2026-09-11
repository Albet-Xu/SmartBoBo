'use strict'

// 内置技能的版本感知播种：按「源目录内容哈希」决定是否覆盖用户机器上的同名技能。
// 之所以覆盖：内置技能随 app 升级修 bug，只补缺的播种方式让修复永远到不了老用户机器。
// 之所以保留目标端多出来的文件：用户会在内置技能里加自己的脚本/配置，删掉即数据丢失。

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const MARKER_NAME = '.seeded.json'

/**
 * 递归遍历目录下所有文件，按「相对路径 + 文件字节」排序拼接后取 sha256 十六进制。
 * 相对路径统一用 `/` 分隔，保证跨平台哈希稳定。
 */
function hashDir(dir) {
  const entries = []
  const walk = (base, rel) => {
    for (const dirent of fs.readdirSync(base, { withFileTypes: true })) {
      const abs = path.join(base, dirent.name)
      const childRel = rel ? `${rel}/${dirent.name}` : dirent.name
      if (dirent.isDirectory()) walk(abs, childRel)
      else if (dirent.isFile()) entries.push([childRel, fs.readFileSync(abs)])
    }
  }
  walk(dir, '')
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  const hash = crypto.createHash('sha256')
  const SEP = Buffer.from([0])
  for (const [rel, bytes] of entries) {
    hash.update(rel, 'utf8')
    hash.update(SEP)
    hash.update(bytes)
    hash.update(SEP)
  }
  return hash.digest('hex')
}

/**
 * 把 from 目录下的文件逐个写入 to（同名覆盖），但绝不删除 to 里多出来的文件，
 * 因此用户新增的内容得以保留。
 */
function copyInto(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const dirent of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, dirent.name)
    const destPath = path.join(to, dirent.name)
    if (dirent.isDirectory()) copyInto(srcPath, destPath)
    else if (dirent.isFile()) fs.copyFileSync(srcPath, destPath)
  }
}

/** 读标记文件；缺失或损坏都按「未播种过」处理，让下次全量重播。 */
function readMarker(markerPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    if (parsed && typeof parsed.skills === 'object' && parsed.skills) return parsed
  } catch {
    /* 首次运行或文件损坏 */
  }
  return { version: '', skills: {} }
}

/** 写临时文件再 rename，避免读到半截 JSON；失败只告警。 */
function writeMarker(markerPath, payload, emit) {
  const tmp = `${markerPath}.${process.pid}.tmp`
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    fs.renameSync(tmp, markerPath)
  } catch (err) {
    emit(`[seedSkills] 标记文件写入失败（不影响启动）: ${err.message}`)
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* 清理失败忽略 */
    }
  }
}

/**
 * 播种内置技能。
 * @param {{ src?: string, targetRoot?: string, version?: string, log?: (line: string) => void }} options
 * @returns {{ copied: string[], updated: string[], unchanged: string[], failed: string[] }}
 */
function seedSkills(options = {}) {
  const { src, targetRoot, version } = options
  const emit = typeof options.log === 'function' ? options.log : () => {}
  const result = { copied: [], updated: [], unchanged: [], failed: [] }

  if (!src || !targetRoot) return result

  let names
  try {
    if (!fs.existsSync(src)) return result
    names = fs
      .readdirSync(src, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
  } catch {
    return result
  }

  const markerPath = path.join(targetRoot, MARKER_NAME)
  const marker = readMarker(markerPath)
  const nextSkills = { ...marker.skills }

  for (const name of names) {
    const from = path.join(src, name)
    const to = path.join(targetRoot, name)
    try {
      const hash = hashDir(from)
      if (!fs.existsSync(to)) {
        copyInto(from, to)
        result.copied.push(name)
      } else if (marker.skills[name] !== hash) {
        copyInto(from, to)
        result.updated.push(name)
      } else {
        result.unchanged.push(name)
        continue
      }
      nextSkills[name] = hash
    } catch (err) {
      // 失败的技能保留旧哈希，下次启动再试。
      result.failed.push(name)
      emit(`[seedSkills] ${name} 播种失败（不影响启动）: ${err.message}`)
    }
  }

  writeMarker(markerPath, { version: version || '', skills: nextSkills }, emit)

  if (result.copied.length || result.updated.length || result.failed.length) {
    emit(
      `[seedSkills] copied=${result.copied.length} updated=${result.updated.length}` +
        ` unchanged=${result.unchanged.length} failed=${result.failed.length}`,
    )
  }

  return result
}

module.exports = { seedSkills }
