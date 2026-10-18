const UNNAMED_GROUP_PREFIX = "__rou3_unnamed_";
const ESCAPED_GROUP_PREFIX = "__rou3_esc_";
function fromGroupName(key) {
	if (key.charCodeAt(0) !== 95) return key;
	if (key.startsWith("__rou3_esc_")) return key.slice(11).replace(/__|_h/g, (c) => c === "__" ? "_" : "-");
	return key.startsWith("__rou3_unnamed_") ? key.slice(15) : key;
}
const NullProtoObj = /* @__PURE__ */ (() => {
	const e = function() {};
	return e.prototype = Object.create(null), Object.freeze(e.prototype), e;
})();
function compileRouter(router, opts) {
	const ctx = {
		opts: opts || {},
		router,
		data: []
	};
	const compiled = compileRouteMatch(ctx);
	if (ctx.data.length < DATA_ARGS_MAX) return new Function(...ctx.data.map((_, i) => `$${i}`), `return(m,p)=>{${compiled}}`)(...ctx.data);
	const arrayCtx = {
		opts: opts || {},
		router,
		data: [],
		dataArray: true
	};
	return new Function("$", `return(m,p)=>{${compileRouteMatch(arrayCtx)}}`)(arrayCtx.data);
}
function compileRouterToString(router, functionName, opts) {
	const ctx = {
		opts: opts || {},
		router,
		data: [],
		compileToString: true
	};
	let compiled = `(m,p)=>{${compileRouteMatch(ctx)}}`;
	if (ctx.data.length > 0) compiled = `/* @__PURE__ */ (() => { ${`const ${ctx.data.map((v, i) => `$${i}=${v}`).join(",")};`} return ${compiled}})()`;
	return functionName ? `const ${functionName}=${compiled};` : compiled;
}
const DATA_ARGS_MAX = 32e3;
function compileRouteMatch(ctx) {
	let code = compileStaticMatch(ctx);
	const match = compileNode(ctx, ctx.router.root, [], 1, 1);
	if (match) {
		const temps = ctx.regexTemps ? `let ${Array.from({ length: ctx.regexTemps }, (_, i) => `_m${i}`).join(",")};` : "";
		const pop = ctx.pathSliced ? `{s.pop();p=p.slice(0,-1)}` : `s.pop();`;
		code += `let s=p.split("/");if(s.length>1&&s[s.length-1]==="")${pop}let l=s.length;${temps}${match}`;
	}
	if (!code) return ctx.opts?.matchAll ? `return [];` : "";
	const normalizeHelper = code.includes("_normalizeGroups(") ? `const _u=${JSON.stringify(UNNAMED_GROUP_PREFIX)},_e=${JSON.stringify(ESCAPED_GROUP_PREFIX)};const _normalizeGroups=(g)=>{if(!g)return g;for(const k in g){const n=k.startsWith(_u)?k.slice(_u.length):(k.startsWith(_e)?k.slice(_e.length).replace(/__|_h/g,(c)=>c==="__"?"_":"-"):k);if(n!==k){g[n]=g[k];delete g[k]}}return g;};` : "";
	const normalizePathHelper = ctx.opts?.normalize ? `if(p.includes("/.")){let _r=[];for(let _v of p.split("/")){if(_v===".")continue;_v===".."&&_r.length>1?_r.pop():_r.push(_v)}p=_r.join("/")||"/"}` : "";
	return `${ctx.opts?.matchAll ? `let r=[];` : ""}${normalizeHelper}${normalizePathHelper}if(p.charCodeAt(p.length-1)===47)p=p.slice(0,-1);${code}${ctx.opts?.matchAll ? "return r.reverse();" : ""}`;
}
const STATIC_CHAIN_MAX = 8;
const SEGMENT_CHAIN_MAX = 32;
function compileStaticMatch(ctx) {
	const matchAll = ctx.opts?.matchAll;
	const entries = [];
	for (const key in ctx.router.static) {
		const node = ctx.router.static[key];
		if (node?.methods) entries.push([key.replace(/\/$/, ""), node]);
	}
	if (entries.length <= STATIC_CHAIN_MAX) {
		let code = "";
		let slashCode = "";
		for (const [nk, node] of entries) {
			const body = compileMethodMatch(ctx, node.methods, [], -1);
			code += `${code ? "else " : ""}if(p===${JSON.stringify(nk)}){${body}}`;
			slashCode += `${slashCode ? "else " : ""}if(p===${JSON.stringify(nk + "/")}){${body}}`;
		}
		return code && `${code}else if(p.charCodeAt(p.length-1)===47){${slashCode}}`;
	}
	const jitMap = ctx.compileToString ? void 0 : new NullProtoObj();
	let mapCode = "";
	for (const [nk, node] of entries) {
		const jitMethods = jitMap ? new NullProtoObj() : void 0;
		let methodsCode = "";
		for (const method in node.methods) {
			const matchers = node.methods[method];
			if (matchers && matchers.length > 0) if (jitMethods) jitMethods[method] = matchAll ? matchers.map((m) => m.data) : matchers[0].data;
			else {
				const refs = matchers.map((m) => serializeData(ctx, m.data));
				methodsCode += `${JSON.stringify(method)}:${matchAll ? `[${refs.join(",")}]` : refs[0]},`;
			}
		}
		if (jitMethods ? Object.keys(jitMethods).length === 0 : !methodsCode) continue;
		if (jitMap) jitMap[nk] = jitMethods;
		else mapCode += `${JSON.stringify(nk)}:{__proto__:null,${methodsCode}},`;
	}
	if (jitMap ? Object.keys(jitMap).length === 0 : !mapCode) return "";
	const ref = pushDataSlot(ctx, jitMap ? jitMap : `{__proto__:null,${mapCode}}`);
	const lookup = `let _n=${ref}[p];if(_n===void 0&&p.charCodeAt(p.length-1)===47)_n=${ref}[p.slice(0,-1)];`;
	return matchAll ? `${lookup}if(_n!==void 0){let _a=_n[m];if(_a===void 0)_a=_n[""];if(_a!==void 0)for(let _i=_a.length-1;_i>=0;_i--)r.push({data:_a[_i]});}` : `${lookup}if(_n!==void 0){let _d=_n[m];if(_d===void 0)_d=_n[""];if(_d!==void 0)return {data:_d};}`;
}
function compileMethodMatch(ctx, methods, params, currentIdx) {
	let code = "";
	let fallback = "";
	for (const key in methods) {
		const matchers = methods[key];
		if (matchers && matchers.length > 0) {
			const compiled = matchers.map((m) => compileFinalMatch(ctx, m, currentIdx, params));
			if (ctx.opts?.matchAll) compiled.reverse();
			const body = compiled.sort((a, b) => b.weight - a.weight).map((m) => m.code).join("");
			if (key === "") fallback = body;
			else code += `${code ? "else " : ""}if(m===${JSON.stringify(key)}){${body}}`;
		}
	}
	return fallback ? code ? `${code}else{${fallback}}` : fallback : code;
}
function compileFinalMatch(ctx, data, currentIdx, params) {
	let ret = `{data:${serializeData(ctx, data.data)}`;
	const conditions = [];
	let guardConditions = 0;
	const { paramsMap } = data;
	if (paramsMap && paramsMap.length > 0) {
		const lastParam = paramsMap[paramsMap.length - 1];
		if (currentIdx !== -1) {
			if (!lastParam[2]) conditions.push(`l>${currentIdx}`);
			else if (lastParam[0] < 0 && paramsMap.length > 1) {
				conditions.push(`l>${currentIdx - 1}`);
				guardConditions++;
			}
		}
		let paramsCode = "";
		let tmpCount = 0;
		for (let i = 0; i < paramsMap.length; i++) {
			const map = paramsMap[i];
			if (typeof map[1] === "string") {
				paramsCode += `${propKey(map[1])}:${params[i]},`;
				continue;
			}
			const regexp = serializeRegExp(ctx, map[1]);
			const groups = scanRegExpGroups(map[1].source);
			if (!groups) {
				const tmp = `_m${tmpCount++}`;
				conditions.push(`(${tmp}=${regexp}.exec(${params[i]}))!==null`);
				paramsCode += `..._normalizeGroups(${tmp}.groups),`;
			} else if (groups.names.length === 0) conditions.push(`${regexp}.test(${params[i]})`);
			else if (groups.whole) {
				conditions.push(`${regexp}.test(${params[i]})`);
				paramsCode += `${propKey(fromGroupName(groups.names[0]))}:${params[i]},`;
			} else {
				const tmp = `_m${tmpCount++}`;
				conditions.push(`(${tmp}=${regexp}.exec(${params[i]}))!==null`);
				for (const name of groups.names) paramsCode += `${propKey(fromGroupName(name))}:${tmp}.groups.${name},`;
			}
		}
		if (tmpCount > (ctx.regexTemps || 0)) ctx.regexTemps = tmpCount;
		ret += `,params:{${paramsCode}}`;
	}
	return {
		code: (conditions.length > 0 ? `if(${conditions.join("&&")})` : "") + (ctx.opts?.matchAll ? `r.push(${ret}});` : `return ${ret}};`),
		weight: conditions.length - guardConditions
	};
}
function compileNode(ctx, node, params, currentIdx, staticPrefixLen) {
	const hasLastOptionalParam = node.key === "*" && hasOptionalLastParam(node.methods);
	let code = "", hasIf = false;
	if (node.methods && params.length > 0) {
		const match = compileMethodMatch(ctx, node.methods, params, hasLastOptionalParam ? currentIdx - 1 : -1);
		if (match) {
			code += `if(l===${currentIdx}${hasLastOptionalParam ? `||l===${currentIdx - 1}` : ""}){${match}}`;
			hasIf = true;
		}
	}
	if (node.static) {
		const children = [];
		for (const key in node.static) {
			const match = compileNode(ctx, node.static[key], params, currentIdx + 1, staticPrefixLen < 0 ? -1 : staticPrefixLen + key.length + 1);
			if (match) children.push([key, match]);
		}
		if (children.length > SEGMENT_CHAIN_MAX) {
			const jitMap = ctx.compileToString ? void 0 : new NullProtoObj();
			let mapCode = "";
			let cases = "";
			for (const [i, [key, match]] of children.entries()) {
				if (jitMap) jitMap[key] = i;
				else mapCode += `${propKey(key)}:${i},`;
				cases += `case ${i}:{${match}}break;`;
			}
			const ref = pushDataSlot(ctx, jitMap ? jitMap : `{__proto__:null,${mapCode}}`);
			code += `${hasIf ? "else " : ""}if(l>${currentIdx}){switch(${ref}[s[${currentIdx}]]){${cases}}}`;
			hasIf = true;
		} else if (children.length > 0) {
			let staticCode = "";
			const notNeedBoundCheck = hasIf;
			for (const [key, match] of children) {
				staticCode += `${hasIf ? "else " : ""}if(s[${currentIdx}]===${JSON.stringify(key)}){${match}}`;
				hasIf = true;
			}
			code += notNeedBoundCheck ? staticCode : `if(l>${currentIdx}){${staticCode}}`;
		}
	}
	if (node.param) code += compileNode(ctx, node.param, params.concat(`s[${currentIdx}]`), currentIdx + 1, -1);
	if (node.wildcard) {
		const { wildcard } = node;
		if (wildcard.static || wildcard.param || wildcard.wildcard) throw new Error("Compiler mode does not support patterns after wildcard");
		if (wildcard.methods) {
			let tail;
			if (staticPrefixLen < 0) tail = `s.slice(${currentIdx}).join('/')`;
			else {
				tail = `p.slice(${staticPrefixLen})`;
				ctx.pathSliced = true;
			}
			code += compileMethodMatch(ctx, wildcard.methods, params.concat(tail), currentIdx);
		}
	}
	return code;
}
function scanRegExpGroups(source) {
	const names = [];
	const wholeCandidate = source.charCodeAt(0) === 94 && source.startsWith("(?<", 1);
	let i = 0;
	let depth = 0;
	let firstGroupEnd = -1;
	while (i < source.length) {
		const c = source.charCodeAt(i);
		if (c === 92) i += 2;
		else if (c === 91) {
			i++;
			while (i < source.length && source.charCodeAt(i) !== 93) i += source.charCodeAt(i) === 92 ? 2 : 1;
			i++;
		} else if (c === 40) {
			depth++;
			if (source.startsWith("(?<", i) && source[i + 3] !== "=" && source[i + 3] !== "!") {
				const end = source.indexOf(">", i + 3);
				const name = end === -1 ? "" : source.slice(i + 3, end);
				if (!/^[A-Za-z_$][\w$]*$/.test(name)) return;
				if (!names.includes(name)) names.push(name);
				i = end + 1;
			} else i++;
		} else if (c === 41) {
			depth--;
			if (depth === 0 && firstGroupEnd === -1) firstGroupEnd = i;
			i++;
		} else i++;
	}
	return {
		names,
		whole: wholeCandidate && names.length === 1 && firstGroupEnd === source.length - 2 && source.charCodeAt(source.length - 1) === 36
	};
}
function serializeData(ctx, value) {
	if (ctx.compileToString) if (ctx.opts?.serialize) value = ctx.opts.serialize(value);
	else if (typeof value?.toJSON === "function") value = value.toJSON();
	else value = JSON.stringify(value);
	const dataMap = ctx.dataMap ??= /* @__PURE__ */ new Map();
	let index = dataMap.get(value);
	if (index === void 0) {
		index = ctx.data.push(value) - 1;
		dataMap.set(value, index);
	}
	return dataRef(ctx, index);
}
function serializeRegExp(ctx, value) {
	const key = value.toString();
	const regexpMap = ctx.regexpMap ??= /* @__PURE__ */ new Map();
	let index = regexpMap.get(key);
	if (index === void 0) {
		index = ctx.data.push(ctx.compileToString ? key : value) - 1;
		regexpMap.set(key, index);
	}
	return dataRef(ctx, index);
}
function pushDataSlot(ctx, value) {
	return dataRef(ctx, ctx.data.push(value) - 1);
}
function dataRef(ctx, index) {
	return ctx.dataArray ? `$[${index}]` : `$${index}`;
}
function propKey(name) {
	return name === "__proto__" ? "[\"__proto__\"]" : JSON.stringify(name);
}
function hasOptionalLastParam(methods) {
	for (const key in methods) for (const m of methods[key] || []) {
		const pMap = m.paramsMap;
		if (pMap?.[pMap.length - 1]?.[2]) return true;
	}
	return false;
}
export { compileRouter, compileRouterToString };
