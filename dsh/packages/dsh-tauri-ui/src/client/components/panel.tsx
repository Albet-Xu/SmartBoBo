import type { ReactElement, ReactNode } from 'react'

/**
 * 面板页容器：复刻官方插件页（`@deepseek-ai/dsh-client-ui-plugin-manager` 的
 * `PluginManagerPage`）的页根几何，使第三方插件面板与官方左侧栏「插件」入口
 * 在左右留白、内容列宽与滚动行为上完全一致。
 *
 * 页根自持 `height:100%` + `overflow:auto`（`main` 槽宿主锚点是 `display:contents`，
 * 中心列不滚动），居中与间距由 `align-items:center` + `gap` 承担；面板自身根节点
 * 作为直接子项被 `>*` 规则夹到 960px。
 */
export function Panel({ children }: { children: ReactNode }): ReactElement {
  return <div className="box-border flex flex-col items-center gap-8 h-full px-[clamp(24px,4vw,48px)] pt-[28px] pb-[48px] overflow-auto text-[var(--dsw-alias-label-primary)] [&>*]:w-full [&>*]:max-w-[960px]">{children}</div>
}
