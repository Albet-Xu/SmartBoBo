/**
 * Proxy Pool section component: displays and manages proxy API sources.
 * @module @deepseek-ai/dsh-client-ui-settings-proxy/ProxyPoolSection
 */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { ProxyPoolConfig, ProxyPoolState, ProxySource } from './store.ts'

/** Registration-side dependencies of {@link ProxyPoolSection}. */
export interface ProxyPoolSectionInjected {
  hooks: {
    config: SnapshotStore<ProxyPoolState>
  }
  controller: { save: (config: ProxyPoolConfig) => Promise<void>; refresh: () => void }
  api: Pick<IApiClient, 'settings'>
}

/** Full component props: section owner share plus item render share. */
export type ProxyPoolSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.proxy'>
  & InjectFace<ProxyPoolSectionInjected>

/**
 * Render the Proxy Pool section content.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function ProxyPoolSection(props: ProxyPoolSectionProps): ReactNode {
  const { controller, useConfig, t } = props
  const state = useConfig(snapshot => snapshot)

  useEffect(() => {
    if (state.status === 'idle') void controller.refresh()
  }, [controller, state.status])

  const config = state.config

  const [edited, setEdited] = useState(false)
  const [localConfig, setLocalConfig] = useState<ProxyPoolConfig>(config)

  useEffect(() => {
    setLocalConfig(config)
    setEdited(false)
  }, [config])

  const handleSave = useCallback(async () => {
    await controller.save(localConfig)
    setEdited(false)
  }, [controller, localConfig])

  const updateSource = (index: number, patch: Partial<ProxySource>) => {
    setEdited(true)
    setLocalConfig(prev => ({
      ...prev,
      sources: prev.sources.map((s, i) => i === index ? { ...s, ...patch } : s),
    }))
  }

  const addSource = () => {
    setEdited(true)
    setLocalConfig(prev => ({
      ...prev,
      sources: [...prev.sources, {
        name: `Proxy ${prev.sources.length + 1}`,
        apiUrl: '',
        apiKey: '',
        pwd: '',
        getnum: 50,
        httptype: 'http',
        geshi: '2',
        fenge: '1',
        enabled: true,
      }],
    }))
  }

  const removeSource = (index: number) => {
    setEdited(true)
    setLocalConfig(prev => ({
      ...prev,
      sources: prev.sources.filter((_, i) => i !== index),
    }))
  }

  const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 12px',
    border: '1px solid #ccc',
    borderRadius: '6px',
    fontSize: '14px',
  }

  const labelStyle = {
    fontSize: '14px',
    fontWeight: 500,
    marginBottom: '4px',
    display: 'block',
  }

  return (
    <div style={{ padding: '16px', maxWidth: '600px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 4px 0' }}>{t('title')}</h2>
        <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>{t('description')}</p>
      </div>

      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <label style={{ fontSize: '14px' }} htmlFor="proxy-pool-master-switch">{t('enabled')}:</label>
        <label
          htmlFor="proxy-pool-master-switch"
          style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, cursor: 'pointer' }}
        >
          <input
            id="proxy-pool-master-switch"
            type="checkbox"
            role="switch"
            checked={localConfig.enabled}
            onChange={(e) => {
              setEdited(true)
              setLocalConfig(prev => ({ ...prev, enabled: e.target.checked }))
            }}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, margin: 0 }}
          />
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 12,
              background: localConfig.enabled ? '#0066cc' : '#cccccc',
              transition: 'background 0.2s ease',
            }}
          />
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 2,
              left: 2,
              width: 20,
              height: 20,
              borderRadius: 10,
              background: '#ffffff',
              transform: localConfig.enabled ? 'translateX(20px)' : 'translateX(0)',
              transition: 'transform 0.2s ease',
            }}
          />
        </label>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={labelStyle}>{t('fetchStrategy')}:</label>
        <div style={{ position: 'relative' }}>
          <select
            value={localConfig.fetchStrategy}
            onChange={(e) => {
              setEdited(true)
              setLocalConfig(prev => ({ ...prev, fetchStrategy: e.target.value as 'cache' | 'realtime' }))
            }}
            style={{ ...inputStyle, appearance: 'none', paddingRight: '40px', cursor: 'pointer' }}
          >
            <option value="cache">{t('cacheStrategy')}</option>
            <option value="realtime">{t('realtimeStrategy')}</option>
          </select>
          <span
            aria-hidden="true"
            style={{ position: 'absolute', top: '50%', right: '16px', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex', color: '#666' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M4 5.5L7 8.5L10 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </div>

      <div style={{ marginBottom: '16px', display: 'flex', gap: '12px' }}>
        <div>
          <label style={labelStyle}>{t('maxRetries')}:</label>
          <input
            type="number"
            value={localConfig.maxRetries}
            min={1}
            max={10}
            onChange={(e) => {
              setEdited(true)
              setLocalConfig(prev => ({ ...prev, maxRetries: Number(e.target.value) }))
            }}
            style={{ ...inputStyle, width: '140px' }}
          />
        </div>
        <div>
          <label style={labelStyle}>{t('timeoutMs')}:</label>
          <input
            type="number"
            value={localConfig.timeoutMs}
            min={5000}
            step={1000}
            onChange={(e) => {
              setEdited(true)
              setLocalConfig(prev => ({ ...prev, timeoutMs: Number(e.target.value) }))
            }}
            style={{ ...inputStyle, width: '140px' }}
          />
        </div>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <label style={{ ...labelStyle, margin: 0 }}>代理源列表</label>
          <button
            type="button"
            onClick={addSource}
            style={{ padding: '6px 12px', border: '1px solid #0066cc', borderRadius: '6px', fontSize: '13px', background: 'white', color: '#0066cc', cursor: 'pointer' }}
          >
            {t('addSource')}
          </button>
        </div>

        {localConfig.sources.map((source, idx) => (
          <div key={idx} style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <input
                type="text"
                value={source.name}
                onChange={(e) => updateSource(idx, { name: e.target.value })}
                style={{ ...inputStyle, width: '200px' }}
                placeholder={t('sourceName')}
              />
              <button
                type="button"
                onClick={() => removeSource(idx)}
                style={{ padding: '4px 8px', border: '1px solid #ff4444', borderRadius: '4px', background: 'white', color: '#ff4444', cursor: 'pointer' }}
              >
                {t('deleteSource')}
              </button>
            </div>
            <div>
              <label style={{ fontSize: '12px' }}>{t('apiUrl')}</label>
              <input type="text" value={source.apiUrl} onChange={(e) => updateSource(idx, { apiUrl: e.target.value })} style={inputStyle} />
            </div>
          </div>
        ))}
      </div>

      {edited && (
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => { setLocalConfig(config); setEdited(false) }}
            style={{ padding: '8px 16px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '14px', background: 'white', cursor: 'pointer' }}
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 500, background: '#0066cc', color: 'white', cursor: 'pointer' }}
          >
            {t('save')}
          </button>
        </div>
      )}
    </div>
  )
}
