import { n as resolveDeployment, r as CloakBrowserService, t as captureDir } from "./deployment-BkFMwNXS.js";
import z from "@deepseek-ai/schemastery";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";

//#region src/python.ts
/**
* Runs the deployment's Python scripts as one-shot children and reports their
* exit as a typed failure, so the crawl tool can tell "the browser service is
* gone" (exit code 2) from every other failure.
* @module bobo-crawl-tool/python
*/
/** A Python invocation that exited non-zero, was killed, or could not start. */
var PythonFailure = class extends Error {
	/** Exit code when the process exited on its own; undefined for a signal, a deadline, or a spawn failure. */
	code;
	/**
	* @param message - captured stderr when the child produced any, otherwise the runner's own diagnosis.
	* @param code - the process exit code, or undefined when no exit code applies.
	*/
	constructor(message, code) {
		super(message);
		this.name = "PythonFailure";
		this.code = code;
	}
};
/** Model-facing detail of one failed invocation. */
function failureDetail(error, stderr) {
	const captured = stderr.trim();
	if (captured !== "") return captured;
	if (error.signal !== void 0) return `python was killed by ${error.signal}`;
	return error.message;
}
/** Exit code of a failed invocation, or undefined when it was killed or never started. */
function exitCodeOf(error) {
	return typeof error.code === "number" ? error.code : void 0;
}
/**
* Run one Python script to completion.
*
* @param pythonBin - interpreter to run.
* @param args - script path and arguments, unquoted: the child is spawned
*   without a shell, so no argument needs escaping.
* @param options - deadline and the caller's cancellation signal.
* @returns the captured stdout and stderr of a successful run.
* @throws {PythonFailure} when the child cannot start, is killed by the
*   deadline or the signal, or exits non-zero.
*/
function runPython(pythonBin, args, options) {
	const execOptions = {
		timeout: options.timeoutMs,
		encoding: "utf-8",
		windowsHide: true,
		...options.signal === void 0 ? {} : { signal: options.signal }
	};
	return new Promise((resolveRun, rejectRun) => {
		execFile(pythonBin, [...args], execOptions, (error, stdout, stderr) => {
			if (error === null) {
				resolveRun({
					stdout,
					stderr
				});
				return;
			}
			rejectRun(new PythonFailure(failureDetail(error, stderr), exitCodeOf(error)));
		});
	});
}

