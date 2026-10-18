import { defineService } from 'dsh-tauri'
import { resolveUngroupedSessionPath } from '../utils/paths'

export const ungrouped = defineService({
  resolve(): string {
    return resolveUngroupedSessionPath()
  },
})
