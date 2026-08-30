/**
 * Skills Library section component: displays and manages skill packages.
 * @module @deepseek-ai/dsh-client-ui-settings-skills/SkillsSection
 */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { SkillsState } from './store.ts'
import { SkillsStore } from './store.ts'
import styles from './SkillsSection.module.css'
import clsx from 'clsx'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
// eslint-disable-next-line @typescript-eslint/no-unused-vars

/** Sentinel select value representing the ungrouped bucket in the move-to-group control. */
const UNGROUPED_VALUE = '__ungrouped__'

/** One filtered dropdown option: a value plus its localized label. */
interface FilterOption<T extends string> {
  id: T
  label: string
}

/**
 * Self-drawn filter dropdown: a trigger button showing the current label and a
 * chevron spaced a single gap after it (native select arrows are pinned to the
 * right edge and drift far from short labels like "全部"). Uses the shared
 * `Menu` primitive for the option list.
 * @param props.open - whether the list is showing (owner-controlled).
 * @param props.value - the current selected option id.
 * @param props.options - selectable options.
 * @param props.onChange - row selection callback (closes the list).
 */
function FilterMenu<T extends string>({ open, onOpenChange, value, options, onChange }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: T
  options: readonly FilterOption<T>[]
  onChange: (id: T) => void
}) {
  const current = options.find(option => option.id === value)
  const items: MenuEntry[] = options.map(option => ({ id: option.id, label: option.label }))
  return (
    <Menu
      open={open}
      items={items}
      selectedId={value}
      onSelect={(id) => onChange(id as T)}
      onClose={() => onOpenChange(false)}
      anchor={
        <button
          type="button"
          className={styles.filterTrigger}
          onClick={() => onOpenChange(!open)}
        >
          <span className={styles.filterTriggerLabel}>{current?.label}</span>
          <span className={clsx(styles.filterChevron, open && styles.filterOpen)} aria-hidden>
            <IconChevronDownOutline14 />
          </span>
        </button>
      }
    />
  )
}

/** Registration-side dependencies of {@link SkillsSection}. */
export interface SkillsSectionInjected {
  hooks: {
    skills: SnapshotStore<SkillsState>
  }
  controller: SkillsStore
  api: Pick<IApiClient, 'host' | 'skillLibrary'>
}

/** Full component props: section owner share plus item render share. */
export type SkillsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.skills'>
  & InjectFace<SkillsSectionInjected>

/** Active group filter: every group, the ungrouped bucket, or one group id. */
type ActiveGroup = 'all' | 'ungrouped' | string

