/**
 * MCP Tools icon component: a suitcase with MCP text and compass indicator.
 * @module @deepseek-ai/dsh-client-ui-primitives/IconMcpTools16
 */

import type { IconProps } from './props.ts'

/**
 * Render the MCP Tools icon.
 * @param props.size - width in px (default 16).
 * @param props.className - extra class for layout placement.
 * @returns the icon svg element.
 */
export const IconMcpTools16 = ({ size = 16, className }: IconProps) => (
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
    {/* Suitcase body */}
    <rect x="3" y="8" width="18" height="13" rx="2" />
    {/* Suitcase handle */}
    <path d="M8 8V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3" />
    {/* Compass indicator */}
    <circle cx="12" cy="5" r="1.5" />
    <path d="M12 3.5v-1" />
    <path d="M12 6.5v1" />
    <path d="M10.5 5h-1" />
    <path d="M13.5 5h1" />
    {/* MCP text */}
    <text x="12" y="16" textAnchor="middle" fill="currentColor" stroke="none" fontSize="6" fontWeight="bold">MCP</text>
    {/* Bottom dots */}
    <circle cx="7" cy="19" r="1" fill="currentColor" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
    <circle cx="17" cy="19" r="1" fill="currentColor" />
  </svg>
)
