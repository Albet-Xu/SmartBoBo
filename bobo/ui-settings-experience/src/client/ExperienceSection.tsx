/**
 * Experience pool settings section: the license card (one key input, or the
 * connected plan facts derived from the server clock plus refresh and
 * change-key), the migration card (the two-step transfer of the license to
 * this device), and the connection diagnostics card (gateway URL plus
 * `/v1/health` reachability). All three fold, and all three start folded: each
 * head keeps its own title — the diagnostics head also keeps its re-check
 * button — while the notices stay outside the cards, so a page folded shut
 * still shows what the last action reported.
 *
 * The page never renders a saved key or token — those live in the credential
 * store and this plugin's memory only — and every gateway failure becomes
 * either the server's own description or localized copy from this section's
 * dictionary.
 *
 * @module bobo-settings-experience-ui/ExperienceSection
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, IconChevronDownOutlineRegular, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ExperienceLicenseCache, ExperiencePoolSettings } from '../experience-pool.ts'
import {
  experiencePageState,
  type ExperienceAuthOutcome,
  type ExperienceCredentialsState,
  type ExperienceGatewayOutcome,
  type ExperienceHealthOutcome,
  type ExperienceSaveOutcome,
} from './experience.ts'
import { EXPIRING_SOON_DAYS, remainingDays, type GatewayFailure } from './license-api.ts'
import type { ExperienceLocaleKey } from './locales.ts'
import css from './ExperienceSection.module.css'

/** Registration-side dependencies of {@link ExperienceSection}. */
export interface ExperienceSectionInjected {
  /** Resolve the page's first settings answer; a no-op once one is held. */
  load: () => Promise<void>
  /**
   * Apply one partial settings edit (gateway URL, device id, license cache)
   * through the host namespace.
   * @param patch - the fields this write sets.
   * @returns the write's outcome, which the page turns into its own copy.
   */
  save: (patch: Partial<ExperiencePoolSettings>) => Promise<ExperienceSaveOutcome>
  /**
   * Exchange one license key for a session token over `POST /v1/license/activate`.
   * @param key - the trimmed license key the user typed.
   * @returns the license state to show, or why the call did not produce one.
   */
  activate: (key: string) => Promise<ExperienceAuthOutcome>
  /** Re-read the license over `GET /v1/license/me` with the in-memory token. */
  refresh: () => Promise<ExperienceAuthOutcome>
  /**
   * Ask the gateway to send the migration confirmation email. The page shows
   * one fixed message on any HTTP success, whether or not the email exists.
   * @param email - the email bound to the previous device.
   * @param recoveryCode - the recovery code from that license.
   */
  migrateRequest: (email: string, recoveryCode: string) => Promise<ExperienceGatewayOutcome>
  /**
   * Complete the migration over `POST /v1/license/migrate/complete`.
   * @param email - the email bound to the previous device.
   * @param recoveryCode - the recovery code from that license.
   * @param code - the confirmation code from the email.
   */
  migrateComplete: (email: string, recoveryCode: string, code: string) => Promise<ExperienceAuthOutcome>
  /** Probe `GET /v1/health` and classify gateway and upstream reachability. */
  health: () => Promise<ExperienceHealthOutcome>
  /** Read whether the key and token references are configured; values never ride. */
  credentialsState: () => Promise<ExperienceCredentialsState | null>
  hooks: {
    /** Shared settings mirror, bound by the UI renderer as `useSettings`. */
    settings: SettingsDescribeFace
  }
}

/** Full component props: section owner share, locale seat, and inject face. */
export type ExperienceSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.experience'>
  & InjectFace<ExperienceSectionInjected>

type Translate = ExperienceSectionProps['t']

/**
 * One rendered notice: copy-namespace key with an optional host message, or a
 * raw server description shown verbatim.
 */
type Notice =
  | { readonly tone: 'success' | 'error' | 'warning'; readonly key: ExperienceLocaleKey; readonly message?: string }
  | { readonly tone: 'error' | 'warning'; readonly raw: string }

/** Every way an action can be in flight; null is idle. */
type Busy = 'activate' | 'refresh' | 'sendMail' | 'submit' | 'url'

/** The three cards the page folds. */
type CardId = 'license' | 'migrate' | 'health'

