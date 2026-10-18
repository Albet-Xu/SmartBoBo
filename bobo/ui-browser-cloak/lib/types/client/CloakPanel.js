import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The right Sidebar's built-in browser panel: a frame-by-frame JPEG mirror of
 * the deployment's long-lived Cloak page, plus the input channel that drives
 * that page.
 *
 * SHARED SESSION PAGE — READ BEFORE CHANGING BEHAVIOUR. The panel owns no
 * browser and no page. Every command goes to the host bridge on
 * `/bobo-cloak/cmd`, which forwards it to the deployment's derived-port
 * Cloak service (`scripts/browser_server.py`); that service holds the
 * session page, shared with the agent's own browser work. So navigating here
 * replaces the page an agent is reading, an agent's `debug_navigate` replaces
 * the page here (the very next frame shows it), and the panel's navigations show
 * up in the agent's `debug_network`. That sharing is deliberate: one login, one
 * cookie jar, one current page.
 *
 * TABS AND POPUPS. A link that opens a new window — `target="_blank"`,
 * `window.open`, a middle-click — is followed by the service, which keeps the
 * page it came from as a background tab; the strip above the toolbar lists those
 * tabs and switches or closes them. An agent's `debug_navigate` is a takeover
 * rather than a new tab, and `debug_close` empties the whole set.
 *
 * State discipline: this component holds only local state. It never reads a
 * Context, never subscribes through a custom store, and never touches `ctx` —
 * the sole business input is the injected `t` seat, and every request leaves
 * from an event handler or an effect this component owns.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, IconBrowseOutlineMedium, IconCloseOutlineMedium, IconLinkOutlineRegular, IconRefreshOutlineRegular, IconSendOutlineRegular, } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './CloakPanel.module.css';
/**
 * The one bridge route, shared with the handoff watcher that asks the bridge for
 * a waiting handoff on it; same-origin, so the browser attaches the session
 * cookie by itself.
 */
export const COMMAND_URL = '/bobo-cloak/cmd';
/**
 * Interval between two frame requests. This is the panel's frame rate, and the
 * whole cost of a mirror: every tick renders and JPEG-encodes the shared page
 * on the service side, so lowering it makes every open panel — and the agent's
 * own work against that page — busier. 180ms is roughly 5.5 frames per second.
 * Tune here; nothing else depends on the value.
 */
const FRAME_INTERVAL_MS = 180;
/** Leading-edge throttle for pointer moves: the service only needs the newest position. */
const MOVE_THROTTLE_MS = 50;
/**
 * Interval between two tab-list reads. The strip is a few small fields per tab,
 * so it costs far less than a frame, and 1s is enough for a tab that a link
 * opened to appear right after the picture has already followed it.
 */
const TABS_INTERVAL_MS = 1000;
/** Frame quality sent with every screenshot; lower means smaller frames and softer text. */
const FRAME_QUALITY = 60;
/** One screenshot's budget: the service renders and encodes a JPEG inside it. */
const SCREENSHOT_TIMEOUT_MS = 30_000;
/** Every other command's budget, `debug_navigate` included. */
const COMMAND_TIMEOUT_MS = 15_000;
/** Budget for `start`, which may launch a whole browser process. */
const START_TIMEOUT_MS = 60_000;
/**
 * Pixels per wheel line, used to convert a `deltaMode === LINE` wheel event to
 * pixels. Firefox reports wheel deltas in *lines* (a notch ≈ 3 lines) while the
 * service's `page.mouse.wheel` takes pixels: forwarding a raw `deltaY: 3`
 * scrolls the mirrored page 3px per notch, which reads as "the wheel does
 * nothing". PAGE deltas scale by the mirrored page's height instead.
 */
const WHEEL_LINE_PX = 16;
/**
 * The tail both of the service's no-page refusals share ("…请先打开一个网址");
 * the screenshot op and the input ops word the prefix differently, and the
 * bridge forwards service replies verbatim. Matching this suffix is how the
 * panel learns that the page went away and the frame loop must stop.
 */
