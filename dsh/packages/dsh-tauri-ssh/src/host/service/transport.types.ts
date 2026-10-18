import type { Buffer } from 'node:buffer'
import type { MachineProfile, SshSession } from '../types/index'
import type { ResolvedSshAuth } from '../utils/ssh-config'

export type SshCredentialsResolver = (profile: MachineProfile) => Promise<ResolvedSshAuth>

export interface SshTransportOptions {
  readyTimeoutMs: number
  resolveProfile: SshCredentialsResolver
  keepaliveIntervalMs?: number
  keepaliveCountMax?: number
}

export type SshHostKeyVerifier = (label: string, hostKey: Buffer) => boolean | Promise<boolean>

export interface SshTransport {
  connect: (
    profile: MachineProfile,
    hostKeyVerifier: SshHostKeyVerifier,
    options: SshTransportOptions,
    signal?: AbortSignal,
  ) => Promise<SshSession>
}

export type SshConnectFailureKind
  = | 'key-rejected'
    | 'password-rejected'
    | 'unreachable'
    | 'other'
