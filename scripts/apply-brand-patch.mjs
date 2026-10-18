#!/usr/bin/env node
/**
 * 对打包内核应用 SmartBoBo 品牌补丁（与 src-tauri/src/service/patch/brand.rs 同源逻辑）。
 * 幂等：锚点缺失或已打过都安全跳过。桌面端启动时 Rust 会再打一次，互不冲突。
 *
 * 用法：node scripts/apply-brand-patch.mjs [内核根目录]
 * 默认内核根：%APPDATA%\dsh-tauri\dependencies\dsh
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HEADLINE_ZH_ORIGINAL = '"hero.headline": "探索未至之境"'
const HEADLINE_ZH_PATCHED = '"hero.headline": "万物皆可得"'
const HEADLINE_EN_ORIGINAL = '"hero.headline": "Into the Unknown"'
const HEADLINE_EN_PATCHED = '"hero.headline": "Everything is obtainable"'
const PREVIEW_BADGE_RENDER = 'children: t("hero.preview")'
const PREVIEW_BADGE_ORIGINAL = '[(0, react_jsx_runtime.jsx)("span", { children: t("hero.headline") }), (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\t\tclassName: HeroShell_module_css_default.previewBadge,\n\t\t\t\t\t\t\t\tchildren: t("hero.preview")\n\t\t\t\t\t\t\t})]'
const PREVIEW_BADGE_PATCHED = '(0, react_jsx_runtime.jsx)("span", { children: t("hero.headline") })'
const BOOT_ORIGINAL = 'wordmark,"HARNESS")'
const BOOT_PATCHED = 'wordmark,"AGENT")'
const FAVICON_MARKER = '<!-- smartbobo-pineapple -->'
const WHALE_ANCHOR = 'M48.8354 10.0479C48.3232'
const TITLE_ORIGINAL = '<title>DeepSeek Harness</title>'
const TITLE_PATCHED = '<title>SmartBoBo</title>'
const MANIFEST_NAME_ORIGINAL = '"name": "DeepSeek Harness"'
const MANIFEST_NAME_PATCHED = '"name": "SmartBoBo"'
const MANIFEST_SHORT_ORIGINAL = '"short_name": "DSH"'
const MANIFEST_SHORT_PATCHED = '"short_name": "BoBo"'

const PINEAPPLE_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" width="50.000000" height="50.000000" viewBox="0 0 50 50" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
  <!-- smartbobo-pineapple -->
  <style>
    @media (prefers-color-scheme: dark) {
      svg { stroke: #fff; }
    }
  </style>
  <path d="M25 22 Q24 12 22 5 Q21.5 1 20 3" stroke-width="2.8" />
  <path d="M25 22 Q27 10 31 4 Q33 1 31 4" stroke-width="2.8" />
  <path d="M25 22 Q18 15 11 9 Q9 7 10 10" stroke-width="2.5" />
  <path d="M25 22 Q32 15 39 9 Q41 7 40 10" stroke-width="2.5" />
  <path d="M25 22 Q17 17 9 13" stroke-width="2.2" />
  <path d="M25 22 Q33 17 41 13" stroke-width="2.2" />
  <path d="M25 24 Q8 24 7.5 37 Q7.2 44 17 48 Q22.5 50 25 50 Q27.5 50 33 48 Q42.8 44 42.5 37 Q42 24 25 24 Z" stroke-width="3.5" fill="none" />
  <path d="M17.5 29 L12.5 49" stroke-width="1.2" fill="none" />
  <path d="M25 27 L25 50" stroke-width="1.2" fill="none" />
  <path d="M32.5 29 L37.5 49" stroke-width="1.2" fill="none" />
  <path d="M8 32 L42 32" stroke-width="1.2" fill="none" />
  <path d="M7.5 39 L42.5 39" stroke-width="1.2" fill="none" />
  <path d="M8.5 46 L41.5 46" stroke-width="1.2" fill="none" />
</svg>
`

// 内核打包 JS 里纯产品义文案的策展替换表（与 brand.rs 的 KERNEL_COPY 同源）。
// 只收「主语是产品名」的 UI 串；登录/账号/模型供应商语境不进表。
const KERNEL_COPY = [
  ['node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js', [
    ['productTitle = "DeepSeek Harness"', 'productTitle = "SmartBoBo Agent"'],
  ]],
  ['node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js', [
    ['可能损坏 DeepSeek Harness，或读取和泄露你的数据', '可能损坏 SmartBoBo Agent，或读取和泄露你的数据'],
    ['can damage DeepSeek Harness or leak your data', 'can damage SmartBoBo Agent or leak your data'],
  ]],
  ['node_modules/@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js', [
    ['请在运行 DeepSeek Harness 的主机上', '请在运行 SmartBoBo Agent 的主机上'],
    ['on the computer running DeepSeek Harness', 'on the computer running SmartBoBo Agent'],
  ]],
  ['node_modules/@deepseek-ai/dsh-client-ui-settings-account/lib/client.js', [
    ['onboardingBrand: "DeepSeek Harness"', 'onboardingBrand: "SmartBoBo Agent"'],
    ['返回 DeepSeek Harness', '返回 SmartBoBo Agent'],
    ['Back to DeepSeek Harness', 'Back to SmartBoBo Agent'],
    ['不会影响 DeepSeek Harness 的工作能力', '不会影响 SmartBoBo Agent 的工作能力'],
    ['not what DeepSeek Harness can do', 'not what SmartBoBo Agent can do'],
    ['DeepSeek Harness works in a local folder', 'SmartBoBo Agent works in a local folder'],
    ['DeepSeek Harness 会以本地文件夹作为工作区', 'SmartBoBo Agent 会以本地文件夹作为工作区'],
  ]],
  // v0.5.12：模型选择器空态引导。方案 A 禁用内置 deepseek 路由后全新安装
  // 的选择器为空，把「没有可用的模型」升级为去设置添加提供商的指引。
  ['node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js', [
    ['"empty.models": "没有可用的模型。"', '"empty.models": "未配置模型提供商：请在「设置 → 模型」点击「添加模型提供商」，配置后可用模型将显示在此处。"'],
    ['"empty.models": "No models available."', '"empty.models": "No model provider configured. Add one under Settings - Models; available models will appear here."'],
  ]],
]

// 设置导航图标：两个自建设置页（经验池 / 代理池）的导航字形。
// 章节注册（settings.section）只带 id/order/label，注册方给不了图标；字形只在
// ui-settings-general 的 navIcon(id) 里按 id 硬编码，未知 id 落兜底齿轮。槽位覆盖不到，
// 与参考项目 BoBo-Handyman 的 SettingsRoot.tsx 补丁同源（proxy-pool → IconApiOutlineMedium、
// experience-pool → IconSparkleMedium，均复用内核既有字形，不新增图标文件）。
const NAV_ICON_FALLBACK = '\t\t\treturn (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutlineMedium, {\n'
  + '\t\t\t\tclassName: SettingsRoot_module_css_default.navIcon,\n'
  + '\t\t\t\tsize: 16\n'
  + '\t\t\t});'
const NAV_ICON_BRANCHES = '\t\t\tif (id === "proxy-pool") return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconApiOutlineMedium, {\n'
  + '\t\t\t\tclassName: SettingsRoot_module_css_default.navIcon,\n'
  + '\t\t\t\tsize: 16\n'
  + '\t\t\t});\n'
  + '\t\t\tif (id === "experience-pool") return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSparkleMedium, {\n'
  + '\t\t\t\tclassName: SettingsRoot_module_css_default.navIcon,\n'
  + '\t\t\t\tsize: 16\n'
  + '\t\t\t});\n'

// ── 设置面板导航图标（经验池 / 代理池）—— dsh-tauri-ui 版本 ──────────────────
// 本项目实际渲染设置面板的是 dsh-tauri-ui 插件（Tailwind 实现，占用 shell.overlay），
// 不是内核的 ui-settings-general 外壳；它自带一张 section id → 图标的映射表，未知 id
// 一律落兜底齿轮（`fn[e.id] ?? I`）。要给两个自建 section 图标，只能往这张表里补条目。
// 字形与参考项目 BoBo-Handyman 的 SettingsRoot.tsx 补丁一致：
//   proxy-pool → IconApiOutlineMedium，experience-pool → IconSparkleMedium
// （沿用内核 ui-primitives 的原始 path 数据，视觉与参考项目相同。）
const MAP_ICON_API_PATHS = ['M3 4L7 8L3 12', 'M9 12H13']
const MAP_ICON_SPARKLE_PATHS = [
  'M5.875 3C5.875 6.33333 7.54167 8 10.875 8C7.54167 8 5.875 9.66667 5.875 13C5.875 9.66667 4.20833 8 0.875 8C4.20833 8 5.875 6.33333 5.875 3Z',
  'M12.375 1.55823C12.375 3.39156 13.2917 4.30823 15.125 4.30823C13.2917 4.30823 12.375 5.22489 12.375 7.05823C12.375 5.22489 11.4583 4.30823 9.625 4.30823C11.4583 4.30823 12.375 3.39156 12.375 1.55823Z',
  'M12.375 10.4418C12.375 11.7751 13.0417 12.4418 14.375 12.4418C13.0417 12.4418 12.375 13.1084 12.375 14.4418C12.375 13.1084 11.7083 12.4418 10.375 12.4418C11.7083 12.4418 12.375 11.7751 12.375 10.4418Z',
]
/** 生成该 bundle 风格的图标组件表达式（形如 `e=>_.createElement(...)`）。 */
// 注意：该 bundle 的模块体整体位于一个模板字符串内（内部反引号全部写成 \`），
// 因此插入的代码只能用双引号字符串，且不得出现 `${` —— 否则会截断外层模板串。
function mapIconExpr(paths) {
  const body = paths
    .map((d) => '_.createElement("path",{d:"' + d + '",stroke:"currentColor",fill:"none"})')
    .join(',')
  return 'e=>_.createElement("svg",Object.assign({xmlns:"http://www.w3.org/2000/svg",width:16,height:16,'
    + 'viewBox:"0 0 16 16",fill:"none","aria-hidden":"true"},e),' + body + ')'
}
const SETTINGS_NAV_MAP_ANCHOR = ',"better-sidebar":yt}'
const SETTINGS_NAV_MAP_PATCHED = ',"better-sidebar":yt,"proxy-pool":' + mapIconExpr(MAP_ICON_API_PATHS)
  + ',"experience-pool":' + mapIconExpr(MAP_ICON_SPARKLE_PATHS) + '}'

