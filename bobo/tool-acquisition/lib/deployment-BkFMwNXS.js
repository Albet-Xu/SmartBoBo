import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join, resolve } from "node:path";
import { crc32 } from "node:zlib";
import { fileURLToPath } from "node:url";

//#region src/browser-server.ts
/**
* Lifecycle owner of the deployment's long-lived CloakBrowser-backed browser service (browser_server.py over cloakserve CDP)
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
/** Service script, inside the deployment's scripts directory. */
const BROWSER_SERVER_SCRIPT = "browser_server.py";
/** Port range shared with `scripts/crawl_common.py::derive_browser_port`. */
const PORT_BASE = 2e4;
const PORT_SPAN = 2e4;
/** Milliseconds one liveness probe waits for the service's one-line reply. */
const PROBE_TIMEOUT_MS = 2e3;
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
function deriveBrowserPort(root) {
	return PORT_BASE + (crc32(Buffer.from(root)) >>> 0) % PORT_SPAN;
}
/**
* The deployment interpreter as a GUI-subsystem host (`pythonw.exe` beside it).
*
* The long-lived browser service must never surface a console window, whatever
* the spawning parent's console state is (`windowsHide` alone can fail under
* some hosts). pythonw has no console at all, so no window can exist; its stdio
* is the pipe pair the spawn below sets up, which behaves the same. Falls back
* to the given interpreter when the venv has no pythonw (uv sync installs both).
* The service reuses `sys.executable` to launch cloakserve, so that child
* becomes pythonw too — one switch hides the whole chain.
* @param bin - deployment pythonBin, e.g. `<venv>/Scripts/python.exe`.
* @returns the pythonw path on Windows when present; the input elsewhere.
*/
function pythonwBin(bin) {
	if (process.platform !== "win32" || !/python\.exe$/i.test(bin)) return bin;
	const candidate = bin.replace(/python\.exe$/i, "pythonw.exe");
	return existsSync(candidate) ? candidate : bin;
}
/**
* Whether a browser service already answers on `port`.
* @param port - TCP port to probe.
* @returns true when the service replied inside {@link PROBE_TIMEOUT_MS}.
*/
function probeBrowserService(port) {
	return new Promise((resolveProbe) => {
		const socket = createConnection({
			host: "127.0.0.1",
			port
		}, () => {
			socket.write("{\"op\":\"ping\"}\n");
			socket.setTimeout(PROBE_TIMEOUT_MS, () => {
				socket.destroy();
				resolveProbe(false);
			});
			socket.once("data", () => {
				socket.destroy();
				resolveProbe(true);
			});
		});
		socket.on("error", () => {
			resolveProbe(false);
		});
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
function sendCommand(port, request, timeoutMs) {
	return new Promise((resolveCommand) => {
		const socket = createConnection({
			host: "127.0.0.1",
			port
		});
		let buffer = "";
		let received = 0;
		let settled = false;
		const finish = (reply) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolveCommand(reply);
		};
		/** Parse the accumulated line, tolerating a reply the service left unterminated. */
		const finishWithBuffer = () => {
			if (settled) return;
			if (buffer === "") {
				finish(null);
				return;
			}
			try {
				finish(JSON.parse(buffer));
			} catch {
				finish(null);
			}
		};
		socket.setTimeout(timeoutMs, () => {
			finish(null);
		});
		socket.on("connect", () => {
			socket.write(`${JSON.stringify(request)}\n`);
		});
		socket.on("data", (chunk) => {
			if (settled) return;
			received += chunk.byteLength;
			if (received > MAX_REPLY_BYTES) {
				finish(null);
				return;
			}
			buffer += chunk.toString("utf8");
			const newline = buffer.indexOf("\n");
			if (newline === -1) return;
			const line = buffer.slice(0, newline);
			try {
				finish(JSON.parse(line));
			} catch {
				finish(null);
			}
		});
		socket.on("end", finishWithBuffer);
		socket.on("error", () => {
			finish(null);
		});
		socket.on("close", () => {
			finish(null);
		});
	});
}
/**
* Owns one deployment's browser service. Concurrent captures share a single
* launch; an already running service keeps the proxy it was started with,
* because the proxy reaches the browser only at service start.
*/
var CloakBrowserService = class {
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
	* @returns the `host:port` endpoint `run_cloak.py --server` connects to.
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
		if (child === null || child.exitCode !== null || child.killed) return;
		try {
			child.kill();
		} catch {}
		if (process.platform === "win32" && child.pid !== void 0) execFile("taskkill", [
			"/pid",
			String(child.pid),
			"/T",
			"/F"
		], { windowsHide: true }, () => {});
	}
	/** Port of a running service, launching one when none is. */
	ready(proxy) {
		if (this.child !== null && this.child.exitCode === null && this.port !== null) return Promise.resolve(this.port);
		if (this.starting !== null) return this.starting;
		const attempt = this.launch(proxy).finally(() => {
			if (this.starting === attempt) this.starting = null;
		});
		this.starting = attempt;
		return attempt;
	}
	/** Attach the service to a port: reuse the derived one when a peer serves it, otherwise spawn one. */
	async launch(proxy) {
		const root = this.deployment.root;
		const derived = root === void 0 ? 0 : deriveBrowserPort(root);
		if (derived > 0 && await probeBrowserService(derived)) {
			this.port = derived;
			return derived;
		}
		const args = [
			join(this.deployment.scriptsDir, BROWSER_SERVER_SCRIPT),
			...proxy === void 0 ? [] : ["--proxy", proxy],
			...derived > 0 ? ["--port", String(derived)] : []
		];
		const child = spawn(pythonwBin(this.deployment.pythonBin), args, {
			windowsHide: true,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		this.child = child;
		child.stderr.resume();
		child.once("exit", () => {
			if (this.child === child) {
				this.child = null;
				this.port = null;
			}
		});
		try {
			const port = await this.awaitReady(child);
			this.port = port;
			return port;
		} catch (error) {
			this.dispose();
			throw error;
		}
	}
	/** Resolve with the port the service reports on stdout, or reject on timeout or early exit. */
	awaitReady(child) {
		return new Promise((resolveReady, rejectReady) => {
			let buffer = "";
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				rejectReady(/* @__PURE__ */ new Error(`浏览器服务启动超时（${String(this.startTimeoutMs)}ms）`));
			}, this.startTimeoutMs);
			const onData = (chunk) => {
				buffer += chunk.toString();
				const port = READY_PATTERN.exec(buffer)?.[1];
				if (port === void 0 || settled) return;
				settled = true;
				clearTimeout(timer);
				child.stdout?.off("data", onData);
				resolveReady(Number(port));
			};
			child.stdout?.on("data", onData);
			child.once("exit", (code) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				rejectReady(/* @__PURE__ */ new Error(`浏览器服务异常退出(code=${String(code)})`));
			});
		});
	}
};

