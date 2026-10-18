// 引用源 本仓自建（组合官方标签排版；无上游对应）· 版本 不适用 · hash 不适用
import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import { cn } from 'dsh-tauri/client'

export interface FieldProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** 字段名，渲染为第一个 `<span>`（由样式表染成弱化色）。 */
  label: ReactNode
  /** 控件不是可关联表单控件时（如菜单触发器、分组）用 `div`，避免 `<label>` 包住按钮。 */
  as?: 'label' | 'div'
  children?: ReactNode
}

/** 表单字段：字段名 + 控件的纵向堆叠，控件由隐式 `<label>` 关联。 */
export function Field({ label, as = 'label', className, children, ...rest }: FieldProps): ReactElement {
  const Tag = as
  return (
    <Tag className={cn('flex flex-col gap-[4px] text-[12px] leading-[18px] text-secondary [&>span:first-child]:text-tertiary', className)} {...rest}>
      <span>{label}</span>
      {children}
    </Tag>
  )
}
