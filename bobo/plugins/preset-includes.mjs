/**
 * preset-includes —— 把 `<DSH_HOME>/.agent-presets/<id>/decl.yml` 挂进根组合。
 *
 * 0.2.0 的 `agent-preset-registry` 没有 roots 概念、不扫任何目录（只认声明行），
 * 所以市场装进用户根的预设必须由本插件扫出来、经 `cordis:include` 挂载。
 * 这一层就是「模式预设」tab 装出来的东西能进 roster 的唯一通道，移植自
 * BoBo-Handyman 的 `dsh/packages/bobo/presets/include.mjs`。
 *
 * 两条实测过的坑（照搬参考项目的结论，别再试一遍）：
 *   1. 声明行不能直接写在 cordis.patch.yml 的 insert 列表里 —— registry 记的是
 *      声明行所在树的 baseUrl，写在根 include 里就变成 profile 目录，预设内的
 *      相对装配行（`../../plugins/*.mjs`）全部解析错位。Include 文件会把自己的
 *      目录设为子树 baseUrl，语义与旧的目录扫描一致。
 *   2. 同一个 `apply()` 里连挂多个 Include 会塌缩 —— loader 里一个 entry 只挂得住
 *      一个子分组，后挂的覆盖先挂的，且没有任何失败日志。所以多个声明一律写进
 *      一个合成组合文件，每行各自成 entry。
 *
 * 装完预设需要重启才会出现在 roster 里 —— 本插件只在宿主启动时执行一次。
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const name = 'preset-includes'

export const inject = ['loader']

/** 与 dsh 的 `PRESET_ID` 同形，兼作路径穿越防线。 */
const PRESET_ID_RE = /^[a-z0-9][a-z0-9-]*$/

/** 合成组合文件名，落在 `<DSH_HOME>/cache/` 下（每次启动重写，无需版本化）。 */
const SYNTHETIC_FILE_NAME = 'preset-includes.yml'

function dshHome(env = process.env) {
  return env.DSH_HOME !== undefined && env.DSH_HOME !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
}

/**
 * 把配置里的路径变成声明文件的绝对 file URL。
 * Windows 的 `E:\...` 不是合法 URL，绝对路径必须走 `pathToFileURL`。
 */
function toFileUrl(value) {
  if (value.startsWith('file://')) return value
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return pathToFileURL(value).href
  return new URL(value, import.meta.url).href
}

/** 扫 `<root>/<id>/decl.yml`，按 `<root>/<id>` 排序返回绝对路径。 */
function scanDeclarationRoots(roots) {
  const found = []
  for (const root of roots) {
    if (typeof root !== 'string' || root === '' || !existsSync(root)) continue
    let entries
    try {
      entries = readdirSync(root)
    }
    catch {
      continue
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || !PRESET_ID_RE.test(entry)) continue
      const decl = join(root, entry, 'decl.yml')
      if (existsSync(decl)) found.push(decl)
    }
  }
  return found.sort()
}

/** 写合成组合文件：每个声明一条 `cordis:include` 行（见文件头坑 2）。 */
function writeSyntheticIncludes(declarations, home) {
  const dir = join(home, 'cache')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, SYNTHETIC_FILE_NAME)
  const rows = declarations.map((decl, index) => [
    `- id: preset-include-${index}`,
    "  name: 'cordis:include'",
    '  config:',
    `    path: '${toFileUrl(decl)}'`,
  ].join('\n'))
  writeFileSync(file, `${rows.join('\n')}\n`, 'utf8')
  return file
}

export function apply(ctx, config) {
  const configured = config?.roots
  const roots = Array.isArray(configured) && configured.length > 0
    ? configured
    : [join(dshHome(), '.agent-presets')]
  const declarations = scanDeclarationRoots(roots)
  if (declarations.length === 0) return
  const home = dshHome()
  const target = declarations.length === 1
    ? toFileUrl(declarations[0])
    : pathToFileURL(writeSyntheticIncludes(declarations, home)).href
  ctx.plugin(ctx.loader.builtins.include, { path: target })
}
