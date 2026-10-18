/**
 * Lifecycle owner of the deployment's long-lived Camoufox browser service
 * (`scripts/browser_server.py`).
 *
 * The service is launched on the first capture that needs it, reused by every
 * later capture of the same plugin instance, and stopped when that instance is
 * disposed — so an agent session end closes the browser instead of leaving it
 * running. A service that died is relaunched by the next capture.
 *
 * The module also owns the service's one-command-per-connection wire: {@link
 * sendCommand} is the single place that speaks it, so the bridge's route and
 * the handoff tool reach the service the same way.
 * @module bobo-crawl-tool/browser-server
 */
import { execFile, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
/** Service script, inside the deployment's scripts directory. */
const BROWSER_SERVER_SCRIPT = 'browser_server.py';
/** Port range shared with `scripts/crawl_common.py::derive_browser_port`. */
const PORT_BASE = 20_000;
const PORT_SPAN = 20_000;
/** Milliseconds one liveness probe waits for the service's one-line reply. */
const PROBE_TIMEOUT_MS = 2_000;
/** Largest service reply one command accepts: a screenshot frame travels as base64 JPEG. */
const MAX_REPLY_BYTES = 32 * 1024 * 1024;
/** Line the service prints on stdout once it accepts commands. */
const READY_PATTERN = /READY (\d+)/;
/**
 * Port derived from the project root, by the same rule as
 * `scripts/crawl_common.py::derive_browser_port`, so every consumer in a
 * deployment reaches one browser instance rather than launching its own.
 *
 * `crc32` returns a signed int32 and Python's `zlib.crc32` an unsigned one;
 * the unsigned shift reconciles them.
 *
 * @param root - BoBo project root.
 * @returns the derived TCP port, inside [{@link PORT_BASE}, {@link PORT_BASE}+{@link PORT_SPAN}).
 */
export function deriveBrowserPort(root) {
    return PORT_BASE + ((crc32(Buffer.from(root)) >>> 0) % PORT_SPAN);
}
/**
 * Whether a browser service already answers on `port`.
 * @param port - TCP port to probe.
 * @returns true when the service replied inside {@link PROBE_TIMEOUT_MS}.
 */
export function probeBrowserService(port) {
    return new Promise((resolveProbe) => {
        const socket = createConnection({ host: '127.0.0.1', port }, () => {
            socket.write('{"op":"ping"}\n');
            socket.setTimeout(PROBE_TIMEOUT_MS, () => {
                socket.destroy();
                resolveProbe(false);
            });
            socket.once('data', () => {
                socket.destroy();
                resolveProbe(true);
            });
        });
        socket.on('error', () => { resolveProbe(false); });
    });
}
/**
 * Send one request line to the browser service and read its one-line reply.
 *
 * The service answers one line per connection and then closes, so the reply is
 * complete at its first newline; a connection that never produces one — a
 * refusal, a deadline, a reply past {@link MAX_REPLY_BYTES} — is the null case.
 *
 * @param port - the service's loopback TCP port.
 * @param request - the command object, serialized as one JSON line.
 * @param timeoutMs - budget covering connect, write, and reply.
 * @returns the parsed reply, or null when the service did not answer.
 */
export function sendCommand(port, request, timeoutMs) {
    return new Promise((resolveCommand) => {
        const socket = createConnection({ host: '127.0.0.1', port });
        let buffer = '';
        let received = 0;
        let settled = false;
        const finish = (reply) => {
            if (settled)
                return;
            settled = true;
            socket.destroy();
            resolveCommand(reply);
        };
        /** Parse the accumulated line, tolerating a reply the service left unterminated. */
        const finishWithBuffer = () => {
            if (settled)
                return;
            if (buffer === '') {
                finish(null);
                return;
            }
            try {
                finish(JSON.parse(buffer));
            }
            catch {
                // Swallows the parse error: an unreadable line is the same null answer as no line.
                finish(null);
            }
        };
        socket.setTimeout(timeoutMs, () => { finish(null); });
        socket.on('connect', () => { socket.write(`${JSON.stringify(request)}\n`); });
        socket.on('data', (chunk) => {
            if (settled)
                return;
            received += chunk.byteLength;
            if (received > MAX_REPLY_BYTES) {
                finish(null);
                return;
            }
            buffer += chunk.toString('utf8');
            const newline = buffer.indexOf('\n');
            if (newline === -1)
                return;
            const line = buffer.slice(0, newline);
            try {
                finish(JSON.parse(line));
            }
            catch {
                // Swallows the parse error: an unreadable line is the same null answer as no line.
                finish(null);
            }
        });
        // A closed socket with a partial line is still an answer the service tried to give.
        socket.on('end', finishWithBuffer);
        socket.on('error', () => { finish(null); });
        socket.on('close', () => { finish(null); });
    });
}
/**
 * Owns one deployment's browser service. Concurrent captures share a single
 * launch; an already running service keeps the proxy it was started with,
 * because the proxy reaches the browser only at service start.
 */
export class CamoufoxBrowserService {
    deployment;
    startTimeoutMs;
    child = null;
    port = null;
    starting = null;
    /**
     * @param deployment - resolved deployment paths.
     * @param startTimeoutMs - budget for the service to print its READY line.
     */
    constructor(deployment, startTimeoutMs) {
        this.deployment = deployment;
        this.startTimeoutMs = startTimeoutMs;
    }
    /**
     * Endpoint of a running service, launching one when none is.
     * @param proxy - proxy URL injected when this call has to launch the
     *   service; ignored by an instance that is already running.
     * @returns the `host:port` endpoint `run_camoufox.py --server` connects to.
     */
    async endpoint(proxy) {
        return `127.0.0.1:${String(await this.ready(proxy))}`;
    }
    /**
     * Stop the service and the browser processes it owns. Safe to call while
     * none runs, and safe to call twice.
     */
    dispose() {
        this.starting = null;
        const child = this.child;
        this.child = null;
        this.port = null;
        if (child === null || child.exitCode !== null || child.killed)
            return;
        try {
            child.kill();
        }
        catch {
            // The child left between the checks above; nothing is left to signal.
        }
        // On Windows `kill` reaches only the direct child: the camoufox/firefox
        // tree needs taskkill or it outlives this plugin instance.
        if (process.platform === 'win32' && child.pid !== undefined) {
            execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {
                // A pid that already left makes taskkill exit non-zero; either way the
                // tree is gone and teardown has nothing to report.
            });
        }
    }
    /** Port of a running service, launching one when none is. */
    ready(proxy) {
        if (this.child !== null && this.child.exitCode === null && this.port !== null) {
            return Promise.resolve(this.port);
        }
        if (this.starting !== null)
            return this.starting;
        const attempt = this.launch(proxy).finally(() => {
            if (this.starting === attempt)
                this.starting = null;
        });
        this.starting = attempt;
        return attempt;
    }
    /** Attach the service to a port: reuse the derived one when a peer serves it, otherwise spawn one. */
    async launch(proxy) {
        const root = this.deployment.root;
        const derived = root === undefined ? 0 : deriveBrowserPort(root);
        if (derived > 0 && await probeBrowserService(derived)) {
            this.port = derived;
            return derived;
        }
        const args = [
            join(this.deployment.scriptsDir, BROWSER_SERVER_SCRIPT),
            ...(proxy === undefined ? [] : ['--proxy', proxy]),
            ...(derived > 0 ? ['--port', String(derived)] : []),
        ];
        const child = spawn(this.deployment.pythonBin, args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.child = child;
        // Drained, never parsed: the READY line is the only stdout contract, and
        // interleaving stderr into that buffer would corrupt it.
        child.stderr.resume();
        child.once('exit', () => {
            if (this.child === child) {
                this.child = null;
                this.port = null;
            }
        });
        try {
            const port = await this.awaitReady(child);
            this.port = port;
            return port;
        }
        catch (error) {
            // A service that never became ready owns a live child; stop it here so a
            // later capture launches a fresh one instead of leaking this process.
            this.dispose();
            throw error;
        }
    }
    /** Resolve with the port the service reports on stdout, or reject on timeout or early exit. */
    awaitReady(child) {
        return new Promise((resolveReady, rejectReady) => {
            let buffer = '';
            let settled = false;
            const timer = setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                rejectReady(new Error(`浏览器服务启动超时（${String(this.startTimeoutMs)}ms）`));
            }, this.startTimeoutMs);
            const onData = (chunk) => {
                buffer += chunk.toString();
                const match = READY_PATTERN.exec(buffer);
                const port = match?.[1];
                if (port === undefined || settled)
                    return;
                settled = true;
                clearTimeout(timer);
                child.stdout?.off('data', onData);
                resolveReady(Number(port));
            };
            child.stdout?.on('data', onData);
            child.once('exit', (code) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                rejectReady(new Error(`浏览器服务异常退出(code=${String(code)})`));
            });
        });
    }
}
//# sourceMappingURL=browser-server.js.map