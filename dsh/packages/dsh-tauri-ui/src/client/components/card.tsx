import type { VariantProps } from 'dsh-tauri/client'
// 引用源 @deepseek-ai/dsh-client-ui-plugin-manager · lib/client.js 的插件页卡片族 · 版本 0.1.7-rc.2（≥0.1.5-rc.1）· hash cards=2TxG_cards card=2TxG_card cardHead=2TxG_cardHead cardIcon=2TxG_cardIcon cardMain=2TxG_cardMain titleRow=2TxG_titleRow cardTitle=2TxG_cardTitle cardDesc=2TxG_cardDesc cardEnd=2TxG_cardEnd cardLink=2TxG_cardLink
import type { ComponentProps, ReactElement } from 'react'
import { tv } from 'dsh-tauri/client'

const card = tv({
  slots: {
    list: 'flex flex-col gap-[2px] m-0 p-0 list-none',
    base: 'box-border min-w-0 mx-[-8px] rounded-xl',
    head: 'flex items-center gap-[14px] p-[8px]',
    icon: 'inline-flex items-center justify-center flex-none w-[48px] h-[48px] border-[0.5px] border-border-l3 rounded-lg text-secondary',
    content: 'flex flex-col flex-1 gap-[4px] min-w-0',
    titleRow: 'flex flex-wrap items-center gap-[8px] min-w-0',
    title: 'max-w-full overflow-hidden truncate text-[14px] font-medium leading-[20px]',
    description: 'text-tertiary text-[13px] leading-[18px] line-clamp-1 my-0',
    end: 'relative z-[1] inline-flex flex-none items-center gap-[8px]',
  },
  variants: {
    variant: {
      default: { base: 'border border-border-l2 bg-layer-3' },
      link: { base: 'relative hover:bg-hover' },
    },
  },
  defaultVariants: { variant: 'default' },
})

export type CardVariant = NonNullable<VariantProps<typeof card>['variant']>

function CardBase({ variant, className, children, ...rest }: ComponentProps<'li'> & { variant?: CardVariant }): ReactElement {
  return <li className={card({ variant }).base({ className })} {...rest}>{children}</li>
}

/**
 * 插件页卡片：`default` 有线无 hover（静态卡片），`link` 无线有 hover（整卡可点）。
 * 结构照官方原型 `.card > .cardHead / .cardMain / .cardEnd`，用 `Card.X` 组合。
 */
export const Card = Object.assign(CardBase, {
  List: ({ className, children, ...rest }: ComponentProps<'ul'>): ReactElement => (
    <ul className={card().list({ className })} {...rest}>{children}</ul>
  ),
  Header: ({ className, children, ...rest }: ComponentProps<'div'>): ReactElement => (
    <div className={card().head({ className })} {...rest}>{children}</div>
  ),
  Icon: ({ className, children, ...rest }: ComponentProps<'span'>): ReactElement => (
    <span className={card().icon({ className })} {...rest}>{children}</span>
  ),
  Content: ({ className, children, ...rest }: ComponentProps<'div'>): ReactElement => (
    <div className={card().content({ className })} {...rest}>{children}</div>
  ),
  TitleRow: ({ className, children, ...rest }: ComponentProps<'div'>): ReactElement => (
    <div className={card().titleRow({ className })} {...rest}>{children}</div>
  ),
  Title: ({ className, children, ...rest }: ComponentProps<'span'>): ReactElement => (
    <span className={card().title({ className })} {...rest}>{children}</span>
  ),
  Description: ({ className, children, ...rest }: ComponentProps<'p'>): ReactElement => (
    <p className={card().description({ className })} {...rest}>{children}</p>
  ),
  End: ({ className, children, ...rest }: ComponentProps<'span'>): ReactElement => (
    <span className={card().end({ className })} {...rest}>{children}</span>
  ),
})
