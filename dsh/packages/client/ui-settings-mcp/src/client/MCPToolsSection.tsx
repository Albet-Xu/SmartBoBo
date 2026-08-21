/**
 * MCP Tools section component: displays and manages MCP tools.
 * @module @deepseek-ai/dsh-client-ui-settings-mcp/MCPToolsSection
 */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { MCPToolsState } from './store.ts'
import { MCPToolsStore } from './store.ts'
// eslint-disable-next-line @typescript-eslint/no-unused-vars

/** Registration-side dependencies of {@link MCPToolsSection}. */
export interface MCPToolsSectionInjected {
  hooks: {
    mcpTools: SnapshotStore<MCPToolsState>
  }
  controller: MCPToolsStore
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
}

/** Full component props: section owner share plus item render share. */
export type MCPToolsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.mcp'>
  & InjectFace<MCPToolsSectionInjected>

/**
 * Render the MCP Tools section content.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function MCPToolsSection(props: MCPToolsSectionProps): ReactNode {
  const { controller, useMcpTools, t } = props
  const state = useMcpTools(snapshot => snapshot)
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'enabled' | 'disabled'>('all')

  useEffect(() => {
    if (state.status === 'idle' || state.tools.length === 0) void controller.load()
  }, [controller, state.status, state.tools.length])

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    await controller.toggle(id, enabled)
  }, [controller])

  const handleBatchToggle = useCallback(async (enabled: boolean) => {
    const ids = Array.from(selectedTools)
    await controller.batchToggle(ids, enabled)
    setSelectedTools(new Set())
  }, [controller, selectedTools])

  const handleBatchUninstall = useCallback(async () => {
    const ids = Array.from(selectedTools)
    await controller.batchUninstall(ids)
    setSelectedTools(new Set())
  }, [controller, selectedTools])

  const handleSelectAll = useCallback(() => {
    const filteredTools = state.tools.filter((tool: any) => {
      if (filterStatus === 'enabled') return tool.enabled
      if (filterStatus === 'disabled') return !tool.enabled
      return true
    }).filter((tool: any) =>
      searchQuery === '' || tool.serverName.toLowerCase().includes(searchQuery.toLowerCase())
    )
    setSelectedTools(new Set(filteredTools.map((tool: any) => tool.id)))
  }, [state.tools, filterStatus, searchQuery])

  const handleClearSelection = useCallback(() => {
    setSelectedTools(new Set())
  }, [])

  const handleToggleSelection = useCallback((id: string) => {
    setSelectedTools(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const filteredTools = state.tools.filter((tool: any) => {
    if (filterStatus === 'enabled') return tool.enabled
    if (filterStatus === 'disabled') return !tool.enabled
    return true
  }).filter((tool: any) =>
    searchQuery === '' || tool.serverName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 4px 0' }}>{t('title')}</h2>
        <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>{t('description')}</p>
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
        <input
          type="text"
          placeholder={t('search')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '14px' }}
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
          style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '14px' }}
        >
          <option value="all">{t('filterAll')}</option>
          <option value="enabled">{t('filterEnabled')}</option>
          <option value="disabled">{t('filterDisabled')}</option>
        </select>
        <button
          type="button"
          style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 500, background: '#0066cc', color: 'white', cursor: 'pointer' }}
        >
          {t('install')}
        </button>
      </div>

      {selectedTools.size > 0 && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '12px', background: '#f5f5f5', borderRadius: '6px', marginBottom: '16px' }}>
          <span style={{ fontSize: '14px', color: '#666', marginRight: '8px' }}>{`已选择 ${selectedTools.size} 个工具`}</span>
          <button
            type="button"
            onClick={() => handleBatchToggle(true)}
            style={{ padding: '6px 12px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px', background: 'white', cursor: 'pointer' }}
          >
            {t('batchEnable')}
          </button>
          <button
            type="button"
            onClick={() => handleBatchToggle(false)}
            style={{ padding: '6px 12px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px', background: 'white', cursor: 'pointer' }}
          >
            {t('batchDisable')}
          </button>
          <button
            type="button"
            onClick={handleBatchUninstall}
            style={{ padding: '6px 12px', border: '1px solid #ff4444', borderRadius: '4px', fontSize: '13px', background: '#fff0f0', color: '#ff4444', cursor: 'pointer' }}
          >
            {t('batchUninstall')}
          </button>
          <button
            type="button"
            onClick={handleClearSelection}
            style={{ padding: '6px 12px', border: 'none', borderRadius: '4px', fontSize: '13px', background: 'transparent', color: '#666', cursor: 'pointer' }}
          >
            {t('clearSelection')}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 0' }}>
        <button
          type="button"
          onClick={selectedTools.size === filteredTools.length ? handleClearSelection : handleSelectAll}
          style={{ padding: '4px 8px', border: 'none', borderRadius: '4px', fontSize: '13px', background: 'transparent', color: '#666', cursor: 'pointer' }}
        >
          {selectedTools.size === filteredTools.length ? t('clearSelection') : t('selectAll')}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {filteredTools.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: '16px', fontWeight: 500, margin: '0 0 8px 0' }}>{t('noTools')}</p>
            <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>{t('noToolsHint')}</p>
          </div>
        ) : (
          filteredTools.map((tool: any) => (
            <div key={tool.id} style={{ padding: '12px', border: '1px solid #ccc', borderRadius: '8px', background: 'white' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="checkbox"
                  checked={selectedTools.has(tool.id)}
                  onChange={() => handleToggleSelection(tool.id)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500 }}>{tool.serverName}</span>
                  <span style={{ fontSize: '12px', color: '#666' }}>{tool.transport}</span>
                </div>
                <label style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px' }}>
                  <input
                    type="checkbox"
                    checked={tool.enabled}
                    onChange={(e) => handleToggle(tool.id, e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    cursor: 'pointer',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: tool.enabled ? '#0066cc' : '#ccc',
                    transition: '0.3s',
                    borderRadius: '22px',
                  }}></span>
                </label>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
