import { EmptyObject, H3Event, HTTPError, decodePreservingSeparators, kMalformedURL, kNotFound, normalizeRoute, stripBase, toError, toResponse } from "./response.mjs";
import { callMiddleware, composeHandler, composeMiddleware, normalizeMiddleware } from "./middleware.mjs";
import { addRoute, createRouter, findRoute } from "rou3";
const plusRegex = /\+/g;
function parseQuery(input) {
	const params = new EmptyObject();
	if (!input || input === "?") return params;
	const inputLength = input.length;
	let key = "";
	let value = "";
	let startingIndex = -1;
	let equalityIndex = -1;
	let shouldDecodeKey = false;
	let shouldDecodeValue = false;
	let keyHasPlus = false;
	let valueHasPlus = false;
	let hasBothKeyValuePair = false;
	let c = 0;
	for (let i = 0; i < inputLength + 1; i++) {
		c = i === inputLength ? 38 : input.charCodeAt(i);
		switch (c) {
			case 38:
				hasBothKeyValuePair = equalityIndex > startingIndex;
				if (!hasBothKeyValuePair) equalityIndex = i;
				key = input.slice(startingIndex + 1, equalityIndex);
				if (hasBothKeyValuePair || key.length > 0) {
					if (keyHasPlus) key = key.replace(plusRegex, " ");
					if (shouldDecodeKey) try {
						key = decodeURIComponent(key);
					} catch {}
					if (hasBothKeyValuePair) {
						value = input.slice(equalityIndex + 1, i);
						if (valueHasPlus) value = value.replace(plusRegex, " ");
						if (shouldDecodeValue) try {
							value = decodeURIComponent(value);
						} catch {}
					}
					const currentValue = params[key];
					if (currentValue === void 0) params[key] = value;
					else if (Array.isArray(currentValue)) currentValue.push(value);
					else params[key] = [currentValue, value];
				}
				value = "";
				startingIndex = i;
				equalityIndex = i;
				shouldDecodeKey = false;
				shouldDecodeValue = false;
				keyHasPlus = false;
				valueHasPlus = false;
				break;
			case 61:
				if (equalityIndex <= startingIndex) equalityIndex = i;
				else shouldDecodeValue = true;
				break;
			case 43:
				if (equalityIndex > startingIndex) valueHasPlus = true;
				else keyHasPlus = true;
				break;
			case 37: if (equalityIndex > startingIndex) shouldDecodeValue = true;
			else shouldDecodeKey = true;
		}
	}
	return params;
}
const VALIDATION_FAILED = "Validation failed";
async function validateData(data, fn, options) {
	if ("~standard" in fn) {
		const result = await fn["~standard"].validate(data);
		if (result.issues) throw createValidationError(options?.onError?.(result) || {
			message: VALIDATION_FAILED,
			issues: result.issues
		});
		return result.value;
	}
	try {
		const res = await fn(data);
		if (res === false) throw createValidationError(options?.onError?.({ issues: [{ message: VALIDATION_FAILED }] }) || { message: VALIDATION_FAILED });
		if (res === true) return data;
		return res ?? data;
	} catch (error) {
		throw createValidationError(error);
	}
}
const reqBodyKeys = /* @__PURE__ */ new Set([
	"body",
	"text",
	"formData",
	"arrayBuffer"
]);
async function validatedRequest(req, validate) {
	if (validate.headers) {
		const validatedheaders = await validateSource("headers", Object.fromEntries(req.headers.entries()), validate.headers, validate.onError);
		for (const [key, value] of Object.entries(validatedheaders)) req.headers.set(key, value);
	}
	if (!validate.body) return req;
	return new Proxy(req, { get(_target, prop) {
		if (prop === "json") return function _validatedJson() {
			return req.json().catch((error) => {
				if (HTTPError.isError(error)) throw error;
				throw new HTTPError({
					status: 400,
					statusText: "Bad Request",
					message: "Invalid JSON body"
				});
			}).then((data) => validate.body["~standard"].validate(data)).then((result) => {
				if (result.issues) throw createValidationError(validate.onError?.({
					_source: "body",
					...result
				}) || {
					message: VALIDATION_FAILED,
					issues: result.issues
				});
				return result.value;
			});
		};
		else if (reqBodyKeys.has(prop)) throw new TypeError(`Cannot access .${prop} on request with JSON validation enabled. Use .json() instead.`);
		return Reflect.get(req, prop);
	} });
}
async function validatedURL(url, validate) {
	if (!validate.query) return url;
	const validatedQuery = await validateSource("query", Object.fromEntries(url.searchParams.entries()), validate.query, validate.onError);
	for (const [key, value] of Object.entries(validatedQuery)) url.searchParams.set(key, value);
	return url;
}
async function validateSource(source, data, fn, onError) {
	const result = await fn["~standard"].validate(data);
	if (result.issues) throw createValidationError(onError?.({
		_source: source,
		...result
	}) || {
		message: VALIDATION_FAILED,
		issues: result.issues
	});
	return result.value;
}
function createValidationError(cause) {
	return HTTPError.isError(cause) ? cause : new HTTPError({
		cause,
		status: cause?.status || 400,
		statusText: cause?.statusText || VALIDATION_FAILED,
		message: cause?.message || VALIDATION_FAILED,
		data: {
			issues: cause?.issues,
			message: cause instanceof Error ? VALIDATION_FAILED : cause?.message || VALIDATION_FAILED
		}
	});
}
function isEvent(input) {
	return input instanceof H3Event || input?.constructor?.__is_event__;
}
function isHTTPEvent(input) {
	return input?.req instanceof Request;
}
function getEventContext(event) {
	if (event.context) return event.context;
	event.req.context ??= {};
	return event.req.context;
}
function mockEvent(_request, options) {
	let request;
	if (options?.body && !options.duplex) options.duplex = "half";
	if (typeof _request === "string") {
		let url = _request;
		if (url[0] === "/") url = `http://localhost${url}`;
		request = new Request(url, options);
	} else if (options || _request instanceof URL) request = new Request(_request, options);
	else request = _request;
	return new H3Event(request);
}
function requestWithURL(req, url) {
	const cache = new EmptyObject();
	cache.url = url;
	cache._url = void 0;
	return new Proxy(req, {
		get(target, prop) {
			if (prop in cache) return cache[prop];
			const value = Reflect.get(target, prop);
			if (prop === "bodyUsed") return value;
			cache[prop] = typeof value === "function" && prop !== "constructor" ? value.bind(target) : value;
			return cache[prop];
		},
		set(target, prop, value) {
			if (prop !== "url" && prop !== "_url") delete cache[prop];
			return Reflect.set(target, prop, value);
		}
	});
}
function requestWithBaseURL(req, base, options = {}) {
	const url = new URL(options.url || req.url);
	url.pathname = stripBase(url.pathname, base);
	return requestWithURL(req, url.href);
}
function toRequest(input, options) {
	if (typeof input === "string") {
		let url = input;
		if (url[0] === "/") url = `http://${safeHost((options?.headers ? new Headers(options.headers) : void 0)?.get("host"))}${url}`;
		return new Request(url, options);
	} else if (options || input instanceof URL) return new Request(input, options);
	return input;
}
function getQuery(event) {
	return parseQuery((event.url || new URL(event.req.url)).search.slice(1));
}
function getValidatedQuery(event, validate, options) {
	return validateData(getQuery(event), validate, options);
}
function getRouterParams(event, opts = {}) {
	let params = getEventContext(event).params || {};
	if (opts.decode) {
		params = { ...params };
		for (const key in params) params[key] = decodePreservingSeparators(params[key]);
	}
	return params;
}
function getValidatedRouterParams(event, validate, options = {}) {
	const { decode, ...opts } = options;
	return validateData(getRouterParams(event, { decode }), validate, opts);
}
function getRouterParam(event, name, opts = {}) {
	return getRouterParams(event, opts)[name];
}
function isMethod(event, expected, allowHead) {
	const method = event.req.method.toUpperCase();
	if (allowHead && method === "HEAD") return true;
	if (typeof expected === "string") {
		if (method === expected) return true;
	} else if (expected.includes(method)) return true;
	return false;
}
function assertMethod(event, expected, allowHead) {
	if (!isMethod(event, expected, allowHead)) {
		const allowed = Array.isArray(expected) ? expected : [expected];
		throw new HTTPError({
			status: 405,
			headers: { Allow: allowHead ? [...allowed, "HEAD"].join(", ") : allowed.join(", ") }
		});
	}
}
function getRequestHost(event, opts = {}) {
	if (opts.xForwardedHost) {
		const xForwardedHost = (event.req.headers.get("x-forwarded-host") || "").split(",").shift()?.trim();
		if (xForwardedHost) return xForwardedHost;
	}
	return event.req.headers.get("host") || "";
}
function getRequestProtocol(event, opts = {}) {
	if (opts.xForwardedProto) {
		const forwardedProto = (event.req.headers.get("x-forwarded-proto") || "").split(",")[0].trim();
		if (forwardedProto === "https") return "https";
		if (forwardedProto === "http") return "http";
	}
	return (event.url || new URL(event.req.url)).protocol.slice(0, -1);
}
function getRequestURL(event, opts = {}) {
	const url = new URL(event.url || event.req.url);
	url.protocol = getRequestProtocol(event, opts);
	if (opts.xForwardedHost) {
		const host = getRequestHost(event, opts);
		if (host) applyForwardedHost(url, host);
	}
	return url;
}
function getRequestIP(event, opts = {}) {
	if (opts.xForwardedFor) {
		const _header = event.req.headers.get("x-forwarded-for");
		if (_header) {
			const xForwardedFor = _header.split(",")[0].trim();
			if (xForwardedFor) return xForwardedFor;
		}
	}
	return event.req.context?.clientAddress || event.req.ip || void 0;
}
function applyForwardedHost(url, host) {
	const sep = host.lastIndexOf(":");
	const hasPort = sep > host.lastIndexOf("]");
	const hostname = hasPort ? host.slice(0, sep) : host;
	const prevHostname = url.hostname;
	url.hostname = hostname;
	if (url.hostname === prevHostname && hostname.toLowerCase() !== prevHostname) return;
	const port = hasPort ? host.slice(sep + 1) : "";
	url.port = /^\d{1,5}$/.test(port) && +port < 65536 ? port : "";
}
function safeHost(host) {
	return host && !/[/\\?#@\s]/.test(host) ? host : "localhost";
}
function defineHandler(input) {
	if (typeof input === "function") return handlerWithFetch(input);
	const handler = input.handler || (input.fetch ? function _fetchHandler(event) {
		return input.fetch(event.req);
	} : NoHandler);
	const composed = input.middleware?.length && composeHandler(input.middleware, handler);
	const eventHandler = handlerWithFetch(composed || handler);
	return Object.assign(eventHandler, input, composed && { fetch: eventHandler.fetch });
}
function defineValidatedHandler(def) {
	if (!def.validate) return defineHandler(def);
	return defineHandler({
		...def,
		handler: async function _validatedHandler(event) {
			event.req = await validatedRequest(event.req, def.validate);
			event.url = await validatedURL(event.url, def.validate);
			return def.handler(event);
		}
	});
}
function handlerWithFetch(handler) {
	if ("fetch" in handler) return handler;
	return Object.assign(handler, { fetch: (req) => {
		if (typeof req === "string") req = new URL(req, "http://_");
		if (req instanceof URL) req = new Request(req);
		const event = new H3Event(req);
		try {
			return Promise.resolve(toResponse(handler(event), event));
		} catch (error) {
			return Promise.resolve(toResponse(toError(error), event));
		}
	} });
}
function dynamicEventHandler(initial) {
	let current = toEventHandler(initial);
	return Object.assign(defineHandler(function _dynamicEventHandler(event) {
		return current?.(event);
	}), { set: (handler) => {
		current = toEventHandler(handler);
	} });
}
function defineLazyEventHandler(loader) {
	let handler;
	let promise;
	return defineHandler(function lazyHandler(event) {
		return handler ? handler(event) : (promise ??= Promise.resolve(loader()).then(function resolveLazyHandler(r) {
			handler = toEventHandler(r) || toEventHandler(r.default);
			if (typeof handler !== "function") throw new TypeError("Invalid lazy handler", { cause: { resolved: r } });
			return handler;
		})).then((r) => r(event));
	});
}
function toEventHandler(handler) {
	if (typeof handler === "function") return handler;
	if (typeof handler?.handler === "function" && handler.constructor?.["~h3"]) return handler.handler;
	if (typeof handler?.fetch === "function") return function _fetchHandler(event) {
		return handler.fetch(event.req);
	};
}
const NoHandler = () => kNotFound;
var H3Core = class {
	static "~h3" = true;
	config;
	"~middleware";
	"~routes" = [];
	"~dispatch";
	"~composed";
	constructor(config = {}) {
		this["~middleware"] = [];
		this.config = config;
		this.fetch = this.fetch.bind(this);
		this.handler = this.handler.bind(this);
	}
	fetch(request) {
		return this["~request"](request);
	}
	handler(event) {
		const route = this["~findRoute"](event);
		if (route) {
			event.context.params = route.params;
			event.context.matchedRoute = route.data;
		}
		return (this["~dispatch"] ??= createDispatcher(this))(event, route);
	}
	"~request"(request, context) {
		const event = new H3Event(request, context, this);
		let handlerRes;
		try {
			if (event[kMalformedURL] && !this.config.allowMalformedURL) throw new HTTPError({
				status: 400,
				message: "Bad Request"
			});
			if (this.config.onRequest) {
				const hookRes = this.config.onRequest(event);
				handlerRes = typeof hookRes?.then === "function" ? hookRes.then(() => this.handler(event)) : this.handler(event);
			} else handlerRes = this.handler(event);
		} catch (error) {
			handlerRes = Promise.reject(error);
		}
		return toResponse(handlerRes, event, this.config);
	}
	"~findRoute"(_event) {}
	"~addRoute"(_route) {
		this["~routes"].push(_route);
	}
	"~getMiddleware"(_event, _route) {
		return this["~middleware"];
	}
};
function createDispatcher(app) {
	if (app["~getMiddleware"] !== H3Core.prototype["~getMiddleware"]) return (event, route) => callMiddleware(event, app["~getMiddleware"](event, route || void 0), routeHandler(route));
	const middleware = app["~middleware"];
	if (middleware.length === 0) return (event, route) => routeHandler(route)(event);
	const composed = app["~composed"] ??= composeMiddleware(middleware);
	return (event, route) => composed(event, routeHandler(route));
}
function routeHandler(route) {
	const data = route?.data;
	if (!data) return NoHandler;
	return data.middleware?.length ? data["~composed"] ??= composeHandler(data.middleware, data.handler) : data.handler;
}
const H3 = /* @__PURE__ */ (() => {
	class H3 extends H3Core {
		"~rou3";
		constructor(config = {}) {
			super(config);
			this["~rou3"] = createRouter();
			this.request = this.request.bind(this);
			config.plugins?.forEach((plugin) => plugin(this));
		}
		register(plugin) {
			plugin(this);
			return this;
		}
		request(_req, _init, context) {
			return this["~request"](toRequest(_req, _init), context);
		}
		mount(base, input) {
			base = !base || base === "/" ? "" : normalizeRoute(base).replace(/\/$/, "");
			if ("handler" in input) {
				if (input["~middleware"].length > 0) {
					this["~middleware"].push((event, next) => {
						const originalPathname = event.url.pathname;
						if (!originalPathname.startsWith(base) || originalPathname.length > base.length && originalPathname[base.length] !== "/") return next();
						event.url.pathname = stripBase(originalPathname, base);
						const restore = () => {
							event.url.pathname = originalPathname;
						};
						try {
							const result = (input["~composed"] ??= composeMiddleware(input["~middleware"]))(event, () => {
								restore();
								return next();
							});
							if (typeof result?.then === "function") return Promise.resolve(result).finally(restore);
							restore();
							return result;
						} catch (err) {
							restore();
							throw err;
						}
					});
					this["~dispatch"] = this["~composed"] = void 0;
				}
				for (const r of input["~routes"]) this["~addRoute"]({
					...r,
					route: base + r.route
				});
			} else {
				const fetchHandler = "fetch" in input ? input.fetch : input;
				this.all(`${base}/**`, function _mountedMiddleware(event) {
					return fetchHandler(requestWithBaseURL(event.req, base, { url: event.url }));
				});
			}
			return this;
		}
		on(method, route, handler, opts) {
			const _method = (method || "").toUpperCase();
			route = normalizeRoute(route);
			this["~addRoute"]({
				method: _method,
				route,
				handler: toEventHandler(handler),
				middleware: opts?.middleware,
				meta: {
					...handler.meta,
					...opts?.meta
				}
			});
			return this;
		}
		all(route, handler, opts) {
			return this.on("", route, handler, opts);
		}
		"~findRoute"(_event) {
			const match = findRoute(this["~rou3"], _event.req.method, _event.url.pathname);
			if (match === void 0 && _event.req.method === "HEAD") return findRoute(this["~rou3"], "GET", _event.url.pathname);
			return match;
		}
		"~addRoute"(_route) {
			addRoute(this["~rou3"], _route.method, _route.route, _route);
			super["~addRoute"](_route);
		}
		use(arg1, arg2, arg3) {
			let route;
			let fn;
			let opts;
			if (typeof arg1 === "string") {
				route = arg1;
				fn = arg2;
				opts = arg3;
			} else {
				fn = arg1;
				opts = arg2;
			}
			if (typeof fn !== "function" && "handler" in fn) return this.mount(route || "", fn);
			this["~middleware"].push(normalizeMiddleware(fn, {
				...opts,
				route
			}));
			this["~dispatch"] = this["~composed"] = void 0;
			return this;
		}
	}
	for (const method of [
		"GET",
		"POST",
		"PUT",
		"DELETE",
		"PATCH",
		"HEAD",
		"OPTIONS",
		"CONNECT",
		"TRACE",
		"QUERY"
	]) H3Core.prototype[method.toLowerCase()] = function(route, handler, opts) {
		return this.on(method, route, handler, opts);
	};
	return H3;
})();
function matchETag(ifNoneMatch, etag) {
	if (ifNoneMatch.trim() === "*") return true;
	const target = opaqueTag(etag);
	return splitETags(ifNoneMatch).some((tag) => opaqueTag(tag.trim()) === target);
}
function isCacheMatch(headers, validators) {
	const ifNoneMatch = validators.ifNoneMatch ?? headers.get("if-none-match");
	if (ifNoneMatch) return !!validators.etag && matchETag(ifNoneMatch, validators.etag);
	if (validators.lastModified) {
		const ifModifiedSince = validators.ifModifiedSince ?? headers.get("if-modified-since");
		return !!ifModifiedSince && new Date(ifModifiedSince) >= validators.lastModified;
	}
	return false;
}
function opaqueTag(tag) {
	return tag.startsWith("W/") ? tag.slice(2) : tag;
}
function splitETags(value) {
	const tags = [];
	let current = "";
	let inQuotes = false;
	for (const ch of value) if (ch === "\"") {
		inQuotes = !inQuotes;
		current += ch;
	} else if (ch === "," && !inQuotes) {
		tags.push(current);
		current = "";
	} else current += ch;
	tags.push(current);
	return tags;
}
const RE_PRIVATE = /(?:^|,)\s*(?:private|no-store)(?:\s*=|\s*,|\s*$)/i;
const RE_PUBLIC = /(?:^|,)\s*public(?:\s*=|\s*,|\s*$)/i;
function handleCacheHeaders(event, opts) {
	const cacheControls = [...opts.cacheControls || []];
	const joined = cacheControls.join(",");
	const isPrivate = RE_PRIVATE.test(joined);
	if (!isPrivate && !RE_PUBLIC.test(joined)) cacheControls.unshift("public");
	if (opts.maxAge !== void 0) {
		cacheControls.push(`max-age=${+opts.maxAge}`);
		if (!isPrivate) cacheControls.push(`s-maxage=${+opts.maxAge}`);
	}
	if (opts.etag) event.res.headers.set("etag", opts.etag);
	let lastModified;
	if (opts.modifiedTime) {
		lastModified = new Date(opts.modifiedTime);
		lastModified.setMilliseconds(0);
		event.res.headers.set("last-modified", lastModified.toUTCString());
	}
	event.res.headers.set("cache-control", cacheControls.join(", "));
	if (isCacheMatch(event.req.headers, {
		etag: opts.etag,
		lastModified,
		ifNoneMatch: opts.ifNoneMatch,
		ifModifiedSince: opts.ifModifiedSince
	})) {
		event.res.status = 304;
		return true;
	}
	return false;
}
export { H3, H3Core, assertMethod, defineHandler, defineLazyEventHandler, defineValidatedHandler, dynamicEventHandler, getEventContext, getQuery, getRequestHost, getRequestIP, getRequestProtocol, getRequestURL, getRouterParam, getRouterParams, getValidatedQuery, getValidatedRouterParams, handleCacheHeaders, isCacheMatch, isEvent, isHTTPEvent, isMethod, mockEvent, requestWithBaseURL, requestWithURL, toEventHandler, toRequest, validateData };
