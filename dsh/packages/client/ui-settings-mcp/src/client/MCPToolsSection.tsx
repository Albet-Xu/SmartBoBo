/**
 * MCP Tools section component: displays and manages MCP tools.
 * @module @deepseek-ai/dsh-client-ui-settings-mcp/MCPToolsSection
 */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { MCPToolConfig, MCPToolsState } from './store.ts'
import { MCPToolsStore } from './store.ts'
import styles from './MCPToolsSection.module.css'
// eslint-disable-next-line @typescript-eslint/no-unused-vars

/** Parse `KEY=VALUE` lines from a textarea into an env/header record. */
function parseKeyValue(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const index = line.indexOf('=')
    if (index < 0) continue
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (key !== '') result[key] = value
  }
  return result
}

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
  const [showInstallForm, setShowInstallForm] = useState(false)
  const [installError, setInstallError] = useState('')
  const [installing, setInstalling] = useState(false)
  const [serverName, setServerName] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'streamable-http'>('stdio')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [envText, setEnvText] = useState('')
  const [cwd, setCwd] = useState('')
  const [url, setUrl] = useState('')
  const [headersText, setHeadersText] = useState('')
  const [toolCallTimeoutMs, setToolCallTimeoutMs] = useState('')
  const [failOnStartupError, setFailOnStartupError] = useState(false)
  const [reconnectEnabled, setReconnectEnabled] = useState(true)
  const [initialDelayMs, setInitialDelayMs] = useState('')
  const [maxDelayMs, setMaxDelayMs] = useState('')
  const [maxAttempts, setMaxAttempts] = useState('')

  useEffect(() => {
    if (state.status === 'idle' || state.tools.length === 0) void controller.load()
  }, [controller, state.status, state.tools.length])

  const resetDraft = useCallback(() => {
    setServerName('')
    setTransport('stdio')
    setCommand('')
    setArgsText('')
    setEnvText('')
    setCwd('')
    setUrl('')
    setHeadersText('')
    setToolCallTimeoutMs('')
    setFailOnStartupError(false)
    setReconnectEnabled(true)
    setInitialDelayMs('')
    setMaxDelayMs('')
    setMaxAttempts('')
    setInstallError('')
  }, [])

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

  const handleInstallSubmit = useCallback(async () => {
    const name = serverName.trim()
    if (name === '') {
      setInstallError(t('serverNameRequired'))
      return
    }
    if (transport === 'stdio' && command.trim() === '') {
      setInstallError(t('commandRequired'))
      return
    }
    if (transport === 'streamable-http' && url.trim() === '') {
      setInstallError(t('urlRequired'))
      return
    }
    const env = parseKeyValue(envText)
    const headers = parseKeyValue(headersText)
    const config: Omit<MCPToolConfig, 'id'> = {
      serverName: name,
      transport,
      enabled: true,
      ...(transport === 'stdio' ? {
        command: command.trim(),
        ...(argsText.trim() !== '' ? { args: argsText.trim().split(/\s+/) } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
        ...(cwd.trim() !== '' ? { cwd: cwd.trim() } : {}),
      } : {
        url: url.trim(),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      }),
      ...(toolCallTimeoutMs.trim() !== '' ? { toolCallTimeoutMs: Number(toolCallTimeoutMs) } : {}),
      ...(failOnStartupError ? { failOnStartupError } : {}),
      reconnect: {
        enabled: reconnectEnabled,
        ...(initialDelayMs.trim() !== '' ? { initialDelayMs: Number(initialDelayMs) } : {}),
        ...(maxDelayMs.trim() !== '' ? { maxDelayMs: Number(maxDelayMs) } : {}),
        ...(maxAttempts.trim() !== '' ? { maxAttempts: Number(maxAttempts) } : {}),
      },
    }
    setInstalling(true)
    setInstallError('')
    const id = await controller.install(config)
    setInstalling(false)
    if (id === null) {
      setInstallError(controller.store.getSnapshot().error ?? t('installError'))
    } else {
      setShowInstallForm(false)
      resetDraft()
    }
  }, [controller, serverName, transport, command, argsText, envText, cwd, url, headersText, toolCallTimeoutMs, failOnStartupError, reconnectEnabled, initialDelayMs, maxDelayMs, maxAttempts, t, resetDraft])

  const filteredTools = state.tools.filter((tool: any) => {
    if (filterStatus === 'enabled') return tool.enabled
    if (filterStatus === 'disabled') return !tool.enabled
    return true
  }).filter((tool: any) =>
    searchQuery === '' || tool.serverName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleSelectAll = useCallback(() => {
    setSelectedTools(new Set(filteredTools.map(tool => tool.id)))
  }, [filteredTools])

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

  const inputStyle: CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '8px 12px',
    border: '1px solid #ccc', borderRadius: '6px', fontSize: '14px',
  }
  const labelStyle: CSSProperties = { fontSize: '13px', color: '#666', marginBottom: '4px', display: 'block' }
  const fieldGroupStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '6px' }

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
          className={styles.filterSelect}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
        >
          <option value="all">{t('filterAll')}</option>
          <option value="enabled">{t('filterEnabled')}</option>
          <option value="disabled">{t('filterDisabled')}</option>
        </select>
        <button
          type="button"
          onClick={() => setShowInstallForm(true)}
          style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 500, background: '#0066cc', color: 'white', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {t('install')}
        </button>
      </div>

      {showInstallForm && (
        <div style={{ padding: '16px', border: '1px solid #ccc', borderRadius: '8px', background: '#fafafa', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 12px 0' }}>{t('installNew')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>{t('serverName')}</label>
              <input type="text" value={serverName} onChange={(e) => setServerName(e.target.value)} placeholder={t('serverNamePlaceholder')} style={inputStyle} />
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>{t('transport')}</label>
              <select value={transport} onChange={(e) => setTransport(e.target.value as typeof transport)} style={inputStyle}>
                <option value="stdio">{t('transportStdio')}</option>
                <option value="streamable-http">{t('transportHttp')}</option>
              </select>
            </div>
          </div>

          {transport === 'stdio' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>{t('command')}</label>
                <input type="text" value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t('commandPlaceholder')} style={inputStyle} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>{t('args')}</label>
                <input type="text" value={argsText} onChange={(e) => setArgsText(e.target.value)} placeholder={t('argsPlaceholder')} style={inputStyle} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>{t('env')}</label>
                <textarea value={envText} onChange={(e) => setEnvText(e.target.value)} rows={3} placeholder={t('envPlaceholder')} style={inputStyle} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>{t('cwd')}</label>
                <input type="text" value={cwd} onChange={(e) => setCwd(e.target.value)} style={inputStyle} />
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>{t('url')}</label>
                <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} style={inputStyle} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>{t('headers')}</label>
                <textarea value={headersText} onChange={(e) => setHeadersText(e.target.value)} rows={3} placeholder={t('headersPlaceholder')} style={inputStyle} />
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>{t('timeout')}</label>
              <input type="number" value={toolCallTimeoutMs} onChange={(e) => setToolCallTimeoutMs(e.target.value)} placeholder={t('timeoutPlaceholder')} style={inputStyle} />
            </div>
            <div style={fieldGroupStyle}>
              <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '6px', marginTop: '14px' }}>
                <input type="checkbox" checked={failOnStartupError} onChange={(e) => setFailOnStartupError(e.target.checked)} />
                {t('failOnStartupError')}
              </label>
            </div>
          </div>

          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input type="checkbox" checked={reconnectEnabled} onChange={(e) => setReconnectEnabled(e.target.checked)} />
              {t('reconnectEnabled')}
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>{t('reconnectInitialDelay')}</label>
                <input type="number" value={initialDelayMs} onChange={(e) => setInitialDelayMs(e.target.value)} placeholder={t('reconnectInitialDelayPlaceholder')} style={inputStyle} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>{t('reconnectMaxDelay')}</label>
                <input type="number" value={maxDelayMs} onChange={(e) => setMaxDelayMs(e.target.value)} placeholder={t('reconnectMaxDelayPlaceholder')} style={inputStyle} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>{t('reconnectMaxAttempts')}</label>
                <input type="number" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} placeholder={t('reconnectMaxAttemptsPlaceholder')} style={inputStyle} />
              </div>
            </div>
          </div>

          {installError !== '' && (
            <div style={{ marginTop: '12px', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', background: '#fff0f0', color: '#ff4444' }}>
              {installError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button type="button" onClick={() => { setShowInstallForm(false); resetDraft() }} style={{ padding: '8px 16px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '14px', background: 'white', cursor: 'pointer' }}>
              {t('cancel')}
            </button>
            <button type="button" onClick={handleInstallSubmit} disabled={installing} style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 500, background: '#0066cc', color: 'white', cursor: installing ? 'not-allowed' : 'pointer' }}>
              {installing ? t('loading') : t('save')}
            </button>
          </div>
        </div>
      )}

      {selectedTools.size > 0 && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '12px', background: '#f5f5f5', borderRadius: '6px', marginBottom: '16px' }}>
          <span style={{ fontSize: '14px', color: '#666', marginRight: '8px' }}>{t('selectedItems').replace('{count}', String(selectedTools.size))}</span>
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
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={tool.enabled}
                    onChange={(e) => handleToggle(tool.id, e.target.checked)}
                  />
                  <span className={styles.toggleSlider}></span>
                </label>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}