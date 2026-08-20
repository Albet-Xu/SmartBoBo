// SmartBoBo brand wordmark: pineapple icon + "SmartBoBo" text + AGENT badge
// in one svg. Ink rides currentColor; the badge text is knocked out in the
// inverted label color so the plate stays legible in both themes.

import type { IconProps } from './icons/props.ts'

/**
 * Render the full brand wordmark.
 * @param props.size - height in px (default 24; width keeps the 182:24 ratio).
 * @param props.className - extra class for layout placement.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={(size * 182) / 24}
      height={size}
      className={className}
      viewBox="0 0 182 24"
      fill="none"
      aria-hidden="true"
    >
      {/* Pineapple icon (scaled to ~20x22, centered vertically in 24px) */}
      <g transform="translate(1, 1) scale(0.65)" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {/* Leaves */}
        <path d="M15 13 Q14.5 7 13 2.5 Q12.8 0.5 12 1.5" strokeWidth="1.6" />
        <path d="M15 13 Q16 6 18.5 2 Q19.5 0.5 18.5 2" strokeWidth="1.6" />
        <path d="M15 13 Q11 8 6.5 4.5 Q5 3.5 6 5" strokeWidth="1.5" />
        <path d="M15 13 Q19 8 23.5 4.5 Q25 3.5 24 5" strokeWidth="1.5" />
        <path d="M15 13 Q10 10 5.5 8" strokeWidth="1.3" />
        <path d="M15 13 Q20 10 24.5 8" strokeWidth="1.3" />
        <path d="M15 13 Q13 9.5 9 7" strokeWidth="1.2" />
        <path d="M15 13 Q17 9.5 21 7" strokeWidth="1.2" />
        {/* Body */}
        <path d="M15 14 Q5 14 4.5 22 Q4.2 27 10 30 Q13.5 31.5 15 31.5 Q16.5 31.5 20 30 Q25.8 27 25.5 22 Q25 14 15 14 Z" strokeWidth="2" fill="none" />
        {/* Grid texture */}
        <path d="M10.5 17 L7.5 30" strokeWidth="0.7" fill="none" />
        <path d="M15 16 L15 31.5" strokeWidth="0.7" fill="none" />
        <path d="M19.5 17 L22.5 30" strokeWidth="0.7" fill="none" />
        <path d="M4.8 19 L25.2 19" strokeWidth="0.7" fill="none" />
        <path d="M4.5 23.5 L25.5 23.5" strokeWidth="0.7" fill="none" />
        <path d="M5 27.5 L25 27.5" strokeWidth="0.7" fill="none" />
      </g>

      {/* "SmartBoBo" text — large, same visual weight as the original deepseek wordmark */}
      <text
        x="26"
        y="16"
        fontFamily="Inter, 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        fontSize="14"
        fontWeight="600"
        letterSpacing="-0.01"
        fill="currentColor"
      >
        SmartBoBo
      </text>

      {/* AGENT badge — text size matches SmartBoBo, minimal gap */}
      <rect x="107" y="3.5" width="52" height="17" rx="3" fill="currentColor" />
      <text
        x="133"
        y="15.5"
        fontFamily="Inter, 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        fontSize="14"
        fontWeight="700"
        letterSpacing="0.8"
        textAnchor="middle"
        fill="var(--dsw-alias-label-primary-inverted)"
      >
        AGENT
      </text>
    </svg>
  )
}
