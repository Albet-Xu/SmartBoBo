import type { MachineProfile } from '../types/index'
import type { SshState } from './state.types'
import { DEFAULT_REMOTE_PORT, DEFAULT_SSH_PORT } from '../../shared/constants'
import { MachineId as brandMachineId } from '../types/index'

export function machineProfileOf(raw: unknown): MachineProfile | undefined {
  if (typeof raw !== 'object' || raw === null)
    return undefined
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || value.id === '')
    return undefined
  if (typeof value.name !== 'string')
    return undefined
  if (typeof value.host !== 'string' || value.host === '')
    return undefined
  if (typeof value.user !== 'string')
    return undefined
  return {
    id: brandMachineId(value.id),
    name: value.name,
    host: value.host,
    port: typeof value.port === 'number' ? value.port : DEFAULT_SSH_PORT,
    user: value.user,
    remotePort: typeof value.remotePort === 'number' ? value.remotePort : DEFAULT_REMOTE_PORT,
    ...typeof value.password === 'string' && value.password !== '' ? { password: value.password } : {},
    ...typeof value.passphrase === 'string' && value.passphrase !== '' ? { passphrase: value.passphrase } : {},
    ...typeof value.profileName === 'string' && value.profileName !== '' ? { profileName: value.profileName } : {},
    ...typeof value.startCommand === 'string' && value.startCommand !== '' ? { startCommand: value.startCommand } : {},
    ...typeof value.color === 'string' && value.color !== '' ? { color: value.color } : {},
    ...value.tintBorder === true ? { tintBorder: true } : {},
  }
}

export function parseStateDocument(raw: unknown): SshState {
  if (typeof raw !== 'object' || raw === null)
    return { enabled: false, machines: {} }
  const record = raw as { enabled?: unknown, machines?: unknown }
  const machines: Record<string, MachineProfile> = {}
  if (typeof record.machines === 'object' && record.machines !== null) {
    for (const [key, raw] of Object.entries(record.machines as Record<string, unknown>)) {
      const profile = machineProfileOf(raw)
      if (profile !== undefined && profile.id === key)
        machines[key] = profile
    }
  }
  return { enabled: record.enabled === true, machines }
}