/**
 * One card's fold head: the chevron trigger, the card's title, and any control
 * the card keeps reachable while it is folded shut.
 *
 * The settings page already folds its cards this way in the proxy pool's
 * source list, so this follows that pattern rather than ui-primitives'
 * `FoldToggle` (a list rollup whose copy carries a head/tail count) or
 * `DisclosureRow` (a conversation process row).
 * @param props.title - the card's localized title, which also names the trigger.
 * @param props.open - whether this card's body is showing.
 * @param props.t - the section's dictionary translator.
 * @param props.onToggle - flips this card's fold.
 * @param props.children - controls kept beside the title while folded.
 * @returns the card head element tree.
 */
function CardHead({ title, open, t, onToggle, children }: {
  title: string
  open: boolean
  t: Translate
  onToggle: () => void
  children?: ReactNode | undefined
}): ReactNode {
  return (
    <div className={css.cardHead}>
      <button
        type="button"
        className={css.expandButton}
        aria-expanded={open}
        aria-label={open ? t('collapseCard', { name: title }) : t('expandCard', { name: title })}
        onClick={onToggle}
      >
        <IconChevronDownOutlineRegular className={open ? css.chevronOpen : css.chevronClosed} aria-hidden="true" />
      </button>
      <span className={css.cardName}>{title}</span>
      {children}
    </div>
  )
}

/** Turn one gateway failure into the notice the page renders. */
function failureNotice(failure: GatewayFailure): Notice {
  switch (failure.kind) {
    case 'timeout':
      return { tone: 'error', key: 'errTimeout' }
    case 'network':
      return { tone: 'error', key: 'errNetwork' }
    case 'malformed':
      return { tone: 'error', key: 'errMalformed' }
    case 'http':
      return failure.description === undefined
        ? { tone: 'error', key: 'errHttp', message: String(failure.status) }
        : { tone: 'error', raw: failure.description }
  }
}

/** Turn a refused settings write into a notice; a commit needs no notice. */
function saveNotice(outcome: ExperienceSaveOutcome): Notice | null {
  switch (outcome.kind) {
    case 'written':
      return null
    case 'conflict':
      return { tone: 'error', key: 'conflict' }
    case 'absent':
      return { tone: 'error', key: 'namespaceMissing' }
    case 'refused':
      return { tone: 'error', key: 'operationFailed', message: outcome.message }
  }
}

/** Localized warning line for the stores an `ok` outcome could not finish. */
function storageWarningText(
  outcome: Extract<ExperienceAuthOutcome, { kind: 'ok' }>,
  t: Translate,
): string | null {
  const warnings: string[] = []
  const settingsWarning = saveNotice(outcome.settingsStorage)
  if (settingsWarning !== null && 'key' in settingsWarning) {
    warnings.push(settingsWarning.message === undefined
      ? t(settingsWarning.key)
      : t(settingsWarning.key, { message: settingsWarning.message }))
  }
  if (outcome.credentialsStorage !== null) {
    warnings.push(t('operationFailed', { message: outcome.credentialsStorage }))
  }
  return warnings.length === 0 ? null : warnings.join(' ')
}

/** Render the page status line for a state the editor cannot render from. */
function StatusLine({ state, t, onRetry }: {
  state: 'loading' | 'unavailable' | 'absent' | 'read' | 'section'
  t: Translate
  onRetry: () => void
}): ReactNode {
  return (
    <div className={css.section}>
      <p className={css.status}>
        {state === 'loading' ? t('loading') : null}
        {state === 'unavailable' ? t('unavailable') : null}
        {state === 'absent' ? t('namespaceMissing') : null}
        {state === 'read' || state === 'section' ? t('loadFailed') : null}
      </p>
      {state === 'read'
        ? (
          <p>
            <Button variant="outline" size="sm" onClick={onRetry}>{t('retry')}</Button>
          </p>
        )
        : null}
    </div>
  )
}

/**
 * Render the experience pool section content.
 * @param props - composed slot props (see {@link ExperienceSectionProps}).
 * @returns the settings section element tree.
 */