const root = process.argv[2]
  ?? join(process.env.APPDATA ?? '', 'dsh-tauri', 'dependencies', 'dsh')
if (!existsSync(root)) {
  console.error(`[brand-patch] 内核根不存在：${root}`)
  process.exit(1)
}

function patch(rel, transform) {
  const path = join(root, rel)
  if (!existsSync(path)) {
    console.log(`[brand-patch] skip (missing): ${rel}`)
    return
  }
  const source = readFileSync(path, 'utf8')
  const result = transform(source)
  if (result === null) {
    console.log(`[brand-patch] skip (already/anchor): ${rel}`)
    return
  }
  writeFileSync(path, result)
  console.log(`[brand-patch] patched: ${rel}`)
}

patch('node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', (s) => {
  const hasHeadline = s.includes(HEADLINE_ZH_ORIGINAL) || s.includes(HEADLINE_EN_ORIGINAL)
  const hasPreview = s.includes(PREVIEW_BADGE_ORIGINAL)
  if (!hasHeadline && !hasPreview) return null
  let out = s
  if (out.includes(HEADLINE_ZH_ORIGINAL)) out = out.replace(HEADLINE_ZH_ORIGINAL, HEADLINE_ZH_PATCHED)
  if (out.includes(HEADLINE_EN_ORIGINAL)) out = out.replace(HEADLINE_EN_ORIGINAL, HEADLINE_EN_PATCHED)
  if (out.includes(PREVIEW_BADGE_ORIGINAL)) out = out.replace(PREVIEW_BADGE_ORIGINAL, PREVIEW_BADGE_PATCHED)
  return out
})

