import { EmptyObject, HTTPError, HTTPResponse, decodePreservingSeparators, hasProp, kHandled, normalizeRoute, onDispose, sanitizeStatusCode, sanitizeStatusMessage, toResponse, withoutBase, withoutTrailingSlash } from "./response.mjs";
import "./middleware.mjs";
import { H3, defineHandler, defineLazyEventHandler, defineValidatedHandler, getEventContext, getRequestIP, isCacheMatch, toEventHandler, validateData } from "./cache.mjs";
import { base64Decode, base64Encode, isCorsOriginAllowed, iterable, noContent, redirect, textDecoder, textEncoder } from "./cors.mjs";
import { proxy } from "./proxy.mjs";
import { isCanonicalPath } from "./path.mjs";
import { addRoute, createRouter, removeRoute } from "rou3";
import { limitRequestBody } from "srvx/body-limit";
function freezeApp(app) {
	app.config = Object.freeze(app.config);
	app["~addRoute"] = () => {
		throw new Error("Cannot add routes after the server init.");
	};
}
function definePlugin(def) {
	return ((opts) => (h3) => def(h3, opts));
}
function toWebHandler(app) {
	return (request, context) => {
		return Promise.resolve(app.request(request, void 0, context || request.context));
	};
}
function fromWebHandler(handler) {
	return function _webHandler(event) {
		return handler(event.req, event.context);
	};
}
function fromNodeHandler(handler) {
	if (typeof handler !== "function") throw new TypeError(`Invalid handler. It should be a function: ${handler}`);
	return function _nodeHandler(event) {
		const node = event.runtime?.node;
		if (!node?.res) throw new Error("[h3] Executing Node.js middleware is not supported in this server!");
		const url = event.url.pathname + event.url.search;
		if (node.req.url === url) return callNodeHandler(handler, node.req, node.res);
		const originalUrl = node.req.url;
		node.req.url = url;
		return callNodeHandler(handler, node.req, node.res).finally(() => {
			node.req.url = originalUrl;
		});
	};
}
function defineNodeHandler(handler) {
	return handler;
}
function defineNodeMiddleware(handler) {
	return handler;
}
function callNodeHandler(handler, req, res) {
	const isMiddleware = handler.length > 2;
	return new Promise((resolve, reject) => {
		res.once("close", () => resolve(kHandled));
		res.once("finish", () => resolve(kHandled));
		res.once("error", (error) => reject(error));
		res.once("pipe", (stream) => {
			resolve(new Promise((resolve, reject) => {
				const onResClose = () => {
					stream.destroy();
					resolve(kHandled);
				};
				const settle = (cb) => {
					res.removeListener("close", onResClose);
					cb();
				};
				stream.once("close", () => settle(() => resolve(kHandled)));
				stream.once("error", (error) => settle(() => {
					console.error("[h3] Stream error in Node.js handler", { cause: error });
					reject(kHandled);
				}));
				if (res.closed || res.destroyed) onResClose();
				else res.once("close", onResClose);
			}));
		});
		try {
			if (isMiddleware) Promise.resolve(handler(req, res, (error) => error ? reject(new HTTPError({
				cause: error,
				unhandled: true
			})) : resolve(void 0))).catch((error) => reject(new HTTPError({
				cause: error,
				unhandled: true
			})));
			else return Promise.resolve(handler(req, res)).then(() => resolve(kHandled)).catch((error) => reject(new HTTPError({
				cause: error,
				unhandled: true
			})));
		} catch (error) {
			reject(new HTTPError({
				cause: error,
				unhandled: true
			}));
		}
	});
}
function defineRoute(def) {
	const handler = defineValidatedHandler(def);
	return (h3) => {
		h3.on(def.method, def.route, handler);
	};
}
function removeRoute$1(app, method, route) {
	const _method = method ? method.toUpperCase() : "";
	route = normalizeRoute(route);
	const routes = app["~routes"];
	const kept = routes.filter((r) => !(r.route === route && (r.method || "") === _method));
	if (kept.length === routes.length) {
		removeRoute(app["~rou3"], _method, route);
		return;
	}
	app["~routes"] = kept;
	const rou3 = app["~rou3"];
	if (rou3) {
		const rebuilt = createRouter();
		for (const r of kept) addRoute(rebuilt, r.method || "", r.route, r);
		rou3.root = rebuilt.root;
		rou3.static = rebuilt.static;
	}
}
function appendAcceptQuery(event, mediaTypes) {
	const list = Array.isArray(mediaTypes) ? mediaTypes : [mediaTypes];
	if (list.length === 0) return;
	const value = list.map(serializeMediaType).join(", ");
	event.res.headers.append("accept-query", value);
}
function requireContentType(event, acceptedTypes) {
	const header = event.req.headers.get("content-type");
	if (!header) throw new HTTPError({
		status: 400,
		statusText: "Bad Request",
		message: "Content-Type header is required"
	});
	const mediaType = header.split(";")[0].trim().toLowerCase();
	const slash = mediaType.indexOf("/");
	if (slash <= 0 || slash === mediaType.length - 1) throw new HTTPError({
		status: 422,
		statusText: "Unprocessable Content",
		message: "Malformed Content-Type header"
	});
	const accepted = Array.isArray(acceptedTypes) ? acceptedTypes : [acceptedTypes];
	if (accepted.some((type) => mediaTypeMatches(mediaType, type.split(";")[0].trim().toLowerCase()))) return mediaType;
	throw new HTTPError({
		status: 415,
		statusText: "Unsupported Media Type",
		message: `Unsupported Content-Type: ${mediaType}. Expected one of: ${accepted.join(", ")}`
	});
}
const SF_TOKEN_RE = /^[A-Za-z*][\w!#$%&'*+.^`|~:/-]*$/;
const SF_KEY_RE = /^[a-z*][a-z0-9_.*-]*$/;
function serializeMediaType(mediaType) {
	const parts = splitOutsideQuotes(mediaType, ";");
	const base = parts[0].trim();
	if (!SF_TOKEN_RE.test(base)) throw new TypeError(`Invalid media type: ${JSON.stringify(mediaType)}`);
	let result = base;
	for (let i = 1; i < parts.length; i++) {
		const param = parts[i].trim();
		if (!param) continue;
		const eq = param.indexOf("=");
		const key = (eq === -1 ? param : param.slice(0, eq)).trim().toLowerCase();
		if (!SF_KEY_RE.test(key)) throw new TypeError(`Invalid media type parameter: ${JSON.stringify(param)}`);
		result += eq === -1 ? `;${key}` : `;${key}="${escapeQuotes(unquote(param.slice(eq + 1).trim()))}"`;
	}
	return result;
}
function mediaTypeMatches(mediaType, accepted) {
	if (accepted === "*/*" || accepted === "*") return true;
	if (accepted === mediaType) return true;
	if (accepted.endsWith("/*")) return mediaType.startsWith(accepted.slice(0, -1));
	return false;
}
function splitOutsideQuotes(input, sep) {
	const parts = [];
	let current = "";
	let inQuotes = false;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (inQuotes) {
			current += ch;
			if (ch === "\\" && i + 1 < input.length) current += input[++i];
			else if (ch === "\"") inQuotes = false;
		} else if (ch === "\"") {
			inQuotes = true;
			current += ch;
		} else if (ch === sep) {
			parts.push(current);
			current = "";
		} else current += ch;
	}
	parts.push(current);
	return parts;
}
function escapeQuotes(value) {
	return value.replace(/[\\"]/g, "\\$&");
}
function unquote(value) {
	if (value.length >= 2 && value[0] === "\"" && value.endsWith("\"")) return value.slice(1, -1).replace(/\\(.)/g, "$1");
	return value;
}
function parseURLEncodedBody(body) {
	return collectEntries(new URLSearchParams(body).entries());
}
function parseFormData(form) {
	return collectEntries(form.entries());
}
function collectEntries(entries) {
	const parsed = new EmptyObject();
	for (const [key, value] of entries) if (hasProp(parsed, key)) {
		if (!Array.isArray(parsed[key])) parsed[key] = [parsed[key]];
		parsed[key].push(value);
	} else parsed[key] = value;
	return parsed;
}
async function readBody(event, options) {
	const contentType = event.req.headers.get("content-type") || "";
	const type = options?.type;
	if (type === "formData") {
		let form;
		try {
			form = await event.req.formData();
		} catch (error) {
			if (HTTPError.isError(error)) throw error;
			throw new HTTPError({
				status: 400,
				statusText: "Bad Request",
				message: "Invalid form data body"
			});
		}
		return parseFormData(form);
	}
	const text = await event.req.text();
	if (type === "text") return text;
	if (!text) return;
	if (type === "urlencoded" || !type && contentType.startsWith("application/x-www-form-urlencoded")) return parseURLEncodedBody(text);
	try {
		return JSON.parse(text);
	} catch {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: "Invalid JSON body"
		});
	}
}
async function readValidatedBody(event, validate, options) {
	const _body = await readBody(event, options);
	return validateData(_body, validate, options);
}
function assertBodySize(event, limit) {
	const req = event.req;
	if (!req.body) return;
	const contentLength = req.headers.get("content-length");
	if (contentLength) {
		if (req.headers.get("transfer-encoding")) throw new HTTPError({ status: 400 });
		if (+contentLength > limit) throw bodyTooLargeError(limit);
	}
	event.req = limitRequestBody(req, limit, { createError: () => bodyTooLargeError(limit) });
}
function bodyTooLargeError(limit) {
	return new HTTPError({
		status: 413,
		statusText: "Request Entity Too Large",
		message: `Request body size exceeds the limit of ${limit} bytes`
	});
}
function onRequest(hook) {
	return async function _onRequestMiddleware(event) {
		await hook(event);
	};
}
function onResponse(hook) {
	return async function _onResponseMiddleware(event, next) {
		const rawBody = await next();
		const response = await toResponse(rawBody, event);
		return await hook(response, event) || response;
	};
}
function onError(hook) {
	return async (event, next) => {
		try {
			return await next();
		} catch (rawError) {
			const isHTTPError = HTTPError.isError(rawError);
			const error = isHTTPError ? rawError : new HTTPError(rawError);
			if (!isHTTPError) {
				error.unhandled = true;
				if (rawError?.stack) error.stack = rawError.stack;
			}
			const hookResponse = await hook(error, event);
			if (hookResponse !== void 0) return hookResponse;
			throw error;
		}
	};
}
function bodyLimit(limit) {
	return (event, next) => {
		assertBodySize(event, limit);
		return next();
	};
}
const COOKIE_MAX_AGE_LIMIT = 3456e4;
function endIndex(str, min, len) {
	const index = str.indexOf(";", min);
	return index === -1 ? len : index;
}
function eqIndex(str, min, max) {
	const index = str.indexOf("=", min);
	return index < max ? index : -1;
}
function valueSlice(str, min, max) {
	if (min === max) return "";
	let start = min;
	let end = max;
	do {
		const code = str.charCodeAt(start);
		if (code !== 32 && code !== 9) break;
	} while (++start < end);
	while (end > start) {
		const code = str.charCodeAt(end - 1);
		if (code !== 32 && code !== 9) break;
		end--;
	}
	return str.slice(start, end);
}
const NullObject = /* @__PURE__ */ (() => {
	const C = function() {};
	C.prototype = Object.create(null);
	return C;
})();
function parse(str, options) {
	const obj = new NullObject();
	const len = str.length;
	if (len < 2) return obj;
	const dec = options?.decode || decode;
	const allowMultiple = options?.allowMultiple || false;
	let index = 0;
	do {
		const eqIdx = eqIndex(str, index, len);
		if (eqIdx === -1) break;
		const endIdx = endIndex(str, index, len);
		if (eqIdx > endIdx) {
			index = str.lastIndexOf(";", eqIdx - 1) + 1;
			continue;
		}
		const key = valueSlice(str, index, eqIdx);
		if (options?.filter && !options.filter(key)) {
			index = endIdx + 1;
			continue;
		}
		const val = dec(valueSlice(str, eqIdx + 1, endIdx));
		if (allowMultiple) {
			const existing = obj[key];
			if (existing === void 0) obj[key] = val;
			else if (Array.isArray(existing)) existing.push(val);
			else obj[key] = [existing, val];
		} else if (obj[key] === void 0) obj[key] = val;
		index = endIdx + 1;
	} while (index < len);
	return obj;
}
function decode(str) {
	if (!str.includes("%")) return str;
	try {
		return decodeURIComponent(str);
	} catch {
		return str;
	}
}
const cookieNameRegExp = /^[\u0021-\u003A\u003C\u003E-\u007E]+$/;
const cookieValueRegExp = /^[\u0021-\u003A\u003C-\u007E]*$/;
const domainValueRegExp = /^([.]?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const pathValueRegExp = /^[\u0020-\u003A\u003C-\u007E]*$/;
const __toString = Object.prototype.toString;
function serialize(_a0, _a1, _a2) {
	const isObj = typeof _a0 === "object" && _a0 !== null;
	const options = isObj ? _a1 : _a2;
	const stringify = options?.stringify || JSON.stringify;
	const cookie = isObj ? _a0 : {
		..._a2,
		name: _a0,
		value: _a1 == void 0 ? "" : typeof _a1 === "string" ? _a1 : stringify(_a1)
	};
	const enc = options?.encode || encodeURIComponent;
	if (!cookieNameRegExp.test(cookie.name)) throw new TypeError(`argument name is invalid: ${cookie.name}`);
	const value = cookie.value ? enc(cookie.value) : "";
	if (!cookieValueRegExp.test(value)) throw new TypeError(`argument val is invalid: ${cookie.value}`);
	if (!cookie.secure) {
		if (cookie.partitioned) throw new TypeError(`Partitioned cookies must have the Secure attribute`);
		if (cookie.sameSite && String(cookie.sameSite).toLowerCase() === "none") throw new TypeError(`SameSite=None cookies must have the Secure attribute`);
		if (cookie.name.length > 9 && cookie.name.charCodeAt(0) === 95 && cookie.name.charCodeAt(1) === 95) {
			const nameLower = cookie.name.toLowerCase();
			if (nameLower.startsWith("__secure-") || nameLower.startsWith("__host-")) throw new TypeError(`${cookie.name} cookies must have the Secure attribute`);
		}
	}
	if (cookie.name.length > 7 && cookie.name.charCodeAt(0) === 95 && cookie.name.charCodeAt(1) === 95 && cookie.name.toLowerCase().startsWith("__host-")) {
		if (cookie.path !== "/") throw new TypeError(`__Host- cookies must have Path=/`);
		if (cookie.domain) throw new TypeError(`__Host- cookies must not have a Domain attribute`);
	}
	let str = cookie.name + "=" + value;
	if (cookie.maxAge !== void 0) {
		if (!Number.isInteger(cookie.maxAge)) throw new TypeError(`option maxAge is invalid: ${cookie.maxAge}`);
		str += "; Max-Age=" + Math.max(0, Math.min(cookie.maxAge, COOKIE_MAX_AGE_LIMIT));
	}
	if (cookie.domain) {
		if (!domainValueRegExp.test(cookie.domain)) throw new TypeError(`option domain is invalid: ${cookie.domain}`);
		str += "; Domain=" + cookie.domain;
	}
	if (cookie.path) {
		if (!pathValueRegExp.test(cookie.path)) throw new TypeError(`option path is invalid: ${cookie.path}`);
		str += "; Path=" + cookie.path;
	}
	if (cookie.expires) {
		if (!isDate(cookie.expires) || !Number.isFinite(cookie.expires.valueOf())) throw new TypeError(`option expires is invalid: ${cookie.expires}`);
		str += "; Expires=" + cookie.expires.toUTCString();
	}
	if (cookie.httpOnly) str += "; HttpOnly";
	if (cookie.secure) str += "; Secure";
	if (cookie.partitioned) str += "; Partitioned";
	if (cookie.priority) switch (typeof cookie.priority === "string" ? cookie.priority.toLowerCase() : void 0) {
		case "low":
			str += "; Priority=Low";
			break;
		case "medium":
			str += "; Priority=Medium";
			break;
		case "high":
			str += "; Priority=High";
			break;
		default: throw new TypeError(`option priority is invalid: ${cookie.priority}`);
	}
	if (cookie.sameSite) switch (typeof cookie.sameSite === "string" ? cookie.sameSite.toLowerCase() : cookie.sameSite) {
		case true:
		case "strict":
			str += "; SameSite=Strict";
			break;
		case "lax":
			str += "; SameSite=Lax";
			break;
		case "none":
			str += "; SameSite=None";
			break;
		default: throw new TypeError(`option sameSite is invalid: ${cookie.sameSite}`);
	}
	return str;
}
function isDate(val) {
	return __toString.call(val) === "[object Date]";
}
const maxAgeRegExp = /^-?\d+$/;
const _nullProto = /* @__PURE__ */ Object.getPrototypeOf({});
function parseSetCookie(str, options) {
	const len = str.length;
	let _endIdx = len;
	let eqIdx = -1;
	for (let i = 0; i < len; i++) {
		const c = str.charCodeAt(i);
		if (c === 59) {
			_endIdx = i;
			break;
		}
		if (c === 61 && eqIdx === -1) eqIdx = i;
	}
	if (eqIdx >= _endIdx) eqIdx = -1;
	const name = eqIdx === -1 ? "" : _trim(str, 0, eqIdx);
	if (name && name in _nullProto) return void 0;
	let value = eqIdx === -1 ? _trim(str, 0, _endIdx) : _trim(str, eqIdx + 1, _endIdx);
	if (!name && !value) return void 0;
	if (name.length + value.length > 4096) return void 0;
	if (options?.decode !== false) value = _decode(value, options?.decode);
	const setCookie = {
		name,
		value
	};
	let index = _endIdx + 1;
	while (index < len) {
		let endIdx = len;
		let attrEqIdx = -1;
		for (let i = index; i < len; i++) {
			const c = str.charCodeAt(i);
			if (c === 59) {
				endIdx = i;
				break;
			}
			if (c === 61 && attrEqIdx === -1) attrEqIdx = i;
		}
		if (attrEqIdx >= endIdx) attrEqIdx = -1;
		const attr = attrEqIdx === -1 ? _trim(str, index, endIdx) : _trim(str, index, attrEqIdx);
		const val = attrEqIdx === -1 ? void 0 : _trim(str, attrEqIdx + 1, endIdx);
		if (val === void 0 || val.length <= 1024) switch (attr.toLowerCase()) {
			case "httponly":
				setCookie.httpOnly = true;
				break;
			case "secure":
				setCookie.secure = true;
				break;
			case "partitioned":
				setCookie.partitioned = true;
				break;
			case "domain":
				if (val) setCookie.domain = (val.charCodeAt(0) === 46 ? val.slice(1) : val).toLowerCase();
				break;
			case "path":
				setCookie.path = val;
				break;
			case "max-age":
				if (val && maxAgeRegExp.test(val)) setCookie.maxAge = Math.min(Number(val), COOKIE_MAX_AGE_LIMIT);
				break;
			case "expires": {
				if (!val) break;
				const date = new Date(val);
				if (Number.isFinite(date.valueOf())) {
					const maxDate = new Date(Date.now() + COOKIE_MAX_AGE_LIMIT * 1e3);
					setCookie.expires = date > maxDate ? maxDate : date;
				}
				break;
			}
			case "priority": {
				if (!val) break;
				const priority = val.toLowerCase();
				if (priority === "low" || priority === "medium" || priority === "high") setCookie.priority = priority;
				break;
			}
			case "samesite": {
				if (!val) break;
				const sameSite = val.toLowerCase();
				if (sameSite === "lax" || sameSite === "strict" || sameSite === "none") setCookie.sameSite = sameSite;
				else setCookie.sameSite = "lax";
				break;
			}
			default: {
				const attrLower = attr.toLowerCase();
				if (attrLower && !(attrLower in _nullProto)) setCookie[attrLower] = val;
			}
		}
		index = endIdx + 1;
	}
	return setCookie;
}
function _trim(str, start, end) {
	if (start === end) return "";
	let s = start;
	let e = end;
	while (s < e && (str.charCodeAt(s) === 32 || str.charCodeAt(s) === 9)) s++;
	while (e > s && (str.charCodeAt(e - 1) === 32 || str.charCodeAt(e - 1) === 9)) e--;
	return str.slice(s, e);
}
function _decode(value, decode) {
	if (!decode && !value.includes("%")) return value;
	try {
		return (decode || decodeURIComponent)(value);
	} catch {
		return value;
	}
}
const CHUNKED_COOKIE = "__chunked__";
const CHUNKS_MAX_LENGTH = 4e3;
function parseCookies(event) {
	return parse(event.req.headers.get("cookie") || "");
}
function getValidatedCookies(event, validate, options) {
	const cookies = parseCookies(event);
	return validateData(cookies, validate, options);
}
function getCookie(event, name) {
	return parseCookies(event)[name];
}
function setCookie(event, name, value, options) {
	const { encode, stringify, ...attrs } = options ?? {};
	const newCookie = serialize({
		name,
		value,
		path: "/",
		...attrs
	}, {
		encode,
		stringify
	});
	const currentCookies = event.res.headers.getSetCookie();
	if (currentCookies.length === 0) {
		event.res.headers.set("set-cookie", newCookie);
		return;
	}
	const namePrefix = `${name}=`;
	if (!currentCookies.some((cookie) => cookie.startsWith(namePrefix))) {
		event.res.headers.append("set-cookie", newCookie);
		return;
	}
	const newCookieKey = _getDistinctCookieKey(name, options || {});
	event.res.headers.delete("set-cookie");
	for (const cookie of currentCookies) {
		const parsed = parseSetCookie(cookie);
		if (parsed ? _getDistinctCookieKey(cookie.split("=")?.[0], parsed) === newCookieKey : cookie.startsWith(namePrefix)) continue;
		event.res.headers.append("set-cookie", cookie);
	}
	event.res.headers.append("set-cookie", newCookie);
}
function deleteCookie(event, name, serializeOptions) {
	setCookie(event, name, "", {
		...serializeOptions,
		maxAge: 0
	});
}
function getChunkedCookie(event, name) {
	const cookies = parseCookies(event);
	const mainCookie = cookies[name];
	if (!mainCookie || !mainCookie.startsWith(CHUNKED_COOKIE)) return mainCookie;
	const chunksCount = getChunkedCookieCount(mainCookie);
	if (chunksCount === 0) return;
	const chunks = [];
	for (let i = 1; i <= chunksCount; i++) {
		const chunk = cookies[chunkCookieName(name, i)];
		if (!chunk) return;
		chunks.push(chunk);
	}
	return chunks.join("");
}
function setChunkedCookie(event, name, value, options) {
	const chunkMaxLength = options?.chunkMaxLength || CHUNKS_MAX_LENGTH;
	const chunkCount = Math.ceil(value.length / chunkMaxLength);
	if (chunkCount > MAX_CHUNKED_COOKIE_COUNT) throw new HTTPError({
		status: 500,
		message: `Cannot set chunked cookie "${name}": value needs ${chunkCount} chunks, exceeding the maximum of ${MAX_CHUNKED_COOKIE_COUNT}.`
	});
	const previousCookie = getCookie(event, name);
	if (previousCookie?.startsWith(CHUNKED_COOKIE)) {
		const previousChunkCount = getChunkedCookieCount(previousCookie);
		const newChunkCount = chunkCount <= 1 ? 0 : chunkCount;
		for (let i = newChunkCount + 1; i <= previousChunkCount; i++) deleteCookie(event, chunkCookieName(name, i), options);
	}
	if (chunkCount <= 1) {
		setCookie(event, name, value, options);
		return;
	}
	setCookie(event, name, `${CHUNKED_COOKIE}${chunkCount}`, options);
	for (let i = 1; i <= chunkCount; i++) {
		const start = (i - 1) * chunkMaxLength;
		const end = start + chunkMaxLength;
		const chunkValue = value.slice(start, end);
		setCookie(event, chunkCookieName(name, i), chunkValue, options);
	}
}
function deleteChunkedCookie(event, name, serializeOptions) {
	const mainCookie = getCookie(event, name);
	deleteCookie(event, name, serializeOptions);
	const chunksCount = getChunkedCookieCount(mainCookie);
	if (chunksCount >= 0) for (let i = 0; i < chunksCount; i++) deleteCookie(event, chunkCookieName(name, i + 1), serializeOptions);
}
function _getDistinctCookieKey(name, options) {
	return [
		name,
		(options.domain || "").replace(/^\./, "").toLowerCase(),
		options.path || "/"
	].join(";");
}
const MAX_CHUNKED_COOKIE_COUNT = 100;
function getChunkedCookieCount(cookie) {
	if (!cookie?.startsWith(CHUNKED_COOKIE)) return NaN;
	const count = Number.parseInt(cookie.slice(11));
	if (Number.isNaN(count) || count < 0 || count > MAX_CHUNKED_COOKIE_COUNT) return NaN;
	return count;
}
function chunkCookieName(name, chunkNumber) {
	return `${name}.${chunkNumber}`;
}
function formatEventStreamComment(comment) {
	return comment.split(/\r\n|\r|\n/).map((l) => `: ${l}\n`).join("") + "\n";
}
function formatEventStreamMessage(message) {
	let result = "";
	if (message.id) result += `id: ${_sanitizeSingleLine(message.id)}\n`;
	if (message.event) result += `event: ${_sanitizeSingleLine(message.event)}\n`;
	if (typeof message.retry === "number" && Number.isInteger(message.retry)) result += `retry: ${message.retry}\n`;
	const data = typeof message.data === "string" ? message.data : "";
	for (const line of data.split(/\r\n|\r|\n/)) result += `data: ${line}\n`;
	result += "\n";
	return result;
}
function _sanitizeSingleLine(value) {
	return value.replace(/[\n\r]/g, "");
}
function formatEventStreamMessages(messages) {
	let result = "";
	for (const msg of messages) result += formatEventStreamMessage(msg);
	return result;
}
function eventStreamHeaders(event) {
	const headers = {
		"content-type": "text/event-stream",
		"cache-control": "private, no-cache, no-store, no-transform, must-revalidate, max-age=0",
		"x-accel-buffering": "no"
	};
	if (event.req.headers.get("connection") === "keep-alive") headers["connection"] = "keep-alive";
	return headers;
}
function setEventStreamHeaders(event) {
	for (const [name, value] of Object.entries(eventStreamHeaders(event))) event.res.headers.set(name, value);
}
const _noop = () => {};
var EventStream = class extends HTTPResponse {
	_event;
	_transformStream;
	_writer;
	_encoder = new TextEncoder();
	_closeCallbacks = [];
	_writerIsClosed = false;
	_paused = false;
	_unsentData;
	_disposed = false;
	get _isClosed() {
		return this._writerIsClosed || this._disposed;
	}
	constructor(event, _opts = {}) {
		const transformStream = new TransformStream();
		super(transformStream.readable, {
			status: 200,
			headers: eventStreamHeaders(event)
		});
		this._event = event;
		this._transformStream = transformStream;
		this._writer = transformStream.writable.getWriter();
		this._writer.closed.catch(_noop).finally(() => {
			this._writerIsClosed = true;
			this._disposed = true;
			for (const cb of this._closeCallbacks.splice(0)) _invokeCloseCallback(cb);
		});
		onDispose(this._event, () => this.close());
	}
	async push(message) {
		if (typeof message === "string") {
			await this._sendEvent({ data: message });
			return;
		}
		if (Array.isArray(message)) {
			if (message.length === 0) return;
			if (typeof message[0] === "string") {
				const msgs = [];
				for (const item of message) msgs.push({ data: item });
				await this._sendEvents(msgs);
				return;
			}
			await this._sendEvents(message);
			return;
		}
		await this._sendEvent(message);
	}
	async pushComment(comment) {
		if (this._isClosed) return;
		if (this._paused && !this._unsentData) {
			this._unsentData = formatEventStreamComment(comment);
			return;
		}
		if (this._paused) {
			this._unsentData += formatEventStreamComment(comment);
			return;
		}
		await this._writer.write(this._encoder.encode(formatEventStreamComment(comment))).catch(() => {
			this._writerIsClosed = true;
		});
	}
	async _sendEvent(message) {
		if (this._isClosed) return;
		if (this._paused && !this._unsentData) {
			this._unsentData = formatEventStreamMessage(message);
			return;
		}
		if (this._paused) {
			this._unsentData += formatEventStreamMessage(message);
			return;
		}
		await this._writer.write(this._encoder.encode(formatEventStreamMessage(message))).catch(() => {
			this._writerIsClosed = true;
		});
	}
	async _sendEvents(messages) {
		if (this._isClosed) return;
		const payload = formatEventStreamMessages(messages);
		if (this._paused && !this._unsentData) {
			this._unsentData = payload;
			return;
		}
		if (this._paused) {
			this._unsentData += payload;
			return;
		}
		await this._writer.write(this._encoder.encode(payload)).catch(() => {
			this._writerIsClosed = true;
		});
	}
	pause() {
		this._paused = true;
	}
	get isPaused() {
		return this._paused;
	}
	async resume() {
		this._paused = false;
		await this.flush();
	}
	async flush() {
		if (this._isClosed) return;
		if (this._unsentData?.length) {
			await this._writer.write(this._encoder.encode(this._unsentData)).catch(() => {
				this._writerIsClosed = true;
			});
			this._unsentData = void 0;
		}
	}
	async close() {
		if (this._disposed) return;
		if (!this._isClosed) {
			this._paused = false;
			await this.flush();
			try {
				await this._writer.close();
			} catch {}
		}
		this._disposed = true;
	}
	onClosed(cb) {
		if (this._writerIsClosed) {
			queueMicrotask(() => _invokeCloseCallback(cb));
			return;
		}
		this._closeCallbacks.push(cb);
	}
	async send() {
		setEventStreamHeaders(this._event);
		this._event.res.status = 200;
		return this._transformStream.readable;
	}
};
function _invokeCloseCallback(cb) {
	try {
		const res = cb();
		if (res instanceof Promise) res.catch(_noop);
	} catch {}
}
function setServerTiming(event, name, opts) {
	if (!_isValidToken(name)) throw new TypeError(`Invalid Server-Timing metric name: ${name}`);
	if (opts?.dur !== void 0 && (!Number.isFinite(opts.dur) || opts.dur < 0)) throw new TypeError(`Invalid Server-Timing duration: ${opts.dur}`);
	const value = name + (opts?.desc ? `;desc="${_escapeDesc(opts.desc)}"` : "") + (opts?.dur !== void 0 ? `;dur=${opts.dur}` : "");
	event.res.headers.append("server-timing", value);
	const ctx = event.context;
	if (!Array.isArray(ctx.timing)) ctx.timing = [];
	ctx.timing.push({
		name,
		...opts
	});
}
async function withServerTiming(event, name, fn) {
	const start = performance.now();
	try {
		return await fn();
	} finally {
		setServerTiming(event, name, { dur: performance.now() - start });
	}
}
const _tokenRE = /^[\w!#$%&'*+.^`|~-]+$/;
function _isValidToken(value) {
	return _tokenRE.test(value);
}
function _escapeDesc(value) {
	return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
const COMMON_MIME_TYPES = {
	".html": "text/html",
	".htm": "text/html",
	".css": "text/css",
	".js": "text/javascript",
	".json": "application/json",
	".txt": "text/plain",
	".xml": "application/xml",
	".gif": "image/gif",
	".ico": "image/vnd.microsoft.icon",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".zip": "application/zip",
	".pdf": "application/pdf"
};
function getExtension(path) {
	const filename = path.split("/").pop();
	if (!filename) return;
	const separatorIndex = filename.lastIndexOf(".");
	if (separatorIndex !== -1) return filename.slice(separatorIndex);
}
function getType(ext) {
	return ext ? COMMON_MIME_TYPES[ext] : void 0;
}
async function serveStatic(event, options) {
	if (options.headers) {
		const entries = Array.isArray(options.headers) ? options.headers : typeof options.headers.entries === "function" ? options.headers.entries() : Object.entries(options.headers);
		for (const [key, value] of entries) event.res.headers.set(key, value);
	}
	if (event.req.method !== "GET" && event.req.method !== "HEAD") {
		if (options.fallthrough) return;
		event.res.headers.set("allow", "GET, HEAD");
		throw new HTTPError({ status: 405 });
	}
	if (!isCanonicalPath(event.url.pathname)) {
		if (options.fallthrough) return;
		throw new HTTPError({ status: 404 });
	}
	const resolvedId = withoutTrailingSlash(event.url.pathname);
	let originalId = resolvedId;
	if (resolvedId.includes("%")) try {
		const decodedId = decodePreservingSeparators(resolvedId, {
			decode: decodeURI,
			nested: false
		});
		if (isCanonicalPath(decodedId)) originalId = withoutTrailingSlash(decodedId);
	} catch {}
	const acceptEncodings = parseAcceptEncoding(event.req.headers.get("accept-encoding") || "", options.encodings);
	if (acceptEncodings.length > 1) event.res.headers.set("vary", "accept-encoding");
	let id = originalId;
	let meta;
	const _ids = idSearchPaths(originalId, acceptEncodings, options.indexNames || ["/index.html"]);
	for (const _id of _ids) {
		const _meta = await options.getMeta(_id);
		if (_meta) {
			meta = _meta;
			id = _id;
			break;
		}
	}
	if (!meta) {
		if (options.fallthrough) return;
		throw new HTTPError({ statusCode: 404 });
	}
	let mtimeDate;
	if (meta.mtime) {
		mtimeDate = new Date(meta.mtime);
		mtimeDate.setMilliseconds(0);
		if (!event.res.headers.get("last-modified")) event.res.headers.set("last-modified", mtimeDate.toUTCString());
	}
	if (meta.etag && !event.res.headers.has("etag")) event.res.headers.set("etag", meta.etag);
	if (isCacheMatch(event.req.headers, {
		etag: meta.etag,
		lastModified: mtimeDate
	})) return new HTTPResponse(null, {
		status: 304,
		statusText: "Not Modified"
	});
	if (!event.res.headers.get("content-type")) {
		if (meta.type) event.res.headers.set("content-type", meta.type);
		else {
			const ext = getExtension(id);
			const type = ext ? options.getType?.(ext) ?? getType(ext) : void 0;
			if (type) event.res.headers.set("content-type", type);
		}
	}
	if (meta.encoding && !event.res.headers.get("content-encoding")) event.res.headers.set("content-encoding", meta.encoding);
	if (meta.size !== void 0 && meta.size > 0 && !event.res.headers.get("content-length")) event.res.headers.set("content-length", meta.size + "");
	if (event.req.method === "HEAD") return new HTTPResponse(null, { status: 200 });
	const contents = await options.getContents(id);
	return new HTTPResponse(contents || null, { status: 200 });
}
function parseAcceptEncoding(header, encodingMap) {
	if (!encodingMap || !header) return [];
	return String(header || "").split(",").map((e) => encodingMap[e.trim()]).filter(Boolean);
}
function idSearchPaths(id, encodings, indexNames) {
	const ids = [];
	for (const suffix of ["", ...indexNames]) for (const encoding of [...encodings, ""]) ids.push(`${id}${suffix}${encoding}`);
	return ids;
}
function withBase(base, input) {
	base = withoutTrailingSlash(base);
	const handler = toEventHandler(input);
	if (!handler) throw new Error("Invalid handler", { cause: input });
	return async function _handlerWithBase(event) {
		const _pathBefore = event.url.pathname || "/";
		event.url.pathname = withoutBase(event.url.pathname || "/", base);
		try {
			return await handler(event);
		} finally {
			event.url.pathname = _pathBefore;
		}
	};
}
const defaults = /* @__PURE__ */ Object.freeze({
	ttl: 0,
	timestampSkewSec: 60,
	localtimeOffsetMsec: 0,
	encryption: /* @__PURE__ */ Object.freeze({
		saltBits: 256,
		algorithm: "aes-256-cbc",
		iterations: 8192,
		minPasswordlength: 32
	}),
	integrity: /* @__PURE__ */ Object.freeze({
		saltBits: 256,
		algorithm: "sha256",
		iterations: 8192,
		minPasswordlength: 32
	})
});
const algorithms = /* @__PURE__ */ Object.freeze({
	"aes-128-ctr": /* @__PURE__ */ Object.freeze({
		keyBits: 128,
		ivBits: 128,
		name: "AES-CTR"
	}),
	"aes-256-cbc": /* @__PURE__ */ Object.freeze({
		keyBits: 256,
		ivBits: 128,
		name: "AES-CBC"
	}),
	sha256: /* @__PURE__ */ Object.freeze({
		keyBits: 256,
		ivBits: 128,
		name: "SHA-256"
	})
});
const macPrefix = "Fe26.2";
async function seal(object, password, opts) {
	const now = Date.now() + (opts.localtimeOffsetMsec || 0);
	if (!password) throw new Error("Empty password");
	const { id = "", encryption, integrity } = normalizePassword(password);
	if (id && !/^\w+$/.test(id)) throw new Error("Invalid password id");
	const { encrypted, key } = await encrypt(encryption, opts.encryption, JSON.stringify(object));
	const encryptedB64 = base64Encode(encrypted);
	const iv = base64Encode(key.iv);
	const expiration = opts.ttl ? now + opts.ttl : "";
	const macBaseString = `${macPrefix}*${id}*${key.salt}*${iv}*${encryptedB64}*${expiration}`;
	const mac = await hmacWithPassword(integrity, opts.integrity, macBaseString);
	return `${macBaseString}*${mac.salt}*${mac.digest}`;
}
async function unseal(sealed, password, opts) {
	const now = Date.now() + (opts.localtimeOffsetMsec || 0);
	if (!password) throw new Error("Empty password");
	const parts = sealed.split("*");
	if (parts.length !== 8) throw new Error("Incorrect number of sealed components");
	const [prefix, passwordId, encryptionSalt, encryptionIv, encryptedB64, expiration, hmacSalt, hmac] = parts;
	const macBaseString = `${prefix}*${passwordId}*${encryptionSalt}*${encryptionIv}*${encryptedB64}*${expiration}`;
	if ("Fe26.2" !== prefix) throw new Error("Wrong mac prefix");
	if (expiration) {
		if (!/^\d+$/.test(expiration)) throw new Error("Invalid expiration");
		if (Number.parseInt(expiration, 10) <= now - opts.timestampSkewSec * 1e3) throw new Error("Expired seal");
	}
	let pass = "";
	const _passwordId = passwordId || "default";
	if (typeof password === "string" || password instanceof Uint8Array) pass = password;
	else if (_passwordId in password) pass = password[_passwordId];
	else throw new Error(`Cannot find password: ${_passwordId}`);
	pass = normalizePassword(pass);
	if (!fixedTimeComparison((await hmacWithPassword(pass.integrity, {
		...opts.integrity,
		salt: hmacSalt
	}, macBaseString)).digest, hmac)) throw new Error("Bad hmac value");
	const encrypted = base64Decode(encryptedB64);
	const decryptOptions = {
		...opts.encryption,
		salt: encryptionSalt,
		iv: base64Decode(encryptionIv)
	};
	const decrypted = await decrypt(pass.encryption, decryptOptions, encrypted);
	return decrypted ? JSON.parse(decrypted) : null;
}
async function hmacWithPassword(password, options, data) {
	const key = await generateKey(password, {
		...options,
		hmac: true
	});
	const textBuffer = textEncoder.encode(data);
	const signed = await crypto.subtle.sign({ name: "HMAC" }, key.key, textBuffer);
	return {
		digest: base64Encode(new Uint8Array(signed)),
		salt: key.salt
	};
}
async function generateKey(password, options) {
	if (!password?.length) throw new Error("Empty password");
	if (options == null || typeof options !== "object") throw new Error("Bad options");
	if (!(options.algorithm in algorithms)) throw new Error(`Unknown algorithm: ${options.algorithm}`);
	const algorithm = algorithms[options.algorithm];
	let resultKey;
	let resultSalt;
	let resultIV;
	const hmac = options.hmac ?? false;
	const id = hmac ? {
		name: "HMAC",
		hash: algorithm.name
	} : { name: algorithm.name };
	const usage = hmac ? ["sign", "verify"] : ["encrypt", "decrypt"];
	if (typeof password === "string") {
		if (password.length < options.minPasswordlength) throw new Error(`Password string too short (min ${options.minPasswordlength} characters required)`);
		let { salt = "" } = options;
		if (!salt) {
			const { saltBits = 0 } = options;
			if (!saltBits) throw new Error("Missing salt and saltBits options");
			const randomSalt = randomBits(saltBits);
			salt = [...new Uint8Array(randomSalt)].map((x) => x.toString(16).padStart(2, "0")).join("");
		}
		const derivedKey = await pbkdf2(password, salt, options.iterations, algorithm.keyBits / 8, "SHA-1");
		resultKey = await crypto.subtle.importKey("raw", derivedKey, id, false, usage);
		resultSalt = salt;
	} else {
		if (password.length < algorithm.keyBits / 8) throw new Error("Key buffer (password) too small");
		resultKey = await crypto.subtle.importKey("raw", password, id, false, usage);
		resultSalt = "";
	}
	if (options.iv) resultIV = options.iv;
	else if ("ivBits" in algorithm) resultIV = randomBits(algorithm.ivBits);
	else throw new Error("Missing IV");
	return {
		key: resultKey,
		salt: resultSalt,
		iv: resultIV
	};
}
async function pbkdf2(password, salt, iterations, keyLength, hash) {
	const passwordBuffer = textEncoder.encode(password);
	const importedKey = await crypto.subtle.importKey("raw", passwordBuffer, { name: "PBKDF2" }, false, ["deriveBits"]);
	const params = {
		name: "PBKDF2",
		hash,
		salt: textEncoder.encode(salt),
		iterations
	};
	return await crypto.subtle.deriveBits(params, importedKey, keyLength * 8);
}
async function encrypt(password, options, data) {
	const key = await generateKey(password, options);
	const encrypted = await crypto.subtle.encrypt(...getEncryptParams(options.algorithm, key, data));
	return {
		encrypted: new Uint8Array(encrypted),
		key
	};
}
async function decrypt(password, options, data) {
	const key = await generateKey(password, options);
	const decrypted = await crypto.subtle.decrypt(...getEncryptParams(options.algorithm, key, data));
	return textDecoder.decode(decrypted);
}
function getEncryptParams(algorithm, key, data) {
	return [
		algorithm === "aes-128-ctr" ? {
			name: "AES-CTR",
			counter: key.iv,
			length: 128
		} : {
			name: "AES-CBC",
			iv: key.iv
		},
		key.key,
		typeof data === "string" ? textEncoder.encode(data) : data
	];
}
function fixedTimeComparison(a, b) {
	let mismatch = a.length === b.length ? 0 : 1;
	if (mismatch) b = a;
	for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return mismatch === 0;
}
function normalizePassword(password) {
	if (typeof password === "string" || password instanceof Uint8Array) return {
		encryption: password,
		integrity: password
	};
	if ("secret" in password) return {
		id: password.id,
		encryption: password.secret,
		integrity: password.secret
	};
	return {
		id: password.id,
		encryption: password.encryption,
		integrity: password.integrity
	};
}
function randomBits(bits) {
	if (bits < 1) throw new Error("Invalid random bits count");
	return randomBytes(Math.ceil(bits / 8));
}
function randomBytes(size) {
	const bytes = new Uint8Array(size);
	crypto.getRandomValues(bytes);
	return bytes;
}
const kGetSession = /* @__PURE__ */ Symbol.for("h3.internal.session.promise");
const kSessionNew = /* @__PURE__ */ Symbol.for("h3.internal.session.new");
const kLegacySeal = /* @__PURE__ */ Symbol.for("h3.internal.session.legacy-seal");
const DEFAULT_SESSION_COOKIE = {
	path: "/",
	secure: true,
	httpOnly: true,
	sameSite: "lax"
};
async function useSession(event, config) {
	const sessionName = config.name || "h3";
	if ((await getSession(event, config))[kSessionNew]) await updateSession(event, config);
	const sessionManager = {
		get id() {
			return getEventContext(event)?.sessions?.[sessionName]?.id;
		},
		get data() {
			return getEventContext(event).sessions?.[sessionName]?.data || {};
		},
		update: async (update) => {
			await updateSession(event, config, update);
			return sessionManager;
		},
		clear: () => {
			clearSession(event, config);
			return Promise.resolve(sessionManager);
		}
	};
	return sessionManager;
}
async function getSession(event, config) {
	const sessionName = config.name || "h3";
	const context = getEventContext(event);
	if (!context.sessions) context.sessions = new EmptyObject();
	const existingSession = context.sessions[sessionName];
	if (existingSession) return existingSession[kGetSession] || existingSession;
	const session = {
		id: "",
		createdAt: 0,
		data: new EmptyObject()
	};
	context.sessions[sessionName] = session;
	let sealedSession;
	if (config.sessionHeader !== false) {
		const headerName = typeof config.sessionHeader === "string" ? config.sessionHeader.toLowerCase() : `x-${sessionName.toLowerCase()}-session`;
		const headerValue = event.req.headers.get(headerName);
		if (typeof headerValue === "string") sealedSession = headerValue;
	}
	let sessionFromCookie = false;
	if (!sealedSession) {
		sealedSession = getChunkedCookie(event, sessionName);
		sessionFromCookie = true;
	}
	if (sealedSession) {
		const promise = unsealSession(event, config, sealedSession).catch(() => {}).then(async (unsealed) => {
			const legacySeal = unsealed && unsealed[kLegacySeal];
			if (legacySeal) delete unsealed[kLegacySeal];
			Object.assign(session, unsealed);
			delete context.sessions[sessionName][kGetSession];
			if (session.id && sessionFromCookie && (legacySeal || shouldSlide(session, config))) await updateSession(event, config);
			return session;
		});
		context.sessions[sessionName][kGetSession] = promise;
		await promise;
	}
	if (!session.id) {
		session.id = config.generateId?.() ?? (config.crypto || crypto).randomUUID();
		session.createdAt = Date.now();
		session[kSessionNew] = true;
	}
	return session;
}
async function updateSession(event, config, update) {
	const sessionName = config.name || "h3";
	const session = getEventContext(event).sessions?.[sessionName] || await getSession(event, config);
	if (typeof update === "function") update = update(session.data);
	if (update) Object.assign(session.data, update);
	delete session[kSessionNew];
	if (config.cookie !== false && event.res) {
		setChunkedCookie(event, sessionName, await sealSession(event, config), {
			...DEFAULT_SESSION_COOKIE,
			expires: sessionExpires(session, config),
			...config.cookie
		});
		stageSessionErrCookies(event, sessionName);
	}
	return session;
}
async function sealSession(event, config) {
	const sessionName = config.name || "h3";
	const session = getEventContext(event).sessions?.[sessionName] || await getSession(event, config);
	if (config.idleTimeout) session.lastSeenAt = Date.now();
	return await seal(session, config.password, {
		...defaults,
		ttl: (config.maxAge || config.idleTimeout || 0) * 1e3,
		...config.seal
	});
}
async function unsealSession(_event, config, sealed) {
	const sealOptions = {
		...defaults,
		ttl: (config.maxAge || config.idleTimeout || 0) * 1e3,
		...config.seal
	};
	let unsealed;
	try {
		unsealed = await unseal(sealed, config.password, sealOptions);
	} catch (error) {
		if (config.legacySealFallback === false || sealOptions.integrity.iterations === 1 || !(error instanceof Error) || error.message !== "Bad hmac value") throw error;
		unsealed = await unseal(sealed, config.password, {
			...sealOptions,
			encryption: {
				...sealOptions.encryption,
				iterations: 1
			},
			integrity: {
				...sealOptions.integrity,
				iterations: 1
			}
		});
		if (unsealed) unsealed[kLegacySeal] = true;
	}
	if (config.maxAge) {
		if (Date.now() - (unsealed.createdAt || Number.NEGATIVE_INFINITY) > config.maxAge * 1e3) throw new Error("Session expired!");
	}
	if (config.idleTimeout) {
		if (Date.now() - (unsealed.lastSeenAt || unsealed.createdAt || Number.NEGATIVE_INFINITY) > config.idleTimeout * 1e3) throw new Error("Session expired!");
	}
	return unsealed;
}
function clearSession(event, config) {
	const context = getEventContext(event);
	const sessionName = config.name || "h3";
	if (context.sessions?.[sessionName]) delete context.sessions[sessionName];
	if (event.res && config.cookie !== false) {
		deleteChunkedCookie(event, sessionName, {
			...DEFAULT_SESSION_COOKIE,
			...config.cookie
		});
		stageSessionErrCookies(event, sessionName);
	}
	return Promise.resolve();
}
const SLIDE_THRESHOLD = .5;
function shouldSlide(session, config) {
	if (!config.idleTimeout) return false;
	const lastSeenAt = session.lastSeenAt || session.createdAt || 0;
	return Date.now() - lastSeenAt > config.idleTimeout * 1e3 * SLIDE_THRESHOLD;
}
function stageSessionErrCookies(event, sessionName) {
	const isSessionCookie = (cookie) => cookie.startsWith(`${sessionName}=`) || cookie.startsWith(`${sessionName}.`);
	const errHeaders = event.res.errHeaders;
	const staged = [...errHeaders.getSetCookie().filter((cookie) => !isSessionCookie(cookie)), ...event.res.headers.getSetCookie().filter((cookie) => isSessionCookie(cookie))];
	errHeaders.delete("set-cookie");
	for (const cookie of staged) errHeaders.append("set-cookie", cookie);
}
function sessionExpires(session, config) {
	const times = [];
	if (config.maxAge) times.push(session.createdAt + config.maxAge * 1e3);
	if (config.idleTimeout) times.push((session.lastSeenAt || session.createdAt) + config.idleTimeout * 1e3);
	return times.length > 0 ? new Date(Math.min(...times)) : void 0;
}
const _textEncoder = /* @__PURE__ */ new TextEncoder();
function timingSafeEqual(a, b) {
	const aBuf = _textEncoder.encode(a);
	const bBuf = _textEncoder.encode(b);
	const aLen = aBuf.length;
	const bLen = bBuf.length;
	const len = Math.max(aLen, bLen);
	let result = aLen === bLen ? 0 : 1;
	for (let i = 0; i < len; i++) result |= (aBuf[i % aLen] ?? 0) ^ (bBuf[i % bLen] ?? 0);
	return result === 0;
}
function randomJitter() {
	const randomBuffer = /* @__PURE__ */ new Uint32Array(1);
	crypto.getRandomValues(randomBuffer);
	const jitter = randomBuffer[0] % 100;
	return new Promise((resolve) => setTimeout(resolve, jitter));
}
async function requireBasicAuth(event, opts) {
	if (!opts.validate && !opts.password) throw new HTTPError({
		message: "Either 'password' or 'validate' option must be provided",
		status: 500
	});
	const realm = opts?.realm ?? "auth";
	const authHeader = event.req.headers.get("authorization");
	if (!authHeader) throw await authFailed(event, realm);
	const b64auth = /^basic +(.+)$/i.exec(authHeader)?.[1];
	if (!b64auth) throw await authFailed(event, realm);
	let authDecoded;
	try {
		authDecoded = atob(b64auth);
	} catch {
		throw await authFailed(event, realm);
	}
	try {
		authDecoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(authDecoded, (c) => c.charCodeAt(0)));
	} catch {}
	const colonIndex = authDecoded.indexOf(":");
	if (colonIndex === -1) throw await authFailed(event, realm);
	const username = authDecoded.slice(0, colonIndex);
	const password = authDecoded.slice(colonIndex + 1);
	if (!opts.validate && (!username || !password)) throw await authFailed(event, realm);
	const usernameOk = !opts.username || timingSafeEqual(username, opts.username);
	const passwordOk = !opts.password || timingSafeEqual(password, opts.password);
	const validateOk = !opts.validate || await opts.validate(username, password);
	if (!usernameOk || !passwordOk || !validateOk) throw await authFailed(event, realm);
	const context = getEventContext(event);
	context.basicAuth = {
		username,
		password,
		realm
	};
	return true;
}
function basicAuth(opts) {
	return async (event, next) => {
		await requireBasicAuth(event, opts);
		return next();
	};
}
async function authFailed(event, realm) {
	await randomJitter();
	return new HTTPError({
		status: 401,
		statusText: "Authentication required",
		headers: { "www-authenticate": `Basic realm="${quoteRealm(realm)}", charset="UTF-8"` }
	});
}
function quoteRealm(realm) {
	return realm.replace(/[^\t\x20-\x7E\x80-\xFF]/g, "").replace(/["\\]/g, "\\$&");
}
async function getRequestFingerprint(event, opts = {}) {
	const fingerprint = [];
	let hasValue = false;
	const addComponent = (value) => {
		if (value) hasValue = true;
		fingerprint.push(value ? escapeComponent(value) : "");
	};
	if (opts.ip !== false) addComponent(getRequestIP(event, { xForwardedFor: opts.xForwardedFor }));
	if (opts.method === true) addComponent(event.req.method);
	if (opts.url === true) addComponent(event.req.url);
	if (opts.userAgent === true) addComponent(event.req.headers.get("user-agent"));
	if (!hasValue) return null;
	const fingerprintString = fingerprint.join("|");
	if (opts.hash === false) return fingerprintString;
	const buffer = await crypto.subtle.digest(opts.hash || "SHA-256", new TextEncoder().encode(fingerprintString));
	return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function escapeComponent(value) {
	return value.replaceAll("%", "%25").replaceAll("|", "%7C");
}
function defineWebSocket(hooks) {
	return hooks;
}
function defineWebSocketHandler(hooks, http) {
	return defineHandler(function _webSocketHandler(event) {
		if (http && !isWebSocketUpgrade(event)) return http(event);
		const crossws = typeof hooks === "function" ? hooks(event) : hooks;
		if (crossws instanceof Promise) return crossws.then((resolved) => toUpgradeResponse(event, resolved));
		return toUpgradeResponse(event, crossws);
	});
}
function isWebSocketUpgrade(event) {
	return event.req.headers.get("upgrade")?.toLowerCase() === "websocket";
}
const kWebSocketHooks = /* @__PURE__ */ Symbol.for("crossws.hooks");
function toUpgradeResponse(event, crossws) {
	try {
		const req = event.req;
		if (req.context) req.context[kWebSocketHooks] = crossws;
		req[kWebSocketHooks] = crossws;
	} catch {}
	return Object.assign(new Response("WebSocket upgrade is required.", { status: 426 }), { crossws });
}
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const DEFAULT_MAX_BATCH_SIZE = 50;
function defineJsonRpcHandler(opts = {}) {
	const methodMap = createMethodMap(opts.methods);
	const maxBatchSize = opts.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
	const handler = async (event) => {
		if (event.req.method !== "POST") throw new HTTPError({ status: 405 });
		if (opts.validateContentType !== false && !isJsonContentType(event.req.headers.get("content-type"))) throw new HTTPError({
			status: 415,
			message: "Unsupported Media Type"
		});
		assertAllowedOrigin(event, opts.allowedOrigins);
		let body;
		try {
			body = await event.req.json();
		} catch (error) {
			if (HTTPError.isError(error)) throw error;
			return createJsonRpcError(null, PARSE_ERROR, "Parse error");
		}
		const result = await processJsonRpcBody(body, methodMap, event, maxBatchSize);
		return result === void 0 ? new HTTPResponse("", { status: 202 }) : result;
	};
	return defineHandler({
		...opts,
		handler
	});
}
function isJsonContentType(value) {
	if (!value) return false;
	const mediaType = value.split(";")[0].trim().toLowerCase();
	return mediaType === "application/json" || mediaType === "application/json-rpc" || mediaType.endsWith("+json");
}
function assertAllowedOrigin(event, allowedOrigins) {
	const origin = event.req.headers.get("origin");
	if (!origin || allowedOrigins === "*") return;
	if (!(allowedOrigins ? isCorsOriginAllowed(origin, { origin: typeof allowedOrigins === "string" ? [allowedOrigins] : allowedOrigins }) : origin === event.url.origin)) throw new HTTPError({
		status: 403,
		message: "Origin not allowed"
	});
}
function defineJsonRpcWebSocketHandler(opts) {
	const methodMap = createMethodMap(opts.methods);
	const maxBatchSize = opts.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
	return defineWebSocketHandler({
		...opts.hooks,
		async message(peer, message) {
			let body;
			try {
				body = message.json();
			} catch {
				peer.send(JSON.stringify(createJsonRpcError(null, PARSE_ERROR, "Parse error")));
				return;
			}
			const result = await processJsonRpcBody(body, methodMap, peer, maxBatchSize);
			if (result !== void 0) peer.send(JSON.stringify(result));
		}
	});
}
function createMethodMap(methods) {
	const methodMap = Object.create(null);
	for (const key of Object.keys(methods)) methodMap[key] = methods[key];
	return methodMap;
}
async function processJsonRpcBody(body, methodMap, context, maxBatchSize) {
	if (!body || typeof body !== "object") return createJsonRpcError(null, INVALID_REQUEST, "Invalid Request");
	const requests = Array.isArray(body) ? body : [body];
	if (requests.length === 0) return createJsonRpcError(null, INVALID_REQUEST, "Invalid Request");
	if (requests.length > maxBatchSize) return createJsonRpcError(null, INVALID_REQUEST, `Invalid Request: batch size exceeds maximum of ${maxBatchSize}`);
	const finalResponses = (await Promise.all(requests.map((raw) => processJsonRpcMethod(raw, methodMap, context)))).filter((r) => r !== void 0);
	if (finalResponses.length === 0) return;
	return Array.isArray(body) ? finalResponses : finalResponses[0];
}
async function processJsonRpcMethod(raw, methodMap, context) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return createJsonRpcError(null, INVALID_REQUEST, "Invalid Request");
	const req = raw;
	if (req.jsonrpc !== "2.0" || typeof req.method !== "string" || "id" in req && !isValidId(req.id)) {
		const id = "id" in req && isValidId(req.id) ? req.id : null;
		return createJsonRpcError(id, INVALID_REQUEST, "Invalid Request");
	}
	if ("params" in req && req.params !== void 0 && (typeof req.params !== "object" || req.params === null)) return isNotification(req) ? void 0 : createJsonRpcError(req.id, INVALID_PARAMS, "Invalid params");
	if (req.method.startsWith("rpc.")) return isNotification(req) ? void 0 : createJsonRpcError(req.id, METHOD_NOT_FOUND, "Method not found");
	const method = req.method;
	const params = req.params;
	const notification = isNotification(req);
	const id = notification ? void 0 : req.id;
	const methodHandler = methodMap[method];
	if (!methodHandler) return notification ? void 0 : createJsonRpcError(id, METHOD_NOT_FOUND, "Method not found");
	try {
		const rpcReq = {
			jsonrpc: "2.0",
			method,
			params
		};
		if (!notification) rpcReq.id = id;
		const result = await methodHandler(rpcReq, context);
		return notification ? void 0 : {
			jsonrpc: "2.0",
			id,
			result: result ?? null
		};
	} catch (error_) {
		if (notification) return;
		const h3Error = HTTPError.isError(error_) && !error_.unhandled ? error_ : {
			status: HTTPError.isError(error_) ? error_.status : 500,
			message: "Internal error",
			data: void 0
		};
		const statusCode = h3Error.status;
		const statusMessage = h3Error.message;
		const errorCode = mapHttpStatusToJsonRpcError(statusCode);
		return createJsonRpcError(id, errorCode, statusMessage, h3Error.data);
	}
}
function mapHttpStatusToJsonRpcError(status) {
	switch (status) {
		case 400:
		case 422: return INVALID_PARAMS;
		case 401: return -32001;
		case 403: return -32003;
		case 404: return -32004;
		case 408: return -32008;
		case 409: return -32009;
		case 429: return -32029;
		default:
			if (status >= 300 && status < 500) return -32e3;
			return -32603;
	}
}
function isNotification(req) {
	return !("id" in req);
}
function isValidId(id) {
	if (id === null) return true;
	if (typeof id === "string") return true;
	return typeof id === "number" && Number.isInteger(id);
}
const createJsonRpcError = (id, code, message, data) => {
	const error = {
		code,
		message
	};
	if (data !== void 0) error.data = data;
	return {
		jsonrpc: "2.0",
		id,
		error
	};
};
const H3Error = HTTPError;
function createError(arg1, arg2) {
	return new HTTPError(arg1, arg2);
}
function isError(input) {
	return HTTPError.isError(input);
}
const getRequestPath = (event) => event.path;
function getRequestHeader(event, name) {
	return event.req.headers.get(name) || void 0;
}
const getHeader = getRequestHeader;
function getRequestHeaders(event) {
	return Object.fromEntries(event.req.headers.entries());
}
const getHeaders = getRequestHeaders;
function getMethod(event, defaultMethod = "GET") {
	return (event.req.method || defaultMethod).toUpperCase();
}
function readRawBody(event, encoding = "utf8") {
	return encoding ? event.req.text() : event.req.arrayBuffer().then((r) => new Uint8Array(r));
}
async function readFormDataBody(event) {
	return event.req.formData();
}
const readFormData = readFormDataBody;
async function readMultipartFormData(event) {
	const formData = await event.req.formData();
	return Promise.all([...formData.entries()].map(async ([key, value]) => {
		return typeof value === "object" ? {
			name: key,
			type: value.type,
			filename: value.name,
			data: await value.bytes()
		} : {
			name: key,
			data: new TextEncoder().encode(value)
		};
	}));
}
function getBodyStream(event) {
	return event.req.body || void 0;
}
const getRequestWebStream = getBodyStream;
function sendStream(_event, value) {
	return value;
}
const sendNoContent = (_, code) => noContent(code);
const sendRedirect = (_, loc, code) => redirect(loc, code);
const sendWebResponse = (response) => response;
const sendProxy = proxy;
function createEventStream(event, opts) {
	return new EventStream(event, opts);
}
const sendIterable = (_event, val, options) => {
	return iterable(val, options);
};
function getResponseStatusText(event) {
	return event.res.statusText || "";
}
function appendResponseHeader(event, name, value) {
	if (Array.isArray(value)) for (const valueItem of value) event.res.headers.append(name, valueItem);
	else event.res.headers.append(name, value);
}
const appendHeader = appendResponseHeader;
function setResponseHeader(event, name, value) {
	if (Array.isArray(value)) {
		event.res.headers.delete(name);
		for (const valueItem of value) event.res.headers.append(name, valueItem);
	} else event.res.headers.set(name, value);
}
const setHeader = setResponseHeader;
function setResponseHeaders(event, headers) {
	for (const [name, value] of Object.entries(headers)) event.res.headers.set(name, value);
}
const setHeaders = setResponseHeaders;
function getResponseStatus(event) {
	return event.res.status || 200;
}
function setResponseStatus(event, code, text) {
	if (code) event.res.status = sanitizeStatusCode(code, event.res.status);
	if (text) event.res.statusText = sanitizeStatusMessage(text);
}
function defaultContentType(event, type) {
	if (type && event.res.status !== 304 && !event.res.headers.has("content-type")) event.res.headers.set("content-type", type);
}
function getResponseHeaders(event) {
	return Object.fromEntries(event.res.headers.entries());
}
function getResponseHeader(event, name) {
	return event.res.headers.get(name) || void 0;
}
function removeResponseHeader(event, name) {
	return event.res.headers.delete(name);
}
function appendResponseHeaders(event, headers) {
	for (const [name, value] of Object.entries(headers)) appendResponseHeader(event, name, value);
}
const appendHeaders = appendResponseHeaders;
function clearResponseHeaders(event, headerNames) {
	if (headerNames && headerNames.length > 0) for (const name of headerNames) event.res.headers.delete(name);
	else for (const name of event.res.headers.keys()) event.res.headers.delete(name);
}
const defineEventHandler = defineHandler;
const eventHandler = defineHandler;
const lazyEventHandler = defineLazyEventHandler;
const defineNodeListener = defineNodeHandler;
const fromNodeMiddleware = fromNodeHandler;
function toNodeHandler(app) {
	if (toNodeHandler._isWarned !== true) {
		console.warn(`[h3] "toNodeHandler" export from h3 is deprecated. Please import "toNodeHandler" from "h3/node".`);
		toNodeHandler._isWarned = true;
	}
	return (toNodeHandler._toNodeHandler ??= () => {
		return globalThis.process.getBuiltinModule("node:module").createRequire(import.meta.url)("srvx/node").toNodeHandler;
	})()(app.fetch);
}
const toNodeListener = toNodeHandler;
const createApp = (config) => new H3(config);
const createRouter$1 = (config) => new H3(config);
const useBase = withBase;
export { EventStream, H3Error, appendAcceptQuery, appendHeader, appendHeaders, appendResponseHeader, appendResponseHeaders, assertBodySize, basicAuth, bodyLimit, clearResponseHeaders, clearSession, createApp, createError, createEventStream, createRouter$1 as createRouter, defaultContentType, defineEventHandler, defineJsonRpcHandler, defineJsonRpcWebSocketHandler, defineNodeHandler, defineNodeListener, defineNodeMiddleware, definePlugin, defineRoute, defineWebSocket, defineWebSocketHandler, deleteChunkedCookie, deleteCookie, eventHandler, freezeApp, fromNodeHandler, fromNodeMiddleware, fromWebHandler, getBodyStream, getChunkedCookie, getCookie, getHeader, getHeaders, getMethod, getRequestFingerprint, getRequestHeader, getRequestHeaders, getRequestPath, getRequestWebStream, getResponseHeader, getResponseHeaders, getResponseStatus, getResponseStatusText, getSession, getValidatedCookies, isError, lazyEventHandler, onError, onRequest, onResponse, parseCookies, readBody, readFormData, readFormDataBody, readMultipartFormData, readRawBody, readValidatedBody, removeResponseHeader, removeRoute$1 as removeRoute, requireBasicAuth, requireContentType, sealSession, sendIterable, sendNoContent, sendProxy, sendRedirect, sendStream, sendWebResponse, serveStatic, setChunkedCookie, setCookie, setHeader, setHeaders, setResponseHeader, setResponseHeaders, setResponseStatus, setServerTiming, toNodeHandler, toNodeListener, toWebHandler, unsealSession, updateSession, useBase, useSession, withBase, withServerTiming };
