import type { Market, MarketFileContent, MarketInstallResult, MarketSearchPage, MarketSkillDetail } from './repo/market-core.mjs'
import { defineService, DSH_HOME } from 'dsh-tauri'
import { createMarket } from './repo/market-core.mjs'

const CLAWHUB_BASE = 'https://clawhub.ai'

const SKILLHUB_BASE = 'https://api.skillhub.cn'

const registry: Market = createMarket({ dshHome: DSH_HOME, clawhubBase: CLAWHUB_BASE, skillhubBase: SKILLHUB_BASE })

export const market = defineService({
  async search(query: string, cursor?: string): Promise<MarketSearchPage> {
    return registry.search('market', query, cursor)
  },

  async describe(id: string): Promise<MarketSkillDetail> {
    return registry.detail(id)
  },

  async read(id: string, path: string): Promise<MarketFileContent> {
    return registry.file(id, path)
  },

  async install(id: string): Promise<MarketInstallResult> {
    return registry.installTo(id)
  },
})
