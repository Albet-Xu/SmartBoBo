import type { GetApiTauriExtensionImportScanResponse, GetApiTauriExtensionMarketDetailResponse, GetApiTauriExtensionMarketFileResponse, GetApiTauriExtensionMarketSearchResponse, GetApiTauriExtensionMcpResponse, GetApiTauriExtensionRepoDetailResponse, GetApiTauriExtensionRepoListResponse, GetApiTauriExtensionSkillsResponse } from '../apis/index.type'

export type ImportedServerView = Extract<GetApiTauriExtensionImportScanResponse, { servers: unknown }>['servers'][number]
export type McpRow = Extract<GetApiTauriExtensionMcpResponse, { servers: unknown }>['servers'][number]
export type SkillRowView = Extract<GetApiTauriExtensionSkillsResponse, { skills: unknown }>['skills'][number]
export type RepoEntryView = Extract<GetApiTauriExtensionRepoListResponse, { catalog: unknown }>['catalog']['entries'][number]
export type RepoCatalogView = Extract<GetApiTauriExtensionRepoListResponse, { catalog: unknown }>['catalog']
export type RepoDetailView = Extract<GetApiTauriExtensionRepoDetailResponse, { detail: unknown }>['detail']
export type MarketSourceStatus = Extract<GetApiTauriExtensionMarketSearchResponse, { page: unknown }>['page']['sources']['clawhub']
export type MarketSourcesView = Extract<GetApiTauriExtensionMarketSearchResponse, { page: unknown }>['page']['sources']
export type MarketSkillItemView = Extract<GetApiTauriExtensionMarketSearchResponse, { page: unknown }>['page']['items'][number]
export type MarketSkillDetailView = Extract<GetApiTauriExtensionMarketDetailResponse, { detail: unknown }>['detail']
export type MarketFileView = Extract<GetApiTauriExtensionMarketFileResponse, { file: unknown }>['file']
