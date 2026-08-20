// SmartBoBo pineapple logo — outline-only silhouette.
// Derived from user-provided pineapple image; uses currentColor for theme
// compatibility (same contract as the original DeepSeek fish logo).

import type { IconProps } from './icons/props.ts'

/**
 * Render the pineapple logo.
 * @param props.size - width in px (default 24; height keeps 30:34 ratio).
 * @param props.className - extra class for layout placement.
 * @returns the logo svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * 34) / 30}
      className={className}
      viewBox="0 0 30 34"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Pineapple leaves (crown) */}
      <path d="M15 13 Q14.5 7 13 2.5 Q12.8 0.5 12 1.5" strokeWidth="1.6" />
      <path d="M15 13 Q16 6 18.5 2 Q19.5 0.5 18.5 2" strokeWidth="1.6" />
      <path d="M15 13 Q11 8 6.5 4.5 Q5 3.5 6 5" strokeWidth="1.5" />
      <path d="M15 13 Q19 8 23.5 4.5 Q25 3.5 24 5" strokeWidth="1.5" />
      <path d="M15 13 Q10 10 5.5 8" strokeWidth="1.3" />
      <path d="M15 13 Q20 10 24.5 8" strokeWidth="1.3" />
      <path d="M15 13 Q13 9.5 9 7" strokeWidth="1.2" />
      <path d="M15 13 Q17 9.5 21 7" strokeWidth="1.2" />

      {/* Pineapple body */}
      <path
        d="M15 14 Q5 14 4.5 22 Q4.2 27 10 30 Q13.5 31.5 15 31.5 Q16.5 31.5 20 30 Q25.8 27 25.5 22 Q25 14 15 14 Z"
        strokeWidth="2"
        fill="none"
      />

      {/* Cross-hatch grid lines (body texture) */}
      <path d="M10.5 17 L7.5 30" strokeWidth="0.7" fill="none" />
      <path d="M15 16 L15 31.5" strokeWidth="0.7" fill="none" />
      <path d="M19.5 17 L22.5 30" strokeWidth="0.7" fill="none" />
      <path d="M4.8 19 L25.2 19" strokeWidth="0.7" fill="none" />
      <path d="M4.5 23.5 L25.5 23.5" strokeWidth="0.7" fill="none" />
      <path d="M5 27.5 L25 27.5" strokeWidth="0.7" fill="none" />
    </svg>
  )
}
