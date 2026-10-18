import { locale } from '../locales'

const WORDMARK_VIEWBOX = '26 0 156 24'
const WORDMARK_WIDTH = 156
const WORDMARK_HEIGHT = 24
const WORDMARK_SIZE = 24
const WORDMARK_FONT = "Inter, 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

export function BrandName() {
  locale.useLocale()
  return (
    <svg
      width={(WORDMARK_SIZE * WORDMARK_WIDTH) / WORDMARK_HEIGHT}
      height={WORDMARK_SIZE}
      viewBox={WORDMARK_VIEWBOX}
      fill="none"
      aria-hidden="true"
    >
      <text
        x="26"
        y="16"
        fontFamily={WORDMARK_FONT}
        fontSize="14"
        fontWeight="600"
        letterSpacing="-0.01"
        fill="currentColor"
      >
        {locale.text('wordmarkName')}
      </text>
      <rect x="107" y="3.5" width="52" height="17" rx="3" fill="currentColor" />
      <text
        x="133"
        y="15.5"
        fontFamily={WORDMARK_FONT}
        fontSize="14"
        fontWeight="700"
        letterSpacing="0.8"
        textAnchor="middle"
        fill="var(--dsw-alias-label-primary-inverted)"
      >
        {locale.text('wordmarkBadge')}
      </text>
    </svg>
  )
}
