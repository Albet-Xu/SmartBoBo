import { canonicalPathname, withLeadingSlash } from "./response.mjs";
import { handleCors, redirect as redirect$1 } from "./cors.mjs";
import { canonicalPath, decodedPath, isHostPositionSplat, mergedCanonicalPath, needsCanonicalPasses, prepareRuleTarget } from "./_utils.mjs";
import { addRoute, compareRoutes, createRouter, findAllRoutes, routeNodeKeys } from "rou3";
const HTTP_METHODS = /* @__PURE__ */ new Set([
	"GET",
	"HEAD",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"OPTIONS",
	"CONNECT",
	"TRACE",
	"QUERY"
]);
const METHOD_KEY_RE = /^([A-Za-z]+)\s+(\/.*)$/;
function parseRouteKey(key) {
	const match = METHOD_KEY_RE.exec(key);
	if (match) {
		const method = match[1].toUpperCase();
		if (HTTP_METHODS.has(method)) return {
			method,
			path: withLeadingSlash(match[2])
		};
	}
	return {
		method: "",
		path: withLeadingSlash(key)
	};
}
function unknownMethodPrefix(key) {
	const match = METHOD_KEY_RE.exec(key);
	return match && !HTTP_METHODS.has(match[1].toUpperCase()) ? match[1] : void 0;
}
function formatRouteKey(method, path) {
	return method ? `${method} ${path}` : path;
}
const ESCAPE_RUN_RE = /(?:%[\da-f]{2})+/gi;
const UNSAFE_DECODED_RE = /[/\\:*()%]/;
function decodeRoutePattern(path) {
	if (!path.includes("%")) return path;
	path = canonicalPathname(path);
	return path.replace(ESCAPE_RUN_RE, (run) => {
		let decoded;
		try {
			decoded = decodeURIComponent(run);
		} catch {
			return run;
		}
		return UNSAFE_DECODED_RE.test(decoded) ? run : decoded;
	});
}
function mergeMatchedRouteRules(rawLayers, altLayers, canOverride) {
	const resets = /* @__PURE__ */ new Set();
	const routeRules = resolveLayers(rawLayers, resets);
	for (const layers of altLayers || []) unionLayers(routeRules, layers, canOverride, resets);
	return routeRules;
}
function unionLayers(routeRules, layers, canOverride, resets) {
	if (!layers?.length) return;
	const resolved = resolveLayers(layers, resets);
	for (const [name, rule] of Object.entries(resolved)) {
		const current = routeRules[name];
		if (current) {
			if (canOverride && !canOverride(current.route, rule.route)) continue;
		} else if (resets?.has(name) && !rule.handler?.restricting) continue;
		mergeRouteRule(routeRules, name, rule, rule.params);
	}
}
function resolveLayers(layers, resets) {
	const firstData = layers?.[0]?.data;
	if (firstData && !Array.isArray(firstData)) return resolvePreMergedLayers(layers, resets);
	const routeRules = emptyRouteRules();
	for (const layer of orderedLayers(layers)) for (const entry of layer.data) {
		if (entry.options === false) resets?.add(entry.name);
		mergeRouteRule(routeRules, entry.name, entry, layer.params);
	}
	return routeRules;
}
function isMergeableObject(value) {
	return value !== null && typeof value === "object";
}
function emptyRouteRules() {
	return Object.create(null);
}
function mergeRuleOptions(current, incoming) {
	return isMergeableObject(current) && isMergeableObject(incoming) ? {
		...current,
		...incoming
	} : incoming;
}
function orderedLayers(layers) {
	if (!layers || layers.length < 2) return layers || [];
	let ordered = layers;
	for (let i = 1; i < ordered.length; i++) {
		const layer = ordered[i];
		const rank = layerRank(layer);
		let j = i - 1;
		while (j >= 0 && layerRank(ordered[j]) > rank) {
			if (ordered === layers) ordered = [...layers];
			ordered[j + 1] = ordered[j];
			j--;
		}
		if (j + 1 !== i) ordered[j + 1] = layer;
	}
	return ordered;
}
function layerRank(layer) {
	return layer.data[0]?.rank ?? 0;
}
function resolvePreMergedLayers(rawLayers, resets) {
	const layers = rawLayers.length < 2 ? rawLayers : [...rawLayers].sort((a, b) => a.data.rank - b.data.rank);
	const routeRules = emptyRouteRules();
	const winning = layers[layers.length - 1].data;
	if (resets && winning.resets) for (const name of winning.resets) resets.add(name);
	for (const entry of winning.rules) {
		const paramRoutes = entry.paramRoutes;
		let params;
		for (const layer of layers) {
			const layerParams = layer.params;
			if (!layerParams) continue;
			const layerRoute = layer.data.route;
			if (paramRoutes ? paramRoutes.includes(layerRoute) : layerRoute === entry.route) params = params ? {
				...params,
				...layerParams
			} : layerParams;
		}
		routeRules[entry.name] = {
			route: entry.route,
			options: entry.options,
			handler: entry.handler,
			params
		};
	}
	return routeRules;
}
function mergeRouteRule(routeRules, ruleName, rule, params) {
	const name = ruleName;
	const currentRule = routeRules[name];
	if (currentRule) {
		if (rule.options === false) {
			delete routeRules[name];
			return;
		}
		currentRule.options = mergeRuleOptions(currentRule.options, rule.options);
		currentRule.route = rule.route;
		if (currentRule.params || params) currentRule.params = {
			...currentRule.params,
			...params
		};
	} else if (rule.options !== false) routeRules[name] = {
		route: rule.route,
		options: rule.options,
		handler: rule.handler,
		params
	};
}
function sharedNodeMethods(byPath) {
	const parents = /* @__PURE__ */ new Map();
	const find = (key) => {
		let root = key;
		while (parents.get(root) !== root) root = parents.get(root);
		return root;
	};
	const keysByPath = /* @__PURE__ */ new Map();
	for (const path of byPath.keys()) {
		const keys = nodeKeys(path);
		keysByPath.set(path, keys);
		for (const key of keys) if (!parents.has(key)) parents.set(key, key);
		for (const key of keys) {
			const [a, b] = [find(keys[0]), find(key)];
			if (a !== b) parents.set(b, a);
		}
	}
	const groupMethods = /* @__PURE__ */ new Map();
	for (const [path, methods] of byPath) for (const method of methods.keys()) {
		if (!method) continue;
		const root = find(keysByPath.get(path)[0]);
		let scoped = groupMethods.get(root);
		if (!scoped) groupMethods.set(root, scoped = /* @__PURE__ */ new Set());
		scoped.add(method);
	}
	if (groupMethods.size === 0) return /* @__PURE__ */ new Map();
	const byPathMethods = /* @__PURE__ */ new Map();
	for (const [path, keys] of keysByPath) {
		const scoped = groupMethods.get(find(keys[0]));
		if (scoped?.size) byPathMethods.set(path, scoped);
	}
	return byPathMethods;
}
function nodeKeys(path) {
	let keys;
	try {
		keys = routeNodeKeys(path);
	} catch (error) {
		throw new Error(`[h3] rules: invalid route pattern \`${path}\`: ${error.message}`, { cause: error });
	}
	return keys.length > 0 ? keys : [path];
}
function routeContainmentRanks(paths) {
	const ranks = new Map(paths.map((path) => [path, 0]));
	for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
		const [a, b] = [paths[i], paths[j]];
		let rel;
		try {
			rel = compareRoutes(a, b);
		} catch {
			continue;
		}
		if (rel === "superset") ranks.set(b, ranks.get(b) + 1);
		else if (rel === "subset") ranks.set(a, ranks.get(a) + 1);
	}
	return ranks;
}
function preMergeRuleLayers(byPath) {
	const paths = [...byPath.keys()];
	const subsumers = new Map(paths.map((path) => [path, []]));
	for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
		const [a, b] = [paths[i], paths[j]];
		switch (compareRoutes(a, b)) {
			case "disjoint": break;
			case "equal": throw new Error(`[h3] rules: preMerge: \`${a}\` and \`${b}\` match the same paths — merge them into one rule`);
			case "superset":
				subsumers.get(b).push(a);
				break;
			case "subset":
				subsumers.get(a).push(b);
				break;
			case "partial": throw new Error(`[h3] rules: preMerge: \`${a}\` and \`${b}\` partially overlap — the most specific match is ambiguous. Split the overlap into explicit rules or disable preMerge.`);
		}
	}
	const methodsUsed = /* @__PURE__ */ new Set();
	for (const methods of byPath.values()) for (const method of methods.keys()) if (method) methodsUsed.add(method);
	const result = /* @__PURE__ */ new Map();
	for (const path of paths) {
		const chainSubsumers = subsumers.get(path);
		const chain = [...chainSubsumers].sort((a, b) => subsumers.get(a).length - subsumers.get(b).length).concat(path);
		const registrations = /* @__PURE__ */ new Map();
		for (const method of ["", ...methodsUsed]) {
			if (method && !chain.some((route) => byPath.get(route).has(method))) continue;
			const merged = /* @__PURE__ */ new Map();
			const resets = /* @__PURE__ */ new Set();
			for (const route of chain) {
				const methods = byPath.get(route);
				const agnostic = methods.get("") || [];
				const scoped = method && methods.get(method) || [];
				for (const entry of [...agnostic, ...scoped]) mergeChainRule(merged, entry, resets);
			}
			registrations.set(method, {
				route: path,
				rank: chainSubsumers.length,
				rules: [...merged.values()].map(({ paramRoutes, ...rule }) => paramRoutes.length === 1 && paramRoutes[0] === rule.route ? rule : {
					...rule,
					paramRoutes
				}),
				...resets.size > 0 && { resets: [...resets].filter((name) => !merged.has(name)) }
			});
		}
		result.set(path, registrations);
	}
	return result;
}
function mergeChainRule(merged, entry, resets) {
	if (entry.options === false) resets.add(entry.name);
	const current = merged.get(entry.name);
	if (current) {
		if (entry.options === false) {
			merged.delete(entry.name);
			return;
		}
		current.options = mergeRuleOptions(current.options, entry.options);
		current.route = entry.route;
		if (!current.paramRoutes.includes(entry.route)) current.paramRoutes.push(entry.route);
	} else if (entry.options !== false) merged.set(entry.name, {
		...entry,
		paramRoutes: [entry.route]
	});
}
let warnedCredentialsWildcard = false;
function safeCorsOptions(options) {
	const { origin, credentials } = options;
	if (credentials === true && (!origin || origin === "*")) {
		if (!warnedCredentialsWildcard) {
			warnedCredentialsWildcard = true;
			console.warn("[h3] rules: `cors` rule resolved to `credentials: true` with a wildcard origin after merge — dropping `credentials` (an `Access-Control-Allow-Origin: *` + credentials response is rejected by browsers). Set an explicit `origin` allowlist on the more specific rule.");
		}
		return {
			...options,
			credentials: false
		};
	}
	return options;
}
const cors = {
	order: -3,
	handler: (m) => function corsRouteRule(event, next) {
		const preflight = handleCors(event, safeCorsOptions(m.options || {}));
		return preflight === false ? next() : preflight;
	}
};
const headers = {
	order: -1,
	handler: (m) => {
		const entries = Object.entries(m.options || {});
		return async function headersRouteRule(event, next) {
			try {
				return await next();
			} finally {
				for (const [key, value] of entries) {
					event.res.headers.set(key, value);
					event.res.errHeaders.set(key, value);
				}
			}
		};
	}
};
const redirect = {
	order: 1,
	handler: (m) => {
		const options = m.options;
		const resolveTarget = prepareRuleTarget(options);
		if (!resolveTarget) return function redirectRouteRule() {};
		return function redirectRouteRule(event) {
			return redirect$1(resolveTarget(event), options?.status);
		};
	}
};
const ruleHandlers = {
	headers,
	redirect,
	cors
};
function createRulesRouter(rules, handlers, baseURL, preMerge) {
	let base = baseURL || "";
	if (base.endsWith("/")) base = base.slice(0, -1);
	const byPath = /* @__PURE__ */ new Map();
	for (const [key, rule] of Object.entries(rules)) {
		const { method, path } = parseRouteKey(key);
		const entries = [];
		for (const [name, options] of Object.entries(rule)) {
			if (options === void 0) continue;
			entries.push({
				name,
				route: path,
				options: base ? withScopeBase(name, options, base) : options,
				handler: Object.hasOwn(handlers, name) ? handlers[name] : void 0
			});
		}
		let methods = byPath.get(path);
		if (!methods) byPath.set(path, methods = /* @__PURE__ */ new Map());
		methods.set(method, [...methods.get(method) || [], ...entries]);
	}
	for (const methods of byPath.values()) {
		const get = methods.get("GET");
		if (get) methods.set("HEAD", [...get, ...methods.get("HEAD") || []]);
	}
	const router = createRouter();
	if (preMerge) {
		for (const [path, methods] of preMergeRuleLayers(byPath)) for (const [method, data] of methods) addRoute(router, method, base + path, data);
		return router;
	}
	for (const [path, rank] of routeContainmentRanks([...byPath.keys()])) {
		if (rank === 0) continue;
		for (const entries of byPath.get(path).values()) for (const entry of entries) entry.rank = rank;
	}
	const sharedMethods = sharedNodeMethods(byPath);
	for (const [path, methods] of byPath) {
		const agnostic = methods.get("");
		if (!agnostic) continue;
		addRoute(router, "", base + path, agnostic);
		for (const method of sharedMethods.get(path) || []) addRoute(router, method, base + path, agnostic);
	}
	for (const [path, methods] of byPath) for (const [method, entries] of methods) if (method) addRoute(router, method, base + path, entries);
	return router;
}
function createRouteRulesMatcher(rules, opts) {
	const handlers = {
		...ruleHandlers,
		...opts?.handlers
	};
	requireOptInHandler(rules, handlers, "cache", "cache`/`swr", "Install `ocache` and pass `handlers: { cache }` from \"h3/rules/cache\", provide your own via `createCacheRuleHandler`, or pass `handlers: { cache: undefined }` to keep the rule data-only.");
	requireOptInHandler(rules, handlers, "proxy", "proxy", "Pass `handlers: { proxy }` from \"h3/rules/proxy\", or `handlers: { proxy: undefined }` to keep the rule data-only.");
	const router = createRulesRouter(rules, handlers, opts?.baseURL, opts?.preMerge);
	const findRouteRules = (method, pathname) => findAllRoutes(router, method, pathname);
	return createMatcherFromFind(findRouteRules, canOverrideRoute);
}
const canOverrideRoute = (currentRoute, incomingRoute) => {
	if (currentRoute === incomingRoute) return true;
	const rel = compareRoutes(currentRoute, incomingRoute);
	return rel === "superset" || rel === "equal";
};
const OPAQUE_SEGMENT_RE = /[()\\]/;
const CONCRETE_SEGMENT_RE = /^[^:*(){}\\]+$/;
const ZERO_MATCHABLE_SEGMENT_RE = /^:.*[?*]$/;
const canOverrideRouteShape = (currentRoute, incomingRoute) => {
	if (currentRoute === incomingRoute) return true;
	const current = currentRoute.split("/");
	const incoming = incomingRoute.split("/");
	for (let i = 0; i < current.length; i++) {
		const cur = current[i];
		if (cur === "**") return i === current.length - 1 && incoming.length > i && !incoming.slice(i).some((segment) => ZERO_MATCHABLE_SEGMENT_RE.test(segment));
		const inc = incoming[i];
		if (inc === void 0) return false;
		if (cur === inc) continue;
		if ((cur === "*" || cur.startsWith(":") && !OPAQUE_SEGMENT_RE.test(cur)) && CONCRETE_SEGMENT_RE.test(inc)) continue;
		return false;
	}
	return current.length === incoming.length;
};
function createMatcherFromFind(findRouteRules, canOverride = canOverrideRouteShape) {
	return (method, pathname) => {
		const rawLayers = findRouteRules(method, pathname);
		let altLayers;
		let hasAltMatch = false;
		const readings = alternateReadings(pathname);
		if (readings) {
			altLayers = [];
			for (const reading of readings) {
				const layers = findRouteRules(method, reading);
				if (layers?.length) hasAltMatch = true;
				altLayers.push(layers);
			}
		}
		if (!rawLayers?.length && !hasAltMatch) return {
			routeRules: {},
			matchedRules: {},
			routeRuleMiddleware: []
		};
		const matchedRules = mergeMatchedRouteRules(rawLayers, altLayers, canOverride);
		return {
			routeRules: toRouteRules(matchedRules),
			matchedRules,
			routeRuleMiddleware: buildRouteRuleMiddleware(matchedRules)
		};
	};
}
function toRouteRules(matchedRules) {
	const routeRules = Object.create(null);
	for (const name in matchedRules) routeRules[name] = matchedRules[name].options;
	return routeRules;
}
function buildRouteRuleMiddleware(matchedRules) {
	const routeRuleMiddleware = [];
	const rules = Object.entries(matchedRules);
	if (rules.length > 1) rules.sort(compareRuleOrder);
	for (const [, rule] of rules) {
		if (!rule.handler) continue;
		routeRuleMiddleware.push(rule.handler.handler(rule));
	}
	return routeRuleMiddleware;
}
function memoizeRouteRulesMatcher(matcher, opts) {
	const max = opts?.max ?? 1024;
	if (max <= 0) return matcher;
	const memo = /* @__PURE__ */ new Map();
	let hand;
	const evict = () => {
		for (;;) {
			let next = hand?.next();
			if (!next || next.done) {
				hand = memo.values();
				next = hand.next();
				if (next.done) return;
			}
			const entry = next.value;
			if (entry.visited) entry.visited = false;
			else {
				memo.delete(entry.key);
				return;
			}
		}
	};
	return (method, pathname) => {
		const key = method + " " + pathname;
		const entry = memo.get(key);
		if (entry) {
			entry.visited = true;
			return entry.result;
		}
		const result = matcher(method, pathname);
		if (memo.size >= max) evict();
		memo.set(key, {
			key,
			result,
			visited: false
		});
		return result;
	};
}
function alternateReadings(pathname) {
	const decoded = decodedPath(pathname);
	if (decoded === pathname && !needsCanonicalPasses(pathname)) return;
	const readings = [];
	for (const spelling of decoded === pathname ? [pathname] : [pathname, decoded]) {
		if (!needsCanonicalPasses(spelling)) {
			pushReading(readings, pathname, spelling);
			continue;
		}
		const canonical = canonicalPath(spelling);
		pushReading(readings, pathname, canonical);
		const merged = mergedCanonicalPath(spelling, canonical);
		if (merged !== void 0) pushReading(readings, pathname, merged);
	}
	return readings.length > 0 ? readings : void 0;
}
function pushReading(readings, pathname, reading) {
	if (reading !== pathname && !readings.includes(reading)) readings.push(reading);
}
function requireOptInHandler(rules, handlers, name, label, hint) {
	if (name in handlers) return;
	for (const key in rules) if (rules[key][name]) throw new Error(`[h3] rules: rules use \`${label}\` (\`${key}\`) but no \`${name}\` handler is registered. ${hint}`);
}
const compareRuleOrder = (a, b) => orderWeight(a[1].handler) - orderWeight(b[1].handler) || (a[0] < b[0] ? -1 : 1);
function orderWeight(handler) {
	return handler?.order ?? 0;
}
function withScopeBase(name, options, baseURL) {
	if ((name === "redirect" || name === "proxy") && options !== null && typeof options === "object" && typeof options.base === "string") return {
		...options,
		base: baseURL + options.base
	};
	return options;
}
function normalizeRouteRules(config) {
	const normalizedRules = {};
	for (const key in config) {
		const routeConfig = config[key];
		const unknownMethod = unknownMethodPrefix(key);
		if (unknownMethod !== void 0) throw new Error(`[h3] rules: \`${key}\` looks method-scoped but \`${unknownMethod}\` is not a recognized HTTP method — as a literal path this rule can never match. Use one of ${[...HTTP_METHODS].join(", ")}, remove the prefix for an all-methods rule, or add a leading \`/\` for a literal path`);
		const { method, path: rawPath } = parseRouteKey(key);
		const path = decodeRoutePattern(rawPath);
		const canonicalKey = formatRouteKey(method, path);
		validateBuiltinRules(routeConfig, canonicalKey);
		const { redirect, proxy, cors, swr, cache, ...rest } = routeConfig;
		const routeRules = rest;
		if (redirect) {
			const redirectOptions = {
				to: "/",
				status: 307,
				...typeof redirect === "string" ? { to: redirect } : redirect
			};
			if (path.endsWith("/**")) redirectOptions.base = path.slice(0, -3);
			assertNoHostSplat(redirectOptions.to, "redirect", canonicalKey);
			routeRules.redirect = redirectOptions;
		}
		if (proxy) {
			const proxyOptions = typeof proxy === "string" ? { to: proxy } : { ...proxy };
			if (path.endsWith("/**")) proxyOptions.base = path.slice(0, -3);
			assertNoHostSplat(proxyOptions.to, "proxy", canonicalKey);
			routeRules.proxy = proxyOptions;
		}
		if (cors !== void 0 && cors !== false) {
			const corsOptions = cors === true ? {} : { ...cors };
			if (corsOptions.credentials === true && (!corsOptions.origin || corsOptions.origin === "*" || Array.isArray(corsOptions.origin) && corsOptions.origin.includes("*"))) throw new Error(`[h3] rules: \`cors\` rule for \`${canonicalKey}\` sets \`credentials: true\` with a wildcard origin — \`Access-Control-Allow-Origin: *\` is invalid for credentialed requests; set an explicit \`origin\` allowlist (or validation function)`);
			routeRules.cors = corsOptions;
		}
		if (swr !== void 0 && swr !== false) {
			const cacheOptions = { ...cache || void 0 };
			cacheOptions.swr = true;
			if (typeof swr === "number") cacheOptions.maxAge = swr;
			routeRules.cache = cacheOptions;
		} else if (swr === false && cache === void 0) routeRules.cache = false;
		else if (cache !== void 0 && cache !== false) routeRules.cache = cache;
		if (cache === false) routeRules.cache = false;
		if (redirect === false) routeRules.redirect = false;
		if (proxy === false) routeRules.proxy = false;
		if (cors === false) routeRules.cors = false;
		for (const name in routeRules) {
			if (name === "__proto__" || name === "constructor" || name === "prototype") throw new Error(`[h3] rules: \`${name}\` is a reserved name and cannot be used as a rule for \`${canonicalKey}\``);
			if (Array.isArray(routeRules[name])) throw new Error(`[h3] rules: \`${name}\` rule for \`${canonicalKey}\` is an array — rule options cannot be top-level arrays (ambiguous merge semantics); wrap it in an object`);
		}
		const existing = normalizedRules[canonicalKey];
		if (existing) for (const [name, options] of Object.entries(routeRules)) existing[name] = mergeRuleOptions(existing[name], options);
		else normalizedRules[canonicalKey] = routeRules;
	}
	return normalizedRules;
}
function assertNoHostSplat(to, name, canonicalKey) {
	if (isHostPositionSplat(to)) throw new Error(`[h3] rules: \`${name}\` rule for \`${canonicalKey}\` has \`**\` in the target host (\`${to}\`) — \`**\` interpolates the matched path tail and must come after the target's host, in its path, query, or fragment`);
}
const BUILTIN_RULE_NAMES = [
	"cache",
	"headers",
	"redirect",
	"proxy",
	"cors",
	"swr"
];
function validateBuiltinRules(routeConfig, canonicalKey) {
	for (const name of BUILTIN_RULE_NAMES) {
		const value = routeConfig[name];
		if (value || value === void 0 || value === false) continue;
		if (name === "swr" && value === 0) continue;
		throw new Error(`[h3] rules: \`${name}\` rule for \`${canonicalKey}\` is \`${String(value)}\` — use \`false\` to disable a rule inherited from a less-specific pattern, or provide options`);
	}
}
export { HTTP_METHODS, buildRouteRuleMiddleware, cors, createMatcherFromFind, createRouteRulesMatcher, createRulesRouter, headers, memoizeRouteRulesMatcher, mergeMatchedRouteRules, normalizeRouteRules, parseRouteKey, redirect, ruleHandlers };
