import type { VariantProps } from 'dsh-tauri/client'
// 引用源 本仓自建（组合官方状态色 token；无上游对应）· 版本 不适用 · hash 不适用
import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import { tv } from 'dsh-tauri/client'

export interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** 状态配色；省略时用中性底色（`border-l2` + `bg-layer-3`）。 */
  kind?: NoticeKind
  children?: ReactNode
}

const notice = tv({
  base: 'flex items-start gap-[8px] border border-border-l2 rounded-[8px] px-[12px] py-[10px] bg-layer-3 text-[13px] leading-[20px]',
  variants: {
    kind: {
      ok: 'border-success/35 bg-success/8',
      error: 'border-error/35 bg-error/8',
      info: 'border-business/35 bg-business/8',
    },
  },
})

export type NoticeKind = NonNullable<VariantProps<typeof notice>['kind']>

/** 状态提示条：成功 / 失败 / 信息三档着色，默认 `role="status"`（可用 props 覆盖）。 */
export function Notice({ kind, className, children, ...rest }: NoticeProps): ReactElement {
  return <div className={notice({ kind, className })} role="status" {...rest}>{children}</div>
}
