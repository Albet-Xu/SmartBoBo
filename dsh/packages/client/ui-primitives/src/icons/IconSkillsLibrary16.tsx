/**
 * Skills Library icon component: a diamond shape with lightning bolt and connection points.
 * @module @deepseek-ai/dsh-client-ui-primitives/IconSkillsLibrary16
 */

import type { IconProps } from './props.ts'

/**
 * Render the Skills Library icon.
 * @param props.size - width in px (default 16).
 * @param props.className - extra class for layout placement.
 * @returns the icon svg element.
 */
export const IconSkillsLibrary16 = ({ size = 16, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {/* Diamond shape */}
    <path d="M12 2L22 12L12 22L2 12L12 2Z" />
    {/* Lightning bolt */}
    <path d="M13 8L9 14H12L11 18L15 12H12L13 8Z" fill="currentColor" />
    {/* Connection points */}
    <circle cx="2" cy="12" r="2" />
    <circle cx="22" cy="12" r="2" />
    <circle cx="12" cy="2" r="2" />
    <circle cx="12" cy="22" r="2" />
    {/* Connection lines */}
    <line x1="4" y1="12" x2="10" y2="12" />
    <line x1="14" y1="12" x2="20" y2="12" />
    <line x1="12" y1="4" x2="12" y2="10" />
    <line x1="12" y1="14" x2="12" y2="20" />
  </svg>
)
