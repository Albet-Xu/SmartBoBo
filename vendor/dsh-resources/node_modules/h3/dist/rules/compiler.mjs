import { createRulesRouter, normalizeRouteRules, parseRouteKey } from "../normalize.mjs";
import { compareRoutes } from "rou3";
import { compileRouterToString } from "rou3/compiler";
const DEFAULT_RUNTIME_RULES = Object.freeze({
	headers: "h3/rules",
	redirect: "h3/rules",
	proxy: "h3/rules/proxy",
	cache: "h3/rules/cache",
	cors: "h3/rules"
});
function resolveRuntimeRules(runtimeRules) {
	return runtimeRules ? {
		...DEFAULT_RUNTIME_RULES,
		...runtimeRules
	} : DEFAULT_RUNTIME_RULES;
}
function isRuntimeRule(name, runtimeRules) {
	return Object.hasOwn(runtimeRules, name);
}
function resolveRuntimeRule(name, runtimeRules) {
	const entry = runtimeRules[name];
	return typeof entry === "string" ? {
		source: entry,
		export: name
	} : {
		source: entry.source,
		export: entry.export ?? name
	};
}
function serializePreMergedRouteRules(data, ns, runtimeRules) {
	const resets = data.resets?.length ? `,resets:${JSON.stringify(data.resets)}` : "";
	return `{route:${JSON.stringify(data.route)},rank:${data.rank}${resets},rules:${serializeRouteRuleEntries(data.rules, ns, runtimeRules)}}`;
}
function serializeRouteRuleEntries(entries, ns, runtimeRules) {
	return `[${entries.map((entry) => {
		const runtime = isRuntimeRule(entry.name, runtimeRules);
		if (runtime) assertHandlerBinding(entry.name, "runtime rule name");
		assertSerializableOptions(entry.options, entry, "options");
		return [
			`name:${JSON.stringify(entry.name)}`,
			`route:${JSON.stringify(entry.route)}`,
			runtime && `handler:${ns}$${entry.name}`,
			`options:${JSON.stringify(entry.options)}`,
			entry.rank && `rank:${entry.rank}`,
			entry.paramRoutes && `paramRoutes:${JSON.stringify(entry.paramRoutes)}`
		].filter(Boolean).join(",");
	}).map((fields) => `{${fields}}`).join(",")}]`;
}
const DEFAULT_MATCHER_EXPORT_NAME = "matcher";
function compileMatcherExport(matcher, overridePredicate) {
	if (!matcher) return null;
	const spec = typeof matcher === "string" ? { name: matcher } : matcher === true ? {} : matcher;
	const name = spec.name || DEFAULT_MATCHER_EXPORT_NAME;
	assertHandlerBinding(name, "matcher export name");
	const { memoize } = spec;
	let expr = `createMatcherFromFind(findRouteRules, ${overridePredicate})`;
	if (memoize) {
		const max = memoize === true ? void 0 : memoize.max;
		expr = max === void 0 ? `memoizeRouteRulesMatcher(${expr})` : `memoizeRouteRulesMatcher(${expr}, { max: ${JSON.stringify(max)} })`;
	}
	return {
		imports: `import { createMatcherFromFind${memoize ? ", memoizeRouteRulesMatcher" : ""} } from "h3/rules";`,
		body: `export const ${name} = ${expr};\n`
	};
}
function compileOverridePredicate(routes) {
	const sorted = [...routes].sort();
	const allowed = /* @__PURE__ */ new Map();
	for (const current of sorted) for (const incoming of sorted) {
		if (current === incoming) continue;
		const rel = compareRoutes(current, incoming);
		if (rel === "superset" || rel === "equal") {
			let list = allowed.get(current);
			if (!list) allowed.set(current, list = []);
			list.push(incoming);
		}
	}
	if (allowed.size === 0) return "(a, b) => a === b";
	return `/* @__PURE__ */ (() => { const t = new Map([${[...allowed].map(([current, list]) => `[${JSON.stringify(current)}, new Set(${JSON.stringify(list)})]`).join(", ")}]); return (a, b) => a === b || (t.get(a)?.has(b) ?? false); })()`;
}
function assertHandlerBinding(name, what) {
	if (!JS_IDENTIFIER_RE.test(name)) throw new Error(`[h3] rules: compiler: ${what} \`${name}\` is not a valid JS identifier — it is used as a binding in generated code`);
}
const JS_IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
function assertSerializableOptions(value, entry, path) {
	if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return;
	if (Array.isArray(value)) {
		for (const [i, item] of value.entries()) assertSerializableOptions(item, entry, `${path}[${i}]`);
		return;
	}
	const proto = typeof value === "object" ? Object.getPrototypeOf(value) : void 0;
	if (proto === Object.prototype || proto === null) {
		for (const [key, item] of Object.entries(value)) {
			if (key === "__proto__") throw new Error(`[h3] rules: compiler: \`${entry.name}\` rule for \`${entry.route}\` has a \`__proto__\` key at \`${path}\` — it cannot be embedded as a JS object literal without changing the object's prototype (its JSON.stringify output would diverge from the runtime matcher); rename or remove it`);
			assertSerializableOptions(item, entry, `${path}.${key}`);
		}
		return;
	}
	const kind = typeof value === "object" ? value.constructor?.name || "object" : typeof value;
	throw new Error(`[h3] rules: compiler: \`${entry.name}\` rule for \`${entry.route}\` has a non-JSON-serializable value at \`${path}\` (${kind}) — compiled rule options must survive a JSON round-trip`);
}
function compileRouteRules(config, opts = {}) {
	const ctx = resolveCompileCtx(config, opts);
	const handlerImports = emitHandlersImport(ctx);
	const matcherExport = opts.matcher ? compileMatcherExport(opts.matcher, compileOverridePredicate(collectRoutes(ctx))) : null;
	const imports = [handlerImports, matcherExport?.imports].filter(Boolean).join("\n");
	const find = `export const findRouteRules = ${emitFindRouteRules(ctx)};\n`;
	const body = matcherExport ? find + matcherExport.body : find;
	const code = `${imports ? imports + "\n" : ""}${body}`;
	return {
		imports,
		body,
		code,
		toString: () => code
	};
}
function compileFindRouteRules(config, opts = {}) {
	return emitFindRouteRules(resolveCompileCtx(config, opts));
}
function compileHandlersImport(config, opts = {}) {
	return emitHandlersImport(resolveCompileCtx(config, opts));
}
function resolveCompileCtx(config, opts) {
	const rules = normalizeRouteRules(config);
	const ns = opts.handlersImportName || "__ruleHandlers__";
	assertHandlerBinding(ns, "handlersImportName");
	const ctx = {
		rules,
		preMerge: false,
		runtimeRules: resolveRuntimeRules(opts.runtimeRules),
		ns,
		baseURL: opts.baseURL
	};
	if (opts.preMerge) try {
		ctx.router = createRulesRouter(rules, {}, opts.baseURL, true);
		ctx.preMerge = true;
	} catch (error) {
		console.warn(`[h3] rules: compiler: preMerge could not be applied — falling back to plain compilation.\n  ${error.message}`);
	}
	return ctx;
}
function emitFindRouteRules(ctx) {
	const router = ctx.router ?? createRulesRouter(ctx.rules, {}, ctx.baseURL, ctx.preMerge);
	return compileRouterToString(router, void 0, {
		matchAll: true,
		serialize: (data) => Array.isArray(data) ? serializeRouteRuleEntries(data, ctx.ns, ctx.runtimeRules) : serializePreMergedRouteRules(data, ctx.ns, ctx.runtimeRules)
	});
}
function emitHandlersImport(ctx) {
	const names = usedRuleHandlerNames(ctx);
	if (names.length === 0) return "";
	const bySource = /* @__PURE__ */ new Map();
	for (const name of names) {
		assertHandlerBinding(name, "runtime rule name");
		const { source, export: exportName } = resolveRuntimeRule(name, ctx.runtimeRules);
		assertHandlerBinding(exportName, "runtime rule export");
		let specs = bySource.get(source);
		if (!specs) bySource.set(source, specs = []);
		specs.push(`${exportName} as ${ctx.ns}$${name}`);
	}
	return [...bySource.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([source, specs]) => `import { ${specs.join(", ")} } from ${JSON.stringify(source)};`).join("\n");
}
function collectRoutes(ctx) {
	const routes = /* @__PURE__ */ new Set();
	for (const key in ctx.rules) routes.add(parseRouteKey(key).path);
	return [...routes];
}
function usedRuleHandlerNames(ctx) {
	const used = /* @__PURE__ */ new Set();
	for (const key in ctx.rules) for (const [name, options] of Object.entries(ctx.rules[key])) if (options !== void 0 && (options !== false || !ctx.preMerge) && isRuntimeRule(name, ctx.runtimeRules)) used.add(name);
	return [...used].sort();
}
export { DEFAULT_RUNTIME_RULES, compileFindRouteRules, compileHandlersImport, compileRouteRules };
