/**
 * Package invariant companion: this client-only UI plugin has no host-side
 * invariants; its sole runtime boundary is the settings seam, which is
 * validated by the owning settings package.
 * @module @deepseek-ai/dsh-client-ui-settings-mcp/invariant
 */

export const name = '@deepseek-ai/dsh-client-ui-settings-mcp'
export const invariant = 'No runtime invariant: client-only UI settings plugin; settings seam validated by ui-settings.'
