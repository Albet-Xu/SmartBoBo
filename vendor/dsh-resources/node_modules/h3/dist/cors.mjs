import { HTTPResponse, onDispose as onDispose$1 } from "./response.mjs";
const textEncoder = /* @__PURE__ */ new TextEncoder();
const textDecoder = /* @__PURE__ */ new TextDecoder();
const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function base64Encode(data) {
	const buff = validateBinaryLike(data);
	if (globalThis.Buffer) return globalThis.Buffer.from(buff).toString("base64url");
	let result = "";
	let i;
	const len = buff.length;
	for (i = 2; i < len; i += 3) result += base64Chars[buff[i - 2] >> 2] + base64Chars[(buff[i - 2] & 3) << 4 | buff[i - 1] >> 4] + base64Chars[(buff[i - 1] & 15) << 2 | buff[i] >> 6] + base64Chars[buff[i] & 63];
	if (i === len + 1) result += base64Chars[buff[i - 2] >> 2] + base64Chars[(buff[i - 2] & 3) << 4];
	if (i === len) result += base64Chars[buff[i - 2] >> 2] + base64Chars[(buff[i - 2] & 3) << 4 | buff[i - 1] >> 4] + base64Chars[(buff[i - 1] & 15) << 2];
	return result;
}
function base64Decode(b64Url) {
	if (globalThis.Buffer) return new Uint8Array(globalThis.Buffer.from(b64Url, "base64url"));
	const b64 = b64Url.replace(/-/g, "+").replace(/_/g, "/");
	const binString = atob(b64);
	const size = binString.length;
	const bytes = new Uint8Array(size);
	for (let i = 0; i < size; i++) bytes[i] = binString.charCodeAt(i);
	return bytes;
}
function validateBinaryLike(source) {
	if (typeof source === "string") return textEncoder.encode(source);
	else if (source instanceof Uint8Array) return source;
	else if (source instanceof ArrayBuffer) return new Uint8Array(source);
	throw new TypeError(`The input must be a Uint8Array, a string, or an ArrayBuffer.`);
}
function serializeIterableValue(value) {
	switch (typeof value) {
		case "string": return textEncoder.encode(value);
		case "boolean":
		case "number":
		case "bigint":
		case "symbol": return textEncoder.encode(value.toString());
		case "object":
			if (value instanceof Uint8Array) return value;
			return textEncoder.encode(JSON.stringify(value));
	}
	return /* @__PURE__ */ new Uint8Array();
}
function coerceIterable(iterable) {
	if (typeof iterable === "function") iterable = iterable();
	if (Symbol.iterator in iterable) return iterable[Symbol.iterator]();
	if (Symbol.asyncIterator in iterable) return iterable[Symbol.asyncIterator]();
	return iterable;
}
function onDispose(event, cb) {
	onDispose$1(event, cb);
}
function noContent(status = 204) {
	return new HTTPResponse(null, {
		status,
		statusText: "No Content"
	});
}
function redirect(location, status = 302, statusText) {
	const body = `<html><head><meta http-equiv="refresh" content="0; url=${escapeHtml(location)}" /></head></html>`;
	return new HTTPResponse(body, {
		status,
		statusText: statusText || (status === 301 ? "Moved Permanently" : "Found"),
		headers: {
			"content-type": "text/html; charset=utf-8",
			location
		}
	});
}
function redirectBack(event, opts = {}) {
	const referer = event.req.headers.get("referer");
	let location = opts.fallback ?? "/";
	if (referer && URL.canParse(referer)) {
		const refererURL = new URL(referer);
		if (refererURL.origin === event.url.origin) {
			let pathname = refererURL.pathname;
			if (pathname.startsWith("//")) pathname = "/" + pathname.replace(/^\/+/, "");
			location = pathname + (opts.allowQuery ? refererURL.search : "");
		}
	}
	return redirect(location, opts.status);
}
function writeEarlyHints(event, hints) {
	const linkValues = [];
	for (const [name, value] of Object.entries(hints)) if (name.toLowerCase() === "link") {
		for (const v of Array.isArray(value) ? value : [value]) if (v) linkValues.push(v);
	}
	if (event.runtime?.node?.res?.writeEarlyHints) {
		if (linkValues.length === 0) return Promise.resolve();
		const normalizedHints = { link: linkValues };
		for (const [name, value] of Object.entries(hints)) if (name.toLowerCase() !== "link") normalizedHints[name] = value;
		return new Promise((resolve) => {
			event.runtime?.node?.res?.writeEarlyHints(normalizedHints, () => resolve());
		});
	}
	for (const v of linkValues) event.res.headers.append("link", v);
}
async function iterable(iterable, options) {
	const serializer = options?.serializer ?? serializeIterableValue;
	const iterator = coerceIterable(iterable);
	let first = await iterator.next();
	return new HTTPResponse(new ReadableStream({
		async pull(controller) {
			const { value, done } = first ?? await iterator.next();
			first = void 0;
			if (value !== void 0) {
				const chunk = serializer(value);
				if (chunk !== void 0) controller.enqueue(chunk);
			}
			if (done) controller.close();
		},
		cancel() {
			iterator.return?.();
		}
	}));
}
function html(first, ...values) {
	let body;
	if (typeof first === "string") {
		body = escapeHtml(first);
		if (body !== first && html._isWarned !== true) {
			html._isWarned = true;
			console.warn("[h3] `html()` received a plain string containing HTML characters and escaped it. Use the html`` tagged template for dynamic values, or wrap trusted markup with `raw()`.");
		}
	} else if (isRawHTML(first)) body = first.value;
	else body = first.reduce((out, str, i) => {
		const value = values[i];
		const rendered = value == null ? "" : isRawHTML(value) ? value.value : escapeHtml(String(value));
		return out + str + rendered;
	}, "");
	return new HTTPResponse(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}
function raw(value) {
	return {
		[kRawHTML]: true,
		value
	};
}
const kRawHTML = /* @__PURE__ */ Symbol("h3.rawHTML");
function isRawHTML(value) {
	return typeof value === "object" && value !== null && value[kRawHTML] === true;
}
const HTML_ESCAPES = {
	"&": "&amp;",
	"\"": "&quot;",
	"'": "&#39;",
	"<": "&lt;",
	">": "&gt;"
};
function escapeHtml(str) {
	return str.replace(/[&"'<>]/g, (c) => HTML_ESCAPES[c]);
}
function resolveCorsOptions(options = {}) {
	const defaultOptions = {
		origin: "*",
		methods: "*",
		allowHeaders: "*",
		exposeHeaders: "*",
		credentials: false,
		maxAge: false,
		preflight: { statusCode: 204 }
	};
	const resolved = {
		...defaultOptions,
		...options,
		preflight: {
			...defaultOptions.preflight,
			...options.preflight
		}
	};
	if (resolved.credentials && resolved.origin === "*") warnOnce("[h3] CORS: `credentials: true` with wildcard origin is not allowed. Browsers will reject the response.");
	if (resolved.credentials && (resolved.origin === "null" || Array.isArray(resolved.origin) && resolved.origin.includes("null"))) warnOnce("[h3] CORS: `credentials: true` with a `\"null\"` origin is dangerous. Any sandboxed iframe, `data:`/`file:` document, or opaque origin sends `Origin: null`, so credentials would be shared across untrusted contexts.");
	if (resolved.credentials && resolved.exposeHeaders === "*") warnOnce("[h3] CORS: `credentials: true` with wildcard `exposeHeaders` has no effect. Browsers treat `*` literally on credentialed requests — list the headers explicitly.");
	return resolved;
}
function isCorsOriginAllowed(origin, options) {
	const { origin: originOption } = options;
	if (!origin) return false;
	if (!originOption || originOption === "*") return true;
	if (typeof originOption === "function") return originOption(origin);
	if (Array.isArray(originOption)) return originOption.some((_origin) => {
		if (_origin instanceof RegExp) return _origin.test(origin);
		return origin === _origin;
	});
	return originOption === origin;
}
function createOriginHeaders(event, options) {
	const { origin: originOption } = options;
	const origin = event.req.headers.get("origin");
	if (!originOption || originOption === "*") return { "access-control-allow-origin": "*" };
	if (isCorsOriginAllowed(origin, options)) return {
		"access-control-allow-origin": origin,
		vary: "origin"
	};
	return { vary: "origin" };
}
function createMethodsHeaders(event, options) {
	const { methods, credentials } = options;
	if (!methods) return {};
	if (methods === "*") {
		if (credentials) {
			const requestMethod = event.req.headers.get("access-control-request-method");
			return requestMethod ? {
				"access-control-allow-methods": requestMethod,
				vary: "access-control-request-method"
			} : {};
		}
		return { "access-control-allow-methods": "*" };
	}
	return methods.length > 0 ? { "access-control-allow-methods": methods.join(",") } : {};
}
function createCredentialsHeaders(options) {
	const { credentials } = options;
	if (credentials) return { "access-control-allow-credentials": "true" };
	return {};
}
function createAllowHeaderHeaders(event, options) {
	const { allowHeaders } = options;
	if (!allowHeaders || allowHeaders === "*" || allowHeaders.length === 0) {
		const header = event.req.headers.get("access-control-request-headers");
		return header ? {
			"access-control-allow-headers": header,
			vary: "access-control-request-headers"
		} : { vary: "access-control-request-headers" };
	}
	return {
		"access-control-allow-headers": allowHeaders.join(","),
		vary: "access-control-request-headers"
	};
}
function createExposeHeaders(options) {
	const { exposeHeaders, credentials } = options;
	if (!exposeHeaders) return {};
	if (exposeHeaders === "*") return credentials ? {} : { "access-control-expose-headers": exposeHeaders };
	return { "access-control-expose-headers": exposeHeaders.join(",") };
}
function createMaxAgeHeader(options) {
	const { maxAge } = options;
	if (maxAge) return { "access-control-max-age": maxAge };
	return {};
}
let warnedMessages;
function warnOnce(message) {
	warnedMessages ??= /* @__PURE__ */ new Set();
	if (warnedMessages.has(message)) return;
	warnedMessages.add(message);
	console.warn(message);
}
function isPreflightRequest(event) {
	const origin = event.req.headers.get("origin");
	const accessControlRequestMethod = event.req.headers.get("access-control-request-method");
	return event.req.method === "OPTIONS" && !!origin && !!accessControlRequestMethod;
}
function appendCorsPreflightHeaders(event, options) {
	const headerGroups = [
		createOriginHeaders(event, options),
		createCredentialsHeaders(options),
		createMethodsHeaders(event, options),
		createAllowHeaderHeaders(event, options),
		createMaxAgeHeader(options)
	];
	const headers = Object.assign({}, ...headerGroups);
	const varyValues = headerGroups.map((group) => group.vary).filter(Boolean);
	if (varyValues.length > 0) headers.vary = varyValues.join(", ");
	setCorsHeaders(event, headers);
}
function appendCorsHeaders(event, options) {
	setCorsHeaders(event, {
		...createOriginHeaders(event, options),
		...createCredentialsHeaders(options),
		...createExposeHeaders(options)
	});
}
function setCorsHeaders(event, headers) {
	for (const [key, value] of Object.entries(headers)) if (key === "vary") {
		event.res.headers.append(key, value);
		event.res.errHeaders.append(key, value);
	} else {
		event.res.headers.set(key, value);
		event.res.errHeaders.set(key, value);
	}
}
function handleCors(event, options) {
	const _options = resolveCorsOptions(options);
	if (isPreflightRequest(event)) {
		appendCorsPreflightHeaders(event, _options);
		return noContent(_options.preflight.statusCode);
	}
	appendCorsHeaders(event, _options);
	return false;
}
export { appendCorsHeaders, appendCorsPreflightHeaders, base64Decode, base64Encode, handleCors, html, isCorsOriginAllowed, isPreflightRequest, iterable, noContent, onDispose, raw, redirect, redirectBack, textDecoder, textEncoder, writeEarlyHints };
