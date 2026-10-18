import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Proxy Pool settings page: the master switch, the fetch strategy, and the
 * ordered source list the host `/proxy` command draws addresses from.
 *
 * The page edits one draft and commits it as a whole, so a half-typed URL
 * never reaches the host. The host stays the single fact source: an untouched
 * page always renders the last committed value, and a committed draft is
 * dropped in favour of the answer the write returned.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconPlusOutlineMedium, IconTrashOutlineMedium, Input, Switch, } from '@deepseek-ai/dsh-client-ui-primitives';
import { FETCH_STRATEGIES, NEW_PROXY_SOURCE, PROXY_HTTP_TYPES, dropExpanded, moveEntry, moveExpanded, proxyPoolPageState, reorderSources, } from "./proxy-pool.js";
import css from './ProxyPoolSection.module.css';
/**
 * One source's own card: identity on the collapsed row, the full field set
 * once expanded, and the ordering controls that set its priority.
 */
function SourceCard({ source, index, count, readOnly, expanded, drag, t, onToggle, onChange, onRemove, onMove }) {
    const name = source.name.trim() === '' ? t('unnamed') : source.name;
    const classes = [css['card']];
    if (drag?.dragging === true)
        classes.push(css['cardDragging']);
    if (drag?.target === true)
        classes.push(css['cardDropTarget']);
    return (_jsxs("li", { className: classes.join(' '), onDragOver: drag?.onOver, onDrop: drag?.onDrop, children: [_jsxs("div", { className: css['cardHead'], children: [drag === undefined ? null : (_jsx("span", { className: css['dragHandle'], draggable: true, title: t('dragHandleShort'), "aria-label": t('dragHandle', { name }), onDragStart: drag.onStart, onDragEnd: drag.onEnd, children: "\u2261" })), _jsx("button", { type: "button", className: css['expandButton'], "aria-expanded": expanded, "aria-label": name, onClick: onToggle, children: _jsx(IconChevronDownOutlineRegular, { className: expanded ? css['chevronOpen'] : css['chevronClosed'] }) }), expanded ? (_jsx(Input, { className: `${css['nameInput']}`, value: source.name, placeholder: t('sourceNamePlaceholder'), "aria-label": t('sourceName'), disabled: readOnly, onChange: (event) => { onChange({ name: event.currentTarget.value }); } })) : (_jsx("span", { className: css['cardName'], children: name })), source.enabled ? null : _jsx("span", { className: css['cardTag'], children: t('disabledTag') }), _jsxs("span", { className: css['cardActions'], children: [_jsx(Button, { variant: "ghost", size: "sm", disabled: readOnly || index === 0, title: t('moveUpShort'), "aria-label": t('moveUp', { name }), onClick: () => { onMove(index - 1); }, children: _jsx(IconChevronUpOutlineRegular, {}) }), _jsx(Button, { variant: "ghost", size: "sm", disabled: readOnly || index === count - 1, title: t('moveDownShort'), "aria-label": t('moveDown', { name }), onClick: () => { onMove(index + 1); }, children: _jsx(IconChevronDownOutlineRegular, {}) }), _jsx(Switch, { checked: source.enabled, disabled: readOnly, label: t('enabledNamed', { name }), onChange: (next) => { onChange({ enabled: next }); } }), _jsx(Button, { variant: "ghost", size: "sm", disabled: readOnly, title: t('remove'), "aria-label": t('removeNamed', { name }), onClick: onRemove, children: _jsx(IconTrashOutlineMedium, {}) })] })] }), expanded ? (_jsxs("div", { className: css['fields'], children: [_jsxs("label", { className: css['fieldWide'], children: [_jsx("span", { className: css['fieldLabel'], children: t('apiUrl') }), _jsx(Input, { value: source.apiUrl, placeholder: t('apiUrlPlaceholder'), disabled: readOnly, onChange: (event) => { onChange({ apiUrl: event.currentTarget.value }); } })] }), _jsxs("label", { className: css['field'], children: [_jsx("span", { className: css['fieldLabel'], children: t('apiKey') }), _jsx(Input, { value: source.apiKey, disabled: readOnly, onChange: (event) => { onChange({ apiKey: event.currentTarget.value }); } })] }), _jsxs("label", { className: css['field'], children: [_jsx("span", { className: css['fieldLabel'], children: t('pwd') }), _jsx(Input, { value: source.pwd, disabled: readOnly, onChange: (event) => { onChange({ pwd: event.currentTarget.value }); } })] }), _jsxs("label", { className: css['field'], children: [_jsx("span", { className: css['fieldLabel'], children: t('getnum') }), _jsx(Input, { type: "number", min: 1, value: source.getnum, disabled: readOnly, onChange: (event) => { onChange({ getnum: countFrom(event.currentTarget.value, source.getnum) }); } })] }), _jsxs("label", { className: css['field'], children: [_jsx("span", { className: css['fieldLabel'], children: t('httpType') }), _jsxs("select", { className: css['select'], value: source.httptype, "aria-label": t('httpType'), disabled: readOnly, onChange: (event) => { onChange({ httptype: event.currentTarget.value }); }, children: [PROXY_HTTP_TYPES.map(type => _jsx("option", { value: type, children: type }, type)), PROXY_HTTP_TYPES.some(type => type === source.httptype)
                                        ? null
                                        : _jsx("option", { value: source.httptype, children: source.httptype })] })] }), _jsxs("label", { className: css['field'], children: [_jsx("span", { className: css['fieldLabel'], children: t('geshi') }), _jsx(Input, { value: source.geshi, disabled: readOnly, onChange: (event) => { onChange({ geshi: event.currentTarget.value }); } })] }), _jsxs("label", { className: css['field'], children: [_jsx("span", { className: css['fieldLabel'], children: t('fenge') }), _jsx(Input, { value: source.fenge, disabled: readOnly, onChange: (event) => { onChange({ fenge: event.currentTarget.value }); } })] })] })) : null] }));
}
/**
 * Read a positive count out of a number field, keeping the previous value for
 * an empty or fractional entry (a cleared field parses to no count at all).
 * @param raw - the field's text.
 * @param previous - the value to keep when the entry names no count.
 * @returns the count the pool should store.
 */