//#endregion
//#region src/proxy.ts
/** Profile entry id carrying the proxy pool sources and strategy. */
const PROXY_POOL_NAMESPACE = "proxy-pool";
/** Proxy mode of one session, folded from that session's committed events. */
var SessionProxyMode = class {
	enabled = /* @__PURE__ */ new WeakMap();
	/**
	* @param ctx - context whose fiber owns the session-event subscription, so
	*   the fold stops with the plugin instance.
	*/
	constructor(ctx) {
		ctx.on("session/event", (session, event) => {
			if (event.type === "proxy/enabled") this.enabled.set(session, event.data.enabled);
		});
	}
	/**
	* Whether proxy mode is on for `session` after its committed events. A
	* session whose `proxy/enabled` events were appended before this plugin
	* subscribed — a resumed session — reads as off until its next one.
	* @param session - the session to read.
	* @returns the last committed value; off when the session logged none.
	*/
	of(session) {
		return this.enabled.get(session) ?? false;
	}
};
/** Whether a value is a plain data object. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Narrow one source entry, or undefined when any field the pool script reads has the wrong JSON type. */
function narrowSource(value) {
	if (!isRecord(value)) return void 0;
	const { name: name$1, apiUrl, apiKey, pwd, getnum, httptype, geshi, fenge, enabled } = value;
	if (typeof name$1 !== "string" || typeof apiUrl !== "string" || typeof apiKey !== "string" || typeof pwd !== "string" || typeof getnum !== "number" || typeof httptype !== "string" || typeof geshi !== "string" || typeof fenge !== "string" || typeof enabled !== "boolean") return void 0;
	return {
		name: name$1,
		apiUrl,
		apiKey,
		pwd,
		getnum,
		httptype,
		geshi,
		fenge,
		enabled
	};
}
/**
* Read the resolved `proxy-pool` section for one capture.
*
* The section is another plugin entry's volatile Config, so it arrives
* through the settings service's describe projection: this finds the
* descriptor whose ns is the `proxy-pool` entry id and narrows the fields the
* pool script consumes, rather than forwarding a malformed candidate.
*
* @param settings - the settings service; absent in a deployment that composes none.
* @returns the pool, or undefined while no `proxy-pool` entry serves a form.
* @throws {Error} when the section is registered but does not carry this plugin's fields.
*/
function proxyPoolOf(settings) {
	const value = settings?.describe().find((descriptor) => descriptor.ns === PROXY_POOL_NAMESPACE)?.value;
	if (value === void 0) return void 0;
	const label = `settings section "${PROXY_POOL_NAMESPACE}"`;
	if (!isRecord(value)) throw new Error(`${label} is not an object of keys`);
	if (typeof value["enabled"] !== "boolean") throw new Error(`${label} must carry a boolean "enabled"`);
	if (typeof value["timeoutMs"] !== "number") throw new Error(`${label} must carry a numeric "timeoutMs"`);
	const strategy = value["fetchStrategy"];
	if (strategy !== "cache" && strategy !== "realtime") throw new Error(`${label} must carry "fetchStrategy" "cache" or "realtime"`);
	const rawSources = value["sources"];
	if (!Array.isArray(rawSources)) throw new Error(`${label} must carry a "sources" array`);
	const narrowed = rawSources.map(narrowSource);
	if (narrowed.some((source) => source === void 0)) throw new Error(`${label} carries a source entry the proxy pool cannot use`);
	return {
		enabled: value["enabled"],
		timeoutMs: value["timeoutMs"],
		fetchStrategy: strategy,
		sources: narrowed.filter((source) => source !== void 0)
	};
}
/**
* Ask the deployment's proxy pool for one address usable for `targetUrl`.
*
* @param pythonBin - interpreter running the pool script.
* @param scriptsDir - directory holding `proxy_pool.py`.
* @param pool - the resolved pool section.
* @param targetUrl - the page the address has to reach.
* @param timeoutMs - budget for the pool script itself.
* @param signal - caller cancellation.
* @returns the proxy URL, with scheme, to inject into the browser service.
* @throws {Error} when the pool reports that every candidate failed or that
*   none is available; the message is the question the model relays to the user.
*/
async function acquireProxy(pythonBin, scriptsDir, pool, targetUrl, timeoutMs, signal) {
	const run = await runPython(pythonBin, [
		join(scriptsDir, "proxy_pool.py"),
		"--action",
		"get",
		"--config-json",
		JSON.stringify({
			sources: pool.sources.filter((source) => source.enabled),
			fetchStrategy: pool.fetchStrategy,
			timeoutMs: pool.timeoutMs
		}),
		"--target-url",
		targetUrl
	], {
		timeoutMs,
		signal
	});
	let reply;
	try {
		reply = JSON.parse(run.stdout);
	} catch {
		throw new Error(`代理池返回非 JSON 结果: ${run.stdout.slice(0, 200)}`);
	}
	if (!isRecord(reply)) throw new Error(`代理池返回非 JSON 对象: ${run.stdout.slice(0, 200)}`);
	if (reply["failed"] === true) throw new Error("代理失效，是否走本地网络进行访问网页？");
	const proxy = reply["proxy"];
	if (typeof proxy !== "string" || proxy === "") throw new Error("代理池无可用代理，是否走本地网络进行访问网页？");
	return proxy;
}

