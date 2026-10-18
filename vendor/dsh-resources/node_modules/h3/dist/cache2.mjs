import { HTTPResponse } from "./response.mjs";
const CACHE_GROUP = "h3/route-rules";
let dispatching;
let scopeCounter = 0;
function createCacheRuleHandler(opts) {
	const defineCached = opts.defineCachedHandler;
	const defaults = opts.defaults;
	const id = opts.id;
	const cachedHandlers = /* @__PURE__ */ new WeakMap();
	return {
		order: 3,
		handler: (m) => function cacheRouteRule(event, next) {
			const matchedRoute = event.context.matchedRoute;
			if (!matchedRoute) return next();
			const handler = matchedRoute["~composed"] ?? matchedRoute.handler;
			const method = event.req.method;
			const key = `${method === "GET" || method === "HEAD" ? method : "*"}:${m.route}:${matchedRoute.route}`;
			let entry = cachedHandlers.get(handler);
			if (!entry) {
				entry = {
					scope: id ?? `#${++scopeCounter}`,
					byRoute: /* @__PURE__ */ new Map()
				};
				cachedHandlers.set(handler, entry);
			}
			let cachedHandler = entry.byRoute.get(key);
			if (!cachedHandler) {
				cachedHandler = defineCached(handler, {
					group: CACHE_GROUP,
					name: `${entry.scope}:${key}`,
					...defaults,
					...m.options
				});
				entry.byRoute.set(key, cachedHandler);
			}
			let active = dispatching?.get(event);
			if (active?.has(handler)) return next();
			if (!active) (dispatching ??= /* @__PURE__ */ new WeakMap()).set(event, active = /* @__PURE__ */ new Set());
			active.add(handler);
			const res = cachedHandler(event);
			return typeof res?.then === "function" ? res.then(normalizeResult) : normalizeResult(res);
		}
	};
}
function normalizeResult(res) {
	return res === void 0 ? new HTTPResponse(null) : res;
}
export { createCacheRuleHandler };