function countFrom(raw, previous) {
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : previous;
}
/** Render the page status line for a state the editor cannot render from. */
function StatusLine({ state, t }) {
    return (_jsxs("div", { className: css['section'], children: [_jsxs("p", { className: css['status'], children: [state === 'loading' ? t('loading') : null, state === 'unavailable' ? t('unavailable') : null, state === 'absent' ? t('namespaceMissing') : null, state === 'read' ? t('loadFailed') : null, state === 'section' ? t('malformed') : null] }), state === 'absent' ? _jsx("p", { className: css['status'], children: t('namespaceHint') }) : null] }));
}
/**
 * Render the Proxy Pool section content.
 * @param props - composed slot props (see {@link ProxyPoolSectionProps}).
 * @returns the settings section element tree.
 */
export function ProxyPoolSection(props) {
    const { useSettings, load, save, t } = props;
    return _jsx(Loaded, { face: { useSettings, load, save }, t: t });
}
function Loaded({ face, t }) {
    const { useSettings, load, save } = face;
    const mirror = useSettings(snapshot => snapshot);
    // Memoized on the mirrored snapshot so one render does not re-decode the
    // pool the page is not editing.
    const page = useMemo(() => proxyPoolPageState(mirror), [mirror]);
    const [draft, setDraft] = useState(undefined);
    // Open rows by rendered position. Positions rather than entries because every
    // field edit replaces the edited entry with a new record, and an open row has
    // to survive the edit that is being typed into it. Committing or dropping the
    // draft closes every row, so the set only describes the draft in progress.
    const [expanded, setExpanded] = useState(() => new Set());
    const [saving, setSaving] = useState(false);
    const [failure, setFailure] = useState(undefined);
    const [saved, setSaved] = useState(false);
    const [dragIndex, setDragIndex] = useState(undefined);
    const [dropIndex, setDropIndex] = useState(undefined);
    useEffect(() => {
        if (mirror.status === 'idle')
            void load();
    }, [load, mirror.status]);
    if (page.status !== 'ready') {
        return _jsx(StatusLine, { state: page.status === 'failed' ? page.reason : page.status, t: t });
    }
    const committed = page.settings;
    const settings = draft ?? committed;
    const dirty = draft !== undefined;
    const readOnly = !page.writable;
    const patch = (next) => {
        setSaved(false);
        setDraft(previous => ({ ...(previous ?? committed), ...next }));
    };
    const patchSource = (index, next) => {
        patch({ sources: settings.sources.map((source, at) => at === index ? { ...source, ...next } : source) });
    };
    const addSource = () => {
        const source = { ...NEW_PROXY_SOURCE, name: t('newSourceName', { index: settings.sources.length + 1 }) };
        patch({ sources: [...settings.sources, source] });
        // The appended row is the one the user has to fill in, so it opens.
        setExpanded(previous => new Set([...previous, settings.sources.length]));
    };
    const removeSource = (index) => {
        patch({ sources: settings.sources.filter((_source, at) => at !== index) });
        setExpanded(previous => dropExpanded(previous, index));
    };
    const moveSource = (from, to) => {
        patch({ sources: [...moveEntry(settings.sources, from, to)] });
        setExpanded(previous => moveExpanded(previous, from, to));
    };
    /**
     * Settle the gesture. A drop and a release outside the list both end here,
     * so no row keeps a highlight the pointer has left behind.
     */
    const endDrag = () => {
        setDragIndex(undefined);
        setDropIndex(undefined);
    };
    /**
     * Carry one source. The gesture carries its index as text as well, because a
     * drag that sets no data does not start at all in Firefox.
     * @param event - the row's dragstart.
     * @param index - the carried source's position in the rendered list.
     */
    const startDrag = (event, index) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
        setDragIndex(index);
    };
    /**
     * Mark the row a live drag would land on. A gesture this page did not start
     * carries no source, so it keeps the browser's own refusal.
     * @param event - the row's dragover.
     * @param index - the hovered row's position in the rendered list.
     */
    const overDrag = (event, index) => {
        if (dragIndex === undefined)
            return;
        // Only a prevented default accepts a drop.
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropIndex(index);
    };
    /**
     * Apply the drop through the same fold the priority buttons use, and settle
     * the gesture. A drop that asks for no move leaves the draft untouched.
     * @param event - the row's drop.
     * @param index - the target row's position in the rendered list.
     */
    const dropDrag = (event, index) => {
        if (dragIndex === undefined)
            return;
        event.preventDefault();
        const next = reorderSources(settings.sources, dragIndex, index);
        if (next !== null) {
            patch({ sources: [...next] });
            setExpanded(previous => moveExpanded(previous, dragIndex, index));
        }
        endDrag();
    };
    const toggleSource = (index) => {
        setExpanded((previous) => {
            const next = new Set(previous);
            if (next.has(index))
                next.delete(index);
            else
                next.add(index);
            return next;
        });
    };
    const submit = async () => {
        if (draft === undefined)
            return;
        setSaving(true);
        setFailure(undefined);
        setSaved(false);
        const outcome = await save(draft);
        setSaving(false);
        if (outcome.kind === 'written') {
            // The committed draft leaves nothing in progress, so every row closes
            // back to its name — including the one just filled in.
            setDraft(undefined);
            setExpanded(new Set());
            setSaved(true);
            return;
        }
        if (outcome.kind === 'conflict')
            setFailure(t('conflict'));
        else if (outcome.kind === 'absent')
            setFailure(t('namespaceMissing'));
        else
            setFailure(outcome.message);
    };
    return (_jsxs("div", { className: css['section'], children: [_jsxs("div", { className: css['header'], children: [_jsx("h2", { className: css['title'], children: t('title') }), _jsx("p", { className: css['intro'], children: t('intro') })] }), readOnly ? _jsx("p", { className: css['notice'], children: t('readOnly') }) : null, page.staleError === null ? null : _jsx("p", { className: css['notice'], children: page.staleError }), _jsxs("div", { className: css['switchRow'], children: [_jsx(Switch, { checked: settings.enabled, disabled: readOnly, label: t('enabled'), onChange: (next) => { patch({ enabled: next }); } }), _jsxs("span", { className: css['switchText'], children: [_jsx("span", { className: css['switchTitle'], children: t('enabled') }), _jsx("span", { className: css['hint'], children: t('enabledHint') })] })] }), _jsxs("div", { className: css['settingsGrid'], children: [_jsxs("label", { className: css['field'], children: [_jsx("span", { className: css['fieldLabel'], children: t('strategy') }), _jsx("select", { className: css['select'], value: settings.fetchStrategy, "aria-label": t('strategy'), disabled: readOnly, onChange: (event) => {
                                    patch({ fetchStrategy: event.currentTarget.value });
                                }, children: FETCH_STRATEGIES.map(strategy => (_jsx("option", { value: strategy, children: strategy === 'cache' ? t('strategyCache') : t('strategyRealtime') }, strategy))) })] }), _jsxs("label", { className: css['field'], children: [_jsx("span", { className: css['fieldLabel'], children: t('maxRetries') }), _jsx(Input, { type: "number", min: 1, value: settings.maxRetries, disabled: readOnly, onChange: (event) => { patch({ maxRetries: countFrom(event.currentTarget.value, settings.maxRetries) }); } })] }), _jsxs("label", { className: css['field'], children: [_jsx("span", { className: css['fieldLabel'], children: t('timeoutMs') }), _jsx(Input, { type: "number", min: 1000, step: 1000, value: settings.timeoutMs, disabled: readOnly, onChange: (event) => { patch({ timeoutMs: countFrom(event.currentTarget.value, settings.timeoutMs) }); } })] })] }), _jsxs("div", { className: css['sources'], children: [_jsxs("div", { className: css['sourcesHead'], children: [_jsx("span", { className: css['sectionLabel'], children: t('sources') }), _jsx(Button, { variant: "outline", size: "sm", icon: _jsx(IconPlusOutlineMedium, {}), disabled: readOnly, onClick: addSource, children: t('addSource') })] }), _jsx("p", { className: css['hint'], children: t('sourcesHint') }), settings.sources.length === 0
                        ? _jsx("p", { className: css['empty'], children: t('sourcesEmpty') })
                        : (_jsx("ol", { className: css['list'], children: settings.sources.map((source, index) => {
                                const drag = readOnly
                                    ? undefined
                                    : {
                                        dragging: dragIndex === index,
                                        // The carried row is never its own target: that drop asks
                                        // for no move.
                                        target: dropIndex === index && dragIndex !== index,
                                        onStart: (event) => { startDrag(event, index); },
                                        onOver: (event) => { overDrag(event, index); },
                                        onDrop: (event) => { dropDrag(event, index); },
                                        onEnd: endDrag,
                                    };
                                return (_jsx(SourceCard, { source: source, index: index, count: settings.sources.length, readOnly: readOnly, expanded: expanded.has(index), drag: drag, t: t, onToggle: () => { toggleSource(index); }, onChange: next => { patchSource(index, next); }, onRemove: () => { removeSource(index); }, onMove: (to) => { moveSource(index, to); } }, index));
                            }) }))] }), _jsxs("div", { className: css['actions'], children: [failure === undefined ? null : _jsx("p", { className: css['error'], children: failure }), saved ? _jsx("p", { className: css['savedNotice'], children: t('saved') }) : null, _jsx(Button, { variant: "outline", disabled: !dirty || saving, onClick: () => {
                            setDraft(undefined);
                            setExpanded(new Set());
                            setFailure(undefined);
                            setSaved(false);
                        }, children: t('cancel') }), _jsx(Button, { variant: "primary", disabled: !dirty || saving || readOnly, onClick: () => { void submit(); }, children: saving ? t('saving') : t('save') })] })] }));
}
//# sourceMappingURL=ProxyPoolSection.js.map