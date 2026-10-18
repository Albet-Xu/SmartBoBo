import { NullProtoObj as EmptyObject } from "rou3";
import { FastResponse, FastURL } from "srvx";
function withoutTrailingSlash(path) {
	if (!path || path === "/") return "/";
	return path[path.length - 1] === "/" ? path.slice(0, -1) : path;
}
function withLeadingSlash(path) {
	return !path ? "/" : path[0] === "/" ? path : "/" + path;
}
function joinURL(base, path) {
	if (!path || path === "/") return base || "/";
	if (!base) return path;
	const segment = path.replace(JOIN_LEADING_SLASH_RE, "");
	return (base[base.length - 1] === "/" ? base : base + "/") + segment;
}
const JOIN_LEADING_SLASH_RE = /^\//;
function stripBase(pathname, base) {
	if (pathname === base || pathname.startsWith(base + "/") || pathname.startsWith(base + "?")) return "/" + pathname.slice(base.length).replace(/^\/+/, "");
	return pathname;
}
function withoutBase(input = "", base = "") {
	if (!base || base === "/") return input;
	return stripBase(input, withoutTrailingSlash(base));
}
const AUTHORITY_RE = /^(?:[a-z][a-z\d+.-]*:)?\/\//i;
function getURLPathname(input) {
	const path = AUTHORITY_RE.test(input) ? input.replace(AUTHORITY_RE, "").replace(/^[^/?#]*/, "") : input;
	const end = path.search(/[#?]/);
	return end === -1 ? path : path.slice(0, end);
}
const NEEDLESS_ESCAPE_SRC = String.raw`%(?:2[146-9A-E]|3[0-9ABD]|4[0-9A-F]|5[0-9ABDF]|6[1-9A-F]|7[0-9ACE])`;
const NEEDLESS_ESCAPE_RE = /* @__PURE__ */ new RegExp(NEEDLESS_ESCAPE_SRC, "i");
const NEEDLESS_ESCAPE_RE_G = /* @__PURE__ */ new RegExp(NEEDLESS_ESCAPE_SRC, "gi");
function isNonCanonicalPathname(pathname) {
	return NEEDLESS_ESCAPE_RE.test(pathname);
}
function canonicalPathname(pathname) {
	return pathname.replace(NEEDLESS_ESCAPE_RE_G, (m) => String.fromCharCode(Number.parseInt(m.slice(1), 16)));
}
const ABSOLUTE_URL_RE = /^[a-z][a-z\d+\-.]*:\/\//i;
const ROUTE_ENCODE_RE = /[\u0000-\u0020"#<>\u0060]|[^\u0000-\u007E]/gu;
function normalizeRoute(route) {
	if (ABSOLUTE_URL_RE.test(route)) throw new Error(`Route patterns are pathnames, received URL: ${route}`);
	if (route.charCodeAt(0) !== 47) route = `/${route}`;
	route = canonicalPathname(route.replace(ROUTE_ENCODE_RE, encodeURIComponent));
	return route.includes("/.") ? resolveDotSegments(route) : route;
}
function resolveDotSegments(pathname) {
	const out = [];
	let dot = false;
	for (const segment of pathname.split("/")) {
		dot = segment === "." || segment === "..";
		if (!dot) out.push(segment);
		else if (segment.length === 2 && out.length > 1) out.pop();
	}
	if (dot) out.push("");
	return out.join("/");
}
function decodePathname(pathname) {
	try {
		return decodeURI(pathname);
	} catch {
		return;
	}
}
const ENCODED_SEP_RE_G = /%(?:25)*(?:2f|5c)/gi;
const ENCODED_SEP_FLAT_RE_G = /%(?:2f|5c)/gi;
function decodePreservingSeparators(value, opts) {
	if (!value.includes("%")) return value;
	const decode = opts?.decode || decodeURIComponent;
	const re = opts?.nested === false ? ENCODED_SEP_FLAT_RE_G : ENCODED_SEP_RE_G;
	let result = "";
	let lastIndex = 0;
	re.lastIndex = 0;
	for (let m; m = re.exec(value);) {
		result += decode(value.slice(lastIndex, m.index)) + m[0];
		lastIndex = m.index + m[0].length;
	}
	return result + decode(value.slice(lastIndex));
}
const kEventNS = "h3.internal.event.";
const kEventRes = /* @__PURE__ */ Symbol.for(`${kEventNS}res`);
const kEventResHeaders = /* @__PURE__ */ Symbol.for(`${kEventNS}res.headers`);
const kEventResErrHeaders = /* @__PURE__ */ Symbol.for(`${kEventNS}res.err.headers`);
const kMalformedURL = /* @__PURE__ */ Symbol.for(`${kEventNS}malformed`);
var H3Event = class {
	app;
	req;
	url;
	context;
	static __is_event__ = true;
	constructor(req, context, app) {
		this.context = req.context = context || req.context || new EmptyObject();
		this.req = req;
		this.app = app;
		const _url = req._url;
		let url = _url && _url instanceof URL ? _url : new FastURL(req.url);
		const pathname = url.pathname;
		if (pathname.includes("%")) {
			if (decodePathname(pathname) === void 0) this[kMalformedURL] = true;
			else if (isNonCanonicalPathname(pathname)) url = new FastURL(`${url.protocol}//${url.host}${canonicalPathname(pathname)}${url.search}`);
		}
		this.url = url;
	}
	get res() {
		return this[kEventRes] ||= new H3EventResponse();
	}
	get runtime() {
		return this.req.runtime;
	}
	waitUntil(promise) {
		this.req.waitUntil?.(promise);
	}
	toString() {
		return `[${this.req.method}] ${this.req.url}`;
	}
	toJSON() {
		return this.toString();
	}
	get node() {
		return this.req.runtime?.node;
	}
	get headers() {
		return this.req.headers;
	}
	get path() {
		return this.url.pathname + this.url.search;
	}
	get method() {
		return this.req.method;
	}
};
var H3EventResponse = class {
	status;
	statusText;
	get headers() {
		return this[kEventResHeaders] ||= new Headers();
	}
	get errHeaders() {
		return this[kEventResErrHeaders] ||= new Headers();
	}
};
const DISALLOWED_STATUS_CHARS = /[^\u0009\u0020-\u007E]/g;
function sanitizeStatusMessage(statusMessage = "") {
	return statusMessage.replace(DISALLOWED_STATUS_CHARS, "");
}
function sanitizeStatusCode(statusCode, defaultStatusCode = 200) {
	if (!statusCode) return defaultStatusCode;
	if (typeof statusCode === "string") statusCode = +statusCode;
	if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) return defaultStatusCode;
	return statusCode;
}
var HTTPError = class HTTPError extends Error {
	get name() {
		return "HTTPError";
	}
	status;
	statusText;
	headers;
	cause;
	data;
	body;
	unhandled;
	static isError(input) {
		return input instanceof Error && input?.name === "HTTPError";
	}
	static status(status, statusText, details) {
		return new HTTPError({
			...details,
			statusText,
			status
		});
	}
	constructor(arg1, arg2) {
		let messageInput;
		let details;
		if (typeof arg1 === "string") {
			messageInput = arg1;
			details = arg2;
		} else details = arg1;
		const status = sanitizeStatusCode(details?.status || details?.statusCode || (details?.cause)?.status || (details?.cause)?.statusCode, 500);
		const statusText = sanitizeStatusMessage(details?.statusText || details?.statusMessage || (details?.cause)?.statusText || (details?.cause)?.statusMessage);
		const message = messageInput || details?.message || (details?.cause)?.message || details?.statusText || details?.statusMessage || [
			"HTTPError",
			status,
			statusText
		].filter(Boolean).join(" ");
		super(message, { cause: details });
		this.cause = details;
		this.status = status;
		this.statusText = statusText || void 0;
		const rawHeaders = details?.headers || (details?.cause)?.headers;
		this.headers = rawHeaders ? new Headers(rawHeaders) : void 0;
		this.unhandled = details?.unhandled ?? (details?.cause)?.unhandled ?? void 0;
		this.data = details?.data;
		this.body = details?.body;
	}
	get statusCode() {
		return this.status;
	}
	get statusMessage() {
		return this.statusText;
	}
	toJSON() {
		const unhandled = this.unhandled;
		return {
			status: this.status,
			statusText: this.statusText,
			unhandled,
			message: unhandled ? "HTTPError" : this.message,
			data: unhandled ? void 0 : this.data,
			...unhandled ? void 0 : this.body
		};
	}
};
function hasProp(obj, prop) {
	try {
		return prop in obj;
	} catch {
		return false;
	}
}
function isJSONSerializable(value, _type) {
	if (value === null || value === void 0) return true;
	if (_type !== "object") return _type === "boolean" || _type === "number" || _type === "string";
	if (typeof value.toJSON === "function") return true;
	if (Array.isArray(value)) return true;
	if (typeof value.pipe === "function" || typeof value.pipeTo === "function") return false;
	if (value instanceof EmptyObject) return true;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
const kEventDispose = /* @__PURE__ */ Symbol.for("h3.internal.event.dispose");
function onDispose(event, cb) {
	let state = event[kEventDispose];
	if (!state) {
		const _state = {
			callbacks: [],
			observe: (response, val) => observeResponse(response, val, event, _state)
		};
		state = event[kEventDispose] = _state;
	}
	if (state.disposed) invokeDisposeCallbacks(event, [cb], state.reason);
	else state.callbacks.push(cb);
}
function observeResponse(response, val, event, state) {
	if (state.observing || state.disposed) return response;
	state.observing = true;
	const nodeRes = event.runtime?.node?.res;
	if (nodeRes) {
		if (nodeRes.closed || nodeRes.destroyed) {
			fireDispose(event, state, nodeRes.errored ?? abortError());
			return response;
		}
		nodeRes.once("close", () => {
			fireDispose(event, state, nodeRes.errored ?? (nodeRes.writableFinished ? void 0 : abortError()));
		});
		return response;
	}
	if (!isStreamBody(val) || !response.body) {
		fireDispose(event, state, void 0);
		return response;
	}
	const body = response.body;
	const { readable, writable } = new TransformStream();
	body.pipeTo(writable).then(() => fireDispose(event, state, void 0), (reason) => fireDispose(event, state, reason === void 0 ? abortError() : reason));
	return new FastResponse(readable, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});
}
function fireDispose(event, state, reason) {
	if (state.disposed) return;
	state.disposed = true;
	state.reason = reason;
	const callbacks = state.callbacks;
	state.callbacks = [];
	invokeDisposeCallbacks(event, callbacks, reason);
}
function invokeDisposeCallbacks(event, callbacks, reason) {
	const pending = [];
	for (const cb of callbacks) try {
		const res = cb(reason);
		if (typeof res?.then === "function") pending.push(Promise.resolve(res).catch((error) => reportDisposeError(event, error)));
	} catch (error) {
		reportDisposeError(event, error);
	}
	if (pending.length > 0) event.waitUntil(Promise.all(pending));
}
function isStreamBody(val) {
	return val instanceof ReadableStream || val instanceof Blob || val instanceof Response || val?.body instanceof ReadableStream;
}
function abortError() {
	return new DOMException("Connection closed prematurely.", "AbortError");
}
function reportDisposeError(event, error) {
	if (!event.app?.config.silent) console.error("[h3] onDispose:", error);
}
const kNotFound = /* @__PURE__ */ Symbol.for("h3.notFound");
const kHandled = /* @__PURE__ */ Symbol.for("h3.handled");
function toResponse(val, event, config = {}) {
	if (typeof val?.then === "function") return val.then((resolvedVal) => toResponse(resolvedVal, event, config), (r) => toResponse(toError(r), event, config));
	let response;
	try {
		response = prepareResponse(val, event, config);
	} catch (error) {
		return toResponse(toError(error), event, config);
	}
	if (typeof response?.then === "function") return toResponse(response, event, config);
	const { onResponse } = config;
	if (onResponse) return Promise.resolve().then(() => onResponse(response, event)).catch((error) => {
		if (!config.silent) console.error(error);
	}).then(() => event[kEventDispose]?.observe(response, val) ?? response);
	return event[kEventDispose]?.observe(response, val) ?? response;
}
function toError(value) {
	if (value === kNotFound || value === kHandled || value instanceof Error) return value;
	if (typeof value === "number") return new HTTPError({ status: value });
	const error = new HTTPError({
		status: 500,
		unhandled: true
	});
	error.cause = value;
	return error;
}
const kHTTPResponse = /* @__PURE__ */ Symbol.for("h3.HTTPResponse");
var HTTPResponse = class {
	#headers;
	#init;
	body;
	constructor(body, init) {
		this.body = body;
		this.#init = init;
	}
	get status() {
		return this.#init?.status;
	}
	get statusText() {
		return this.#init?.statusText;
	}
	get headers() {
		return this.#headers ||= new Headers(this.#init?.headers);
	}
};
HTTPResponse.prototype[kHTTPResponse] = true;
function prepareResponse(val, event, config, nested) {
	if (val === kHandled) return new FastResponse(null);
	if (val === kNotFound) val = new HTTPError({
		status: 404,
		message: `Cannot find any route matching [${event.req.method}] ${event.url}`
	});
	if (val && val instanceof Error) {
		const isHTTPError = HTTPError.isError(val);
		const error = isHTTPError ? val : new HTTPError(val);
		if (!isHTTPError) {
			error.unhandled = true;
			if (val?.stack) error.stack = val.stack;
		}
		if (error.unhandled && !config.silent) console.error(error);
		const { onError } = config;
		const errHeaders = event[kEventRes]?.[kEventResErrHeaders];
		if (onError && !nested) return Promise.resolve().then(() => onError(error, event)).catch(toError).then((newVal) => prepareResponse(newVal ?? val, event, config, true));
		event[kEventRes] = void 0;
		return errorResponse(error, config.debug, errHeaders);
	}
	const preparedRes = event[kEventRes];
	let preparedHeaders = preparedRes?.[kEventResHeaders];
	event[kEventRes] = void 0;
	if (!(val instanceof Response)) {
		const res = prepareResponseBody(val, event, config);
		const rawStatus = res.status || preparedRes?.status;
		const status = rawStatus ? sanitizeStatusCode(rawStatus) : void 0;
		const rawStatusText = res.statusText || preparedRes?.statusText;
		return new FastResponse(nullBody(event.req.method, status) ? null : res.body, {
			status,
			statusText: rawStatusText === void 0 ? void 0 : sanitizeStatusMessage(rawStatusText),
			headers: res.headers && preparedHeaders ? mergeHeaders(res.headers, preparedHeaders) : res.headers || preparedHeaders
		});
	}
	if (val.status >= 400) preparedHeaders = preparedRes?.[kEventResErrHeaders];
	if (preparedHeaders && !nested && !preparedHeaders.keys().next().done) return new FastResponse(nullBody(event.req.method, val.status) ? null : val.body, {
		status: val.status,
		statusText: val.statusText,
		headers: mergeHeaders(val.headers, preparedHeaders)
	});
	return event.req.method === "HEAD" && val.body !== null ? new FastResponse(null, {
		status: val.status,
		statusText: val.statusText,
		headers: val.headers
	}) : val;
}
function mergeHeaders(base, overrides, target = new Headers(base)) {
	for (const [name, value] of overrides) if (name === "set-cookie") target.append(name, value);
	else target.set(name, value);
	return target;
}
const frozen = (name) => (...args) => {
	throw new Error(`Headers are frozen (${name} ${args.join(", ")})`);
};
var FrozenHeaders = class extends Headers {
	set = frozen("set");
	append = frozen("append");
	delete = frozen("delete");
};
const emptyHeaders = /* @__PURE__ */ new FrozenHeaders({ "content-length": "0" });
const jsonHeaders = /* @__PURE__ */ new FrozenHeaders({ "content-type": "application/json;charset=UTF-8" });
function prepareResponseBody(val, event, config) {
	if (val === null || val === void 0) return {
		body: "",
		headers: emptyHeaders
	};
	const valType = typeof val;
	if (valType === "string") return { body: val };
	if (val instanceof Uint8Array) return {
		body: val,
		headers: new Headers({ "content-length": val.byteLength.toString() })
	};
	if (val instanceof HTTPResponse || val?.[kHTTPResponse] === true) return val;
	if (isJSONSerializable(val, valType)) return {
		body: JSON.stringify(val, void 0, config.debug ? 2 : void 0),
		headers: jsonHeaders
	};
	if (valType === "bigint") return {
		body: val.toString(),
		headers: jsonHeaders
	};
	if (val instanceof Blob) {
		const headers = new Headers({
			"content-type": val.type,
			"content-length": val.size.toString()
		});
		let filename = val.name;
		if (filename) {
			filename = encodeURIComponent(filename);
			headers.set("content-disposition", `filename="${filename}"; filename*=UTF-8''${filename}`);
		}
		return {
			body: val.stream(),
			headers
		};
	}
	if (valType === "symbol") return { body: val.toString() };
	if (valType === "function") return { body: `${val.name}()` };
	return { body: val };
}
function nullBody(method, status) {
	return method === "HEAD" || status === 100 || status === 101 || status === 102 || status === 204 || status === 205 || status === 304;
}
function errorResponse(error, debug, errHeaders) {
	let headers = error.headers ? mergeHeaders(jsonHeaders, error.headers) : new Headers(jsonHeaders);
	if (errHeaders) headers = mergeHeaders(headers, errHeaders);
	return new FastResponse(JSON.stringify({
		...error.toJSON(),
		stack: debug && error.stack ? error.stack.split("\n").map((l) => l.trim()) : void 0
	}, void 0, debug ? 2 : void 0), {
		status: error.status,
		statusText: error.statusText,
		headers
	});
}
export { EmptyObject, H3Event, HTTPError, HTTPResponse, canonicalPathname, decodePreservingSeparators, getURLPathname, hasProp, joinURL, kHandled, kMalformedURL, kNotFound, normalizeRoute, onDispose, sanitizeStatusCode, sanitizeStatusMessage, stripBase, toError, toResponse, withLeadingSlash, withoutBase, withoutTrailingSlash };
