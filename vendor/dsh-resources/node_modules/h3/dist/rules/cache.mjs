import { HTTPError, HTTPResponse, toResponse } from "../response.mjs";
import { defineHandler, handleCacheHeaders } from "../cache.mjs";
import { createCacheRuleHandler } from "../cache2.mjs";
import { createMemoryStorage, defineCachedHandler } from "ocache";
const VOLATILE_CORS_HEADERS = ["access-control-allow-origin", "access-control-allow-credentials"];
function getSetCookies(headers) {
	if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
	const value = headers.get("set-cookie");
	return value === null ? [] : [value];
}
const RE_VARY_ORIGIN = /(?:^|,)\s*origin\s*(?:,|$)/i;
function withoutVaryOrigin(vary) {
	const rest = vary.split(",").map((name) => name.trim()).filter((name) => name && name.toLowerCase() !== "origin");
	return rest.length > 0 ? rest.join(", ") : void 0;
}
function moveVolatileHeaders(res, event) {
	if (event.req.method !== "GET" && event.req.method !== "HEAD") return res;
	const moved = [];
	for (const name of VOLATILE_CORS_HEADERS) {
		const value = res.headers.get(name);
		if (value !== null) moved.push([name, value]);
	}
	const cookies = getSetCookies(res.headers);
	const vary = event.context.routeRules?.cors ? res.headers.get("vary") : null;
	const dropVaryOrigin = vary !== null && RE_VARY_ORIGIN.test(vary);
	const varyRest = dropVaryOrigin ? withoutVaryOrigin(vary) : void 0;
	if (moved.length === 0 && cookies.length === 0 && !dropVaryOrigin) return res;
	const strip = (headers) => {
		for (const [name] of moved) headers.delete(name);
		if (cookies.length > 0) headers.delete("set-cookie");
		if (dropVaryOrigin) {
			if (varyRest === void 0) headers.delete("vary");
			else headers.set("vary", varyRest);
		}
	};
	try {
		strip(res.headers);
	} catch {
		res = new Response(res.body, res);
		strip(res.headers);
	}
	for (const [name, value] of moved) event.res.headers.set(name, value);
	for (const cookie of cookies) event.res.headers.append("set-cookie", cookie);
	if (dropVaryOrigin) event.res.headers.set("vary", vary);
	return res;
}
const CREDENTIAL_HEADERS = ["authorization", "proxy-authorization"];
function setRequestHeaders(event, names, values) {
	const apply = (headers) => {
		for (let i = 0; i < names.length; i++) {
			const value = values[i];
			if (value == null) headers.delete(names[i]);
			else headers.set(names[i], value);
		}
	};
	const applied = (headers) => names.every((name, i) => headers.get(name) === (values[i] ?? null));
	try {
		if (applied(event.req.headers)) return true;
		apply(event.req.headers);
		if (applied(event.req.headers)) return true;
	} catch {}
	try {
		const original = event.req;
		const headers = new Headers(original.headers);
		apply(headers);
		const req = new Request(original.url, {
			method: original.method,
			headers
		});
		req.context = original.context;
		if (original.runtime) req.runtime = original.runtime;
		event.req = req;
	} catch {
		return false;
	}
	return applied(event.req.headers);
}
const savedHeaders = /* @__PURE__ */ new WeakMap();
const servedCacheControl = /* @__PURE__ */ new WeakMap();
const RE_PRIVATE = /(?:^|,)\s*(?:private|no-store)(?:\s*=|\s*,|\s*$)/i;
function withPreservedCacheControl(event, conditions, sendCacheControl) {
	const existing = servedCacheControl.get(event) ?? event.res.headers.get("cache-control");
	const preserve = !sendCacheControl || existing !== null && RE_PRIVATE.test(existing);
	const matched = handleCacheHeaders(event, conditions);
	if (preserve) {
		if (existing) event.res.headers.set("cache-control", existing);
		else event.res.headers.delete("cache-control");
	}
	return matched;
}
function withRequestHeaderFilter(handler, strip, restore) {
	const names = [...strip, ...restore];
	const stripped = strip.map(() => null);
	return (event) => {
		if (names.length > 0 && (event.req.method === "GET" || event.req.method === "HEAD")) {
			const saved = savedHeaders.get(event);
			const values = saved ? [...stripped, ...saved] : [...stripped, ...restore.map(() => null)];
			if (!setRequestHeaders(event, names, values)) {
				for (const name of strip) if (event.req.headers.get(name) !== null) throw new HTTPError({
					status: 500,
					message: "Cache rule could not strip the credential headers from the request before a cached dispatch."
				});
			}
		}
		return handler(event);
	};
}
function variableHeaderNames(opts, allowCredentials) {
	const allowsCookies = (opts.allowCookies ?? []).some((name) => name?.trim());
	const varies = allowCredentials ? [...opts.varies ?? [], ...CREDENTIAL_HEADERS] : opts.varies ?? [];
	return [...new Set(varies.filter(Boolean).map((name) => name.toLowerCase()))].filter((name) => !(allowsCookies && name === "cookie"));
}
const idStorages = /* @__PURE__ */ new Map();
function idStorage(id) {
	let storage = idStorages.get(id);
	if (!storage) {
		storage = createMemoryStorage();
		idStorages.set(id, storage);
	}
	return storage;
}
function createOcacheRuleHandler(opts) {
	let memoryStorage;
	const id = opts?.id;
	const storage = opts?.storage ?? (id === void 0 ? () => memoryStorage ??= createMemoryStorage() : () => idStorage(id));
	return createCacheRuleHandler({
		defineCachedHandler: (handler, cachedOpts) => {
			const allowCredentials = cachedOpts.allowAuthorization === true;
			const strip = allowCredentials ? [] : CREDENTIAL_HEADERS;
			const restore = variableHeaderNames(cachedOpts, allowCredentials).filter((name) => !strip.includes(name));
			const ocacheHandler = defineCachedHandler(cachedOpts.headersOnly ? handler : withRequestHeaderFilter(handler, strip, restore), {
				toResponse: async (value, event) => {
					const res = moveVolatileHeaders(await toResponse(value, event), event);
					const cacheControl = res.headers.get("cache-control");
					if (cacheControl) servedCacheControl.set(event, cacheControl);
					return res;
				},
				handleCacheHeaders: (event, conditions) => withPreservedCacheControl(event, conditions, cachedOpts.sendCacheControl !== false),
				storage,
				...cachedOpts,
				...allowCredentials && { varies: [...cachedOpts.varies ?? [], ...CREDENTIAL_HEADERS] }
			});
			return defineHandler(async (event) => {
				if (restore.length > 0) savedHeaders.set(event, restore.map((name) => event.req.headers.get(name)));
				const res = await ocacheHandler(event);
				if (res instanceof Response && res.status === 304) return new HTTPResponse(null, {
					status: 304,
					headers: res.headers
				});
				return res;
			});
		},
		defaults: opts?.defaults,
		id: opts?.id
	});
}
const cache = /* @__PURE__ */ createOcacheRuleHandler();
export { cache, createOcacheRuleHandler };