//#endregion
//#region src/deployment.ts
/**
* Locates the BoBo deployment this plugin drives: the project root owning
* `dsh/`, `scripts/`, and `.venv`, the Python interpreter, the directory of
* capture scripts, and the directory crawl artifacts land in.
* @module bobo-crawl-tool/deployment
*/
/** Child directory that identifies the BoBo project root while walking up. */
const PROJECT_MARKER = "dsh";
/** Parent directories the project-root walk ascends before giving up. */
const PROJECT_ROOT_DEPTH = 12;
/** Virtual-environment interpreter subpath, per platform layout. */
const PYTHON_SUBPATH = process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python";
/**
* Find the BoBo project root above `start`: the first directory holding a
* `dsh` child. Locating it from the plugin's own file position keeps the
* deployment independent of the launch working directory and of any
* environment variable, so the same build works at any install path.
*
* @param start - directory to begin the walk at.
* @returns the project root, or undefined when no ancestor holds `dsh`.
*/
function findProjectRoot(start) {
	let dir = resolve(start);
	for (let depth = 0; depth < PROJECT_ROOT_DEPTH; depth++) {
		if (existsSync(join(dir, PROJECT_MARKER))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
}
/** The deployment this build sits inside; undefined when installed outside a BoBo project. */
const PROJECT_ROOT = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
/** A configured string, or undefined when absent or blank. */
function nonBlank(value) {
	return value !== void 0 && value.trim() !== "" ? value : void 0;
}
/**
* Resolve the deployment paths for one plugin instance.
*
* @param paths - configured paths; a blank value is treated as unset, so a
*   composition may leave `pythonBin` and `scriptsDir` empty and let the
*   plugin's own position decide.
* @returns the resolved interpreter, scripts directory, capture directory, and
*   project root.
*/
function resolveDeployment(paths) {
	return {
		root: PROJECT_ROOT,
		pythonBin: nonBlank(paths.pythonBin) ?? (PROJECT_ROOT === void 0 ? "python" : join(PROJECT_ROOT, PYTHON_SUBPATH)),
		scriptsDir: nonBlank(paths.scriptsDir) ?? (PROJECT_ROOT === void 0 ? "scripts" : join(PROJECT_ROOT, "scripts")),
		dataDir: nonBlank(paths.dataDir) ?? ""
	};
}
/**
* Resolve the directory one capture writes into, most specific source first:
* the call's own `saveDir`, a pinned deployment `dataDir`, the calling
* session's workspace `data`, the project root's `data`, then a relative
* `data`.
*
* @param deployment - resolved deployment paths.
* @param saveDir - the call's explicit target directory, when it named one.
* @param sessionCwd - the calling session's working directory, when it has one.
* @returns the directory the capture scripts write their artifacts into.
*/
function captureDir(deployment, saveDir, sessionCwd) {
	const requested = nonBlank(saveDir);
	if (requested !== void 0) return requested;
	if (deployment.dataDir !== "") return deployment.dataDir;
	const workspace = nonBlank(sessionCwd);
	if (workspace !== void 0) {
		const workspaceData = join(workspace, "data");
		try {
			mkdirSync(workspaceData, { recursive: true });
		} catch {}
		return workspaceData;
	}
	if (deployment.root !== void 0) return join(deployment.root, "data");
	return "data";
}

//#endregion
export { probeBrowserService as a, deriveBrowserPort as i, resolveDeployment as n, sendCommand as o, CloakBrowserService as r, captureDir as t };