//#endregion
//#region src/crawl-tool.ts
/**
* The model-facing `crawl_fetch` tool: render one page through the deployment's
* long-lived CloakBrowser-backed browser service (browser_server.py over cloakserve CDP) and save every requested output format.
*
* One crawl derives all its formats from the same rendered document, so asking
* for `html,md,skeleton` costs one page load. Artifacts land under the calling
* session's workspace `data` directory unless the call or the deployment names
* another target.
* @module bobo-crawl-tool/crawl-tool
*/
/** Model-visible tool name. */
const CRAWL_FETCH_TOOL = "crawl_fetch";
/** Output formats the engine can derive, each from the same rendered document. */
const OUTPUT_FORMATS = [
	"html",
	"md",
	"skeleton"
];
/** Characters of the rendered text carried back to the model as a preview. */
const CONTENT_PREVIEW_CHARS = 2e3;
/** Engine script, inside the deployment's scripts directory. */
const CRAWL_ENGINE_SCRIPT = "run_cloak.py";
/** Exit code the engine uses when it cannot reach the browser service. */
const SERVICE_UNREACHABLE_EXIT_CODE = 2;
/**
* Validate the requested output formats.
*
* @param requested - the model's `outputFormat` value, comma-separated.
* @returns the accepted formats in request order without duplicates, or `md`
*   when the request names none of {@link OUTPUT_FORMATS}.
*/
function parseOutputFormats(requested) {
	const accepted = (requested ?? "md").split(",").map((entry) => entry.trim().toLowerCase()).filter((entry) => OUTPUT_FORMATS.includes(entry));
	const unique = [...new Set(accepted)];
	return unique.length > 0 ? unique : ["md"];
}
/** Model-facing detail of one failed run. */
function detailOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Text of one engine report field, or the empty string when the engine sent another type. */
function textOf(value) {
	return typeof value === "string" ? value : "";
}
/** One engine invocation, without the browser-service retry. */
async function captureOnce(deps, args, signal) {
	return (await runPython(deps.deployment.pythonBin, args, {
		timeoutMs: deps.timeoutMs,
		signal
	})).stdout;
}
/**
* Run one capture, replacing the browser service and retrying once when the
* engine reports it unreachable.
*
* @param deps - registration dependencies.
* @param proxy - proxy URL the browser service was started with, reused when
*   the service is relaunched.
* @param buildArgs - engine arguments for one endpoint.
* @param signal - caller cancellation.
* @returns the engine's stdout, one line of JSON.
* @throws {Error} naming the engine failure; the retry failure names the restart.
*/
async function captureWithServiceRestart(deps, proxy, buildArgs, signal) {
	const endpoint = await deps.browser.endpoint(proxy);
	try {
		return await captureOnce(deps, buildArgs(endpoint), signal);
	} catch (error) {
		if (!(error instanceof PythonFailure) || error.code !== SERVICE_UNREACHABLE_EXIT_CODE) throw new Error(`crawl_fetch 后台脚本执行失败: ${detailOf(error)}`);
		deps.browser.dispose();
		const restarted = await deps.browser.endpoint(proxy);
		try {
			return await captureOnce(deps, buildArgs(restarted), signal);
		} catch (retryError) {
			throw new Error(`crawl_fetch 后台脚本执行失败（浏览器服务已重启仍不可用）: ${detailOf(retryError)}`);
		}
	}
}
/**
* Project the engine's one-line JSON report into the tool's canonical value.
*
* @param stdout - the engine's stdout.
* @param requestedFormat - the validated format list, used when the report carries none.
* @returns the capture report.
* @throws {Error} when the engine printed no JSON object, which no successful
*   capture can do.
*/
function reportToValue(stdout, requestedFormat) {
	let reply;
	try {
		reply = JSON.parse(stdout);
	} catch {
		throw new Error(`crawl_fetch 后台脚本未返回 JSON 报告: ${stdout.slice(0, 200)}`);
	}
	if (typeof reply !== "object" || reply === null || Array.isArray(reply)) throw new Error(`crawl_fetch 后台脚本未返回 JSON 报告: ${stdout.slice(0, 200)}`);
	const report = reply;
	const outputs = Array.isArray(report["outputs"]) ? report["outputs"].map((entry) => {
		const record = typeof entry === "object" && entry !== null ? entry : {};
		return {
			format: textOf(record["format"]),
			path: textOf(record["path"])
		};
	}) : [];
	const reportedFormat = textOf(report["format"]);
	return {
		savedTo: textOf(report["savedTo"]),
		status: typeof report["status"] === "number" ? report["status"] : 0,
		contentPreview: textOf(report["preview"]).slice(0, CONTENT_PREVIEW_CHARS),
		format: reportedFormat === "" ? requestedFormat : reportedFormat,
		outputs
	};
}
/**
* Register `crawl_fetch` on the tools registry of the calling plugin instance.
*
* @param ctx - context whose `tools` registry receives the registration; the
*   registration is effect-scoped and leaves with that instance.
* @param deps - resolved deployment, browser-service owner, proxy fold, and budgets.
*/
function registerCrawlFetchTool(ctx, deps) {
	ctx.tools.register(defineTool({
		name: CRAWL_FETCH_TOOL,
		description: "Fetch a webpage with the local Python engine, convert the rendered content to one or more chosen output formats, and save them to the local data directory. A single crawl can produce multiple formats (each derived from the same rendered HTML). By default, saves to the current workspace's data folder. Returns the saved path(s), HTTP status, chosen format(s) and a short text preview.",
		parameters: {
			url: {
				type: "string",
				required: true,
				description: "The target webpage URL to crawl, e.g. https://example.com."
			},
			selector: {
				type: "string",
				description: "Optional CSS selector to narrow extraction; when present, only the first match is returned."
			},
			outputFormat: {
				type: "string",
				description: "One or more output formats, comma-separated: \"html\" (raw rendered HTML), \"md\" (Markdown, default), \"skeleton\" (block-level webpage skeleton). E.g. \"html,md,skeleton\" returns all three from a single crawl. Extensions: html -> .html, md -> .md, skeleton -> .skeleton.txt."
			},
			outFile: {
				type: "string",
				description: "Optional target filename; default is auto-generated as 站点_标题_时间戳.<ext>. Extension is appended per outputFormat when missing."
			},
			saveDir: {
				type: "string",
				description: "Optional directory to save the file; default is the current workspace's data folder."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					savedTo: {
						type: "string",
						required: true
					},
					status: {
						type: "number",
						required: true
					},
					contentPreview: {
						type: "string",
						required: true
					},
					format: {
						type: "string",
						required: true
					},
					outputs: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								format: {
									type: "string",
									required: true
								},
								path: {
									type: "string",
									required: true
								}
							}
						}
					}
				}
			},
			render: (_args, value) => {
				return [{
					type: "text",
					text: `采集完成:\n${value.outputs.length > 0 ? value.outputs.map((output) => `- ${output.format}: ${output.path}`).join("\n") : `- 已保存: ${value.savedTo}`}\n- HTTP状态: ${value.status}\n- 格式: ${value.format}\n- 预览: ${value.contentPreview}`
				}];
			}
		},
		async execute(args, exec) {
			const format = parseOutputFormats(args.outputFormat).join(",");
			const dataDir = captureDir(deps.deployment, args.saveDir, exec.agent?.session.header.cwd);
			const session = exec.agent?.session;
			const pool = session !== void 0 && deps.proxyMode.of(session) ? proxyPoolOf(ctx.get("settings")) : void 0;
			return reportToValue(await captureWithServiceRestart(deps, pool !== void 0 && pool.enabled && pool.sources.length > 0 ? await acquireProxy(deps.deployment.pythonBin, deps.deployment.scriptsDir, pool, args.url, deps.proxyTimeoutMs, exec.signal) : void 0, (endpoint) => [
				join(deps.deployment.scriptsDir, CRAWL_ENGINE_SCRIPT),
				"--url",
				args.url,
				"--out",
				join(dataDir, args.outFile ?? "crawl_auto"),
				"--format",
				format,
				"--server",
				endpoint,
				...args.outFile === void 0 ? ["--auto-name"] : [],
				...args.selector === void 0 ? [] : ["--selector", args.selector]
			], exec.signal), format);
		},
		presentCall: (args) => ({
			card: "generic",
			title: `采集: ${args.url}`,
			rawInput: args.url,
			kind: "fetch"
		}),
		presentResult: () => ({ card: "generic" })
	}));
}

