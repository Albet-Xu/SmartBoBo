#!/usr/bin/env node
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'

const MANIFEST_MAX_BYTES = 64 * 1024
const SPRITESHEET_MAX_BYTES = 8 * 1024 * 1024
const SPRITESHEET_MAX_DIMENSION = 16384
const SPRITESHEET_MAX_PIXELS = 64 * 1024 * 1024
const COLUMNS = 8
const V1_ROWS = 9
const V2_ROWS = 11
const ID_PATTERN = /^[\w-]{1,64}$/

const problems = []
const notes = []

function fail(message) {
  problems.push(message)
}

function checkId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id) || /[^\w-]/.test(id)) {
    fail('PET_ID_INVALID: id must be 1..=64 ascii letters/digits/-/_')
    return false
  }
  return true
}

function portableRelative(value) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('PET_PATH_INVALID: spritesheetPath must be a non-empty string')
    return undefined
  }
  if (value.includes('\0') || value.includes('\\') || value.includes(':')) {
    fail('PET_PATH_INVALID: path must be a portable relative path')
    return undefined
  }
  const normalized = value.replaceAll('/', sep)
  if (isAbsolute(normalized)) {
    fail('PET_PATH_INVALID: path must not be absolute or contain traversal')
    return undefined
  }
  const parts = value.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    fail('PET_PATH_INVALID: path must not be absolute or contain traversal')
    return undefined
  }
  return normalized
}

function readBounded(path, limit, prefix) {
  let stats
  try {
    stats = statSync(path)
  }
  catch (error) {
    fail(`${prefix}: failed to read ${path}: ${error.message}`)
    return undefined
  }
  if (!stats.isFile()) {
    fail(`${prefix}: ${path} is not a file`)
    return undefined
  }
  if (stats.size > limit) {
    fail(`${prefix}: ${path} exceeds the ${limit} byte limit`)
    return undefined
  }
  return readFileSync(path)
}

function grid(declared, width, height) {
  if (width % COLUMNS !== 0) {
    fail(`PET_ASSET_DIMENSIONS_INVALID: spritesheet width must be divisible by ${COLUMNS} columns`)
    return undefined
  }
  const v1 = height % V1_ROWS === 0
  const v2 = height % V2_ROWS === 0
  let version
  if (!v1 && !v2) {
    fail(`PET_ASSET_DIMENSIONS_INVALID: spritesheet height must be divisible by ${V1_ROWS} (v1) or ${V2_ROWS} (v2) rows`)
    return undefined
  }
  else if (v1 && !v2) {
    version = 1
  }
  else if (!v1 && v2) {
    version = 2
  }
  else {
    version = declared ?? 2
  }
  if (declared !== undefined && declared !== version) {
    notes.push(`pet.json declares spriteVersionNumber ${declared} but the atlas resolves to v${version}; the host trusts the atlas and derives v${version}`)
  }
  return { version, columns: COLUMNS, rows: version === 1 ? V1_ROWS : V2_ROWS }
}

function dimensions(bytes, declared) {
  let mime
  let width
  let height
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
    if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') {
      fail('PET_ASSET_FORMAT_INVALID: PNG is missing IHDR')
      return undefined
    }
    mime = 'image/png'
    width = bytes.readUInt32BE(16)
    height = bytes.readUInt32BE(20)
  }
  else if (bytes.length >= 30 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    const chunk = bytes.subarray(12, 16).toString('latin1')
    if (chunk === 'VP8X' && bytes.length >= 30) {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
    }
    else if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2F) {
      width = 1 + bytes[21] + ((bytes[22] & 0x3F) << 8)
      height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0F) << 10)
    }
    else if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9D && bytes[24] === 0x01 && bytes[25] === 0x2A) {
      width = bytes.readUInt16LE(26) & 0x3FFF
      height = bytes.readUInt16LE(28) & 0x3FFF
    }
    else {
      fail('PET_ASSET_FORMAT_INVALID: unsupported or malformed WebP header')
      return undefined
    }
    mime = 'image/webp'
  }
  else {
    fail('PET_ASSET_FORMAT_INVALID: spritesheet must be PNG or WebP')
    return undefined
  }
  if (width === 0 || height === 0 || width > SPRITESHEET_MAX_DIMENSION || height > SPRITESHEET_MAX_DIMENSION || width * height > SPRITESHEET_MAX_PIXELS) {
    fail(`PET_ASSET_DIMENSIONS_INVALID: spritesheet dimensions exceed ${SPRITESHEET_MAX_DIMENSION}px or ${SPRITESHEET_MAX_PIXELS} pixels`)
    return undefined
  }
  const resolved = grid(declared, width, height)
  return resolved === undefined ? undefined : { mime, width, height, grid: resolved }
}

