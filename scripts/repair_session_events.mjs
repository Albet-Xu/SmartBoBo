#!/usr/bin/env node
/**
 * 会话日志静默修复：把"读取必然失败"的历史会话救回来。
 *
 * 背景：dsh 的读取侧对不认识的会话事件类型是"整份拒绝"（不是跳过），
 * 除非该事件带 `ignorable: true`（见 dsh-session 的 storage-contract）。
 * 而插件写自定义事件时没法带这个标记 —— 只要某个会话里出现过这种事件，
 * 这份会话就永久打不开（界面显示"历史加载失败 / 未知事件类型"）。
 *
 * 本脚本只做一件事：给这类未知事件补上 `"ignorable": true`，
 * 不删除事件、不改 seq、不动其余字节，并在改写前整体备份。
 *
 * 为什么是 Node 而不是 Python：会话文件是 zstd 多帧容器，
 * Python 3.13 标准库没有 zstd，而打包的 Node 24 自带 zlib.zstd*。
 *
 * 用法：
 *   node repair_session_events.mjs --sessions <sessionsDir> \
 *        [--known <known-event-types.js>] [--backup <dir>] [--dry-run]
 *
 * 输出（每行一条，供启动器转写日志）：
 *   scanned=N repaired=M skipped=K failed=F
 *   repaired: <file> unknown=<n> bytes=<a>→<b>
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'

const ZSTD_MAGIC = 0xfd2fb528

/** 极简参数解析：只认 `--key value` 与 `--flag`。 */
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next
      i += 1
    } else {
      out[key] = true
    }
  }
  return out
}

/**
 * 定位 zstd 容器里的完整帧边界（末帧被截断时返回 tornStart）。
 * 与 dsh-session-persistence-jsonl 的 scanZstdFrames 同构。
 */
function scanFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) throw new Error(`reserved frame-header bit at ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (offset > buffer.length) return { frames, tornStart: start }
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) throw new Error(`reserved block type at ${offset - 3}`)
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/** 逐帧解压并把明文拼起来；遇到坏帧直接抛错（宁可不修也不写坏）。 */
function decodeContainer(buffer) {
  const { frames, tornStart } = scanFrames(buffer)
  const parts = []
  for (const frame of frames) {
    const slice = buffer.subarray(frame.start, frame.end)
    parts.push(zlib.zstdDecompressSync(slice))
  }
  return { text: Buffer.concat(parts).toString('utf8'), frames: frames.length, tornStart }
}

/** 一次性读取已知事件类型集合（从内核自身的构建产物导入，避免两处漂移）。 */
async function loadKnownTypes(file) {
  if (!file) return undefined
  const mod = await import(pathToFileURL(path.resolve(file)).href)
  const set = mod.KNOWN_SESSION_EVENT_TYPES
  if (!(set instanceof Set)) {
    throw new Error(`KNOWN_SESSION_EVENT_TYPES missing in ${file}`)
  }
  return set
}

/**
 * 给一行事件补 ignorable（需要时）。
 * @returns {null | string} null = 不需要改；string = 改写后的行
 */
function patchLine(line, known, stats) {
  if (line.trim() === '') return null
  let event
  try {
    event = JSON.parse(line)
  } catch {
    stats.badline += 1
    return null
  }
  const type = event && event.type
  if (typeof type !== 'string') {
    stats.badline += 1
    return null
  }
  // 第一行是会话头（{type:"session",version,id,...}），不是事件：
  // 它没有 seq，也绝不能加 ignorable —— 动了就等于改会话身份。
  if (type === 'session' || typeof event.seq !== 'number') return null
  if (known.has(type) || event.ignorable === true) return null
  stats.unknown += 1
  event.ignorable = true
  return JSON.stringify(event)
}

function collectTargets(root, skipRoots = []) {
  const skip = new Set(skipRoots.map((p) => path.resolve(p)))
  const out = []
  const walk = (dir) => {
    if (skip.has(path.resolve(dir))) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '.repair-backup') continue
        walk(full)
      } else if (entry.isFile() && /\.jsonl(\.zstd)?$/.test(entry.name)) out.push(full)
    }
  }
  walk(root)
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const sessions = args.sessions
  if (!sessions || typeof sessions !== 'string') {
    console.error('usage: repair_session_events.mjs --sessions <dir> [--known <file>] [--backup <dir>] [--dry-run]')
    return 2
  }
  if (!fs.existsSync(sessions)) {
    console.log('scanned=0 repaired=0 skipped=0 failed=0 (no sessions dir)')
    return 0
  }
  const known = await loadKnownTypes(typeof args.known === 'string' ? args.known : undefined)
  if (!known) {
    console.log('scanned=0 repaired=0 skipped=0 failed=0 (known types unavailable)')
    return 0
  }
  const dryRun = args['dry-run'] === true
  // 备份默认放在 sessions 的**同级**目录：放进 sessions 里会被自己的扫描
  // 再扫一遍（把备份也"修"一遍），既浪费又污染备份。
  const backupRoot = typeof args.backup === 'string'
    ? args.backup
    : path.join(path.dirname(path.resolve(sessions)), 'session-repair-backup')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')

  const stats = { scanned: 0, repaired: 0, skipped: 0, failed: 0 }
  for (const file of collectTargets(sessions, [backupRoot])) {
    stats.scanned += 1
    try {
      const raw = fs.readFileSync(file)
      const compressed = file.endsWith('.zstd')
      const decoded = compressed ? decodeContainer(raw) : { text: raw.toString('utf8'), frames: 0 }
      const lines = decoded.text.split('\n')
      const perFile = { unknown: 0, badline: 0 }
      let touched = false
      for (let i = 0; i < lines.length; i += 1) {
        const next = patchLine(lines[i], known, perFile)
        if (next !== null) {
          lines[i] = next
          touched = true
        }
      }
      if (!touched) {
        stats.skipped += 1
        continue
      }
      if (perFile.badline > 0) {
        // 有解析不了的行：保守起见不修，交给人工判断
        stats.failed += 1
        console.log(`failed: ${file} badline=${perFile.badline}`)
        continue
      }
      // 末尾 split 会多出一个空串：只有原文以 '\n' 结尾时才保留
      const trailingNewline = decoded.text.endsWith('\n')
      if (!trailingNewline && lines[lines.length - 1] === '') lines.pop()
      const body = lines.join('\n') + (trailingNewline ? '\n' : '')
      const payload = compressed
        ? zlib.zstdCompressSync(Buffer.from(body, 'utf8'), {
          params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 },
        })
        : Buffer.from(body, 'utf8')
      if (dryRun) {
        stats.repaired += 1
        console.log(`would-repair: ${file} unknown=${perFile.unknown}`)
        continue
      }
      const backupDir = path.join(backupRoot, stamp)
      const backupPath = path.join(backupDir, path.relative(sessions, file))
      fs.mkdirSync(path.dirname(backupPath), { recursive: true })
      fs.copyFileSync(file, backupPath)
      const tmp = `${file}.repair-tmp`
      fs.writeFileSync(tmp, payload)
      fs.renameSync(tmp, file)
      stats.repaired += 1
      console.log(
        `repaired: ${file} unknown=${perFile.unknown} bytes=${raw.length}→${payload.length}` +
        (decoded.tornStart !== undefined ? ' (torn tail dropped)' : ''),
      )
    } catch (error) {
      stats.failed += 1
      console.log(`failed: ${file} ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  console.log(
    `scanned=${stats.scanned} repaired=${stats.repaired} ` +
    `skipped=${stats.skipped} failed=${stats.failed}`,
  )
  return stats.failed > 0 ? 1 : 0
}

main().then(
  (code) => { process.exitCode = code },
  (error) => {
    console.error(`repair_session_events: ${error instanceof Error ? error.stack : String(error)}`)
    process.exitCode = 1
  },
)
