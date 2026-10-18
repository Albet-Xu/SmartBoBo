import { EmptyObject, HTTPError, HTTPResponse } from "./response.mjs";
const ignoredHeaders = /* @__PURE__ */ new Set([
	"transfer-encoding",
	"accept-encoding",
	"connection",
	"keep-alive",
	"upgrade",
	"expect",
	"te",
	"trailer",
	"host",
	"proxy-authorization",
	"proxy-connection"
]);
const framingHeaders = /* @__PURE__ */ new Set([
	"connection",
	"keep-alive",
	"transfer-encoding",
	"te",
	"trailer",
	"upgrade",
	"proxy-authorization",
	"proxy-connection"
]);
function connectionTokens(connection) {
	return new Set((connection || "").toLowerCase().split(",").map((name) => name.trim()).filter(Boolean));
}
const ignoredResponseHeaders = /* @__PURE__ */ new Set([
	"content-encoding",
	"content-length",
	"transfer-encoding",
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-connection",
	"upgrade",
	"trailer",
	"te"
]);
function rewriteCookieProperty(header, map, property) {
	const _map = typeof map === "string" ? { "*": map } : map;
	return header.replace(new RegExp(`(;\\s*${property}=)([^;]+)`, "gi"), (match, prefix, previousValue) => {
		let newValue;
		if (Object.hasOwn(_map, previousValue)) newValue = _map[previousValue];
		else if (Object.hasOwn(_map, "*")) newValue = _map["*"];
		else return match;
		return newValue ? prefix + newValue : "";
	});
}
function applyXForwardedHeaders(headers, event) {
	const merged = headers instanceof Headers ? headers : new Headers(headers);
	const ip = event.req.ip;
	if (ip) {
		const forwardedFor = merged.get("x-forwarded-for");
		merged.set("x-forwarded-for", forwardedFor ? `${forwardedFor}, ${ip}` : ip);
	}
	const proto = event.url.protocol.slice(0, -1);
	merged.set("x-forwarded-proto", proto);
	merged.set("x-forwarded-host", event.url.host);
	merged.set("x-forwarded-port", event.url.port || (proto === "https" ? "443" : "80"));
	return merged;
}
function rewriteLocationHeaders(headers, rewrite, targetOrigin, requestOrigin) {
	const rewriteValue = (value) => rewrite === true ? rewriteOrigin(value, targetOrigin, requestOrigin) : rewritePrefix(value, rewrite);
	const location = headers.get("location");
	if (location) {
		const rewritten = rewriteValue(location);
		if (rewritten) headers.set("location", rewritten);
	}
	const refresh = headers.get("refresh");
	if (refresh) {
		const match = refresh.match(/^(\s*(?:[\d.]+\s*[;,]\s*)?url\s*=\s*)(['"]?)(.*?)\2(\s*)$/i);
		const rewritten = match && rewriteValue(match[3]);
		if (rewritten) headers.set("refresh", match[1] + match[2] + rewritten + match[2] + match[4]);
	}
}
function rewriteOrigin(value, targetOrigin, requestOrigin) {
	if (!targetOrigin || targetOrigin === requestOrigin) return;
	const url = value.startsWith("//") ? URL.canParse(value, targetOrigin) ? new URL(value, targetOrigin) : void 0 : URL.canParse(value) ? new URL(value) : void 0;
	if (!url || url.origin !== targetOrigin) return;
	return requestOrigin + url.pathname + url.search + url.hash;
}
function rewritePrefix(value, map) {
	for (const prefix of Object.keys(map)) if (value.startsWith(prefix)) return map[prefix] + value.slice(prefix.length);
}
function abortable(run, signal) {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		Promise.resolve(run()).then((value) => {
			signal.removeEventListener("abort", onAbort);
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", onAbort);
			reject(error);
		});
	});
}
function mergeHeaders(defaults, ...inputs) {
	const _inputs = inputs.filter(Boolean);
	if (_inputs.length === 0) return defaults;
	const merged = new Headers(defaults);
	for (const input of _inputs) {
		const entries = Array.isArray(input) ? input : typeof input.entries === "function" ? input.entries() : Object.entries(input);
		for (const [key, value] of entries) if (value !== void 0) merged.set(key, value);
	}
	return merged;
}
async function proxyRequest(event, target, opts = {}) {
	const method = opts.fetchOptions?.method || event.req.method;
	const methodUpper = method.toUpperCase();
	const incomingBody = event.req.body;
	const requestBody = incomingBody != null && methodUpper !== "GET" && methodUpper !== "HEAD" ? incomingBody : void 0;
	const proxyHeaders = getProxyRequestHeaders(event, {
		host: target.startsWith("/"),
		forwardHeaders: opts.forwardHeaders,
		filterHeaders: opts.filterHeaders
	});
	const fetchHeaders = mergeHeaders(opts.xfwd ? applyXForwardedHeaders(proxyHeaders, event) : proxyHeaders, opts.fetchOptions?.headers, opts.headers);
	if (opts.fetchOptions && "body" in opts.fetchOptions || incomingBody && !requestBody) {
		if (fetchHeaders instanceof Headers) fetchHeaders.delete("content-length");
		else if (!Array.isArray(fetchHeaders)) delete fetchHeaders["content-length"];
	}
	const fetchBody = opts.fetchOptions?.body ?? requestBody;
	return proxy(event, target, {
		...opts,
		fetchOptions: {
			method,
			body: requestBody,
			...opts.fetchOptions,
			duplex: opts.fetchOptions?.duplex ?? (fetchBody != null ? "half" : void 0),
			headers: fetchHeaders
		}
	});
}
async function proxy(event, target, opts = {}) {
	const signals = [event.req.signal];
	if (opts.fetchOptions?.signal) signals.push(opts.fetchOptions.signal);
	let timeoutId;
	if (opts.timeout > 0 && Number.isFinite(opts.timeout)) {
		const timeoutController = new AbortController();
		timeoutId = setTimeout(() => timeoutController.abort(new DOMException("Proxy request timed out", "TimeoutError")), Math.min(Math.max(Math.trunc(opts.timeout), 1), 2147483647));
		signals.push(timeoutController.signal);
	}
	const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
	const fetchOptions = {
		headers: opts.headers,
		...opts.fetchOptions,
		redirect: opts.fetchOptions?.redirect ?? "manual",
		signal
	};
	let response;
	try {
		response = target[0] === "/" ? await abortable(() => event.app.fetch(createSubRequest(event, target, fetchOptions)), signal) : await fetch(target, fetchOptions);
	} catch (error) {
		if ((signal.aborted ? signal.reason : void 0)?.name === "TimeoutError" || error?.name === "TimeoutError") throw new HTTPError({
			status: 504,
			statusText: "Gateway Timeout",
			cause: error
		});
		if (signal.aborted || error?.name === "AbortError") {
			if (opts.propagateAbortError) throw error;
			if (event.req.signal.aborted) return new HTTPResponse(null, {
				status: 499,
				statusText: "Client Closed Request"
			});
		}
		throw new HTTPError("Bad Gateway", {
			status: 502,
			statusText: "Bad Gateway",
			cause: error
		});
	} finally {
		if (timeoutId !== void 0) clearTimeout(timeoutId);
	}
	if (response.type === "opaqueredirect") throw new HTTPError({
		status: 502,
		message: "Cannot relay an opaque redirect response on this runtime. Set `fetchOptions: { redirect: \"follow\" }` to follow upstream redirects instead."
	});
	if (response.type === "opaque" || response.type === "error" || response.status === 0) throw new HTTPError({
		status: 502,
		message: "Cannot relay an opaque or errored upstream response (status 0), typically caused by a `no-cors` request mode on browser/service-worker runtimes."
	});
	const headers = new Headers();
	const connectionNominated = connectionTokens(response.headers.get("connection"));
	for (const [key, value] of response.headers.entries()) {
		if (ignoredResponseHeaders.has(key) || connectionNominated.has(key) || key === "set-cookie") continue;
		headers.append(key, value);
	}
	const cookies = response.headers.getSetCookie();
	if (cookies.length > 0) {
		const _cookies = cookies.map((cookie) => {
			if (opts.cookieDomainRewrite) cookie = rewriteCookieProperty(cookie, opts.cookieDomainRewrite, "domain");
			if (opts.cookiePathRewrite) cookie = rewriteCookieProperty(cookie, opts.cookiePathRewrite, "path");
			return cookie;
		});
		for (const cookie of _cookies) headers.append("set-cookie", cookie);
	}
	const locationRewrite = opts.locationRewrite ?? true;
	if (locationRewrite !== false && (locationRewrite !== true || target[0] !== "/")) rewriteLocationHeaders(headers, locationRewrite, target[0] === "/" ? void 0 : new URL(target).origin, event.url.origin);
	if (opts.onResponse) await opts.onResponse(event, response);
	return new HTTPResponse(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}
function getProxyRequestHeaders(event, opts) {
	const headers = new EmptyObject();
	const filterHeaders = opts?.filterHeaders?.map((h) => h.toLowerCase());
	const forwardHeaders = opts?.forwardHeaders?.map((h) => h.toLowerCase());
	const connectionNominated = connectionTokens(event.req.headers.get("connection"));
	for (const [name, value] of event.req.headers.entries()) {
		if (filterHeaders?.includes(name)) continue;
		if (forwardHeaders?.includes(name) && !framingHeaders.has(name) && !connectionNominated.has(name)) {
			headers[name] = value;
			continue;
		}
		if (connectionNominated.has(name)) continue;
		if (!ignoredHeaders.has(name) || name === "host" && opts?.host) {
			headers[name] = value;
			continue;
		}
	}
	return headers;
}
async function fetchWithEvent(event, url, init) {
	if (url[0] !== "/") {
		if (init?.body != null && init.duplex === void 0) init = {
			...init,
			duplex: "half"
		};
		return fetch(url, init);
	}
	return event.app.fetch(createSubRequest(event, url, {
		...init,
		headers: mergeHeaders(getProxyRequestHeaders(event, { host: true }), init?.headers)
	}));
}
function createSubRequest(event, path, init) {
	const url = new URL(path.replace(LEADING_SEPARATOR_RUN_RE, "/"), event.url);
	if (init.body != null && init.duplex === void 0) init = {
		...init,
		duplex: "half"
	};
	const req = new Request(url, init);
	req.runtime = event.req.runtime;
	req.waitUntil = event.req.waitUntil;
	req.ip = event.req.ip;
	return req;
}
const LEADING_SEPARATOR_RUN_RE = /^(?:[/\\]|[\t\n\r])+/;
export { fetchWithEvent, getProxyRequestHeaders, proxy, proxyRequest };
