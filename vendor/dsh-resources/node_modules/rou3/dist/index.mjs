const NullProtoObj = /* @__PURE__ */ (() => {
	const e = function() {};
	return e.prototype = Object.create(null), Object.freeze(e.prototype), e;
})();
function createRouter() {
	return {
		root: { key: "" },
		static: new NullProtoObj()
	};
}
function scanFirstGroup(path) {
	let i = 0;
	let depth = 0;
	for (; i < path.length; i++) {
		const c = path.charCodeAt(i);
		if (c === 92) i++;
		else if (c === 40) depth++;
		else if (c === 41 && depth > 0) depth--;
		else if (c === 123 && depth === 0) break;
	}
	if (i >= path.length) return;
	let j = i + 1;
	depth = 0;
	for (; j < path.length; j++) {
		const c = path.charCodeAt(j);
		if (c === 92) j++;
		else if (c === 40) depth++;
		else if (c === 41 && depth > 0) depth--;
		else if (c === 125 && depth === 0) break;
	}
	if (j >= path.length) return;
	const mod = path[j + 1];
	const hasMod = mod === "?" || mod === "+" || mod === "*";
	return [
		path.slice(0, i),
		path.slice(i + 1, j),
		path.slice(j + (hasMod ? 2 : 1)),
		hasMod ? mod : void 0
	];
}
function expandGroupDelimiters(path) {
	if (!path.includes("{")) return;
	const group = scanFirstGroup(path);
	if (!group) return;
	const [pre, body, suf, mod] = group;
	if (!mod) return [pre + body + suf];
	if (mod === "?") return [pre + body + suf, pre + suf];
	if (body.includes("/")) throw new Error("unsupported group repetition across segments");
	return [`${pre}(?:${body})${mod}${suf}`];
}
const UNNAMED_GROUP_PREFIX = "__rou3_unnamed_";
const ESCAPED_GROUP_PREFIX = "__rou3_esc_";
function toUnnamedGroupKey(index) {
	return `${UNNAMED_GROUP_PREFIX}${index}`;
}
function toGroupName(name) {
	return /^(?!__rou3_|_\d)[A-Za-z_]\w*$/.test(name) ? name : ESCAPED_GROUP_PREFIX + name.replace(/[_-]/g, (c) => c === "_" ? "__" : "_h");
}
function fromGroupName(key) {
	if (key.charCodeAt(0) !== 95) return key;
	if (key.startsWith("__rou3_esc_")) return key.slice(11).replace(/__|_h/g, (c) => c === "__" ? "_" : "-");
	return key.startsWith("__rou3_unnamed_") ? key.slice(15) : key;
}
function hasSegmentWildcard(segment) {
	let depth = 0;
	for (let i = 0; i < segment.length; i++) {
		const ch = segment.charCodeAt(i);
		if (ch === 92) {
			i++;
			continue;
		}
		if (ch === 40) {
			depth++;
			continue;
		}
		if (ch === 41 && depth > 0) {
			depth--;
			continue;
		}
		if (ch === 42 && depth === 0) return true;
	}
	return false;
}
function replaceSegmentWildcards(segment, unnamedStart, toGroupKey = toUnnamedGroupKey) {
	let depth = 0;
	let nextIndex = unnamedStart;
	let replaced = "";
	for (let i = 0; i < segment.length; i++) {
		const ch = segment.charCodeAt(i);
		if (ch === 92) {
			replaced += segment[i];
			if (i + 1 < segment.length) replaced += segment[++i];
			continue;
		}
		if (ch === 40) {
			depth++;
			replaced += segment[i];
			continue;
		}
		if (ch === 41 && depth > 0) {
			depth--;
			replaced += segment[i];
			continue;
		}
		if (ch === 42 && depth === 0) {
			replaced += `(?<${toGroupKey(nextIndex++)}>[^/]*)`;
			continue;
		}
		replaced += segment[i];
	}
	return [replaced, nextIndex];
}
function encodeEscapes(path) {
	if (!path.includes("\\")) return path;
	return path.replace(/\\([:(){}])/g, (_, c) => "�" + "ABCDE"[":(){}".indexOf(c)]);
}
function segmentKey(segment) {
	if (segment.startsWith("**")) return 2;
	if (segment === "*" || segment.includes(":") || segment.includes("(") || hasSegmentWildcard(segment)) return 1;
	if (segment === "\\*") return "*";
	if (segment === "\\*\\*") return "**";
	if (!segment.includes("�")) return segment;
	return segment.replace(/\uFFFD([A-E])/g, (_, c) => c === "A" ? ":" : c === "B" ? "(" : c === "C" ? ")" : c === "D" ? "{" : "}");
}
function expandModifiers(segments) {
	for (let i = 0; i < segments.length; i++) {
		const last = segments[i].charCodeAt(segments[i].length - 1);
		if (last !== 63 && last !== 43 && last !== 42) continue;
		const m = segments[i].match(/^(.*:[\w-]+(?:\([^)]*\))?)([?+*])$/);
		if (!m) continue;
		const pre = segments.slice(0, i);
		const suf = segments.slice(i + 1);
		if (m[2] === "?") return ["/" + pre.concat(m[1]).concat(suf).join("/"), "/" + pre.concat(suf).join("/")];
		const name = m[1].match(/:([\w-]+)/)?.[1] || "_";
		const wc = "/" + [
			...pre,
			`**:${name}`,
			...suf
		].join("/");
		const without = "/" + [...pre, ...suf].join("/");
		return m[2] === "+" ? [wc] : [wc, without];
	}
}
function normalizePath(path) {
	if (!path.includes("/.")) return path;
	const r = [];
	for (const s of path.split("/")) if (s === ".") continue;
	else if (s === ".." && r.length > 1) r.pop();
	else r.push(s);
	return r.join("/") || "/";
}
function splitPath(path) {
	const s = path.split("/");
	s.shift();
	if (s[s.length - 1] === "") s.pop();
	return s;
}
function splitRoute(path) {
	const s = splitPath(path);
	while (s[s.length - 1] === "") s.pop();
	return s;
}
function getMatchParams(segments, paramsMap) {
	const params = new NullProtoObj();
	for (const [index, name] of paramsMap) {
		const segment = index < 0 ? segments.slice(-(index + 1)).join("/") : segments[index];
		if (typeof name === "string") params[name] = segment;
		else {
			const match = segment.match(name);
			if (match) for (const key in match.groups) params[fromGroupName(key)] = match.groups[key];
		}
	}
	return params;
}
function addRoute(ctx, method = "", path, data) {
	method = method.toUpperCase();
	if (path.charCodeAt(0) !== 47) path = `/${path}`;
	const groupExpanded = expandGroupDelimiters(path);
	if (groupExpanded) {
		for (const expandedPath of groupExpanded) addRoute(ctx, method, expandedPath, data);
		return;
	}
	path = encodeEscapes(path);
	const segments = splitRoute(path);
	const expanded = expandModifiers(segments);
	if (expanded) {
		for (const p of expanded) addRoute(ctx, method, p, data);
		return;
	}
	let node = ctx.root;
	let _unnamedParamIndex = 0;
	const paramsMap = [];
	const paramsRegexp = [];
	for (let i = 0; i < segments.length; i++) {
		let segment = segments[i];
		const key = segmentKey(segment);
		if (key === 2) {
			if (!node.wildcard) node.wildcard = { key: "**" };
			node = node.wildcard;
			paramsMap.push([
				-(i + 1),
				segment.split(":")[1] || "_",
				segment.length === 2
			]);
			break;
		}
		if (key === 1) {
			if (!node.param) node.param = { key: "*" };
			node = node.param;
			if (segment === "*") paramsMap.push([
				i,
				String(_unnamedParamIndex++),
				true
			]);
			else if (segment.includes("(") || segment.includes(":", 1) || !/^:[\w-]+$/.test(segment)) {
				const [regexp, nextIndex] = getParamRegexp(segment, _unnamedParamIndex);
				_unnamedParamIndex = nextIndex;
				paramsRegexp[i] = regexp;
				node.hasRegexParam = true;
				paramsMap.push([
					i,
					regexp,
					false
				]);
			} else paramsMap.push([
				i,
				segment.slice(1),
				false
			]);
			continue;
		}
		segment = segments[i] = key;
		const child = node.static?.[segment];
		if (child) node = child;
		else {
			const staticNode = { key: segment };
			if (!node.static) node.static = new NullProtoObj();
			node.static[segment] = staticNode;
			node = staticNode;
		}
	}
	const hasParams = paramsMap.length > 0;
	const methods = node.methods ??= new NullProtoObj();
	(methods[method] ??= []).push({
		data: data || null,
		paramsRegexp,
		paramsMap: hasParams ? paramsMap : void 0
	});
	if (!hasParams) ctx.static["/" + segments.join("/")] = node;
}
function getParamRegexp(segment, unnamedStart = 0) {
	let _i = unnamedStart;
	let _s = "", _d = 0;
	for (let j = 0; j < segment.length; j++) {
		const c = segment.charCodeAt(j);
		if (c === 40) _d++;
		else if (c === 41 && _d > 0) _d--;
		else if (c === 92 && _d === 0 && j + 1 < segment.length) {
			const n = segment[j + 1];
			if (n !== ":" && n !== "(" && n !== "*" && n !== "\\") {
				_s += "￾" + n;
				j++;
				continue;
			}
		} else if (c === 46 && _d === 0) {
			_s += "\\.";
			continue;
		}
		_s += segment[j];
	}
	[_s, _i] = replaceSegmentWildcards(_s, _i);
	const regex = _s.replace(/:([\w-]+)(?:\(([^)]*)\))?/g, (_, id, p) => `(?<${toGroupName(id)}>${p || "[^/]+"})`).replace(/\((?![?<])/g, () => `(?<${toUnnamedGroupKey(_i++)}>`).replace(/\uFFFE(.)/g, (_, c) => /[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c);
	return [new RegExp(`^${regex}$`), _i];
}
function findRoute(ctx, method = "", path, opts) {
	if (opts?.normalize) path = normalizePath(path);
	if (path.charCodeAt(path.length - 1) === 47) path = path.slice(0, -1);
	const staticNode = ctx.static[path];
	if (staticNode && staticNode.methods) {
		const staticMatch = staticNode.methods[method] || staticNode.methods[""];
		if (staticMatch !== void 0) return staticMatch[0];
	}
	const segments = splitPath(path);
	const match = _lookupTree(ctx.root, method, segments, 0);
	if (match === void 0) return;
	if (opts?.params === false) return match;
	return {
		data: match.data,
		params: match.paramsMap ? getMatchParams(segments, match.paramsMap) : void 0
	};
}
function _lookupTree(node, method, segments, index) {
	if (index === segments.length) {
		if (node.methods) {
			const match = _selectMatcher(node.methods, method, segments, node.key === "*", false);
			if (match) return match;
		}
		return node.param?.methods && _selectMatcher(node.param.methods, method, segments, true, true) || node.wildcard?.methods && _selectMatcher(node.wildcard.methods, method, segments, true, true) || void 0;
	}
	const segment = segments[index];
	if (node.static) {
		const staticChild = node.static[segment];
		if (staticChild) {
			const match = _lookupTree(staticChild, method, segments, index + 1);
			if (match) return match;
		}
	}
	if (node.param) {
		const match = _lookupTree(node.param, method, segments, index + 1);
		if (match) return match;
	}
	if (node.wildcard && node.wildcard.methods) return _selectMatcher(node.wildcard.methods, method, segments, true, false);
}
function _selectMatcher(methods, method, segments, dynamicTerminal, optionalOnly) {
	const match = methods[method] || methods[""];
	if (!match) return;
	const first = match[0];
	if (match.length === 1 && first.paramsRegexp.length === 0) {
		if (!optionalOnly) return first;
		const pMap = first.paramsMap;
		return pMap?.[pMap.length - 1]?.[2] ? first : void 0;
	}
	let best;
	let bestWeight = -1;
	for (const m of match) {
		const pMap = m.paramsMap;
		const lastOptional = pMap?.[pMap.length - 1]?.[2];
		if (optionalOnly && !lastOptional) continue;
		let weight = dynamicTerminal && pMap && !lastOptional ? 1 : 0;
		const regexps = m.paramsRegexp;
		for (let i = 0; i < regexps.length; i++) if (regexps[i]) {
			if (!regexps[i].test(segments[i])) {
				weight = -1;
				break;
			}
			weight++;
		}
		if (weight > bestWeight) {
			best = m;
			bestWeight = weight;
		}
	}
	return best;
}
function removeRoute(ctx, method = "", path) {
	method = method.toUpperCase();
	if (path.charCodeAt(0) !== 47) path = `/${path}`;
	const groupExpanded = expandGroupDelimiters(path);
	if (groupExpanded) {
		for (const expandedPath of groupExpanded) removeRoute(ctx, method, expandedPath);
		return;
	}
	path = encodeEscapes(path);
	const segments = splitRoute(path);
	const modExpanded = expandModifiers(segments);
	if (modExpanded) {
		for (const expandedPath of modExpanded) removeRoute(ctx, method, expandedPath);
		return;
	}
	_remove(ctx.root, method, segments, 0);
}
function _remove(node, method, segments, index) {
	if (index === segments.length) {
		if (node.methods && method in node.methods) {
			delete node.methods[method];
			if (Object.keys(node.methods).length === 0) node.methods = void 0;
		}
		return;
	}
	const segment = segments[index];
	const key = segmentKey(segment);
	if (key === 2) {
		if (node.wildcard) {
			_remove(node.wildcard, method, segments, segments.length);
			if (_isEmptyNode(node.wildcard)) node.wildcard = void 0;
		}
		return;
	}
	if (key === 1) {
		if (node.param) {
			_remove(node.param, method, segments, index + 1);
			if (_isEmptyNode(node.param)) node.param = void 0;
		}
		return;
	}
	const childNode = node.static?.[key];
	if (childNode) {
		_remove(childNode, method, segments, index + 1);
		if (_isEmptyNode(childNode)) {
			delete node.static[key];
			if (Object.keys(node.static).length === 0) node.static = void 0;
		}
	}
}
function _isEmptyNode(node) {
	return node.methods === void 0 && node.static === void 0 && node.param === void 0 && node.wildcard === void 0;
}
function findAllRoutes(ctx, method = "", path, opts) {
	if (opts?.normalize) path = normalizePath(path);
	if (path.charCodeAt(path.length - 1) === 47) path = path.slice(0, -1);
	const segments = splitPath(path);
	const matches = _findAll(ctx.root, method, segments, 0);
	if (opts?.params === false) return matches;
	return matches.map((m) => {
		return {
			data: m.data,
			params: m.paramsMap ? getMatchParams(segments, m.paramsMap) : void 0
		};
	});
}
function _findAll(node, method, segments, index, matches = []) {
	const segment = segments[index];
	if (node.wildcard && node.wildcard.methods) {
		const match = node.wildcard.methods[method] || node.wildcard.methods[""];
		if (match) if (index < segments.length) pushSorted(matches, match, true);
		else {
			const optional = [];
			for (const m of match) {
				const pMap = m.paramsMap;
				if (pMap?.[pMap.length - 1]?.[2]) optional.push(m);
			}
			pushSorted(matches, optional, true);
		}
	}
	if (node.param) {
		if (index < segments.length) {
			const start = matches.length;
			_findAll(node.param, method, segments, index + 1, matches);
			if (node.param.hasRegexParam) {
				for (let r = matches.length - 1; r >= start; r--) if (matches[r].paramsRegexp[index]?.test(segment) === false) matches.splice(r, 1);
			}
		} else if (node.param.methods) {
			const match = node.param.methods[method] || node.param.methods[""];
			if (match) {
				const optional = [];
				for (const m of match) {
					const pMap = m.paramsMap;
					if (pMap?.[pMap.length - 1]?.[2]) optional.push(m);
				}
				pushSorted(matches, optional, true);
			}
		}
	}
	if (index < segments.length) {
		const staticChild = node.static?.[segment];
		if (staticChild) _findAll(staticChild, method, segments, index + 1, matches);
	}
	if (index === segments.length && node.methods) {
		const match = node.methods[method] || node.methods[""];
		if (match) pushSorted(matches, match, node.key === "*");
	}
	return matches;
}
function pushSorted(matches, match, dynamicTerminal) {
	if (match.length > 1) match = match.map((m) => {
		let w = 0;
		const { paramsRegexp: rx, paramsMap: pm } = m;
		for (let i = 0; i < rx.length; i++) if (rx[i]) w++;
		if (dynamicTerminal && pm && !pm[pm.length - 1][2]) w++;
		return [m, w];
	}).sort((a, b) => a[1] - b[1]).map((e) => e[0]);
	for (const m of match) matches.push(m);
}
function shapeSubsumes(a, b) {
	const fa = a.fixed.length;
	const fb = b.fixed.length;
	if (fa + a.tailMin > fb + b.tailMin || fa + a.tailMax < fb + b.tailMax) return false;
	const common = fa < fb ? fa : fb;
	for (let k = 0; k < common; k++) if (!_segmentSubsumes(a.fixed[k], b.fixed[k])) return false;
	for (let k = fb; k < fa; k++) if (a.fixed[k] !== void 0) return false;
	return true;
}
function mergeShapes(shapes) {
	for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) {
		const a = shapes[i];
		const b = shapes[j];
		if (_sameFixed(a.fixed, b.fixed) && a.tailMin <= b.tailMax + 1 && b.tailMin <= a.tailMax + 1) {
			a.tailMin = Math.min(a.tailMin, b.tailMin);
			a.tailMax = Math.max(a.tailMax, b.tailMax);
			shapes.splice(j, 1);
			j = i;
		}
	}
	return shapes;
}
function _sameFixed(a, b) {
	if (a.length !== b.length) return false;
	for (let k = 0; k < a.length; k++) if (!_segmentEqual(a[k], b[k])) return false;
	return true;
}
function _segmentEqual(x, y) {
	return x === y || x instanceof RegExp && y instanceof RegExp && x.flags === y.flags && _regExpKey(x) === _regExpKey(y);
}
function _segmentSubsumes(x, y) {
	if (x === void 0) return true;
	if (typeof x === "string") return x === y;
	if (typeof y === "string") return x.test(y);
	return y instanceof RegExp && x.flags === y.flags && _regExpKey(x) === _regExpKey(y);
}
const _regExpKeys = /* @__PURE__ */ new WeakMap();
function _regExpKey(r) {
	let key = _regExpKeys.get(r);
	if (key === void 0) {
		const s = r.source;
		key = "";
		for (let i = 0; i < s.length; i++) {
			const c = s[i];
			if (c === "\\") key += c + s[++i];
			else if (c === "[") {
				let j = i + 1;
				while (j < s.length && s[j] !== "]") j += s[j] === "\\" ? 2 : 1;
				key += s.slice(i, j + 1);
				i = j;
			} else if (c === "(" && s[i + 1] === "?" && s[i + 2] === "<" && s[i + 3] !== "=" && s[i + 3] !== "!") {
				const end = s.indexOf(">", i + 3);
				key += "(";
				i = end === -1 ? i : end;
			} else key += c;
		}
		_regExpKeys.set(r, key);
	}
	return key;
}
function routeToShapes(pattern) {
	let shapes = _patternShapes.get(pattern);
	if (shapes === void 0) {
		const ctx = createRouter();
		addRoute(ctx, "", pattern);
		shapes = [];
		_collectShapes(ctx.root, [], shapes);
		shapes = mergeShapes(shapes);
		if (_patternShapes.size >= 1024) _patternShapes.clear();
		_patternShapes.set(pattern, shapes);
	}
	return shapes;
}
function shapeOf(edges, entry) {
	let shape = _shapeCache.get(entry);
	if (!shape) _shapeCache.set(entry, shape = _computeShape(edges, entry));
	return shape;
}
function shapesOverlap(a, b) {
	const fa = a.fixed.length;
	const fb = b.fixed.length;
	const common = fa < fb ? fa : fb;
	for (let k = 0; k < common; k++) if (!_segmentsCanOverlap(a.fixed[k], b.fixed[k])) return false;
	return Math.max(fa + a.tailMin, fb + b.tailMin) <= Math.min(fa + a.tailMax, fb + b.tailMax);
}
function mayMatchAt(query, depth, key) {
	for (const q of query) if (depth < q.fixed.length) {
		const m = q.fixed[depth];
		if (m === void 0 || (typeof m === "string" ? m === key : m.test(key))) return true;
	} else if (depth - q.fixed.length < q.tailMax) return true;
	return false;
}
const _shapeCache = /* @__PURE__ */ new WeakMap();
const _patternShapes = /* @__PURE__ */ new Map();
function _collectShapes(node, edges, shapes) {
	if (node.methods) for (const entry of node.methods[""] || []) shapes.push(_computeShape(edges, entry));
	if (node.static) for (const key in node.static) {
		edges.push(key);
		_collectShapes(node.static[key], edges, shapes);
		edges.pop();
	}
	if (node.param) {
		edges.push(0);
		_collectShapes(node.param, edges, shapes);
		edges.pop();
	}
	if (node.wildcard) {
		edges.push(1);
		_collectShapes(node.wildcard, edges, shapes);
		edges.pop();
	}
}
function _computeShape(edges, entry) {
	const fixed = [];
	let tailMin = 0;
	let tailMax = 0;
	const pMap = entry.paramsMap;
	for (let d = 0; d < edges.length; d++) {
		const edge = edges[d];
		if (typeof edge === "string") fixed.push(edge);
		else if (edge === 1) {
			tailMin = pMap[pMap.length - 1][2] ? 0 : 1;
			tailMax = Number.POSITIVE_INFINITY;
		} else if (pMap) {
			const p = pMap.find((e) => e[0] === d);
			if (p[1] instanceof RegExp) fixed.push(p[1]);
			else if (p[2] && d === edges.length - 1) tailMax = 1;
			else fixed.push(void 0);
		}
	}
	let f = fixed.length;
	while (f > 0 && fixed[f - 1] === void 0) f--;
	if (f < fixed.length) {
		tailMin += fixed.length - f;
		tailMax += fixed.length - f;
		fixed.length = f;
	}
	return {
		fixed,
		tailMin,
		tailMax
	};
}
function _segmentsCanOverlap(x, y) {
	if (typeof x === "string") return typeof y === "string" ? x === y : y instanceof RegExp ? y.test(x) : true;
	if (x instanceof RegExp && typeof y === "string") return x.test(y);
	return true;
}
function routesOverlap(patternA, patternB) {
	return _anyOverlap(routeToShapes(patternA), routeToShapes(patternB));
}
function compareRoutes(patternA, patternB) {
	const a = routeToShapes(patternA);
	const b = routeToShapes(patternB);
	const aCoversB = _covers(a, b);
	const bCoversA = _covers(b, a);
	if (aCoversB && bCoversA) return "equal";
	if (aCoversB) return "superset";
	if (bCoversA) return "subset";
	return _anyOverlap(a, b) ? "partial" : "disjoint";
}
function findOverlappingRoutes(ctx, method = "", pattern) {
	const query = routeToShapes(pattern);
	const matches = [];
	_collectOverlaps(ctx.root, method, query, [], /* @__PURE__ */ new Set(), matches);
	return matches;
}
function _anyOverlap(a, b) {
	for (const x of a) for (const y of b) if (shapesOverlap(x, y)) return true;
	return false;
}
function _covers(sup, sub) {
	return sub.every((s) => sup.some((x) => shapeSubsumes(x, s)));
}
function _collectOverlaps(node, method, query, edges, seen, matches) {
	if (node.wildcard) {
		edges.push(1);
		_collectOverlaps(node.wildcard, method, query, edges, seen, matches);
		edges.pop();
	}
	if (node.param) {
		edges.push(0);
		_collectOverlaps(node.param, method, query, edges, seen, matches);
		edges.pop();
	}
	if (node.static) {
		for (const key in node.static) if (mayMatchAt(query, edges.length, key)) {
			edges.push(key);
			_collectOverlaps(node.static[key], method, query, edges, seen, matches);
			edges.pop();
		}
	}
	if (node.methods) {
		const data = node.methods[method] || node.methods[""];
		if (data) for (const entry of data) {
			const d = entry.data;
			const isRef = d !== null && (typeof d === "object" || typeof d === "function");
			if (isRef && seen.has(d)) continue;
			const shape = shapeOf(edges, entry);
			if (query.some((q) => shapesOverlap(q, shape))) {
				if (isRef) seen.add(d);
				matches.push({ data: d });
			}
		}
	}
}
function routeNodeKeys(pattern) {
	let keys = _patternKeys.get(pattern);
	if (keys === void 0) {
		const ctx = createRouter();
		addRoute(ctx, "", pattern);
		keys = [];
		_collectKeys(ctx.root, "", keys);
		if (_patternKeys.size >= 1024) _patternKeys.clear();
		_patternKeys.set(pattern, keys);
	}
	return keys.slice();
}
const _patternKeys = /* @__PURE__ */ new Map();
function _collectKeys(node, prefix, keys) {
	if (node.methods) keys.push(prefix || "/");
	if (node.static) for (const key in node.static) _collectKeys(node.static[key], prefix + "/" + _escapeKey(key), keys);
	if (node.param) _collectKeys(node.param, prefix + "/*", keys);
	if (node.wildcard) _collectKeys(node.wildcard, prefix + "/**", keys);
}
function _escapeKey(key) {
	if (key === "*") return "\\*";
	if (key === "**") return "\\*\\*";
	return key.replace(/[:(){}]/g, "\\$&");
}
const _P = "￾";
function replaceEscapesOutsideGroups(segment) {
	let r = "", d = 0;
	for (let i = 0; i < segment.length; i++) {
		const c = segment.charCodeAt(i);
		if (c === 40) d++;
		else if (c === 41 && d > 0) d--;
		else if (c === 92 && d === 0 && i + 1 < segment.length) {
			const n = segment[i + 1];
			if (n !== ":" && n !== "(" && n !== "*" && n !== "\\") {
				r += _P + n;
				i++;
				continue;
			}
		}
		r += segment[i];
	}
	return r;
}
function resolveEscapePlaceholders(str) {
	return str.replace(/\uFFFE(.)/g, (_, c) => /[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c);
}
function escapeBareDots(str) {
	let r = "", d = 0;
	for (let i = 0; i < str.length; i++) {
		const c = str.charCodeAt(i);
		if (c === 92 || c === 65534) {
			r += str[i] + (str[i + 1] || "");
			i++;
		} else if (c === 40) {
			d++;
			r += str[i];
		} else if (c === 41) {
			if (d > 0) d--;
			r += str[i];
		} else if (c === 46 && d === 0) r += "\\.";
		else r += str[i];
	}
	return r;
}
function routeToRegExp(route = "/") {
	if (route.charCodeAt(0) !== 47) route = `/${route}`;
	const inlineOptional = inlineOptionalGroup(route);
	if (inlineOptional) return inlineOptional;
	const groupExpanded = expandGroupDelimiters(route);
	if (groupExpanded) {
		const sources = groupExpanded.map((expandedRoute) => routeToRegExp(expandedRoute).source.slice(1, -1));
		return new RegExp(`^(?:${sources.join("|")})$`);
	}
	return _routeToRegExp(route);
}
function inlineOptionalGroup(route) {
	const group = scanFirstGroup(route);
	if (!group) return;
	const [pre, body, suf, mod] = group;
	if (mod !== "?" || suf !== "" || body === "" || scanFirstGroup(pre) || scanFirstGroup(body)) return;
	const baseSegs = routeToRegExpSegments(pre);
	const fullSegs = routeToRegExpSegments(pre + body);
	const baseLen = baseSegs.length;
	if (baseLen === 0 || fullSegs.length < baseLen) return;
	const midSegment = fullSegs.length === baseLen;
	const sharedLen = midSegment ? baseLen - 1 : baseLen;
	for (let i = 0; i < sharedLen; i++) if (fullSegs[i] !== baseSegs[i]) return;
	if (midSegment) {
		const prefix = baseSegs[baseLen - 1];
		const last = fullSegs[baseLen - 1];
		if (!last.startsWith(prefix)) return;
		if (/(?:\[\^\/\]|\.)[*+]\)?$/.test(prefix)) return;
		const k = prefix.length;
		const inlineSegs = fullSegs.slice(0, baseLen - 1);
		inlineSegs.push(`${last.slice(0, k)}(?:${last.slice(k)})?`);
		return new RegExp(`^/${inlineSegs.join("/")}/?$`);
	}
	const head = fullSegs.slice(0, baseLen).join("/");
	const tail = fullSegs.slice(baseLen).join("/");
	return new RegExp(`^/${head}(?:/${tail})?/?$`);
}
function _routeToRegExp(route) {
	return new RegExp(`^/${routeToRegExpSegments(route).join("/")}/?$`);
}
function routeToRegExpSegments(route) {
	const reSegments = [];
	let idCtr = 0;
	for (const segment of splitRoute(route)) {
		if (!segment) {
			reSegments.push("");
			continue;
		}
		if (segment === "*") reSegments.push(`(?<${toRegExpUnnamedKey(idCtr++)}>[^/]*)`);
		else if (segment.startsWith("**")) reSegments.push(segment === "**" ? "?(?<_>.*)" : `?(?<${toGroupName(segment.slice(3))}>.+)`);
		else if (segment.includes(":") || /(^|[^\\])\(/.test(segment) || hasSegmentWildcard(segment)) {
			const modMatch = segment.match(/^(.*:[\w-]+(?:\([^)]*\))?)([?+*])$/);
			if (modMatch) {
				const [, base, mod] = modMatch;
				const name = toGroupName(base.match(/:([\w-]+)/)?.[1] || `_${idCtr++}`);
				if (mod === "?") {
					const inner = escapeBareDots(base.replace(/:([\w-]+)(?:\(([^)]*)\))?/g, (_, id, pattern) => `(?<${toGroupName(id)}>${pattern || "[^/]+"})`));
					if (reSegments.length > 0) {
						const prevQ = reSegments.pop();
						reSegments.push(`${prevQ}(?:/${inner})?`);
					} else reSegments.push(`?${inner}?`);
					continue;
				}
				const pattern = base.match(/:([\w-]+)(?:\(([^)]*)\))?/)?.[2];
				if (reSegments.length > 0) {
					const prevMod = reSegments.pop();
					if (pattern) {
						const repeated = `${pattern}(?:/${pattern})*`;
						reSegments.push(mod === "+" ? `${prevMod}/(?<${name}>${repeated})` : `${prevMod}(?:/(?<${name}>${repeated}))?`);
					} else reSegments.push(mod === "+" ? `${prevMod}/(?<${name}>.+)` : `${prevMod}(?:/(?<${name}>.*))?`);
				} else if (pattern) {
					const repeated = `${pattern}(?:/${pattern})*`;
					reSegments.push(mod === "+" ? `?(?<${name}>${repeated})` : `?(?<${name}>${repeated})?`);
				} else reSegments.push(mod === "+" ? `?(?<${name}>.+)` : `?(?<${name}>.*)`);
				continue;
			}
			let dynamicSegment = replaceEscapesOutsideGroups(segment);
			[dynamicSegment, idCtr] = replaceSegmentWildcards(dynamicSegment, idCtr, toRegExpUnnamedKey);
			reSegments.push(resolveEscapePlaceholders(escapeBareDots(dynamicSegment.replace(/:([\w-]+)(?:\(([^)]*)\))?/g, (_, id, pattern) => `(?<${toGroupName(id)}>${pattern || "[^/]+"})`).replace(/(^|[^\\])\((?![?<])/g, (_, p) => `${p}(?<${toRegExpUnnamedKey(idCtr++)}>`))));
		} else reSegments.push(segment.replace(/\\(.)/g, "$1").replace(/[.*+?^${}()|[\]]/g, "\\$&"));
	}
	return reSegments;
}
function toRegExpUnnamedKey(index) {
	return `_${index}`;
}
const ROUTE_SPECIAL = /* @__PURE__ */ new Set([
	":",
	"(",
	")",
	"{",
	"}",
	"*",
	"\\",
	"?",
	"+",
	"|",
	"^",
	"$",
	"[",
	"]"
]);
function regExpToRoute(regexp) {
	if (typeof regexp !== "string" && /[ims]/.test(regexp.flags)) throw new Error(`rou3: cannot represent regexp flag(s) "${regexp.flags}" as a route`);
	let src = typeof regexp === "string" ? regexp : regexp.source;
	if (src.startsWith("^")) src = src.slice(1);
	if (src.endsWith("$")) src = src.slice(0, -1);
	if (src.endsWith("\\/?")) src = src.slice(0, -3);
	if (src === "" || src === "\\/") return "/";
	const segments = [];
	const n = src.length;
	let i = 0;
	while (i < n) {
		if (src.startsWith("(?:", i)) {
			const end = readGroup(src, i);
			if (src[end] !== "?") throw new Error(`rou3: unsupported non-optional group in "${src}"`);
			applyOptional(segments, src.slice(i + 3, end - 1));
			i = end + 1;
			continue;
		}
		if (src.startsWith("\\/?", i)) {
			const g = matchNamedGroup(src, i + 3);
			if (g && g.end === n && (g.body === ".*" || g.body === ".+")) {
				segments.push(g.name === "_" ? "**" : `**:${g.name}`);
				break;
			}
		}
		if (src.startsWith("\\/", i)) {
			const end = segmentEnd(src, i + 2);
			segments.push(reverseSegment(src.slice(i + 2, end)));
			i = end;
			continue;
		}
		throw new Error(`rou3: cannot parse "${src}" at index ${i}`);
	}
	return "/" + segments.join("/");
}
function reverseSegment(seg) {
	const whole = matchNamedGroup(seg, 0);
	if (whole && whole.end === seg.length) {
		if (whole.body === ".+") return `:${whole.name}+`;
		const rep = matchRepeat(whole.body);
		if (rep) return `:${whole.name}${constraint(rep)}+`;
	}
	let out = "";
	let i = 0;
	while (i < seg.length) {
		const c = seg[i];
		if (c === "(") {
			const g = matchNamedGroup(seg, i);
			if (g) {
				out += paramToken(g.name, g.body);
				i = g.end;
				continue;
			}
			if (!seg.startsWith("(?", i)) {
				const end = readGroup(seg, i);
				out += paramToken("_0", seg.slice(i + 1, end - 1));
				i = end;
				continue;
			}
			throw new Error(`rou3: unsupported group construct in "${seg}"`);
		}
		if (c === "\\") {
			const next = seg[i + 1];
			if (next === void 0) throw new Error(`rou3: dangling escape in "${seg}"`);
			if (/[a-z0-9]/i.test(next)) throw new Error(`rou3: unsupported escape "\\${next}" in "${seg}"`);
			out += escapeLiteral(next);
			i += 2;
			continue;
		}
		if (BARE_META.has(c)) throw new Error(`rou3: unsupported metacharacter "${c}" in "${seg}"`);
		out += escapeLiteral(c);
		i += 1;
	}
	return out;
}
const BARE_META = /* @__PURE__ */ new Set([
	".",
	"^",
	"$",
	"*",
	"+",
	"?",
	"|",
	"[",
	"]",
	"{",
	"}",
	")"
]);
function applyOptional(segments, inner) {
	if (inner.startsWith("\\/")) {
		const rest = inner.slice(2);
		const g = matchNamedGroup(rest, 0);
		if (g && g.end === rest.length) {
			segments.push(optionalParam(g.name, g.body));
			return;
		}
		mergeGroup(segments, `/${reverseSegment(rest)}`);
		return;
	}
	mergeGroup(segments, reverseSegment(inner));
}
function mergeGroup(segments, body) {
	if (segments.length === 0) throw new Error(`rou3: optional group "{${body}}?" has no preceding segment`);
	segments[segments.length - 1] += `{${body}}?`;
}
function paramToken(name, body) {
	const unnamed = /^_\d+$/.test(name);
	if (unnamed && body === "[^/]*") return "*";
	if (!unnamed && body === "[^/]+") return `:${name}`;
	return unnamed ? constraint(body) : `:${name}${constraint(body)}`;
}
function optionalParam(name, body) {
	if (body === "[^/]+") return `:${name}?`;
	if (body === ".*") return `:${name}*`;
	const rep = matchRepeat(body);
	if (rep) return `:${name}${constraint(rep)}*`;
	return `:${name}${constraint(body)}?`;
}
function matchRepeat(body) {
	const m = body.match(/^(.+)\(\?:\\\/(.+)\)\*$/);
	return m && m[1] === m[2] ? m[1] : void 0;
}
function constraint(body) {
	if (body.includes("/")) throw new Error(`rou3: param constraint "(${body})" cannot contain "/"`);
	return `(${body})`;
}
function escapeLiteral(ch) {
	return ROUTE_SPECIAL.has(ch) ? `\\${ch}` : ch;
}
function matchNamedGroup(src, start) {
	if (!src.startsWith("(?<", start)) return;
	const after = src[start + 3];
	if (after === "=" || after === "!") return;
	const gt = src.indexOf(">", start);
	if (gt === -1) return;
	const end = readGroup(src, start);
	return {
		name: fromGroupName(src.slice(start + 3, gt)),
		body: src.slice(gt + 1, end - 1),
		end
	};
}
function readGroup(src, start) {
	let depth = 0;
	let inClass = false;
	for (let i = start; i < src.length; i++) {
		const c = src[i];
		if (inClass) {
			if (c === "\\") i++;
			else if (c === "]") inClass = false;
			continue;
		}
		if (c === "\\") i++;
		else if (c === "[") inClass = true;
		else if (c === "(") depth++;
		else if (c === ")" && --depth === 0) return i + 1;
	}
	throw new Error(`rou3: unbalanced group in "${src}"`);
}
function segmentEnd(src, start) {
	let depth = 0;
	let inClass = false;
	let i = start;
	while (i < src.length) {
		if (inClass) {
			if (src[i] === "\\") i++;
			else if (src[i] === "]") inClass = false;
			i++;
			continue;
		}
		if (depth === 0 && (src.startsWith("\\/", i) || src.startsWith("(?:", i))) break;
		const c = src[i];
		if (c === "\\") i += 2;
		else if (c === "[") {
			inClass = true;
			i++;
		} else {
			if (c === "(") depth++;
			else if (c === ")") depth--;
			i++;
		}
	}
	return i;
}
export { NullProtoObj, addRoute, compareRoutes, createRouter, findAllRoutes, findOverlappingRoutes, findRoute, regExpToRoute, removeRoute, routeNodeKeys, routeToRegExp, routesOverlap };