const assetsDir = join(root, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
if (existsSync(assetsDir)) {
  for (const name of readdirSync(assetsDir)) {
    if (!name.startsWith('index-') || !name.endsWith('.js')) continue
    patch(`node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/${name}`, (s) => {
      if (s.includes(BOOT_PATCHED) || !s.includes(BOOT_ORIGINAL)) return null
      return s.replace(BOOT_ORIGINAL, BOOT_PATCHED)
    })
  }
}

for (const fav of ['favicon.svg', 'favicon-dark.svg']) {
  patch(`node_modules/@deepseek-ai/dsh-web-frontend/dist/${fav}`, (s) => {
    if (s.includes(FAVICON_MARKER) || !s.includes(WHALE_ANCHOR)) return null
    return PINEAPPLE_FAVICON
  })
}

patch('node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html', (s) => {
  if (!s.includes(TITLE_ORIGINAL)) return null
  return s.replace(TITLE_ORIGINAL, TITLE_PATCHED)
})

patch('node_modules/@deepseek-ai/dsh-web-frontend/dist/manifest.webmanifest', (s) => {
  if (!s.includes(MANIFEST_NAME_ORIGINAL) || !s.includes(MANIFEST_SHORT_ORIGINAL)) return null
  return s
    .replace(MANIFEST_NAME_ORIGINAL, MANIFEST_NAME_PATCHED)
    .replace(MANIFEST_SHORT_ORIGINAL, MANIFEST_SHORT_PATCHED)
})

for (const [rel, pairs] of KERNEL_COPY) {
  patch(rel, (s) => {
    const hasAny = pairs.some(([original]) => s.includes(original))
    if (!hasAny) return null
    let out = s
    for (const [original, next] of pairs) {
      if (out.includes(original)) out = out.replaceAll(original, next)
    }
    return out
  })
}

patch('node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js', (s) => {
  if (s.includes('id === "proxy-pool"') || s.includes('id === "experience-pool"')) return null
  if (!s.includes(NAV_ICON_FALLBACK)) return null
  return s.replace(NAV_ICON_FALLBACK, NAV_ICON_BRANCHES + NAV_ICON_FALLBACK)
})

// ── 设置面板导航图标（经验池 / 代理池）—— dsh-tauri-ui 版本 ──────────────────
// 该插件被 profile 以 link: 引用（来源通常是桌面端的 resources/node_modules），
// 因此按 profile 的 package.json 解析真实目录，不写死路径，换机/换目录都能命中。
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profilePkgPath = join(projectRoot, '.dsh', 'profiles', 'web', 'package.json')

/** 解析 profile 里 link: 的插件包目录（找不到返回空数组，逐个尝试）。 */
function resolveLinkedPackage(name) {
  const candidates = []
  if (existsSync(profilePkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(profilePkgPath, 'utf8'))
      const spec = pkg.dependencies?.[name]
      if (typeof spec === 'string' && spec.startsWith('link:')) {
        const target = spec.slice(5)
        candidates.push(resolve(profilePkgPath, '..', target), resolve(target))
      }
    } catch {
      // profile package.json 读坏时退回 node_modules 解析
    }
  }
  candidates.push(join(projectRoot, '.dsh', 'profiles', 'web', 'node_modules', name))
  candidates.push(join(root, 'node_modules', name))
  return candidates
}

// 定位并给 dsh-tauri-ui 的 section→图标映射表补上两个自建 section 的图标。
let navMapPatched = false
for (const dir of resolveLinkedPackage('dsh-tauri-ui')) {
  const target = join(dir, 'dist', 'client.cjs')
  if (!existsSync(target)) continue
  const source = readFileSync(target, 'utf8')
  if (source.includes('"proxy-pool":')) {
    console.log(`[brand-patch] skip (already): ${target}`)
    navMapPatched = true
    break
  }
  if (source.includes(SETTINGS_NAV_MAP_ANCHOR)) {
    writeFileSync(target, source.replace(SETTINGS_NAV_MAP_ANCHOR, SETTINGS_NAV_MAP_PATCHED))
    console.log(`[brand-patch] patched: ${target}`)
    navMapPatched = true
  } else {
    console.log(`[brand-patch] skip (anchor): ${target}`)
  }
  break
}
if (!navMapPatched) console.log('[brand-patch] skip (missing): dsh-tauri-ui/dist/client.cjs（设置面板导航图标未打）')

console.log('[brand-patch] done')
