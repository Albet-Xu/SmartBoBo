// 引用源 本仓自建（无上游对应；渲染 @gravity-ui/icons 转发字形）· 版本 不适用 · hash 不适用
import type { ComponentType, ReactElement, SVGProps } from 'react'

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'as'> {
  as: IconComponent
  size?: number
}

export type SharedIconProps = Omit<SVGProps<SVGSVGElement>, 'as'> & { size?: number }

export function Icon({ as: Component, size = 16, ...props }: IconProps): ReactElement {
  return <Component {...props} width={size} height={size} />
}
