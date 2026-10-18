import type { MouseEventHandler, ReactNode } from 'react'
import { Card } from '@heroui/react'
import { cn } from 'tailwind-variants'

export interface ItemProps {
  left?: ReactNode
  right?: ReactNode
  footer?: ReactNode
  onClick?: MouseEventHandler<HTMLDivElement>
  className?: string
}

export function Item({ left, right, footer, onClick, className }: ItemProps) {
  return (
    <Card
      className={cn('bg-panel2 py-3', onClick && 'cursor-pointer', className)}
      onClick={onClick}
    >
      <Card.Content className="flex flex-col gap-1.5">
        <div className="flex flex-row items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">{left}</div>
          <div className="flex shrink-0 items-center gap-1.5">{right}</div>
        </div>
        {footer}
      </Card.Content>
    </Card>
  )
}