const NO_PAGE_REASON = '请先打开一个网址';
/** DOM `KeyboardEvent.key` values forwarded as named presses rather than as text. */
const NAMED_KEYS = {
    Enter: 'Enter',
    Tab: 'Tab',
    Escape: 'Escape',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ' ': 'Space',
};
/** A JSON object, or null for an array, a scalar, or a parse failure. */
function asObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : null;
}
/** A reply field read as text; anything but a string is the empty string. */
function asText(value) {
    return typeof value === 'string' ? value : '';
}
/** A reply field read as a positive number; anything else is null. */
function asNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
/**
 * The reply's `pages` array read as tab facts. A malformed entry is dropped
 * rather than guessed at: every tab id is positive (the service never reuses
 * one), so the same reader that validates the id validates the entry.
 * @param value - the `pages` field of a `panel_pages` reply.
 * @returns the tabs in service order, oldest first.
 */
function tabsFrom(value) {
    if (!Array.isArray(value))
        return [];
    const tabs = [];
    for (const entry of value) {
        const item = asObject(entry);
        if (item === null)
            continue;
        const id = asNumber(item.id);
        if (id === null)
            continue;
        tabs.push({ id, url: asText(item.url), title: asText(item.title), active: item.active === true });
    }
    return tabs;
}
/** Tab strip label: the page's title, or its address while the title is empty. */
function tabLabel(tab) {
    return tab.title !== '' ? tab.title : tab.url;
}
/**
 * Post one command to the host bridge.
 *
 * Never rejects: transport failures, timeouts, aborts, and unreadable replies
 * all collapse into `unreachable`, so a caller can render an error bar instead
 * of catching. The signal aborts the request without changing the answer kind
 * (an aborted call is a cancelled call, and its caller checks that itself).
 *
 * @param payload - the command body; `op` is the only field every op needs.
 * @param timeoutMs - budget covering the request and its answer.
 * @param signal - optional caller-owned cancellation (unmount, tab switch).
 * @returns the classified answer.
 */
async function send(payload, timeoutMs, signal) {
    const controller = new AbortController();
    const relay = () => { controller.abort(); };
    signal?.addEventListener('abort', relay, { once: true });
    const timer = window.setTimeout(relay, timeoutMs);
    try {
        const response = await fetch(COMMAND_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            credentials: 'same-origin',
            signal: controller.signal,
        });
        // 401/403 are the connection service's trust fence, not a browser-service failure.
        if (response.status === 401 || response.status === 403)
            return { kind: 'refused' };
        let body = null;
        try {
            body = asObject(JSON.parse(await response.text()));
        }
        catch {
            // Swallows the parse error: an unreadable body is the same "no usable answer".
            body = null;
        }
        if (body === null)
            return { kind: 'unreachable' };
        if (body.ok === false)
            return { kind: 'failed', reason: asText(body.error) };
        return { kind: 'ok', body };
    }
    catch {
        // Swallows transport failures — offline, timeout, abort, DNS, a route the
        // profile does not mount: each is the same panel-level "no answer".
        return { kind: 'unreachable' };
    }
    finally {
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', relay);
    }
}
/**
 * Turn a non-success answer into the line the error bar shows.
 *
 * A refusal the browser service explained is shown verbatim: that text is
 * written where the condition is understood (the service and the bridge), and
 * it names the actual cause. Everything else falls back to this panel's own
 * dictionary, keyed by which command failed.
 *
 * @param t - translate function of this panel's namespace.
 * @param result - any answer other than success.
 * @param fallback - dictionary key for a command that got no answer at all.
 * @returns the text to display.
 */
function failureText(t, result, fallback) {
    switch (result.kind) {
        case 'refused': return t('error.denied');
        case 'unreachable': return t(fallback);
        case 'failed': return result.reason === '' ? t(fallback) : result.reason;
    }
}
/** Pointer button name for the service's `button` field. */
function buttonName(button) {
    return button === 1 ? 'middle' : button === 2 ? 'right' : 'left';
}
/** Clamp one mapped page coordinate into the page box, in whole CSS pixels. */
function clampToPage(value, extent) {
    return Math.min(Math.max(Math.round(value), 0), Math.max(0, extent - 1));
}
/**
 * Normalize one wheel event's delta into the pixels `page.mouse.wheel` expects.
 *
 * `deltaMode` 0 (pixel) passes through; 1 (line) is the Firefox notch case and
 * scales by `WHEEL_LINE_PX`; 2 (page) scales by the mirrored page's height.
 * @param event - the wheel event carrying `deltaX`/`deltaY`/`deltaMode`.
 * @param pageHeight - the mirrored page's CSS height, used for page-mode deltas.
 * @returns the delta in CSS pixels for both axes.
 */
