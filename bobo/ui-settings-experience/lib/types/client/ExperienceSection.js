import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconChevronDownOutlineRegular, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { experiencePageState, } from "./experience.js";
import { EXPIRING_SOON_DAYS, remainingDays } from "./license-api.js";
import css from './ExperienceSection.module.css';
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
function CardHead({ title, open, t, onToggle, children }) {
    return (_jsxs("div", { className: css.cardHead, children: [_jsx("button", { type: "button", className: css.expandButton, "aria-expanded": open, "aria-label": open ? t('collapseCard', { name: title }) : t('expandCard', { name: title }), onClick: onToggle, children: _jsx(IconChevronDownOutlineRegular, { className: open ? css.chevronOpen : css.chevronClosed, "aria-hidden": "true" }) }), _jsx("span", { className: css.cardName, children: title }), children] }));
}
/** Turn one gateway failure into the notice the page renders. */
function failureNotice(failure) {
    switch (failure.kind) {
        case 'timeout':
            return { tone: 'error', key: 'errTimeout' };
        case 'network':
            return { tone: 'error', key: 'errNetwork' };
        case 'malformed':
            return { tone: 'error', key: 'errMalformed' };
        case 'http':
            return failure.description === undefined
                ? { tone: 'error', key: 'errHttp', message: String(failure.status) }
                : { tone: 'error', raw: failure.description };
    }
}
/** Turn a refused settings write into a notice; a commit needs no notice. */
function saveNotice(outcome) {
    switch (outcome.kind) {
        case 'written':
            return null;
        case 'conflict':
            return { tone: 'error', key: 'conflict' };
        case 'absent':
            return { tone: 'error', key: 'namespaceMissing' };
        case 'refused':
            return { tone: 'error', key: 'operationFailed', message: outcome.message };
    }
}
/** Localized warning line for the stores an `ok` outcome could not finish. */
function storageWarningText(outcome, t) {
    const warnings = [];
    const settingsWarning = saveNotice(outcome.settingsStorage);
    if (settingsWarning !== null && 'key' in settingsWarning) {
        warnings.push(settingsWarning.message === undefined
            ? t(settingsWarning.key)
            : t(settingsWarning.key, { message: settingsWarning.message }));
    }
    if (outcome.credentialsStorage !== null) {
        warnings.push(t('operationFailed', { message: outcome.credentialsStorage }));
    }
    return warnings.length === 0 ? null : warnings.join(' ');
}
/** Render the page status line for a state the editor cannot render from. */
function StatusLine({ state, t, onRetry }) {
    return (_jsxs("div", { className: css.section, children: [_jsxs("p", { className: css.status, children: [state === 'loading' ? t('loading') : null, state === 'unavailable' ? t('unavailable') : null, state === 'absent' ? t('namespaceMissing') : null, state === 'read' || state === 'section' ? t('loadFailed') : null] }), state === 'read'
                ? (_jsx("p", { children: _jsx(Button, { variant: "outline", size: "sm", onClick: onRetry, children: t('retry') }) }))
                : null] }));
}
/**
 * Render the experience pool section content.
 * @param props - composed slot props (see {@link ExperienceSectionProps}).
 * @returns the settings section element tree.
 */