function main() {
  const target = process.argv[2]
  if (target === undefined || target.length === 0) {
    console.error('usage: node validate-pet.mjs <pet directory>')
    process.exitCode = 2
    return
  }
  const directory = resolve(target)
  let stats
  try {
    stats = statSync(directory)
  }
  catch (error) {
    console.error(`PET_DIRECTORY_MISSING: ${directory}: ${error.message}`)
    process.exitCode = 1
    return
  }
  if (!stats.isDirectory()) {
    console.error(`PET_DIRECTORY_MISSING: ${directory} is not a directory`)
    process.exitCode = 1
    return
  }
  if (basename(resolve(directory, '..')) !== 'pets') {
    notes.push(`${directory} is not a direct child of a "pets" directory; the host enumerates only <DSH_HOME>/pets/*`)
  }

  const manifestBytes = readBounded(join(directory, 'pet.json'), MANIFEST_MAX_BYTES, 'PET_MANIFEST_READ_FAILED')
  if (manifestBytes === undefined) {
    report()
    return
  }
  let manifest
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'))
  }
  catch (error) {
    fail(`PET_MANIFEST_INVALID: invalid pet.json: ${error.message}`)
    report()
    return
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('PET_MANIFEST_INVALID: pet.json must be a JSON object')
    report()
    return
  }

  checkId(manifest.id)

  let declared
  if (manifest.spriteVersionNumber !== undefined && manifest.spriteVersionNumber !== null) {
    declared = manifest.spriteVersionNumber
    if (declared !== 1 && declared !== 2) {
      fail('PET_SPRITE_VERSION_UNSUPPORTED: spriteVersionNumber must be 1 or 2')
      declared = undefined
    }
  }

  if (manifest.spritesheetPath === undefined) {
    fail('PET_MANIFEST_INVALID: pet.json is missing spritesheetPath')
    report()
    return
  }
  const relativePath = portableRelative(manifest.spritesheetPath)
  if (relativePath === undefined) {
    report()
    return
  }

  let root
  try {
    root = realpathSync(directory)
  }
  catch (error) {
    fail(`PET_ASSET_READ_FAILED: failed to resolve ${directory}: ${error.message}`)
    report()
    return
  }

  let assetPath
  try {
    assetPath = realpathSync(resolve(directory, relativePath))
  }
  catch (error) {
    fail(`PET_ASSET_READ_FAILED: failed to resolve asset: ${error.message}`)
    report()
    return
  }
  if (!assetPath.startsWith(root + sep)) {
    fail('PET_PATH_INVALID: spritesheetPath escapes the pet directory')
    report()
    return
  }

  const assetBytes = readBounded(assetPath, SPRITESHEET_MAX_BYTES, 'PET_ASSET_READ_FAILED')
  if (assetBytes === undefined) {
    report()
    return
  }

  const resolved = dimensions(assetBytes, declared)
  notes.push(`id resolves to chat:${manifest.id}`)
  if (resolved !== undefined) {
    notes.push(`atlas ${resolved.mime} ${resolved.width}x${resolved.height} -> v${resolved.grid.version} ${resolved.grid.columns}x${resolved.grid.rows} (${resolved.width / resolved.grid.columns}x${resolved.height / resolved.grid.rows} per cell)`)
    notes.push(`expected atlas size for v${resolved.grid.version}: ${resolved.grid.columns * 192}x${resolved.grid.rows * 208}`)
  }
  report()
}

function report() {
  for (const note of notes) {
    console.log(`note: ${note}`)
  }
  if (problems.length === 0) {
    console.log('ok: pet satisfies the host contract')
    process.exitCode = 0
    return
  }
  for (const problem of problems) {
    console.error(problem)
  }
  console.error(`failed: ${problems.length} contract violation(s)`)
  process.exitCode = 1
}

main()
