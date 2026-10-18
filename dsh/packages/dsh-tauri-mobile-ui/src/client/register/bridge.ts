import type { ClientContext } from 'dsh-tauri/client'
import { defineRegister } from 'dsh-tauri/client'

const CONFIG_KEY = '__DSH_BRIDGE_CONFIG__'
interface BridgeConfig {
  disablePageTweaks?: boolean
}

let previousConfig: BridgeConfig | undefined
let configCaptured = false
let installedConfig: BridgeConfig | undefined

declare global {
  interface Window {
    __DSH_BRIDGE_CONFIG__?: BridgeConfig
  }
}

export function installBridgeConfig(): void {
  if (typeof window === 'undefined')
    return

  if (!configCaptured) {
    previousConfig = window[CONFIG_KEY]
    configCaptured = true
  }

  if (installedConfig !== undefined && window[CONFIG_KEY] === installedConfig)
    return

  installedConfig = { disablePageTweaks: true }
  window[CONFIG_KEY] = installedConfig
}

function restoreBridgeConfig(): void {
  if (typeof window === 'undefined' || !configCaptured)
    return

  if (window[CONFIG_KEY] === installedConfig) {
    if (previousConfig === undefined)
      delete window[CONFIG_KEY]
    else
      window[CONFIG_KEY] = previousConfig
  }

  previousConfig = undefined
  installedConfig = undefined
  configCaptured = false
}

export const registerBridgeConfig = defineRegister<ClientContext>((controller) => {
  installBridgeConfig()
  controller.add(restoreBridgeConfig)
})

// keep:effect dsh-bridge probes once before Cordis effects; install the opt-out during module evaluation.
installBridgeConfig()
