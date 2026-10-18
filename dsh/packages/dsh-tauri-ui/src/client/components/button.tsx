// 引用源 @deepseek-ai/dsh-client-ui-primitives · packages/client/ui-primitives/src/Button.tsx ; @deepseek-ai/dsh-client-ui-sidebar · packages/client/ui-sidebar/src/client/SidebarRoot.module.css ; @deepseek-ai/dsh-client-ui-plugin-manager · packages/client/ui-plugin-manager/src/client/PluginManagerPage.module.css · 版本 0.1.7-rc.2（≥0.1.5-rc.1）· hash elevated=hHd-Xa_newSession add=X_2TxG_addButton addGhost=X_2TxG_addButton danger=X_2TxG_danger
import type { ButtonVariant as PrimitiveVariant } from '@deepseek-ai/dsh-client-ui-primitives'
import type { VariantProps } from 'dsh-tauri/client'
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'
import { Button as PrimitiveButton } from '@deepseek-ai/dsh-client-ui-primitives'
import { tv } from 'dsh-tauri/client'

// elevated / add / addGhost 是上游固定几何，size 对其无效；danger 沿用官方 outline 的 md / sm 两档。
const localVariants = {
  elevated: 'flex w-full shrink-0 gap-[6px] h-[38px] px-[16px] py-[8px] [font-family:inherit] text-[14px] font-medium leading-[22px] text-primary bg-[var(--dsw-alias-button-elevated-fill)] border-[0.5px] border-border-l3 rounded-md overflow-hidden hover:not-disabled:bg-[var(--dsw-alias-button-floating-hover)] disabled:opacity-50',
  add: 'inline-flex border-none gap-[4px] h-[32px] px-[12px] text-[13px] leading-[20px] bg-primary-fill text-primary-fg rounded-md hover:not-disabled:bg-primary-hover disabled:opacity-40',
  addGhost: 'inline-flex border-none gap-[4px] h-[32px] px-[12px] text-[13px] leading-[20px] bg-transparent text-primary rounded-md hover:not-disabled:bg-hover active:not-disabled:bg-active disabled:opacity-40',
  // 上游 `.danger` 是 token 重绑：本地覆盖 --dsw-alias-interactive-bg-hover，让 hover 洗色变红。
  danger: 'inline-flex gap-[4px] h-[36px] px-[14px] text-[14px] leading-[22px] text-error bg-transparent rounded-md border-[0.5px] border-[color-mix(in_srgb,var(--dsw-alias-state-error-primary)_30%,transparent)] [--dsw-alias-interactive-bg-hover:color-mix(in_srgb,var(--dsw-alias-state-error-primary)_8%,transparent)] hover:not-disabled:bg-hover disabled:opacity-40',
  // 正文里的链接式按钮（归档会话标题这类「点开看详情」）：无底色，hover 才出下划线。
  link: 'inline-flex border-none bg-transparent p-0 [font-family:inherit] text-[13px] leading-[22px] text-primary text-left max-w-full cursor-pointer hover:not-disabled:underline hover:not-disabled:underline-offset-2 hover:not-disabled:decoration-secondary disabled:opacity-50',
} as const

const localButton = tv({
  base: 'box-border items-center justify-center cursor-pointer disabled:cursor-not-allowed',
  variants: {
    variant: localVariants,
    size: { md: '', sm: '' },
  },
  compoundVariants: [
    { variant: 'danger', size: 'sm', class: 'h-[28px] px-[10px] text-[12px] leading-[18px] rounded-sm' },
  ],
})

type LocalVariant = NonNullable<VariantProps<typeof localButton>['variant']>

export type ButtonVariant = PrimitiveVariant | LocalVariant

export type ButtonSize = NonNullable<VariantProps<typeof localButton>['size']>

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  children?: ReactNode
}

function isLocalVariant(variant: ButtonVariant): variant is LocalVariant {
  return variant in localVariants
}

export function Button({ variant = 'ghost', size = 'md', icon, className, children, ...rest }: ButtonProps): ReactElement {
  if (isLocalVariant(variant)) {
    return (
      <button type="button" className={localButton({ variant, size, className })} {...rest}>
        {icon}
        {children}
      </button>
    )
  }
  return <PrimitiveButton variant={variant} size={size} icon={icon} className={className} {...rest}>{children}</PrimitiveButton>
}
