import type { MachineProfile, SshSession } from '../types/index'
import type { BootstrapHooks, RemoteInstallPlan } from './bootstrap.types'
import { defineService } from 'dsh-tauri'
import { hostConfig } from '../config/runtime'
import { ensureRemoteInstance, runInstallScript } from './bootstrap.utils'

export const bootstrap = defineService({
  async provision(
    session: SshSession,
    profile: MachineProfile,
    hooks: BootstrapHooks = {},
  ): Promise<string> {
    return await ensureRemoteInstance(session, profile, hostConfig(), hooks)
  },

  async install(
    session: SshSession,
    plan: RemoteInstallPlan,
    hooks: BootstrapHooks = {},
    failureLine = 'bootstrap 失败',
  ): Promise<string[]> {
    return await runInstallScript(session, plan, hostConfig().installTimeoutMs!, hooks, failureLine)
  },
})
