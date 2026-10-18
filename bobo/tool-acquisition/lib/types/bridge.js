/**
 * Host half of the right-panel browser mirror: one POST route carrying the
 * panel's commands to the deployment's long-lived Camoufox browser service
 * (`scripts/browser_server.py`) and back.
 *
 * The bridge owns no browser. `status` and every forwarded command address the
 * deployment's derived port, so the panel drives the very session page a
 * capture or a debug session already holds, and an idle panel starts no
 * process. `start` is the single op that may launch the service, through the
 * same derived-port-then-spawn path a capture takes, so both reach one browser
 * instead of two.
 *
 * Security has one home, as on every host route: the composition's `connection`
 * service answers `requestRejection` first, so its Host/Origin fence plus the
 * browser authentication gate every command before its body is read.
 * @module bobo-crawl-tool/bridge
 */
import z from '@deepseek-ai/schemastery';
import { CamoufoxBrowserService, deriveBrowserPort, probeBrowserService, sendCommand } from "./browser-server.js";
import { resolveDeployment } from "./deployment.js";
import { readPendingHandoff } from "./handoff-state.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = 'bobo-browser-bridge';
/** The route carrier and the trust fence every command passes before it is read. */
export const inject = ['webServer', 'connection'];
/** Route prefix the panel posts under; this bridge serves `<prefix>/cmd` and nothing else. */
const BRIDGE_PREFIX = '/bobo-camoufox';
/** The one endpoint that carries commands. */
const COMMAND_PATH = `${BRIDGE_PREFIX}/cmd`;
/** Command bodies are small JSON objects; anything larger is hostile. */
const MAX_BODY_BYTES = 64 * 1024;
/**
 * Operations forwarded verbatim to the browser service. The set is the panel's
 * whole surface, so the refusal for anything else happens here rather than at
 * the service: `render` returns whole documents and the read-only analysis ops
 * (`debug_evaluate`, `debug_network`, `debug_cookies`, `debug_websocket`) are
 * outside what the mirror needs.
 */
const FORWARDED_OPS = new Set([
    'ping', 'panel_state', 'screenshot', 'mouse', 'key', 'reload', 'debug_navigate', 'debug_close',
    'panel_pages', 'panel_select', 'panel_close',
]);
export const Config = z.object({
    // One second is the floor for every budget: a shorter one would expire before
    // any page op could answer, and a zero must fail at load instead of at use.
    opTimeoutMs: z.natural().min(1_000).default(15_000),
    screenshotTimeoutMs: z.natural().min(1_000).default(30_000),
    timeoutMs: z.natural().min(1_000).default(120_000),
    serverStartTimeoutMs: z.natural().min(1_000).default(60_000),
});
/** Reject a configured budget that is not whole positive milliseconds. */
function assertBudget(name, value) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`bobo-browser-bridge: ${name} must be a positive integer number of milliseconds`);
    }
}
/** The composition's connection service (typed locally: its package is browser-side). */
function connectionOf(ctx) {
    return Reflect.get(ctx, 'connection');
}
/** The composition's web-server service (typed locally: its package is host-side but not a dependency here). */
function webServerOf(ctx) {
    return Reflect.get(ctx, 'webServer');
}
/** JSON response (no-store: liveness, page state, and frames are live facts). */
function sendJson(res, status, payload) {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
}
/** 405 with the route's one supported method. */
function sendMethodNotAllowed(res) {
    res.setHeader('allow', 'POST');
    sendJson(res, 405, { ok: false, error: '只接受 POST' });
}
/** Collect a bounded request body as UTF-8 text; null past the ceiling (stream drained). */
async function readBoundedBody(req) {
    const chunks = [];
    let size = 0;
    // http server streams without setEncoding always yield Buffer chunks.
    for await (const chunk of req) {
        size += chunk.byteLength;
        if (size > MAX_BODY_BYTES) {
            // Drain the remainder so the refusal is a readable response, not a socket cut.
            req.resume();
            return null;
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks, size).toString('utf8');
}
/** A value that is a JSON object rather than an array or a scalar. */
function asObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : null;
}
/** A reply field read as text; anything else is the empty string. */
function fieldText(value) {
    return typeof value === 'string' ? value : '';
}
/**
 * Validate one command body at the wire: JSON with a non-blank `op` string.
 * @param text - the bounded request body.
 * @returns the command object, or null when the body is not a command.
 */
function parseCommand(text) {
    let body;
    try {
        body = JSON.parse(text);
    }
    catch {
        // Swallows the parse error: a non-JSON body is exactly the null case.
        return null;
    }
    const command = asObject(body);
    if (command === null)
        return null;
    const op = command.op;
    return typeof op === 'string' && op.trim() !== '' ? command : null;
}
/**
 * Register the panel's command route.
 *
 * @param ctx - context whose `webServer` receives the route and whose
 *   `connection` decides every caller's trust; the route leaves with this
 *   plugin instance.
 * @param config - command budgets, validated by {@link Config}.
 * @throws {Error} when a configured budget is not whole positive milliseconds.
 */