/**
 * Render the Skills Library section content.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function SkillsSection(props: SkillsSectionProps): ReactNode {
  const { controller, api, useSkills, t } = props
  const state = useSkills(snapshot => snapshot)
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [filterSource, setFilterSource] = useState<'all' | 'local' | 'http' | 'github' | 'runtime'>('all')
  const [statusOpen, setStatusOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [activeGroup, setActiveGroup] = useState<ActiveGroup>('all')
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null)
  const [renameGroupName, setRenameGroupName] = useState('')
  const [moveGroupId, setMoveGroupId] = useState('')
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    if (state.status === 'idle' || state.skills.length === 0) void controller.load()
  }, [controller, state.status, state.skills.length])

  const statusMatched = (skill: any): boolean => {
    if (filterStatus === 'enabled') return skill.enabled
    if (filterStatus === 'disabled') return !skill.enabled
    return true
  }

  const groupMatched = (skill: any): boolean => {
    if (activeGroup === 'all') return true
    if (activeGroup === 'ungrouped') return skill.group == null
    return skill.group === activeGroup
  }

  const filteredSkills = state.skills.filter((skill: any) =>
    statusMatched(skill)
  ).filter((skill: any) =>
    filterSource === 'all' || skill.source === filterSource
  ).filter((skill: any) =>
    searchQuery === '' ||
    skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    skill.description?.toLowerCase().includes(searchQuery.toLowerCase())
  ).filter((skill: any) => groupMatched(skill))

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

  const handleInstall = useCallback(async () => {
    setFeedback('')
    const pick = await api.host.pickDirectory({})
    if (!pick.result.ok) {
      setFeedback(t('installError').replace('{name}', '').replace('{error}', pick.result.error.message))
      return
    }
    const path = pick.result.value.path
    if (path === null) return
    const okResult = await controller.installFromLocal(path)
    if (!okResult) setFeedback(controller.store.getSnapshot().error ?? t('installError'))
    else setFeedback(t('success'))
  }, [api, controller, t])

  const handleNewGroup = useCallback(async () => {
    const name = newGroupName.trim()
    if (name === '') return
    await controller.createGroup(name)
    setNewGroupName('')
    setShowNewGroup(false)
    setFeedback('')
  }, [controller, newGroupName])

  const submitRename = useCallback(async (id: string) => {
    const name = renameGroupName.trim()
    setRenameGroupId(null)
    if (name === '') return
    await controller.renameGroup(id, name)
  }, [controller, renameGroupName])

  const handleDeleteGroup = useCallback(async (id: string, name: string) => {
    if (!window.confirm(t('confirmDeleteGroup').replace('{name}', name))) return
    await controller.deleteGroup(id)
    if (activeGroup === id) setActiveGroup('all')
  }, [controller, activeGroup, t])

  const handleMoveToGroup = useCallback(async () => {
    if (moveGroupId === '') return
    const target = moveGroupId === UNGROUPED_VALUE ? null : moveGroupId
    await controller.moveToGroup(Array.from(selectedSkills), target)
    setSelectedSkills(new Set())
    setMoveGroupId('')
  }, [controller, selectedSkills, moveGroupId])

  const handleSelectAll = useCallback(() => {
    setSelectedSkills(new Set(filteredSkills.map(skill => skill.name)))
  }, [filteredSkills])

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

  const groupTabStyle = (selected: boolean): CSSProperties => ({
    padding: '6px 14px',
    border: selected ? '1px solid #0066cc' : '1px solid #ccc',
    borderRadius: '999px',
    fontSize: '13px',
    background: selected ? '#0066cc' : 'white',
    color: selected ? 'white' : '#333',
    cursor: 'pointer',
  })

  const smallIconStyle: CSSProperties = {
    border: 'none', background: 'transparent', color: '#999', cursor: 'pointer',
    padding: '0 2px', fontSize: '13px', lineHeight: 1,
  }

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 4px 0' }}>{t('title')}</h2>
        <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>{t('description')}</p>
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
        <input
          type="text"
          placeholder={t('search')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '14px' }}
        />
        <FilterMenu
          open={statusOpen}
          onOpenChange={setStatusOpen}
          value={filterStatus}
          options={[
            { id: 'all', label: t('filterAll') },
            { id: 'enabled', label: t('filterEnabled') },
            { id: 'disabled', label: t('filterDisabled') },
          ]}
          onChange={(status) => setFilterStatus(status)}
        />
        <FilterMenu
          open={sourceOpen}
          onOpenChange={setSourceOpen}
          value={filterSource}
          options={[
            { id: 'all', label: t('filterAll') },
            { id: 'local', label: t('filterLocal') },
            { id: 'http', label: t('filterHttp') },
            { id: 'github', label: t('filterGithub') },
            { id: 'runtime', label: t('filterRuntime') },
          ]}
          onChange={(source) => setFilterSource(source)}
        />
        <button
          type="button"
          onClick={handleInstall}
          style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 500, background: '#0066cc', color: 'white', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {t('install')}
        </button>
      </div>

      {(feedback !== '' || state.error !== null) && (
        <div style={{ marginBottom: '12px', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', background: '#fff0f0', color: '#ff4444' }}>
          {feedback || state.error}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '16px' }}>
        <button type="button" onClick={() => setActiveGroup('all')} style={groupTabStyle(activeGroup === 'all')}>{t('groupAll')}</button>
        <button type="button" onClick={() => setActiveGroup('ungrouped')} style={groupTabStyle(activeGroup === 'ungrouped')}>{t('groupUngrouped')}</button>
        {state.groups.map(group => (
          <span key={group.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
            <button type="button" onClick={() => setActiveGroup(group.id)} style={groupTabStyle(activeGroup === group.id)}>{group.name}</button>
            {renameGroupId === group.id ? (
              <>
                <input
                  autoFocus
                  value={renameGroupName}
                  onChange={(e) => setRenameGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitRename(group.id)
                    if (e.key === 'Escape') setRenameGroupId(null)
                  }}
                  style={{ width: '90px', padding: '4px 6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px' }}
                />
                <button type="button" onClick={() => void submitRename(group.id)} style={smallIconStyle}>✓</button>
                <button type="button" onClick={() => setRenameGroupId(null)} style={smallIconStyle}>✕</button>
              </>
            ) : (
              <>
                <button type="button" title={t('renameGroup')} onClick={() => { setRenameGroupId(group.id); setRenameGroupName(group.name) }} style={smallIconStyle}>✎</button>
                <button type="button" title={t('deleteGroup')} onClick={() => void handleDeleteGroup(group.id, group.name)} style={{ ...smallIconStyle, color: '#ff4444' }}>✕</button>
              </>
            )}
          </span>
        ))}
        {showNewGroup ? (
          <>
            <input
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleNewGroup()
                if (e.key === 'Escape') { setShowNewGroup(false); setNewGroupName('') }
              }}
              placeholder={t('groupNamePlaceholder')}
              style={{ padding: '6px 10px', border: '1px solid #0066cc', borderRadius: '999px', fontSize: '13px' }}
            />
            <button type="button" onClick={() => void handleNewGroup()} style={{ ...groupTabStyle(true), padding: '6px 10px' }}>✓</button>
            <button type="button" onClick={() => { setShowNewGroup(false); setNewGroupName('') }} style={smallIconStyle}>✕</button>
          </>
        ) : (
          <button type="button" onClick={() => setShowNewGroup(true)} style={{ ...groupTabStyle(false), borderColor: '#0066cc', color: '#0066cc' }}>+ {t('newGroup')}</button>
        )}
      </div>

      {selectedSkills.size > 0 && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '12px', background: '#f5f5f5', borderRadius: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '14px', color: '#666', marginRight: '8px' }}>{t('selectedItems').replace('{count}', String(selectedSkills.size))}</span>
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
          <select
            value={moveGroupId}
            onChange={(e) => setMoveGroupId(e.target.value)}
            style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px', background: 'white' }}
          >
            <option value="">{t('moveToGroup')}</option>
            <option value={UNGROUPED_VALUE}>{t('groupUngrouped')}</option>
            {state.groups.map(group => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleMoveToGroup}
            disabled={moveGroupId === ''}
            style={{ padding: '6px 12px', border: '1px solid #0066cc', borderRadius: '4px', fontSize: '13px', background: 'white', color: '#0066cc', cursor: moveGroupId === '' ? 'not-allowed' : 'pointer' }}
          >
            {t('applyMove')}
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
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={skill.enabled}
                    onChange={(e) => handleToggle(skill.name, e.target.checked)}
                  />
                  <span className={styles.toggleSlider}></span>
                </label>
              </div>
              {skill.description && (
                <p style={{ fontSize: '13px', color: '#666', margin: '8px 0 0 0', lineHeight: 1.4 }}>{skill.description}</p>
              )}
              <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: '#666', marginTop: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 500 }}>{t('invocation')}:</span>
                <span>{t('modelInvocable')}: {skill.invocation.modelInvocable ? '✓' : '✗'}</span>
                <span>{t('userInvocable')}: {skill.invocation.userInvocable ? '✓' : '✗'}</span>
                {skill.group != null && state.groups.some(group => group.id === skill.group) && (
                  <span style={{ color: '#0066cc' }}>{state.groups.find(group => group.id === skill.group)?.name}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}