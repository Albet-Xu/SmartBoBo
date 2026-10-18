import { kNotFound, normalizeRoute } from "./response.mjs";
import { addRoute, createRouter, findRoute } from "rou3";
const LITERAL_ROUTE_RE = /^(?:\/[^/:*(){}\\]+)*\/?$/;
const LITERAL_PREFIX_ROUTE_RE = /^((?:\/[^/:*(){}\\]+)*)\/\*\*\/?$/;
function createRouteMatcher(route) {
	if (route.charCodeAt(0) !== 47) route = `/${route}`;
	const prefixMatch = LITERAL_PREFIX_ROUTE_RE.exec(route);
	if (prefixMatch) {
		const base = prefixMatch[1];
		const prefix = `${base}/`;
		return (pathname) => pathname.startsWith(prefix) ? { _: trimTrailingSlashes(pathname.slice(prefix.length)) } : pathname === base ? { _: "" } : false;
	}
	if (LITERAL_ROUTE_RE.test(route)) {
		const base = route.endsWith("/") ? route.slice(0, -1) : route;
		return (pathname) => pathname === base || pathname === `${base}/` || pathname === `${base}//` ? void 0 : false;
	}
	const router = createRouter();
	addRoute(router, "", route, true);
	return (pathname) => {
		const match = findRoute(router, "", pathname);
		return match ? match.params : false;
	};
}
function trimTrailingSlashes(rest) {
	if (rest.endsWith("/")) {
		rest = rest.slice(0, -1);
		if (rest.endsWith("/")) rest = rest.slice(0, -1);
	}
	return rest;
}
function defineMiddleware(input) {
	return input;
}
function normalizeMiddleware(input, opts = {}) {
	const matcher = createMatcher(opts);
	if (!matcher && (input.length > 1 || input.constructor?.name === "AsyncFunction")) return input;
	return (event, next) => {
		if (matcher && !matcher(event)) return next();
		const res = input(event, next);
		return res === void 0 || res === kNotFound ? next() : res;
	};
}
function createMatcher(opts) {
	if (!opts.route && !opts.method && !opts.match) return;
	const routeMatcher = opts.route ? createRouteMatcher(normalizeRoute(opts.route)) : void 0;
	const method = opts.method?.toUpperCase();
	return function _middlewareMatcher(event) {
		if (method) {
			const reqMethod = event.req.method.toUpperCase();
			if (reqMethod !== method && !(method === "GET" && reqMethod === "HEAD")) return false;
		}
		if (opts.match && !opts.match(event)) return false;
		if (!routeMatcher) return true;
		const params = routeMatcher(event.url.pathname);
		if (params === false) return false;
		if (params) event.context.middlewareParams = {
			...event.context.middlewareParams,
			...params
		};
		return true;
	};
}
function composeMiddleware(middleware) {
	let chain = (event, handler) => handler(event);
	for (let i = middleware.length - 1; i >= 0; i--) {
		const fn = middleware[i];
		const inner = chain;
		chain = (event, handler) => callLayer(fn, event, handler, inner);
	}
	return chain;
}
function composeHandler(middleware, handler) {
	const chain = composeMiddleware(middleware);
	return function _composedHandler(event) {
		return chain(event, handler);
	};
}
function callMiddleware(event, middleware, handler, index = 0) {
	return index === middleware.length ? handler(event) : callLayer(middleware[index], event, handler, (_event, _handler) => callMiddleware(_event, middleware, _handler, index + 1));
}
function callLayer(fn, event, handler, inner) {
	let nextCalled;
	let nextResult;
	const next = () => {
		if (nextCalled) return nextResult;
		nextCalled = true;
		nextResult = inner(event, handler);
		return nextResult;
	};
	const ret = fn(event, next);
	return isUnhandledResponse(ret) ? next() : typeof ret?.then === "function" ? ret.then((resolved) => isUnhandledResponse(resolved) ? next() : resolved) : ret;
}
function isUnhandledResponse(val) {
	return val === void 0 || val === kNotFound;
}
function toMiddleware(input) {
	let h = input.handler || input;
	let isFunction = typeof h === "function";
	if (!isFunction && typeof input?.fetch === "function") {
		isFunction = true;
		h = function _fetchHandler(event) {
			return input.fetch(event.req);
		};
	}
	if (!isFunction) return function noopMiddleware(event, next) {
		return next();
	};
	if (h.length === 2) return h;
	return function _middlewareHandler(event, next) {
		const res = h(event);
		return typeof res?.then === "function" ? res.then((r) => {
			return is404(r) ? next() : r;
		}) : is404(res) ? next() : res;
	};
}
function is404(val) {
	return isUnhandledResponse(val) || val?.status === 404 && val instanceof Response;
}
export { callMiddleware, composeHandler, composeMiddleware, defineMiddleware, normalizeMiddleware, toMiddleware };