export function ExperienceSection(props) {
    const { useSettings, load, save, activate, refresh, migrateRequest, migrateComplete, health, credentialsState, t, } = props;
    const mirror = useSettings(snapshot => snapshot);
    const page = useMemo(() => experiencePageState(mirror), [mirror]);
    const [showActivate, setShowActivate] = useState(false);
    const [sessionLicense, setSessionLicense] = useState(null);
    const [keyDraft, setKeyDraft] = useState('');
    const [busy, setBusy] = useState(null);
    const [notice, setNotice] = useState(null);
    const [storageWarning, setStorageWarning] = useState(null);
    const [openCards, setOpenCards] = useState(() => new Set());
    const [mailSent, setMailSent] = useState(false);
    const [emailDraft, setEmailDraft] = useState('');
    const [recoveryDraft, setRecoveryDraft] = useState('');
    const [codeDraft, setCodeDraft] = useState('');
    const [healthView, setHealthView] = useState(null);
    const [healthBusy, setHealthBusy] = useState(false);
    const [credState, setCredState] = useState(null);
    const [credTick, setCredTick] = useState(0);
    const [urlDraft, setUrlDraft] = useState('');
    useEffect(() => {
        if (mirror.status === 'idle')
            void load();
    }, [load, mirror.status]);
    const committedUrl = page.status === 'ready' ? page.settings.baseUrl : null;
    useEffect(() => {
        if (committedUrl !== null)
            setUrlDraft(committedUrl);
    }, [committedUrl]);
    const runHealth = useCallback(async () => {
        setHealthBusy(true);
        const result = await health();
        setHealthView(result);
        setHealthBusy(false);
    }, [health]);
    const healthStarted = useRef(false);
    useEffect(() => {
        if (page.status !== 'ready' || healthStarted.current)
            return;
        healthStarted.current = true;
        void runHealth();
    }, [page.status, runHealth]);
    const ready = page.status === 'ready';
    useEffect(() => {
        if (!ready)
            return;
        let current = true;
        void credentialsState().then((state) => { if (current)
            setCredState(state); });
        return () => { current = false; };
    }, [ready, credentialsState, credTick]);
    if (page.status !== 'ready') {
        const state = page.status === 'failed' ? page.reason : page.status;
        return _jsx(StatusLine, { state: state, t: t, onRetry: () => { void load(); } });
    }
    const committed = page.settings;
    const displayLicense = sessionLicense ?? committed.license;
    const connected = displayLicense !== undefined && !showActivate;
    const remaining = displayLicense === undefined
        ? undefined
        : remainingDays(displayLicense.expiresAt, displayLicense.serverTime);
    const expiring = remaining !== undefined && remaining <= EXPIRING_SOON_DAYS;
    /** Fold one auth outcome into notice, license, and mode. */
    const applyAuth = (outcome, successKey) => {
        if (outcome.kind === 'device') {
            setNotice({ tone: 'error', key: 'deviceFailed' });
            return;
        }
        if (outcome.kind === 'no-token') {
            setNotice({ tone: 'error', key: 'noToken' });
            return;
        }
        if (outcome.kind === 'gateway') {
            setNotice(failureNotice(outcome.failure));
            return;
        }
        setSessionLicense(outcome.license);
        setKeyDraft('');
        setShowActivate(false);
        setNotice({ tone: 'success', key: successKey });
        setStorageWarning(storageWarningText(outcome, t));
        setCredTick(value => value + 1);
    };
    const onActivate = async () => {
        const key = keyDraft.trim();
        if (key === '') {
            setNotice({ tone: 'error', key: 'keyRequired' });
            return;
        }
        setNotice(null);
        setStorageWarning(null);
        setBusy('activate');
        const outcome = await activate(key);
        setBusy(null);
        applyAuth(outcome, 'activated');
    };
    const onRefresh = async () => {
        setNotice(null);
        setStorageWarning(null);
        setBusy('refresh');
        const outcome = await refresh();
        setBusy(null);
        applyAuth(outcome, 'refreshed');
    };
    const onSendMail = async () => {
        if (emailDraft.trim() === '') {
            setNotice({ tone: 'error', key: 'emailRequired' });
            return;
        }
        if (recoveryDraft.trim() === '') {
            setNotice({ tone: 'error', key: 'recoveryRequired' });
            return;
        }
        setNotice(null);
        setBusy('sendMail');
        const outcome = await migrateRequest(emailDraft.trim(), recoveryDraft.trim());
        setBusy(null);
        // One fixed message for every HTTP success — the server's anti-enumeration
        // semantic; the page never inspects whether the email exists.
        setNotice(outcome.kind === 'ok'
            ? { tone: 'success', key: 'mailSent' }
            : failureNotice(outcome.failure));
        if (outcome.kind === 'ok')
            setMailSent(true);
    };
    const onSubmitMigration = async () => {
        if (emailDraft.trim() === '') {
            setNotice({ tone: 'error', key: 'emailRequired' });
            return;
        }
        if (recoveryDraft.trim() === '') {
            setNotice({ tone: 'error', key: 'recoveryRequired' });
            return;
        }
        if (codeDraft.trim() === '') {
            setNotice({ tone: 'error', key: 'codeRequired' });
            return;
        }
        setNotice(null);
        setStorageWarning(null);
        setBusy('submit');
        const outcome = await migrateComplete(emailDraft.trim(), recoveryDraft.trim(), codeDraft.trim());
        setBusy(null);
        applyAuth(outcome, 'migrated');
    };
    const onSaveUrl = async () => {
        const value = urlDraft.trim();
        if (value === '') {
            setNotice({ tone: 'error', key: 'urlRequired' });
            return;
        }
        setNotice(null);
        setStorageWarning(null);
        setBusy('url');
        const outcome = await save({ baseUrl: value });
        setBusy(null);
        const saved = saveNotice(outcome);
        setNotice(saved === null ? { tone: 'success', key: 'urlSaved' } : saved);
    };
    const toggleCard = (id) => {
        setOpenCards((previous) => {
            const next = new Set(previous);
            if (next.has(id))
                next.delete(id);
            else
                next.add(id);
            return next;
        });
    };
    // The page opens folded: a fresh visit shows the three titles and whatever
    // the last action reported, and nothing else.
    const licenseOpen = openCards.has('license');
    const migrateOpen = openCards.has('migrate');
    const healthOpen = openCards.has('health');
    const noticeText = notice === null
        ? null
        : 'raw' in notice
            ? notice.raw
            : notice.message === undefined
                ? t(notice.key)
                : t(notice.key, { message: notice.message });
    return (_jsxs("section", { className: css.section, "aria-labelledby": "experience-pool-title", children: [_jsx("header", { className: css.header, children: _jsxs("div", { children: [_jsx("h3", { id: "experience-pool-title", className: css.title, children: t('title') }), _jsx("p", { className: css.intro, children: t('intro') })] }) }), noticeText === null ? null : (_jsx("p", { className: css.notice, "data-tone": notice?.tone ?? 'error', role: notice?.tone === 'success' ? 'status' : 'alert', children: noticeText })), storageWarning === null ? null : _jsx("p", { className: css.warning, role: "status", children: storageWarning }), page.staleError === null ? null : _jsx("p", { className: css.notice, "data-tone": "warning", role: "status", children: page.staleError }), _jsxs("div", { className: css.card, children: [_jsx(CardHead, { title: t('licenseTitle'), open: licenseOpen, t: t, onToggle: () => { toggleCard('license'); } }), licenseOpen ? (connected ? (_jsxs(_Fragment, { children: [_jsxs("dl", { className: css.facts, children: [_jsxs("div", { className: css.fact, children: [_jsx("dt", { className: css.factName, children: t('planLabel') }), _jsx("dd", { className: css.factValue, children: displayLicense.planCode })] }), _jsxs("div", { className: css.fact, children: [_jsx("dt", { className: css.factName, children: t('statusLabel') }), _jsx("dd", { className: css.factValue, children: displayLicense.status })] }), _jsxs("div", { className: css.fact, children: [_jsx("dt", { className: css.factName, children: t('remainingLabel') }), _jsx("dd", { className: expiring ? css.expiring : css.factValue, children: remaining === undefined ? '—' : String(remaining) })] }), _jsxs("div", { className: css.fact, children: [_jsx("dt", { className: css.factName, children: t('expiresLabel') }), _jsx("dd", { className: css.factValue, children: displayLicense.expiresAt })] }), _jsxs("div", { className: css.fact, children: [_jsx("dt", { className: css.factName, children: t('serverTimeLabel') }), _jsx("dd", { className: css.factValue, children: displayLicense.serverTime })] })] }), expiring ? _jsx("p", { className: css.expiring, role: "status", children: t('expiringSoon') }) : null, credState?.token === true ? _jsx("p", { className: css.hint, children: t('credentialsHint') }) : null, _jsxs("div", { className: css.actions, children: [_jsx(Button, { variant: "outline", size: "sm", disabled: busy !== null, onClick: () => { void onRefresh(); }, children: busy === 'refresh' ? t('refreshing') : t('refresh') }), _jsx(Button, { variant: "ghost", size: "sm", disabled: busy !== null, onClick: () => {
                                            setKeyDraft('');
                                            setShowActivate(true);
                                            setNotice(null);
                                            setStorageWarning(null);
                                        }, children: t('replaceKey') })] })] })) : (_jsxs(_Fragment, { children: [_jsxs("label", { className: css.fieldWide, children: [_jsx("span", { className: css.fieldLabel, children: t('keyLabel') }), _jsx(Input, { type: "password", autoComplete: "off", value: keyDraft, placeholder: t('keyPlaceholder'), "aria-label": t('keyLabel'), disabled: busy !== null, onChange: (event) => { setKeyDraft(event.currentTarget.value); } })] }), _jsxs("div", { className: css.actions, children: [_jsx(Button, { variant: "primary", size: "sm", disabled: busy !== null, onClick: () => { void onActivate(); }, children: busy === 'activate' ? t('activating') : t('activate') }), displayLicense === undefined ? null : (_jsx(Button, { variant: "ghost", size: "sm", disabled: busy !== null, onClick: () => {
                                            setShowActivate(false);
                                            setNotice(null);
                                            setStorageWarning(null);
                                        }, children: t('backToStatus') }))] })] }))) : null] }), _jsxs("div", { className: css.card, children: [_jsx(CardHead, { title: t('migrateTitle'), open: migrateOpen, t: t, onToggle: () => { toggleCard('migrate'); } }), migrateOpen ? (_jsxs(_Fragment, { children: [_jsx("p", { className: css.hint, children: t('migrateIntro') }), _jsxs("label", { className: css.fieldWide, children: [_jsx("span", { className: css.fieldLabel, children: t('emailLabel') }), _jsx(Input, { value: emailDraft, placeholder: t('emailPlaceholder'), "aria-label": t('emailLabel'), disabled: busy !== null, onChange: (event) => { setEmailDraft(event.currentTarget.value); } })] }), _jsxs("label", { className: css.fieldWide, children: [_jsx("span", { className: css.fieldLabel, children: t('recoveryLabel') }), _jsx(Input, { value: recoveryDraft, placeholder: t('recoveryPlaceholder'), "aria-label": t('recoveryLabel'), disabled: busy !== null, onChange: (event) => { setRecoveryDraft(event.currentTarget.value); } })] }), _jsx("div", { className: css.actions, children: _jsx(Button, { variant: "outline", size: "sm", disabled: busy !== null, onClick: () => { void onSendMail(); }, children: busy === 'sendMail' ? t('sendingMail') : t('sendMail') }) }), mailSent ? _jsx("p", { className: css.hint, role: "status", children: t('mailSent') }) : null, mailSent ? (_jsxs(_Fragment, { children: [_jsxs("label", { className: css.fieldWide, children: [_jsx("span", { className: css.fieldLabel, children: t('confirmCodeLabel') }), _jsx(Input, { value: codeDraft, placeholder: t('confirmCodePlaceholder'), "aria-label": t('confirmCodeLabel'), disabled: busy !== null, onChange: (event) => { setCodeDraft(event.currentTarget.value); } })] }), _jsx("div", { className: css.actions, children: _jsx(Button, { variant: "primary", size: "sm", disabled: busy !== null, onClick: () => { void onSubmitMigration(); }, children: busy === 'submit' ? t('migrating') : t('submitMigration') }) })] })) : null] })) : null] }), _jsxs("div", { className: css.card, children: [_jsx(CardHead, { title: t('healthTitle'), open: healthOpen, t: t, onToggle: () => { toggleCard('health'); }, children: _jsx(Button, { variant: "ghost", size: "sm", disabled: healthBusy, onClick: () => { void runHealth(); }, children: healthBusy ? t('healthChecking') : t('healthCheck') }) }), healthOpen ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: css.urlRow, children: [_jsxs("label", { className: css.urlField, children: [_jsx("span", { className: css.fieldLabel, children: t('urlLabel') }), _jsx(Input, { value: urlDraft, placeholder: t('urlPlaceholder'), "aria-label": t('urlLabel'), disabled: busy !== null, onChange: (event) => { setUrlDraft(event.currentTarget.value); } })] }), _jsx(Button, { variant: "outline", size: "sm", disabled: busy !== null || urlDraft.trim() === committed.baseUrl, onClick: () => { void onSaveUrl(); }, children: busy === 'url' ? t('savingUrl') : t('saveUrl') })] }), healthView === null && healthBusy ? _jsx("p", { className: css.hint, children: t('healthChecking') }) : null, healthView === null ? null : (_jsxs("div", { className: css.healthRows, children: [_jsxs("div", { className: css.healthRow, children: [_jsx(Tag, { tone: healthView.gateway === 'up' ? 'success' : 'danger', children: healthView.gateway === 'up' ? t('gatewayUp') : t('gatewayDown') }), _jsx(Tag, { tone: healthView.qdrant === 'up' ? 'success' : healthView.qdrant === 'down' ? 'danger' : 'neutral', children: healthView.qdrant === 'up' ? t('qdrantUp') : healthView.qdrant === 'down' ? t('qdrantDown') : t('qdrantUnknown') })] }), healthView.gateway === 'down' ? _jsx("p", { className: css.hint, children: t('gatewayDownHint') }) : null, healthView.detail === undefined ? null : _jsx("p", { className: css.hint, children: healthView.detail })] }))] })) : null] })] }));
}
//# sourceMappingURL=ExperienceSection.js.map