//#endregion
//#region src/index.ts
/** Cordis plugin name used by loader diagnostics. */
const name = "tool-acquisition";
/** Services required before the tool can be registered. */
const inject = ["tools"];
const Config = z.object({
	pythonBin: z.string(),
	scriptsDir: z.string(),
	dataDir: z.string().default(""),
	timeoutMs: z.natural().min(1e3).default(12e4),
	serverStartTimeoutMs: z.natural().min(1e3).default(6e4),
	proxyFetchTimeoutMs: z.natural().min(1e3).default(15e3)
});
/** Reject a configured budget that is not whole positive milliseconds. */
function assertBudget(name$1, value) {
	if (!Number.isInteger(value) || value < 1) throw new Error(`tool-acquisition: ${name$1} must be a positive integer number of milliseconds`);
}
/**
* Register `crawl_fetch` and take ownership of the browser service it drives.
*
* @param ctx - context whose `tools` registry receives the tool; the
*   registration and the browser service both leave with this plugin instance.
* @param config - deployment paths and budgets, validated by {@link Config}.
* @throws {Error} when a configured budget is not whole positive milliseconds.
*/
function apply(ctx, config) {
	const resolved = config;
	assertBudget("timeoutMs", resolved.timeoutMs);
	assertBudget("serverStartTimeoutMs", resolved.serverStartTimeoutMs);
	assertBudget("proxyFetchTimeoutMs", resolved.proxyFetchTimeoutMs);
	const deployment = resolveDeployment({
		pythonBin: resolved.pythonBin,
		scriptsDir: resolved.scriptsDir,
		dataDir: resolved.dataDir
	});
	const browser = new CloakBrowserService(deployment, resolved.serverStartTimeoutMs);
	ctx.effect(() => () => {
		browser.dispose();
	}, "tool-acquisition.browser-server");
	registerCrawlFetchTool(ctx, {
		deployment,
		browser,
		proxyMode: new SessionProxyMode(ctx),
		timeoutMs: resolved.timeoutMs,
		proxyTimeoutMs: resolved.proxyFetchTimeoutMs
	});
}

//#endregion
export { Config, apply, inject, name };