import type {
  MachineId,
  SshAuthMethod,
  SshInstallResult,
  SshLink,
  SshMachineStatus,
  SshProgress,
  SshSession,
  SshTunnelHandle,
} from '../types/index'
import type { WorkspaceAllowlist } from '../utils/allowlist'
import type { BundledPluginsTree } from '../utils/plugins-sync'
import type { SshTransport } from './transport.types'

export interface MachineState {
  generation: number
  phase: 'disconnected' | 'testing' | 'connecting' | 'connected' | 'reconnecting' | 'given-up'
  connecting?: Promise<SshLink>
  installing?: Promise<SshInstallResult>
  session?: SshSession
  tunnel?: SshTunnelHandle
  link?: SshLink
  lastError?: string
  dshMissing?: boolean
  progress?: SshProgress
  reconnect?: ReconnectState
  preferredTunnelPort?: number
  authMethod?: SshAuthMethod
}

export interface ReconnectState {
  generation: number
  attempt: number
  nextRetryAt?: number
  timer?: NodeJS.Timeout
  reasons: string[]
}

export interface MachineDeps {
  transport: SshTransport
  emitStatus: (machineId: MachineId, status: SshMachineStatus) => void
  localAllowlist: () => WorkspaceAllowlist
  bundledPluginsTree?: BundledPluginsTree
}