export function ExperienceSection(props: ExperienceSectionProps): ReactNode {
  const {
    useSettings, load, save, activate, refresh, migrateRequest, migrateComplete,
    health, credentialsState, t,
  } = props
  const mirror = useSettings(snapshot => snapshot)
  const page = useMemo(() => experiencePageState(mirror), [mirror])

  const [showActivate, setShowActivate] = useState(false)
  const [sessionLicense, setSessionLicense] = useState<ExperienceLicenseCache | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState<Busy | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [openCards, setOpenCards] = useState<ReadonlySet<CardId>>(() => new Set())
  const [mailSent, setMailSent] = useState(false)
  const [emailDraft, setEmailDraft] = useState('')
  const [recoveryDraft, setRecoveryDraft] = useState('')
  const [codeDraft, setCodeDraft] = useState('')
  const [healthView, setHealthView] = useState<ExperienceHealthOutcome | null>(null)
  const [healthBusy, setHealthBusy] = useState(false)
  const [credState, setCredState] = useState<ExperienceCredentialsState | null>(null)
  const [credTick, setCredTick] = useState(0)
  const [urlDraft, setUrlDraft] = useState('')

  useEffect(() => {
    if (mirror.status === 'idle') void load()
  }, [load, mirror.status])

  const committedUrl = page.status === 'ready' ? page.settings.baseUrl : null
  useEffect(() => {
    if (committedUrl !== null) setUrlDraft(committedUrl)
  }, [committedUrl])

  const runHealth = useCallback(async (): Promise<void> => {
    setHealthBusy(true)
    const result = await health()
    setHealthView(result)
    setHealthBusy(false)
  }, [health])

  const healthStarted = useRef(false)
  useEffect(() => {
    if (page.status !== 'ready' || healthStarted.current) return
    healthStarted.current = true
    void runHealth()
  }, [page.status, runHealth])

  const ready = page.status === 'ready'
  useEffect(() => {
    if (!ready) return
    let current = true
    void credentialsState().then((state) => { if (current) setCredState(state) })
    return () => { current = false }
  }, [ready, credentialsState, credTick])

  if (page.status !== 'ready') {
    const state = page.status === 'failed' ? page.reason : page.status
    return <StatusLine state={state} t={t} onRetry={() => { void load() }} />
  }

  const committed = page.settings
  const displayLicense = sessionLicense ?? committed.license
  const connected = displayLicense !== undefined && !showActivate
  const remaining = displayLicense === undefined
    ? undefined
    : remainingDays(displayLicense.expiresAt, displayLicense.serverTime)
  const expiring = remaining !== undefined && remaining <= EXPIRING_SOON_DAYS

  /** Fold one auth outcome into notice, license, and mode. */
  const applyAuth = (outcome: ExperienceAuthOutcome, successKey: ExperienceLocaleKey): void => {
    if (outcome.kind === 'device') {
      setNotice({ tone: 'error', key: 'deviceFailed' })
      return
    }
    if (outcome.kind === 'no-token') {
      setNotice({ tone: 'error', key: 'noToken' })
      return
    }
    if (outcome.kind === 'gateway') {
      setNotice(failureNotice(outcome.failure))
      return
    }
    setSessionLicense(outcome.license)
    setKeyDraft('')
    setShowActivate(false)
    setNotice({ tone: 'success', key: successKey })
    setStorageWarning(storageWarningText(outcome, t))
    setCredTick(value => value + 1)
  }

  const onActivate = async (): Promise<void> => {
    const key = keyDraft.trim()
    if (key === '') {
      setNotice({ tone: 'error', key: 'keyRequired' })
      return
    }
    setNotice(null)
    setStorageWarning(null)
    setBusy('activate')
    const outcome = await activate(key)
    setBusy(null)
    applyAuth(outcome, 'activated')
  }

  const onRefresh = async (): Promise<void> => {
    setNotice(null)
    setStorageWarning(null)
    setBusy('refresh')
    const outcome = await refresh()
    setBusy(null)
    applyAuth(outcome, 'refreshed')
  }

  const onSendMail = async (): Promise<void> => {
    if (emailDraft.trim() === '') {
      setNotice({ tone: 'error', key: 'emailRequired' })
      return
    }
    if (recoveryDraft.trim() === '') {
      setNotice({ tone: 'error', key: 'recoveryRequired' })
      return
    }
    setNotice(null)
    setBusy('sendMail')
    const outcome = await migrateRequest(emailDraft.trim(), recoveryDraft.trim())
    setBusy(null)
    // One fixed message for every HTTP success — the server's anti-enumeration
    // semantic; the page never inspects whether the email exists.
    setNotice(outcome.kind === 'ok'
      ? { tone: 'success', key: 'mailSent' }
      : failureNotice(outcome.failure))
    if (outcome.kind === 'ok') setMailSent(true)
  }

  const onSubmitMigration = async (): Promise<void> => {
    if (emailDraft.trim() === '') {
      setNotice({ tone: 'error', key: 'emailRequired' })
      return
    }
    if (recoveryDraft.trim() === '') {
      setNotice({ tone: 'error', key: 'recoveryRequired' })
      return
    }
    if (codeDraft.trim() === '') {
      setNotice({ tone: 'error', key: 'codeRequired' })
      return
    }
    setNotice(null)
    setStorageWarning(null)
    setBusy('submit')
    const outcome = await migrateComplete(emailDraft.trim(), recoveryDraft.trim(), codeDraft.trim())
    setBusy(null)
    applyAuth(outcome, 'migrated')
  }

  const onSaveUrl = async (): Promise<void> => {
    const value = urlDraft.trim()
    if (value === '') {
      setNotice({ tone: 'error', key: 'urlRequired' })
      return
    }
    setNotice(null)
    setStorageWarning(null)
    setBusy('url')
    const outcome = await save({ baseUrl: value })
    setBusy(null)
    const saved = saveNotice(outcome)
    setNotice(saved === null ? { tone: 'success', key: 'urlSaved' } : saved)
  }

  const toggleCard = (id: CardId): void => {
    setOpenCards((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // The page opens folded: a fresh visit shows the three titles and whatever
  // the last action reported, and nothing else.
  const licenseOpen = openCards.has('license')
  const migrateOpen = openCards.has('migrate')
  const healthOpen = openCards.has('health')

  const noticeText = notice === null
    ? null
    : 'raw' in notice
      ? notice.raw
      : notice.message === undefined
        ? t(notice.key)
        : t(notice.key, { message: notice.message })

  return (
    <section className={css.section} aria-labelledby="experience-pool-title">
      <header className={css.header}>
        <div>
          <h3 id="experience-pool-title" className={css.title}>{t('title')}</h3>
          <p className={css.intro}>{t('intro')}</p>
        </div>
      </header>

      {noticeText === null ? null : (
        <p className={css.notice} data-tone={notice?.tone ?? 'error'} role={notice?.tone === 'success' ? 'status' : 'alert'}>
          {noticeText}
        </p>
      )}
      {storageWarning === null ? null : <p className={css.warning} role="status">{storageWarning}</p>}
      {page.staleError === null ? null : <p className={css.notice} data-tone="warning" role="status">{page.staleError}</p>}

      <div className={css.card}>
        <CardHead
          title={t('licenseTitle')}
          open={licenseOpen}
          t={t}
          onToggle={() => { toggleCard('license') }}
        />
        {licenseOpen ? (
          connected ? (
            <>
              <dl className={css.facts}>
                <div className={css.fact}>
                  <dt className={css.factName}>{t('planLabel')}</dt>
                  <dd className={css.factValue}>{displayLicense.planCode}</dd>
                </div>
                <div className={css.fact}>
                  <dt className={css.factName}>{t('statusLabel')}</dt>
                  <dd className={css.factValue}>{displayLicense.status}</dd>
                </div>
                <div className={css.fact}>
                  <dt className={css.factName}>{t('remainingLabel')}</dt>
                  <dd className={expiring ? css.expiring : css.factValue}>
                    {remaining === undefined ? '—' : String(remaining)}
                  </dd>
                </div>
                <div className={css.fact}>
                  <dt className={css.factName}>{t('expiresLabel')}</dt>
                  <dd className={css.factValue}>{displayLicense.expiresAt}</dd>
                </div>
                <div className={css.fact}>
                  <dt className={css.factName}>{t('serverTimeLabel')}</dt>
                  <dd className={css.factValue}>{displayLicense.serverTime}</dd>
                </div>
              </dl>
              {expiring ? <p className={css.expiring} role="status">{t('expiringSoon')}</p> : null}
              {credState?.token === true ? <p className={css.hint}>{t('credentialsHint')}</p> : null}
              <div className={css.actions}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => { void onRefresh() }}
                >
                  {busy === 'refresh' ? t('refreshing') : t('refresh')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => {
                    setKeyDraft('')
                    setShowActivate(true)
                    setNotice(null)
                    setStorageWarning(null)
                  }}
                >
                  {t('replaceKey')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <label className={css.fieldWide}>
                <span className={css.fieldLabel}>{t('keyLabel')}</span>
                <Input
                  type="password"
                  autoComplete="off"
                  value={keyDraft}
                  placeholder={t('keyPlaceholder')}
                  aria-label={t('keyLabel')}
                  disabled={busy !== null}
                  onChange={(event) => { setKeyDraft(event.currentTarget.value) }}
                />
              </label>
              <div className={css.actions}>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => { void onActivate() }}
                >
                  {busy === 'activate' ? t('activating') : t('activate')}
                </Button>
                {displayLicense === undefined ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => {
                      setShowActivate(false)
                      setNotice(null)
                      setStorageWarning(null)
                    }}
                  >
                    {t('backToStatus')}
                  </Button>
                )}
              </div>
            </>
          )
        ) : null}
      </div>

      <div className={css.card}>
        <CardHead
          title={t('migrateTitle')}
          open={migrateOpen}
          t={t}
          onToggle={() => { toggleCard('migrate') }}
        />
        {migrateOpen ? (
          <>
            <p className={css.hint}>{t('migrateIntro')}</p>
            <label className={css.fieldWide}>
              <span className={css.fieldLabel}>{t('emailLabel')}</span>
              <Input
                value={emailDraft}
                placeholder={t('emailPlaceholder')}
                aria-label={t('emailLabel')}
                disabled={busy !== null}
                onChange={(event) => { setEmailDraft(event.currentTarget.value) }}
              />
            </label>
            <label className={css.fieldWide}>
              <span className={css.fieldLabel}>{t('recoveryLabel')}</span>
              <Input
                value={recoveryDraft}
                placeholder={t('recoveryPlaceholder')}
                aria-label={t('recoveryLabel')}
                disabled={busy !== null}
                onChange={(event) => { setRecoveryDraft(event.currentTarget.value) }}
              />
            </label>
            <div className={css.actions}>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => { void onSendMail() }}
              >
                {busy === 'sendMail' ? t('sendingMail') : t('sendMail')}
              </Button>
            </div>
            {mailSent ? <p className={css.hint} role="status">{t('mailSent')}</p> : null}
            {mailSent ? (
              <>
                <label className={css.fieldWide}>
                  <span className={css.fieldLabel}>{t('confirmCodeLabel')}</span>
                  <Input
                    value={codeDraft}
                    placeholder={t('confirmCodePlaceholder')}
                    aria-label={t('confirmCodeLabel')}
                    disabled={busy !== null}
                    onChange={(event) => { setCodeDraft(event.currentTarget.value) }}
                  />
                </label>
                <div className={css.actions}>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => { void onSubmitMigration() }}
                  >
                    {busy === 'submit' ? t('migrating') : t('submitMigration')}
                  </Button>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>

      <div className={css.card}>
        <CardHead
          title={t('healthTitle')}
          open={healthOpen}
          t={t}
          onToggle={() => { toggleCard('health') }}
        >
          <Button
            variant="ghost"
            size="sm"
            disabled={healthBusy}
            onClick={() => { void runHealth() }}
          >
            {healthBusy ? t('healthChecking') : t('healthCheck')}
          </Button>
        </CardHead>
        {healthOpen ? (
          <>
            <div className={css.urlRow}>
              <label className={css.urlField}>
                <span className={css.fieldLabel}>{t('urlLabel')}</span>
                <Input
                  value={urlDraft}
                  placeholder={t('urlPlaceholder')}
                  aria-label={t('urlLabel')}
                  disabled={busy !== null}
                  onChange={(event) => { setUrlDraft(event.currentTarget.value) }}
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null || urlDraft.trim() === committed.baseUrl}
                onClick={() => { void onSaveUrl() }}
              >
                {busy === 'url' ? t('savingUrl') : t('saveUrl')}
              </Button>
            </div>
            {healthView === null && healthBusy ? <p className={css.hint}>{t('healthChecking')}</p> : null}
            {healthView === null ? null : (
              <div className={css.healthRows}>
                <div className={css.healthRow}>
                  <Tag tone={healthView.gateway === 'up' ? 'success' : 'danger'}>
                    {healthView.gateway === 'up' ? t('gatewayUp') : t('gatewayDown')}
                  </Tag>
                  <Tag tone={healthView.qdrant === 'up' ? 'success' : healthView.qdrant === 'down' ? 'danger' : 'neutral'}>
                    {healthView.qdrant === 'up' ? t('qdrantUp') : healthView.qdrant === 'down' ? t('qdrantDown') : t('qdrantUnknown')}
                  </Tag>
                </div>
                {healthView.gateway === 'down' ? <p className={css.hint}>{t('gatewayDownHint')}</p> : null}
                {healthView.detail === undefined ? null : <p className={css.hint}>{healthView.detail}</p>}
              </div>
            )}
          </>
        ) : null}
      </div>
    </section>
  )
}
