import { HTTPError, decodePreservingSeparators, getURLPathname, joinURL, withoutBase } from "./response.mjs";
import { isCanonicalPath, resolveDotSegments } from "./path.mjs";
const CANONICAL_OPTS = { decodeSlashes: true };
const MERGED_OPTS = {
	decodeSlashes: true,
	mergeSlashes: true
};
function canonicalPath(pathname) {
	return resolveDotSegments(pathname, CANONICAL_OPTS);
}
function decodedPath(pathname) {
	let decoded = pathname;
	for (let pass = 0; hasDecodableEscape(decoded); pass++) {
		if (pass >= MAX_PASSES) return decoded;
		const input = pass < EXACT_PASSES ? decoded : flattenNesting(decoded);
		let next;
		try {
			next = decodePreservingSeparators(input);
		} catch {
			return input;
		}
		if (next === input) return input;
		decoded = next;
	}
	return decoded;
}
const EXACT_PASSES = 8;
const MAX_PASSES = 24;
const CHAR_2 = 50;
const CHAR_5 = 53;
function needsCanonicalPasses(pathname) {
	return !isCanonicalPath(pathname, MERGED_OPTS);
}
function mergedCanonicalPath(pathname, canonical) {
	const merged = resolveDotSegments(pathname, MERGED_OPTS);
	return merged === canonical ? void 0 : merged;
}
function isPathInScope(pathname, base) {
	if (!base) return true;
	if (!isEveryCanonicalReadingInScope(pathname, base)) return false;
	const decoded = decodedPath(pathname);
	return decoded === pathname || isEveryCanonicalReadingInScope(decoded, base);
}
function isEveryCanonicalReadingInScope(pathname, base) {
	if (!needsCanonicalPasses(pathname)) return isCanonicalInScope(pathname, base);
	return isCanonicalInScope(canonicalPath(pathname), base) && isCanonicalInScope(resolveDotSegments(pathname, MERGED_OPTS), base);
}
function isCanonicalInScope(canonical, base) {
	return canonical === base || canonical.startsWith(base + "/");
}
function hasDecodableEscape(value) {
	for (let i = value.indexOf("%"); i !== -1; i = value.indexOf("%", i + 1)) {
		const byte = escapeByte(value, nestingEnd(value, i));
		if (byte !== 47 && byte !== 92) return true;
	}
	return false;
}
function flattenNesting(path) {
	let flat = "";
	let last = 0;
	for (let i = path.indexOf("%"); i !== -1; i = path.indexOf("%", i + 1)) {
		const end = nestingEnd(path, i);
		if (end === i + 1) continue;
		const byte = escapeByte(path, end);
		if (byte === 47 || byte === 92) continue;
		flat += path.slice(last, i) + (byte === -1 ? "%25" : "%");
		last = end;
	}
	return last === 0 ? path : flat + path.slice(last);
}
function nestingEnd(value, index) {
	let end = index + 1;
	while (value.charCodeAt(end) === CHAR_2 && value.charCodeAt(end + 1) === CHAR_5) end += 2;
	return end;
}
function escapeByte(value, index) {
	const high = hexDigit(value.charCodeAt(index));
	const low = hexDigit(value.charCodeAt(index + 1));
	return high === -1 || low === -1 ? -1 : high * 16 + low;
}
function hexDigit(code) {
	if (code >= 48 && code <= 57) return code - 48;
	if (code >= 97 && code <= 102) return code - 87;
	if (code >= 65 && code <= 70) return code - 55;
	return -1;
}
const QUERY_UNSAFE_RE = /[#&+;=?]/g;
const asQueryValue = (tail) => tail.replace(QUERY_UNSAFE_RE, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const asPath = (tail) => tail;
const AUTHORITY_RE = /^(?:[a-z][a-z\d+.-]*:[/\\]*|[/\\]{2,})[^/\\?#]*/i;
function authorityEnd(target) {
	return AUTHORITY_RE.exec(target)?.[0].length ?? 0;
}
function isHostPositionSplat(target) {
	const index = target.indexOf("**");
	return index !== -1 && index <= authorityEnd(target);
}
function parseSplatTemplate(target) {
	let index = target.indexOf("**");
	if (index === -1 || index <= authorityEnd(target)) return;
	const marker = target.search(/[?#]/);
	const valueStart = marker === -1 ? Number.POSITIVE_INFINITY : marker;
	const literals = [];
	const encoders = [];
	let last = 0;
	for (; index !== -1; index = target.indexOf("**", last)) {
		literals.push(target.slice(last, index));
		encoders.push(index > valueStart ? asQueryValue : asPath);
		last = index + 2;
	}
	literals.push(target.slice(last));
	return {
		literals,
		encoders
	};
}
function interpolateSplat(template, tail) {
	const { literals, encoders } = template;
	let resolved = literals[0];
	for (let i = 0; i < encoders.length; i++) resolved += encoders[i](tail) + literals[i + 1];
	return resolved;
}
const LEADING_SEPARATOR_RUN_RE = /^(?:[/\\]|%(?:25)*(?:2f|5c))+/i;
const DYNAMIC_PATTERN_RE = /[:*()\\]/;
const VARIABLE_WIDTH_SEGMENT_RE = /^\*\*|^:.*[?*+]$/;
function prepareRuleTarget(options) {
	const target = options?.to;
	if (!target) return;
	const base = options?.base;
	if (target.endsWith("/**")) {
		const baseTarget = target.slice(0, -3);
		const baseTargetPath = targetBasePath(baseTarget);
		const resolveTail = prepareTailResolver(base);
		return (event) => {
			const resolved = joinURL(baseTarget, resolveTail(event) + event.url.search);
			assertTargetInScope(resolved, baseTargetPath);
			return resolved;
		};
	}
	const template = base === void 0 ? void 0 : parseSplatTemplate(target);
	if (template) {
		const prefix = template.literals[0];
		const baseTargetPath = targetBasePath(prefix);
		const resolveTail = prepareTailResolver(base);
		return (event) => {
			const resolved = interpolateSplat(template, resolveTail(event).slice(1));
			assertTargetInScope(resolved, baseTargetPath);
			assertTargetOrigin(resolved, prefix, event.url);
			return appendSearch(resolved, event.url.search);
		};
	}
	return (event) => appendSearch(target, event.url.search);
}
function prepareTailResolver(base) {
	const baseSegments = base && DYNAMIC_PATTERN_RE.test(base) ? patternSegmentCount(base) : 0;
	return (event) => {
		const rawPath = event.url.pathname;
		let scopeBase = base;
		if (baseSegments) {
			scopeBase = leadingSegments(rawPath, baseSegments);
			if (scopeBase === void 0) throw new HTTPError({ status: 400 });
		}
		if (!scopeBase) return rawPath.replace(LEADING_SEPARATOR_RUN_RE, "/");
		if (!isLiterallyInScope(rawPath, scopeBase)) {
			const decoded = decodedPath(rawPath);
			const derived = decoded === rawPath || !isLiterallyInScope(decoded, scopeBase) ? void 0 : leadingSegments(rawPath, countSegments(scopeBase));
			if (derived === void 0) throw new HTTPError({ status: 400 });
			scopeBase = derived;
		}
		return withoutBase(rawPath, scopeBase);
	};
}
function targetBasePath(prefix) {
	const path = getURLPathname(prefix);
	return path.endsWith("/") ? path.slice(0, -1) : path;
}
function appendSearch(target, search) {
	if (!search) return target;
	const hashIndex = target.indexOf("#");
	const targetBase = hashIndex === -1 ? target : target.slice(0, hashIndex);
	const targetHash = hashIndex === -1 ? "" : target.slice(hashIndex);
	return targetBase + (targetBase.includes("?") ? targetBase.endsWith("?") || targetBase.endsWith("&") ? "" : "&" : "?") + search.slice(1) + targetHash;
}
function assertTargetInScope(resolved, baseTargetPath) {
	if (!isFinalTargetInScope(getURLPathname(resolved), baseTargetPath)) throw new HTTPError({ status: 400 });
}
function assertTargetOrigin(resolved, prefix, url) {
	let expected;
	let actual;
	try {
		expected = new URL(prefix, url);
		actual = new URL(resolved, url);
	} catch {
		throw new HTTPError({ status: 400 });
	}
	if (expected.origin !== actual.origin || expected.protocol !== actual.protocol) throw new HTTPError({ status: 400 });
}
function isFinalTargetInScope(pathname, baseTargetPath) {
	if (baseTargetPath) return isPathInScope(pathname, baseTargetPath);
	const run = LEADING_SEPARATOR_RUN_RE.exec(pathname);
	return run === null || run[0] === "/";
}
function isLiterallyInScope(pathname, base) {
	return isPathInScope(pathname, base) && (pathname === base || pathname.startsWith(base + "/"));
}
function patternSegmentCount(base) {
	const segments = splitSegments(base);
	let depth = 0;
	for (const segment of segments) {
		if (VARIABLE_WIDTH_SEGMENT_RE.test(segment)) return 0;
		for (let i = 0; i < segment.length; i++) if (segment[i] === "{") depth++;
		else if (segment[i] === "}") depth--;
		if (depth !== 0) return 0;
	}
	return segments.length;
}
function countSegments(base) {
	return splitSegments(base).length;
}
function splitSegments(base) {
	return (base.startsWith("/") ? base.slice(1) : base).split("/");
}
function leadingSegments(pathname, count) {
	let index = 0;
	for (let i = 0; i < count; i++) {
		index = pathname.indexOf("/", index + 1);
		if (index === -1) return i === count - 1 ? pathname : void 0;
	}
	return pathname.slice(0, index);
}
export { canonicalPath, decodedPath, isHostPositionSplat, mergedCanonicalPath, needsCanonicalPasses, prepareRuleTarget };