function wheelPixels(event, pageHeight) {
    if (event.deltaMode === 1) {
        return { x: event.deltaX * WHEEL_LINE_PX, y: event.deltaY * WHEEL_LINE_PX };
    }
    if (event.deltaMode === 2) {
        return { x: event.deltaX * pageHeight, y: event.deltaY * pageHeight };
    }
    return { x: event.deltaX, y: event.deltaY };
}
/**
 * Render the built-in browser panel.
 * @param props - body-seat props from the framework; this panel uses only the `t` copy seat.
 * @returns the toolbar, status row, frame surface, and input controls.
 */
export function CloakPanel({ t }) {
    const [phase, setPhase] = useState('probing');
    const [fault, setFault] = useState(undefined);
    const [page, setPage] = useState({ url: '', title: '' });
    const [tabs, setTabs] = useState([]);
    const [size, setSize] = useState(undefined);
    const [hidden, setHidden] = useState(false);
    const [address, setAddress] = useState('');
    const [text, setText] = useState('');
    const surfaceRef = useRef(null);
    const canvasRef = useRef(null);
    const decoderRef = useRef(null);
    const sizeRef = useRef(undefined);
    // The address box follows the page, except while the user is typing in it —
    // that state lives in a ref because the frame loop must read it without
    // restarting on every focus change.
    const editingRef = useRef(false);
    const lastMoveRef = useRef(0);
    const moveInFlightRef = useRef(false);
    // The pointer mapping runs from native listeners and throttled handlers, so
    // the last frame's page size has to be readable without a re-render.
    useEffect(() => { sizeRef.current = size; }, [size]);
    useEffect(() => {
        const update = () => { setHidden(document.hidden); };
        update();
        document.addEventListener('visibilitychange', update);
        return () => { document.removeEventListener('visibilitychange', update); };
    }, []);
    /**
     * Point the address box at the page the service is showing, unless the user is
     * typing in it. Every reply that names a page goes through here, so the box
     * follows in-page navigation and tab switches alike.
     * @param url - the page's address, as the service reported it.
     */
    const syncAddress = useCallback((url) => {
        if (editingRef.current)
            return;
        setAddress(current => current === url ? current : url);
    }, []);
    /**
     * Read the service's tab list. A read that fails or is cancelled leaves the
     * last list in place: the strip is a view of the service, and a dropped poll
     * is not a change to report.
     * @param signal - caller-owned cancellation for the poll.
     */
    const refreshTabs = useCallback(async (signal) => {
        const result = await send({ op: 'panel_pages' }, COMMAND_TIMEOUT_MS, signal);
        if (signal?.aborted === true || result.kind !== 'ok')
            return;
        setTabs(tabsFrom(result.body.pages));
    }, []);
    // The strip is polled on its own slower cadence: a popup the service just
    // followed shows up in the picture immediately, and a second later in the list.
    useEffect(() => {
        if (phase !== 'live')
            return undefined;
        const lifecycle = new AbortController();
        void refreshTabs(lifecycle.signal);
        const timer = window.setInterval(() => { void refreshTabs(lifecycle.signal); }, TABS_INTERVAL_MS);
        return () => {
            lifecycle.abort();
            window.clearInterval(timer);
        };
    }, [phase, refreshTabs]);
    /**
     * Read the service's own view of the world and adopt it: not running means
     * the start button, running without a page means the address bar, and
     * anything else means the frame loop.
     * @param signal - caller-owned cancellation for the probe.
     */
    const probe = useCallback(async (signal) => {
        const result = await send({ op: 'status' }, COMMAND_TIMEOUT_MS, signal);
        if (signal?.aborted === true)
            return;
        if (result.kind !== 'ok') {
            setFault(failureText(t, result, 'error.notRunning'));
            setPhase('idle');
            return;
        }
        setPage({ url: asText(result.body.url), title: asText(result.body.title) });
        syncAddress(asText(result.body.url));
        if (result.body.running !== true) {
            setPhase('idle');
            return;
        }
        setPhase(result.body.has_page === true ? 'live' : 'nopage');
    }, [syncAddress, t]);
    useEffect(() => {
        const controller = new AbortController();
        void probe(controller.signal);
        return () => { controller.abort(); };
    }, [probe]);
    /**
     * One frame tick. Only one request is ever in flight: the interval fires
     * again while a slow frame is still travelling, and piling those up would
     * queue renders on the shared page for no visible gain. A frame stops the
     * loop by moving to the no-page phase — the effect's cleanup then aborts the
     * request and clears the interval.
     */
    useEffect(() => {
        if (phase !== 'live' || hidden)
            return undefined;
        // One controller for the whole lifetime of this loop: cleanup and unmount
        // abort the frame in flight, so a cancelled tick never reaches the service
        // for a surface that is already gone.
        const lifecycle = new AbortController();
        let inFlight = false;
        const tick = async () => {
            if (inFlight)
                return;
            inFlight = true;
            try {
                const result = await send({ op: 'screenshot', quality: FRAME_QUALITY, scale: 'css' }, SCREENSHOT_TIMEOUT_MS, lifecycle.signal);
                // A cancelled loop (unmount, tab switch, the no-page fallback below)
                // has unmounted this surface already: there is nothing left to paint
                // into, and no reader left for a status line.
                const canvas = canvasRef.current;
                if (canvas === null)
                    return;
                if (result.kind !== 'ok') {
                    if (result.kind === 'failed' && result.reason.includes(NO_PAGE_REASON)) {
                        setFault(t('error.pageClosed'));
                        setPhase('nopage');
                        return;
                    }
                    setFault(failureText(t, result, 'error.frame'));
                    return;
                }
                const data = asText(result.body.data);
                const cssWidth = asNumber(result.body.css_width);
                const cssHeight = asNumber(result.body.css_height);
                if (data === '' || cssWidth === null || cssHeight === null) {
                    setFault(t('error.frame'));
                    return;
                }
                // Decode off-screen and blit: swapping an <img> src repaints an empty
                // box between frames, which reads as flicker at this rate.
                const image = decoderRef.current ?? (decoderRef.current = new Image());
                image.src = `data:image/jpeg;base64,${data}`;
                const context = canvas.getContext('2d');
                if (context === null) {
                    setFault(t('error.frame'));
                    return;
                }
                const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
                const pixelWidth = Math.max(1, Math.round(cssWidth * ratio));
                const pixelHeight = Math.max(1, Math.round(cssHeight * ratio));
                try {
                    await image.decode();
                    // The decode outlives a phase change: never paint a stale frame over
                    // the surface that replaced this one.
                    if (canvasRef.current !== canvas)
                        return;
                    if (canvas.width !== pixelWidth)
                        canvas.width = pixelWidth;
                    if (canvas.height !== pixelHeight)
                        canvas.height = pixelHeight;
                    context.drawImage(image, 0, 0, pixelWidth, pixelHeight);
                }
                catch {
                    // Swallows a truncated or undecodable frame: the loop keeps running,
                    // so the next tick either paints or reports the same failure again.
                    setFault(t('error.frame'));
                    return;
                }
                const url = asText(result.body.url);
                const title = asText(result.body.title);
                setFault(undefined);
                setSize(current => current !== undefined && current.width === cssWidth && current.height === cssHeight
                    ? current
                    : { width: cssWidth, height: cssHeight });
                setPage(current => current.url === url && current.title === title ? current : { url, title });
                syncAddress(url);
            }
            finally {
                inFlight = false;
            }
        };
        const timer = window.setInterval(() => { void tick(); }, FRAME_INTERVAL_MS);
        void tick();
        return () => {
            lifecycle.abort();
            window.clearInterval(timer);
        };
    }, [phase, hidden, syncAddress, t]);
    /**
     * Map a viewport point onto the page's CSS coordinate space.
     *
     * The canvas fills its stage and letterboxes the page inside it
     * (`object-fit: contain`), so the page rect inside the stage is the stage's
     * own rect shrank by one scale factor on both axes. A point on the letterbox
     * clamps to the nearest page edge rather than being dropped.
     * @param clientX - viewport X of the pointer event.
     * @param clientY - viewport Y of the pointer event.
     * @returns whole page CSS pixels, or undefined while no frame size is known.
     */
    const pointAt = useCallback((clientX, clientY) => {
        const surface = surfaceRef.current;
        const current = sizeRef.current;
        if (surface === null || current === undefined)
            return undefined;
        const rect = surface.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0)
            return undefined;
        const scale = Math.min(rect.width / current.width, rect.height / current.height);
        if (!Number.isFinite(scale) || scale <= 0)
            return undefined;
        const left = rect.left + (rect.width - current.width * scale) / 2;
        const top = rect.top + (rect.height - current.height * scale) / 2;
        return {
            x: clampToPage((clientX - left) / scale, current.width),
            y: clampToPage((clientY - top) / scale, current.height),
        };
    }, []);
    /**
     * Forward one command without blocking the caller. Failures land in the
     * error bar; the quiet flag is for the pointer-move stream, where a dead
     * service would otherwise rewrite the same line twenty times a second.
     * @param payload - command body to send.
     * @param quiet - suppress the error bar for this command.
     */
    const forward = useCallback((payload, quiet) => {
        void send(payload, COMMAND_TIMEOUT_MS).then((result) => {
            if (result.kind === 'ok' || quiet)
                return;
            setFault(failureText(t, result, 'error.request'));
        });
    }, [t]);
    /**
     * Send one mouse command to the page.
     * @param action - `move`/`down`/`up`/`click`/`dblclick`/`wheel`/`contextmenu`.
     * @param at - page CSS coordinates, mapped from the pointer event.
     * @param extra - additional mouse fields (`button`, `delta_x`, `delta_y`).
     */
    const sendMouse = useCallback((action, at, extra = {}) => {
        // A move whose predecessor is unanswered is dropped: the service only acts
        // on the newest position, and a stalled request must not queue a backlog.
        const quiet = action === 'move';
        if (quiet) {
            if (moveInFlightRef.current)
                return;
            moveInFlightRef.current = true;
        }
        // `at` is optional because `wheel` is the one action the service dispatches
        // at the page's own cursor and never reads x/y for; an unplaceable pointer
        // must not swallow a scroll tick. Every other action passes real coords.
        void send({ op: 'mouse', action, ...(at === undefined ? {} : { x: at.x, y: at.y }), ...extra }, COMMAND_TIMEOUT_MS).then((result) => {
            if (quiet)
                moveInFlightRef.current = false;
            if (result.kind === 'ok' || quiet)
                return;
            setFault(failureText(t, result, 'error.request'));
        });
    }, [t]);
    useEffect(() => {
        if (phase !== 'live')
            return undefined;
        const surface = surfaceRef.current;
        /* v8 ignore next -- the surface is mounted by the same render that sets this phase. */
        if (surface === null)
            return undefined;
        // React registers `onWheel` as a passive root listener, where
        // preventDefault is ignored; the page must not scroll behind the mirror.
        const onWheel = (event) => {
            event.preventDefault();
            // Unit first: a line-mode wheel (Firefox notch) must reach the service as
            // pixels, or every notch scrolls the mirrored page 3px and the mirror
            // looks stuck. The service's wheel branch ignores x/y — it scrolls at the
            // page's own cursor — so an unplaceable pointer must not swallow the tick.
            const delta = wheelPixels(event, sizeRef.current?.height ?? surface.clientHeight);
            const at = pointAt(event.clientX, event.clientY);
            sendMouse('wheel', at, { delta_x: delta.x, delta_y: delta.y });
        };
        surface.addEventListener('wheel', onWheel, { passive: false });
        return () => { surface.removeEventListener('wheel', onWheel); };
    }, [phase, pointAt, sendMouse]);
    /** Start the deployment's browser service, reporting progress while it boots. */
    const startBrowser = useCallback(async () => {
        setPhase('starting');
        setFault(undefined);
        const result = await send({ op: 'start' }, START_TIMEOUT_MS);
        if (result.kind !== 'ok') {
            setFault(failureText(t, result, 'error.notRunning'));
            setPhase('idle');
            return;
        }
        // The launch only proves a port; the service itself decides whether a page exists.
        await probe();
    }, [probe, t]);
    /**
     * Open one address in the shared session page.
     * @param value - the raw address the user typed; the service validates it.
     */
    const navigate = useCallback(async (value) => {
        if (value === '')
            return;
        const result = await send({ op: 'debug_navigate', url: value }, COMMAND_TIMEOUT_MS);
        if (result.kind !== 'ok') {
            setFault(failureText(t, result, 'error.request'));
            return;
        }
        const url = asText(result.body.url);
        setPage({ url, title: asText(result.body.title) });
        setAddress(url === '' ? value : url);
        setFault(undefined);
        setPhase('live');
        // A navigation replaces the service's session page, so the strip's ids moved.
        void refreshTabs();
    }, [refreshTabs, t]);
    /**
     * Show another tab. The service switches its session page and the frame loop
     * picks the new page up on its next tick.
     * @param id - the tab id from the strip.
     */
    const selectTab = useCallback((id) => {
        void send({ op: 'panel_select', id }, COMMAND_TIMEOUT_MS).then((result) => {
            if (result.kind !== 'ok') {
                setFault(failureText(t, result, 'error.request'));
                return;
            }
            setPage({ url: asText(result.body.url), title: asText(result.body.title) });
            syncAddress(asText(result.body.url));
            setFault(undefined);
            setPhase('live');
            void refreshTabs();
        });
    }, [refreshTabs, syncAddress, t]);
    /**
     * Close one tab. Closing the tab being mirrored hands the mirror to the most
     * recently used of the remaining ones, which the reply names — or empties the
     * session, which is the same "enter a URL" state as having closed everything.
     * @param id - the tab id from the strip.
     */
    const closeTab = useCallback((id) => {
        void send({ op: 'panel_close', id }, COMMAND_TIMEOUT_MS).then((result) => {
            if (result.kind !== 'ok') {
                setFault(failureText(t, result, 'error.request'));
                return;
            }
            const url = asText(result.body.url);
            setPage({ url, title: asText(result.body.title) });
            // The last tab's address stays in the box: it is the page the user may
            // want to reopen, and an emptied session has nothing better to offer.
            if (result.body.has_page === true)
                syncAddress(url);
            setFault(undefined);
            setPhase(result.body.has_page === true ? 'live' : 'nopage');
            void refreshTabs();
        });
    }, [refreshTabs, syncAddress, t]);
    /** Reload the session page in place. */
    const reload = useCallback(() => {
        void send({ op: 'reload' }, COMMAND_TIMEOUT_MS).then((result) => {
            if (result.kind !== 'ok') {
                setFault(failureText(t, result, 'error.request'));
                return;
            }
            setPage({ url: asText(result.body.url), title: asText(result.body.title) });
            setFault(undefined);
        });
    }, [t]);
    /**
     * Forward one keystroke to the page.
     *
     * Three mappings: an accelerator (`Control+`/`Meta+` plus one character) as a
     * named press, a named control key as a named press — Space is one, although
     * it is also a single character — and any other single character as text
     * insertion, which keeps the page's ordinary typing path intact. Anything
     * else (modifier-only presses, F-keys, OS shortcuts) is left alone, so the
     * panel never swallows a key it cannot mirror.
     * @param event - the surface's key event.
     */
    const onKeyDown = useCallback((event) => {
        const chord = event.ctrlKey ? 'Control' : event.metaKey ? 'Meta' : undefined;
        if (chord !== undefined) {
            if (event.key.length !== 1)
                return;
            event.preventDefault();
            // `Space` is a single character and a named key at once, so the chord
            // spelling comes from the same table the named branch uses.
            forward({ op: 'key', action: 'press', key: `${chord}+${NAMED_KEYS[event.key] ?? event.key}` }, false);
            return;
        }
        const named = NAMED_KEYS[event.key];
        if (named !== undefined) {
            event.preventDefault();
            forward({ op: 'key', action: 'press', key: named }, false);
            return;
        }
        if (event.key.length === 1) {
            event.preventDefault();
            forward({ op: 'key', action: 'insert', text: event.key }, false);
        }
    }, [forward]);
    const submitAddress = (event) => {
        event.preventDefault();
        void navigate(address.trim());
    };
    const submitText = (event) => {
        event.preventDefault();
        // The insertion op exists for text a keyboard event cannot carry: Chinese
        // and every other composition-based script.
        forward({ op: 'key', action: 'insert', text }, false);
        setText('');
    };
    /** Breadcrumb text: what the panel is doing right now. */
    const phaseLabel = phase === 'probing' || phase === 'starting'
        ? t(phase === 'starting' ? 'start.pending' : 'phase.probing')
        : phase === 'idle' ? t('phase.idle') : hidden ? t('phase.paused') : t('phase.live');
    const toolbarVisible = phase === 'live' || phase === 'nopage';
    return (_jsxs("div", { className: css.root, "data-cloak-panel": true, children: [phase === 'live' && tabs.length > 1 && (_jsx("div", { className: css.tabs, "aria-label": t('tabs.label'), children: tabs.map(tab => (_jsxs("div", { className: tab.active ? css.tabActive : css.tab, children: [_jsx("button", { type: "button", className: css.tabPick, title: tab.url === '' ? tabLabel(tab) : tab.url, "aria-current": tab.active ? 'page' : undefined, onClick: () => { if (!tab.active)
                                selectTab(tab.id); }, children: tabLabel(tab) }), _jsx("button", { type: "button", className: css.tabClose, "aria-label": t('tabs.close'), title: t('tabs.close'), onClick: () => { closeTab(tab.id); }, children: _jsx(IconCloseOutlineMedium, { size: 12 }) })] }, tab.id))) })), toolbarVisible && (_jsxs("form", { className: css.toolbar, onSubmit: submitAddress, children: [_jsx("input", { className: css.address, value: address, "aria-label": t('address.placeholder'), placeholder: t('address.placeholder'), spellCheck: false, onChange: (event) => { setAddress(event.currentTarget.value); }, onFocus: () => { editingRef.current = true; }, onBlur: () => { editingRef.current = false; } }), _jsx("button", { type: "submit", className: css.tool, "aria-label": t('go'), title: t('go'), disabled: address.trim() === '', children: _jsx(IconLinkOutlineRegular, { size: 14 }) }), _jsx("button", { type: "button", className: css.tool, "aria-label": t('reload'), title: t('reload'), disabled: page.url === '', onClick: reload, children: _jsx(IconRefreshOutlineRegular, {}) })] })), _jsxs("div", { className: css.status, role: "status", children: [_jsx("span", { className: css.phase, children: phaseLabel }), page.title !== '' && _jsx("span", { className: css.pageTitle, children: page.title }), page.url !== '' && _jsx("span", { className: css.pageUrl, children: page.url })] }), fault !== undefined && _jsx("div", { className: css.fault, role: "alert", children: fault }), _jsx("div", { className: css.stage, children: phase === 'live'
                    ? (_jsx("div", { className: css.surface, ref: surfaceRef, tabIndex: 0, "aria-label": t('frame.label'), onPointerMove: (event) => {
                            const now = Date.now();
                            if (now - lastMoveRef.current < MOVE_THROTTLE_MS)
                                return;
                            lastMoveRef.current = now;
                            const at = pointAt(event.clientX, event.clientY);
                            if (at === undefined)
                                return;
                            sendMouse('move', at);
                        }, onPointerDown: (event) => {
                            event.currentTarget.focus();
                            const at = pointAt(event.clientX, event.clientY);
                            if (at === undefined)
                                return;
                            sendMouse('down', at, { button: buttonName(event.button) });
                        }, onPointerUp: (event) => {
                            const at = pointAt(event.clientX, event.clientY);
                            if (at === undefined)
                                return;
                            sendMouse('up', at, { button: buttonName(event.button) });
                        }, onDoubleClick: (event) => {
                            const at = pointAt(event.clientX, event.clientY);
                            if (at === undefined)
                                return;
                            sendMouse('dblclick', at, { button: 'left' });
                        }, onContextMenu: (event) => {
                            event.preventDefault();
                            const at = pointAt(event.clientX, event.clientY);
                            if (at === undefined)
                                return;
                            sendMouse('contextmenu', at, { button: 'right' });
                        }, onKeyDown: onKeyDown, children: _jsx("canvas", { className: css.canvas, ref: canvasRef, "aria-hidden": true }) }))
                    : (_jsx("div", { className: css.notice, children: phase === 'idle' || phase === 'starting'
                            ? (_jsxs(_Fragment, { children: [_jsx("p", { className: css.noticeText, children: t(phase === 'starting' ? 'start.pending' : 'phase.idle') }), _jsx(Button, { variant: "primary", icon: _jsx(IconBrowseOutlineMedium, { size: 14 }), disabled: phase === 'starting', onClick: () => { void startBrowser(); }, children: t('start') })] }))
                            : _jsx("p", { className: css.noticeText, children: phase === 'nopage' ? t('nopage') : phaseLabel }) })) }), phase === 'live' && (_jsxs(_Fragment, { children: [_jsxs("form", { className: css.insertRow, onSubmit: submitText, children: [_jsx("input", { className: css.insert, value: text, "aria-label": t('insert.placeholder'), placeholder: t('insert.placeholder'), onChange: (event) => { setText(event.currentTarget.value); } }), _jsx("button", { type: "submit", className: css.tool, "aria-label": t('insert.send'), title: t('insert.send'), disabled: text === '', children: _jsx(IconSendOutlineRegular, {}) })] }), _jsx("p", { className: css.hint, children: t('keyboard.hint') })] }))] }));
}
//# sourceMappingURL=CloakPanel.js.map