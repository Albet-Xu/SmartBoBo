import { tv } from 'tailwind-variants'

export const button = tv({
  base: 'inline-flex cursor-pointer items-center justify-center gap-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40',
  variants: {
    size: {
      sm: 'h-7 rounded-sm px-2.5 text-xs',
      md: 'h-9 rounded-md px-3.5 text-sm leading-[22px]',
    },
    tone: {
      primary: 'bg-btn-fill text-btn-ink hover:bg-btn-fill-hover',
      ghost: 'text-ink hover:bg-btn-hover active:bg-btn-active',
      danger: 'text-danger hover:bg-btn-danger-hover',
    },
    block: {
      true: 'mt-1.5 w-full',
    },
  },
  defaultVariants: {
    size: 'md',
    tone: 'ghost',
  },
})
