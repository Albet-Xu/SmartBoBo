import type { VariantProps } from 'dsh-tauri/client'
// 引用源 本仓自建（官方语义色 token；无上游对应）· 版本 不适用 · hash 不适用
import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import { tv } from 'dsh-tauri/client'

export interface TextProps extends Omit<HTMLAttributes<HTMLParagraphElement>, 'children'> {
  tone?: TextTone
  size?: TextSize
  children?: ReactNode
}

const text = tv({
  base: 'm-0',
  variants: {
    size: {
      xs: 'text-[12px] leading-[18px]',
      sm: 'text-[13px] leading-[20px]',
    },
    tone: {
      primary: 'text-primary',
      secondary: 'text-secondary',
      tertiary: 'text-tertiary',
      dimmed: 'text-dimmed',
      error: 'text-error',
      success: 'text-success',
    },
  },
  defaultVariants: { size: 'xs', tone: 'secondary' },
})

export type TextTone = NonNullable<VariantProps<typeof text>['tone']>

export type TextSize = NonNullable<VariantProps<typeof text>['size']>

/** 行内说明文字（固定渲染 `<p>`，自带 `m-0`）：错误行、灰字提示、次要说明统一走这里。 */
export function Text({ tone, size, className, children, ...rest }: TextProps): ReactElement {
  return <p className={text({ tone, size, className })} {...rest}>{children}</p>
}
