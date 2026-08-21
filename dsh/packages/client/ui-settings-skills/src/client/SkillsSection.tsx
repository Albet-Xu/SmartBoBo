/**
 * Skills Library section component: displays and manages skill packages.
 * @module @deepseek-ai/dsh-client-ui-settings-skills/SkillsSection
 */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { SkillsState } from './store.ts'
import { SkillsStore } from './store.ts'
// eslint-disable-next-line @typescript-eslint/no-unused-vars

/** Registration-side dependencies of {@link SkillsSection}. */
export interface SkillsSectionInjected {
  hooks: {
    skills: SnapshotStore<SkillsState>
  }
  controller: SkillsStore
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
}

/** Full component props: section owner share plus item render share. */
export type SkillsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.skills'>
  & InjectFace<SkillsSectionInjected>

/**
 * Render the Skills Library section content.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function SkillsSection(props: SkillsSectionProps): ReactNode {
  const { controller, useSkills, t } = props
  const state = useSkills(snapshot => snapshot)
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [filterSource, setFilterSource] = useState<'all' | 'local' | 'http' | 'github' | 'runtime'>('all')

  useEffect(() => {
    if (state.status === 'idle' || state.skills.length === 0) void controller.load()
  }, [controller, state.status, state.skills.length])

  const handleToggle = useCallback(async (name: string, enabled: boolean) => {
    await controller.toggle(name, enabled)
  }, [controller])

  const handleBatchToggle = useCallback(async (enabled: boolean) => {
    const names = Array.from(selectedSkills)
    await controller.batchToggle(names, enabled)
    setSelectedSkills(new Set())
  }, [controller, selectedSkills])

  const handleBatchUninstall = useCallback(async () => {
    const names = Array.from(selectedSkills)
    await controller.batchUninstall(names)
    setSelectedSkills(new Set())
  }, [controller, selectedSkills])

  const handleSelectAll = useCallback(() => {
    const filteredSkills = state.skills.filter((skill: any) => {
      if (filterStatus === 'enabled') return skill.enabled
      if (filterStatus === 'disabled') return !skill.enabled
      return true
    }).filter((skill: any) =>
      filterSource === 'all' || skill.source === filterSource
    ).filter((skill: any) =>
      searchQuery === '' ||
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    setSelectedSkills(new Set(filteredSkills.map((skill: any) => skill.name)))
  }, [state.skills, filterStatus, filterSource, searchQuery])

  const handleClearSelection = useCallback(() => {
    setSelectedSkills(new Set())
  }, [])

  const handleToggleSelection = useCallback((name: string) => {
    setSelectedSkills(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }, [])

  const filteredSkills = state.skills.filter((skill: any) => {
    if (filterStatus === 'enabled') return skill.enabled
    if (filterStatus === 'disabled') return !skill.enabled
    return true
  }).filter((skill: any) =>
    filterSource === 'all' || skill.source === filterSource
  ).filter((skill: any) =>
    searchQuery === '' ||
    skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    skill.description?.toLowerCase().includes(searchQuery.toLowerCase())
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
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value as typeof filterSource)}
          style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '14px' }}
        >
          <option value="all">{t('filterAll')}</option>
          <option value="local">{t('filterLocal')}</option>
          <option value="http">{t('filterHttp')}</option>
          <option value="github">{t('filterGithub')}</option>
          <option value="runtime">{t('filterRuntime')}</option>
        </select>
        <button
          type="button"
          style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 500, background: '#0066cc', color: 'white', cursor: 'pointer' }}
        >
          {t('install')}
        </button>
      </div>

      {selectedSkills.size > 0 && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '12px', background: '#f5f5f5', borderRadius: '6px', marginBottom: '16px' }}>
          <span style={{ fontSize: '14px', color: '#666', marginRight: '8px' }}>{`已选择 ${selectedSkills.size} 个技能`}</span>
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
          onClick={selectedSkills.size === filteredSkills.length ? handleClearSelection : handleSelectAll}
          style={{ padding: '4px 8px', border: 'none', borderRadius: '4px', fontSize: '13px', background: 'transparent', color: '#666', cursor: 'pointer' }}
        >
          {selectedSkills.size === filteredSkills.length ? t('clearSelection') : t('selectAll')}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {filteredSkills.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: '16px', fontWeight: 500, margin: '0 0 8px 0' }}>{t('noSkills')}</p>
            <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>{t('noSkillsHint')}</p>
          </div>
        ) : (
          filteredSkills.map((skill: any) => (
            <div key={skill.name} style={{ padding: '12px', border: '1px solid #ccc', borderRadius: '8px', background: 'white' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="checkbox"
                  checked={selectedSkills.has(skill.name)}
                  onChange={() => handleToggleSelection(skill.name)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500 }}>{skill.name}</span>
                  <span style={{ fontSize: '12px', color: '#666' }}>{skill.source}</span>
                </div>
                <label style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px' }}>
                  <input
                    type="checkbox"
                    checked={skill.enabled}
                    onChange={(e) => handleToggle(skill.name, e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    cursor: 'pointer',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: skill.enabled ? '#0066cc' : '#ccc',
                    transition: '0.3s',
                    borderRadius: '22px',
                  }}></span>
                </label>
              </div>
              {skill.description && (
                <p style={{ fontSize: '13px', color: '#666', margin: '8px 0 0 0', lineHeight: 1.4 }}>{skill.description}</p>
              )}
              <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: '#666', marginTop: '8px' }}>
                <span style={{ fontWeight: 500 }}>{t('invocation')}:</span>
                <span>{t('modelInvocable')}: {skill.invocation.modelInvocable ? '✓' : '✗'}</span>
                <span>{t('userInvocable')}: {skill.invocation.userInvocable ? '✓' : '✗'}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