export function apply(ctx, config) {
    const resolved = config;
    assertBudget('opTimeoutMs', resolved.opTimeoutMs);
    assertBudget('screenshotTimeoutMs', resolved.screenshotTimeoutMs);
    assertBudget('timeoutMs', resolved.timeoutMs);
    assertBudget('serverStartTimeoutMs', resolved.serverStartTimeoutMs);
    // No path is pinned: the bridge sits inside the same deployment as the tool
    // plugin, so both derive the project root from their own file position.
    const deployment = resolveDeployment({});
    /**
     * One service instance per bridge life, created on the first `start`: its
     * single launch is what concurrent starts share, instead of one spawn each
     * racing for the derived port. Deliberately never disposed — the browser it
     * starts is the deployment's shared instance, and the capture plugin instance
     * owns closing it; a bridge teardown must not close a browser another owner
     * is using.
     */
    let launcher;
    const startService = () => launcher ??= new CamoufoxBrowserService(deployment, resolved.serverStartTimeoutMs);
    /** Port derived from the deployment root, or null when this build sits outside a BoBo project. */
    const derivedPort = () => deployment.root === undefined ? null : deriveBrowserPort(deployment.root);
    /**
     * Port of a service already listening; null when none is. Probes only: a
     * status read must never launch a browser as a side effect.
     */
    const listeningPort = async () => {
        const port = derivedPort();
        if (port === null)
            return null;
        return await probeBrowserService(port) ? port : null;
    };
    /** Forward one command to a listening service; an unanswered command keeps its own op's budget. */
    const forward = async (port, command, op) => {
        const budget = op === 'screenshot'
            ? resolved.screenshotTimeoutMs
            : op === 'debug_navigate' ? resolved.timeoutMs : resolved.opTimeoutMs;
        const reply = await sendCommand(port, command, budget);
        return reply ?? { ok: false, error: '浏览器服务无应答' };
    };
    /**
     * Liveness plus the session page's address, title, and viewport. A service
     * that stopped between the probe and the read degrades to "no page" with the
     * reason attached, so the panel keeps a truthful running flag either way.
     */
    const readStatus = async () => {
        const port = await listeningPort();
        if (port === null) {
            return { ok: true, running: false, port: null, has_page: false, url: '', title: '', viewport: null };
        }
        const reply = asObject(await sendCommand(port, { op: 'panel_state' }, resolved.opTimeoutMs));
        const running = { ok: true, running: true, port };
        // A reply that is not `ok: true` is a failure of the read itself (an older
        // service without the op, a page that went away), so it degrades to "no
        // page" carrying the reason rather than reporting an empty page as truth.
        if (reply === null || reply.ok !== true) {
            return {
                ...running, has_page: false, url: '', title: '', viewport: null,
                error: reply === null ? '浏览器服务无应答' : fieldText(reply.error) || '浏览器服务未返回页面状态',
            };
        }
        return {
            ...running,
            has_page: reply.has_page === true,
            url: fieldText(reply.url),
            title: fieldText(reply.title),
            viewport: asObject(reply.viewport),
        };
    };
    /**
     * The manual handoff a tool call is waiting on, or null while none waits.
     *
     * The record lives in this process (`handoff-state.ts`), written by the
     * `browser_handoff` tool before it asks the user; the panel polls it to learn
     * when to put itself in front of them. Answering it touches no browser and no
     * page, so a poll costs one round trip and nothing else.
     */
    const readHandoff = () => ({ ok: true, pending: readPendingHandoff() });
    /** Make the deployment's browser service answer, launching one when none does. */
    const startServiceAndReport = async () => {
        try {
            const endpoint = await startService().endpoint(undefined);
            const port = Number(endpoint.slice(endpoint.lastIndexOf(':') + 1));
            if (!Number.isInteger(port) || port < 1) {
                return { ok: false, error: `浏览器服务返回的端点非法: ${endpoint}` };
            }
            return { ok: true, port };
        }
        catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    };
    /** Answer one command: the three ops the bridge owns, or a forwarded whitelisted op. */
    const run = async (command) => {
        const op = fieldText(command.op);
        if (op === 'status')
            return await readStatus();
        if (op === 'handoff_state')
            return readHandoff();
        if (op === 'start')
            return await startServiceAndReport();
        if (!FORWARDED_OPS.has(op))
            return { ok: false, error: `不允许的操作: ${op}` };
        const port = await listeningPort();
        if (port === null)
            return { ok: false, error: '浏览器服务未运行' };
        return await forward(port, command, op);
    };
    /** Answer an untrusted/unauthenticated request; true when it was rejected. */
    const rejected = (req, res) => {
        const rejection = connectionOf(ctx).requestRejection(req);
        if (rejection === undefined)
            return false;
        res.statusCode = rejection;
        res.end();
        return true;
    };
    ctx.effect(() => webServerOf(ctx).register({
        kind: 'prefix',
        path: BRIDGE_PREFIX,
        handler: async (req, res) => {
            if (rejected(req, res))
                return;
            // Node always sets url on server requests; String keeps that fact local.
            const pathname = new URL(String(req.url), 'http://localhost').pathname;
            if (pathname !== COMMAND_PATH) {
                sendJson(res, 404, { ok: false, error: `未知路径: ${pathname}` });
                return;
            }
            if (req.method !== 'POST') {
                sendMethodNotAllowed(res);
                return;
            }
            let text;
            try {
                text = await readBoundedBody(req);
            }
            catch {
                // Swallows connection errors mid-body: there is nothing left to answer precisely.
                sendJson(res, 400, { ok: false, error: '请求体读取失败' });
                return;
            }
            if (text === null) {
                sendJson(res, 400, { ok: false, error: '请求体过大' });
                return;
            }
            const command = parseCommand(text);
            if (command === null) {
                sendJson(res, 400, { ok: false, error: '请求体必须是含 op 字符串的 JSON 对象' });
                return;
            }
            try {
                sendJson(res, 200, await run(command));
            }
            catch (error) {
                // Unreachable through the ops above (each reports its own failure), but a
                // route owns its response: a thrown error must still be an answer.
                sendJson(res, 500, { ok: false, error: `桥接处理失败: ${error instanceof Error ? error.message : String(error)}` });
            }
        },
    }), `bobo-browser-bridge: POST ${COMMAND_PATH}`);
}
//# sourceMappingURL=bridge.js.map