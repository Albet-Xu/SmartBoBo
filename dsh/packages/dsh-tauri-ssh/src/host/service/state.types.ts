import type { MachineProfile } from '../types/index'

export interface SshState {
  enabled: boolean
  machines: Record<string, MachineProfile>
}
