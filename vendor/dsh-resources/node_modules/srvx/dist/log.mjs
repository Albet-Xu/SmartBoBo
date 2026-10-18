import { blue, bold, gray, green, red, yellow } from "./_chunks/_utils.mjs";
const plain = (text) => text;
const paintForStatus = (code) => code < 200 ? blue : code < 300 ? green : code < 400 ? yellow : red;
function colorsEnabled() {
	const env = globalThis.process?.env;
	return !!env?.FORCE_COLOR || env?.NODE_ENV !== "production";
}
const encoder = /* @__PURE__ */ new TextEncoder();
const stdout = globalThis.process?.stdout;
const write = /* @__PURE__ */ (() => {
	if (stdout?.write) return (chunk) => stdout.write(chunk);
	return (chunk) => (console.log(chunk.slice(0, -1)), true);
})();
const schedule = /* @__PURE__ */ (() => {
	const setImmediate = globalThis.setImmediate;
	return setImmediate ? (task) => void setImmediate(task) : (task) => queueMicrotask(task);
})();
let pending = "";
let scheduled = false;
let draining = false;
function enqueue(line) {
	pending += line;
	if (!scheduled && !draining) {
		scheduled = true;
		schedule(flush);
	}
}
function writeNow(line) {
	pending += line;
	flush();
}
function flush() {
	scheduled = false;
	if (draining || !pending) return;
	const chunk = pending;
	pending = "";
	try {
		if (!write(chunk) && stdout?.once) {
			draining = true;
			stdout.once("drain", onDrain);
		}
	} catch {}
}
function onDrain() {
	draining = false;
	if (pending) {
		scheduled = true;
		schedule(flush);
	}
}
function flushSync() {
	if (!pending) return;
	const proc = globalThis.process;
	const chunk = pending;
	pending = "";
	try {
		const fs = proc?.getBuiltinModule?.("node:fs");
		if (fs) {
			const bytes = encoder.encode(chunk);
			for (let offset = 0; offset < bytes.length;) {
				const written = fs.writeSync(1, bytes, offset, bytes.length - offset);
				if (written <= 0) break;
				offset += written;
			}
		} else proc?.stdout?.write(chunk);
	} catch {}
}
let exitHooked = false;
function hookExit() {
	const proc = globalThis.process;
	if (exitHooked || !proc?.on) return;
	exitHooked = true;
	proc.on("exit", flushSync);
	if (!proc.listenerCount || !proc.kill) return;
	for (const [sig, signum] of [
		["SIGHUP", 1],
		["SIGINT", 2],
		["SIGTERM", 15]
	]) {
		const onSignal = () => {
			if (proc.listenerCount(sig) > 1) return;
			flushSync();
			proc.removeListener(sig, onSignal);
			try {
				proc.kill(proc.pid, sig);
			} catch {
				proc.exit(128 + signum);
			}
		};
		if (proc.prependListener) proc.prependListener(sig, onSignal);
		else proc.on(sig, onSignal);
	}
}
const loggerMiddleware = (options = {}) => {
	const emit = options.batch === false ? writeNow : enqueue;
	const colors = colorsEnabled();
	const paint = (fn) => colors ? fn : plain;
	const gray$1 = paint(gray);
	const bold$1 = paint(bold);
	const blue$1 = paint(blue);
	let cachedSecond = 0;
	let cachedTime = "";
	const time = () => {
		const now = Date.now();
		const second = now - now % 1e3;
		if (second !== cachedSecond) {
			cachedSecond = second;
			cachedTime = gray$1(`[${new Date(now).toLocaleTimeString()}]`);
		}
		return cachedTime;
	};
	const status = (code) => `[${paint(paintForStatus(code))(code + "")}]`;
	hookExit();
	return async (req, next) => {
		const start = performance.now();
		const res = await next();
		const duration = performance.now() - start;
		emit(`${time()} ${bold$1(req.method)} ${blue$1(req.url)} ${status(res.status)} ${gray$1(`(${duration.toFixed(2)}ms)`)}\n`);
		return res;
	};
};
export { loggerMiddleware };
