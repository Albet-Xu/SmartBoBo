import { usePreferredDark, useWatch } from '@reause/core'
import { useDshStyle } from './use-dsh-style'
import { useInvoke } from './use-invoke'

export function resolveTheme(
  preference: 'dark' | 'light' | 'system' | null | undefined,
  systemDark: boolean,
): 'dark' | 'light' {
  return preference === 'light' || preference === 'dark'
    ? preference
    : (systemDark ? 'dark' : 'light')
}

export function useThemeAdaptive() {
  const themePreference = useInvoke<'dark' | 'light' | 'system'>('get_dsh_theme')
  const [dshStyle] = useDshStyle()
  const systemDark = usePreferredDark()
  // 显式偏好优先；`system` 与尚未取到偏好（useInvoke 首次返回 undefined）都按系统
  // 偏好折算——首次进入（没有偏好配置）时后端回退 `system`，这里不能先落深色。
  const theme = resolveTheme(themePreference, systemDark)
  useWatch(
    dshStyle.colorScheme || theme,
    value => document.documentElement.dataset.theme = value,
    { immediate: true },
  )
}
