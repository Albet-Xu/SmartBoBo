/**
 * 插件包（`packages/*`）专用的 Tailwind 配置：**独立配置**，不引用根 `tailwind.config.js`。
 *
 * 为什么不复用根配置：根配置注册的是桌面壳自己的变量（`--color-*`，见 `src/styles/main.css`），
 * 插件挂进的是 DSH 控制台，那里没有这些变量——插件写 `bg-panel` 只会得到一条静默回退的工具类；
 * 而插件真正能用的官方 `--dsw-*` token 又没在根配置里。两套 token 体系不同，共用主题只会互相污染。
 *
 * 主题真值在 `packages/dsh-tauri-ui/src/client/constants/theme.ts`（`styles`）：这里同名登记，插件侧
 * 写 `text-secondary` / `bg-layer-3` / `border-border-l2` 就等于写 `var(--dsw-alias-label-secondary)`，
 * 具体色值仍由官方主题变量在运行时决定（深浅色随之切换）。构建期 JS 与运行期 TS 无法互引，
 * 改 theme.ts 时必须同步本文件。
 *
 * 键名一律 **kebab-case**：Tailwind v4 不为含大写的主题键生成工具类（`borderL2` 会静默无产出），
 * 所以 theme.ts 的 `borderL2` / `hoverDanger` / `focusRing` 在这里写作 `border-l2` / `hover-danger` /
 * `focus-ring`。
 *
 * content 必须显式收窄：Tailwind 的自动内容探测会从 CSS 所在目录一路扫到仓库根，而 `@config`
 * 的 content 只是**追加**在探测结果之上、覆盖不掉它。两者都会把桌面壳 `src/**` 的工具类带进插件
 * 产物——产物随壳 UI 改动而变，插件作者也会误用只在那份产物里存在的类。因此 index.css 用
 * `source(none)` 关掉自动探测，源清单完全由下面的 content 决定（`source(none)` 之后连显式
 * `@source` 都会失效，content 是唯一口径）。
 */
/** @type {import("tailwindcss").Config} */
export default {
  darkMode: 'class',
  content: [
    './packages/*/src/**/*.{js,ts,jsx,tsx}',
    // 生成物自身不能参与扫描：产物里的类名会被再次当成候选，第一次与第二次生成结果不一致
    // （不收敛），提交的 taiwindcss.ts 也就无法稳定复现。
    '!./packages/dsh-tauri-ui/src/client/styles/index.ts',
  ],
  theme: {
    extend: {
      // theme.ts `styles` 的颜色 token（键名 kebab 化，见顶部说明）。
      colors: {
        'primary': 'var(--dsw-alias-label-primary)',
        'secondary': 'var(--dsw-alias-label-secondary)',
        'tertiary': 'var(--dsw-alias-label-tertiary)',
        'dimmed': 'var(--dsw-alias-label-dimmed)',
        'border-l2': 'var(--dsw-alias-border-l2)',
        'border-l3': 'var(--dsw-alias-border-l3)',
        'border-l4': 'var(--dsw-alias-border-l4)',
        'border-weak': 'var(--dsw-alias-border-weak, rgba(127, 127, 127, 0.2))',
        'brand': 'var(--dsw-alias-brand-primary)',
        'business': 'var(--dsw-alias-state-business-primary)',
        'layer-1': 'var(--dsw-alias-bg-layer-1)',
        'layer-3': 'var(--dsw-alias-bg-layer-3)',
        'module-platform': 'var(--dsw-alias-bg-module-platform)',
        'hover': 'var(--dsw-alias-interactive-bg-hover)',
        'active': 'var(--dsw-alias-interactive-bg-active)',
        'hover-solid': 'var(--dsw-alias-interactive-bg-hover-solid)',
        'hover-danger': 'var(--dsw-alias-interactive-bg-hover-danger)',
        'error': 'var(--dsw-alias-state-error-primary)',
        'success': 'var(--dsw-alias-state-success-primary)',
        'warn': 'var(--dsw-alias-state-warn-primary)',
        'idle': 'var(--dsw-alias-state-idle-primary)',
        'primary-fill': 'var(--dsw-alias-button-primary-fill)',
        'primary-hover': 'var(--dsw-alias-button-primary-hover)',
        'primary-fg': 'var(--dsw-alias-label-primary-foreground)',
      },
      // `font-sans` 取官方正文字体变量（theme.ts `font`）；`font-mono` 取官方等宽变量，
      // 与插件 cssr 里手写的 `var(--ds-font-family-code)` 同源。
      fontFamily: {
        sans: ['var(--dsw-font-family)'],
        mono: ['var(--ds-font-family-code)'],
      },
      // 尺寸刻度：官方圆角变量（theme.ts `focusRing` 用的也是官方 focus-ring 变量族）。
      borderRadius: {
        xs: 'var(--dsw-radius-xs)',
        sm: 'var(--dsw-radius-sm)',
        md: 'var(--dsw-radius-md)',
        lg: 'var(--dsw-radius-lg)',
        xl: 'var(--dsw-radius-xl)',
      },
      // theme.ts `focusRing.boxShadow`：登记后写 `shadow-focus-ring`。
      boxShadow: {
        'focus-ring': '0 0 0 2px var(--dsw-alias-border-l3)',
      },
    },
  },
}
