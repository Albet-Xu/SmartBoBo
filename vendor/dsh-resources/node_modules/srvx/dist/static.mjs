import { FastURL } from "./_chunks/_url.mjs";
import { constants } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream";
import { open, realpath, stat } from "node:fs/promises";
import { constants as constants$1, createBrotliCompress, createGzip } from "node:zlib";
import { FastResponse } from "srvx";
const COMMON_MIME_TYPES = {
	".html": "text/html",
	".htm": "text/html",
	".css": "text/css",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".json": "application/json",
	".txt": "text/plain",
	".xml": "application/xml",
	".wasm": "application/wasm",
	".gif": "image/gif",
	".ico": "image/vnd.microsoft.icon",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".avif": "image/avif",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".zip": "application/zip",
	".gz": "application/gzip",
	".pdf": "application/pdf"
};
const DEFAULT_DOTFILES = [".well-known"];
const DEFAULT_ENCODINGS = {
	br: ".br",
	gzip: ".gz"
};
const BROTLI_QUALITY = 4;
const COMPRESS_MIN_SIZE = 1024;
const COMPRESS_MAX_SIZE = 10485760;
const COMPRESSORS = {
	br: (sizeHint) => createBrotliCompress({ params: {
		[constants$1.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
		[constants$1.BROTLI_PARAM_SIZE_HINT]: sizeHint
	} }),
	gzip: () => createGzip()
};
const asPrefix = (path) => path.endsWith(sep) ? path : path + sep;
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);
const staticMiddleware = (options) => {
	const dir = asPrefix(resolve(options.dir));
	const methods = new Set((options.methods || ["GET", "HEAD"]).map((m) => m.toUpperCase()));
	const dotfiles = options.dotfiles ?? DEFAULT_DOTFILES;
	const allowAllDots = dotfiles === true;
	const allowedDots = new Set(Array.isArray(dotfiles) ? dotfiles : []);
	const isDeniedDotPath = (relPath) => !allowAllDots && relPath.split(sep).some((s) => s[0] === "." && !allowedDots.has(s));
	const encodings = options.encodings === true ? DEFAULT_ENCODINGS : options.encodings || {};
	const compress = options.compress ?? true;
	const lastModified = options.lastModified ?? true;
	const etag = options.etag ?? true;
	const ranges = options.ranges ?? true;
	const cacheControl = buildCacheControl(options.maxAge, options.immutable);
	const served = [...Object.entries(encodings).map(([name, ext]) => ({
		name,
		ext,
		compressor: compress ? COMPRESSORS[name] : void 0
	})), ...compress ? Object.keys(COMPRESSORS).filter((name) => !(name in encodings)).map((name) => ({
		name,
		compressor: COMPRESSORS[name]
	})) : []];
	const varyOnEncoding = served.length > 0;
	let realDir;
	const getRealDir = async () => {
		if (realDir === void 0) {
			const resolved = await realpath(dir).catch(() => null);
			if (resolved === null) return dir;
			realDir = asPrefix(resolved);
		}
		return realDir;
	};
	const statFile = async (candidate) => {
		const fileStat = await stat(candidate).catch(() => null);
		return fileStat?.isFile() ? fileStat : null;
	};
	const openServable = async (candidate) => {
		const handle = await open(candidate, OPEN_FLAGS).catch(() => null);
		if (handle === null) return null;
		try {
			const fileStat = await handle.stat();
			const realPath = fileStat.isFile() ? await realpath(candidate).catch(() => null) : null;
			if (realPath !== null) {
				const root = await getRealDir();
				if (realPath.startsWith(root) && !isDeniedDotPath(realPath.slice(root.length))) {
					const realStat = await stat(realPath).catch(() => null);
					if (realStat && realStat.ino === fileStat.ino && realStat.dev === fileStat.dev) return {
						handle,
						size: fileStat.size,
						mtimeMs: fileStat.mtimeMs
					};
				}
			}
		} catch {}
		await handle.close().catch(() => {});
		return null;
	};
	return async (req, next) => {
		if (!methods.has(req.method)) return next();
		let path = (req._url ??= new FastURL(req.url)).pathname.slice(1);
		const trailingSlash = path.endsWith("/");
		if (trailingSlash) path = path.replace(/\/+$/, "");
		if (path.includes("%")) try {
			path = decodeURI(path);
		} catch {
			return new FastResponse("Bad Request", { status: 400 });
		}
		let paths;
		if (path === "") paths = ["index.html"];
		else if (trailingSlash) paths = [`${path}/index.html`];
		else if (extname(path) === "") paths = [
			path,
			`${path}.html`,
			`${path}/index.html`
		];
		else paths = [path];
		let acceptEncodings;
		let rangeRequest;
		for (const candidate of paths) {
			const filePath = join(dir, candidate);
			if (!filePath.startsWith(dir) || isDeniedDotPath(filePath.slice(dir.length))) continue;
			if (!await statFile(filePath)) continue;
			const contentType = COMMON_MIME_TYPES[extname(filePath)] || "application/octet-stream";
			const renderHTML = contentType === "text/html" ? options.renderHTML : void 0;
			const compressible = !renderHTML && isCompressible(contentType);
			if (rangeRequest === void 0) {
				const header = ranges && req.method === "GET" ? req.headers.get("range") : null;
				rangeRequest = header !== null && header.startsWith("bytes=") ? header : "";
			}
			let encoding = "";
			let servePath = filePath;
			let file = null;
			if (compressible && !rangeRequest) {
				acceptEncodings ??= parseAcceptEncoding(req.headers.get("accept-encoding"), served);
				for (const spec of acceptEncodings) {
					if (!spec.ext) continue;
					const variantPath = filePath + spec.ext;
					if (!await statFile(variantPath)) continue;
					const variant = await openServable(variantPath);
					if (variant) {
						encoding = spec.name;
						servePath = variantPath;
						file = variant;
						break;
					}
				}
			}
			file ??= await openServable(filePath);
			if (!file) continue;
			let compressor;
			if (compressible && !rangeRequest && !encoding && file.size >= COMPRESS_MIN_SIZE && file.size <= COMPRESS_MAX_SIZE) {
				const spec = acceptEncodings.find((s) => s.compressor);
				if (spec) {
					encoding = spec.name;
					compressor = spec.compressor;
				}
			}
			if (renderHTML) {
				let html;
				try {
					html = await file.handle.readFile("utf8");
				} finally {
					await file.handle.close().catch(() => {});
				}
				const rendered = await renderHTML({
					html,
					filename: servePath,
					request: req
				});
				if (req.method !== "HEAD") return rendered;
				await rendered.body?.cancel().catch(() => {});
				return new FastResponse(null, {
					status: rendered.status,
					statusText: rendered.statusText,
					headers: rendered.headers
				});
			}
			const headers = { "Content-Type": contentType.startsWith("text/") ? `${contentType}; charset=utf-8` : contentType };
			if (!compressor) headers["Content-Length"] = file.size.toString();
			if (encoding) headers["Content-Encoding"] = encoding;
			if (ranges && !encoding) headers["Accept-Ranges"] = "bytes";
			if (varyOnEncoding && compressible) headers["Vary"] = "Accept-Encoding";
			if (cacheControl) headers["Cache-Control"] = cacheControl;
			let etagValue = "";
			if (etag) {
				etagValue = computeETag(file.size, file.mtimeMs, encoding);
				headers["ETag"] = etagValue;
			}
			const lastModifiedMs = Math.min(Math.floor(file.mtimeMs / 1e3) * 1e3, Math.floor(Date.now() / 1e3) * 1e3);
			if (lastModified) headers["Last-Modified"] = new Date(lastModifiedMs).toUTCString();
			const conditionalGet = req.method === "GET" || req.method === "HEAD";
			let conditionalStatus = 0;
			const ifNoneMatch = req.headers.get("if-none-match");
			if (ifNoneMatch !== null) {
				if (matchesIfNoneMatch(ifNoneMatch, etagValue)) conditionalStatus = conditionalGet ? 304 : 412;
			} else if (lastModified && conditionalGet) {
				if (matchesIfModifiedSince(req.headers.get("if-modified-since"), lastModifiedMs)) conditionalStatus = 304;
			}
			if (conditionalStatus) {
				await file.handle.close().catch(() => {});
				const conditionalHeaders = {};
				if (etagValue) conditionalHeaders["ETag"] = etagValue;
				if (headers["Last-Modified"]) conditionalHeaders["Last-Modified"] = headers["Last-Modified"];
				if (headers["Vary"]) conditionalHeaders["Vary"] = headers["Vary"];
				if (cacheControl && conditionalStatus === 304) conditionalHeaders["Cache-Control"] = cacheControl;
				return new FastResponse(null, {
					status: conditionalStatus,
					headers: conditionalHeaders
				});
			}
			if (rangeRequest) {
				const ifRange = req.headers.get("if-range");
				if (ifRange === null || matchesIfRange(ifRange, lastModifiedMs)) {
					const parsed = parseRange(rangeRequest, file.size);
					if (parsed === "unsatisfiable") {
						await file.handle.close().catch(() => {});
						return new FastResponse(null, {
							status: 416,
							headers: { "Content-Range": `bytes */${file.size}` }
						});
					}
					if (parsed) {
						const stream = file.handle.createReadStream({
							start: parsed.start,
							end: parsed.end
						});
						return new FastResponse(stream, {
							status: 206,
							headers: {
								...headers,
								"Content-Range": `bytes ${parsed.start}-${parsed.end}/${file.size}`,
								"Content-Length": (parsed.end - parsed.start + 1).toString()
							}
						});
					}
				}
			}
			if (req.method === "HEAD") {
				await file.handle.close().catch(() => {});
				return new FastResponse(null, { headers });
			}
			const stream = file.handle.createReadStream();
			if (!compressor) return new FastResponse(stream, { headers });
			const encoded = compressor(file.size);
			pipeline(stream, encoded, () => {});
			return new FastResponse(encoded, { headers });
		}
		return next();
	};
};
function buildCacheControl(maxAge, immutable) {
	if (maxAge === void 0) return "";
	const seconds = Number.isFinite(maxAge) ? Math.min(2147483648, Math.max(0, Math.floor(maxAge))) : 0;
	return immutable ? `max-age=${seconds}, immutable` : `max-age=${seconds}`;
}
function isCompressible(mimeType) {
	return mimeType.startsWith("text/") || mimeType.endsWith("+json") || mimeType.endsWith("+xml") || mimeType === "application/json" || mimeType === "application/xml" || mimeType === "application/wasm";
}
function computeETag(size, mtimeMs, encoding) {
	const tag = `${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}`;
	return `W/"${encoding ? `${tag}-${encoding}` : tag}"`;
}
function matchesIfNoneMatch(header, etag) {
	if (header.trim() === "*") return true;
	if (!etag) return false;
	const bare = etag.replace(/^W\//, "");
	return header.split(",").some((candidate) => candidate.trim().replace(/^W\//, "") === bare);
}
function matchesIfModifiedSince(header, lastModifiedMs) {
	if (!header) return false;
	const since = Date.parse(header);
	return !Number.isNaN(since) && lastModifiedMs <= since;
}
function matchesIfRange(header, lastModifiedMs) {
	const value = header.trim();
	if (value.startsWith("\"") || value.startsWith("W/")) return false;
	return value === new Date(lastModifiedMs).toUTCString();
}
function parseRange(header, size) {
	const match = /^bytes=(\d*)-(\d*)$/.exec(header);
	if (!match) return null;
	const startStr = match[1];
	const endStr = match[2];
	if (startStr === "") {
		if (endStr === "") return null;
		const n = Number(endStr);
		if (n === 0 || size === 0) return "unsatisfiable";
		return {
			start: n >= size ? 0 : size - n,
			end: size - 1
		};
	}
	const start = Number(startStr);
	let end = size - 1;
	if (endStr !== "") {
		const to = Number(endStr);
		if (to < start) return null;
		if (to < end) end = to;
	}
	return start >= size ? "unsatisfiable" : {
		start,
		end
	};
}
function parseAcceptEncoding(header, served) {
	if (!header) return [];
	const quality = /* @__PURE__ */ new Map();
	for (const part of header.split(",")) {
		const [token, ...params] = part.split(";");
		const name = token.trim().toLowerCase();
		if (!name) continue;
		let q = 1;
		for (const param of params) {
			const trimmed = param.trim();
			if (trimmed.startsWith("q=")) q = Number.parseFloat(trimmed.slice(2)) || 0;
		}
		quality.set(name, q);
	}
	const wildcard = quality.get("*");
	return served.filter(({ name }) => (quality.get(name) ?? wildcard ?? 0) > 0);
}
export { staticMiddleware };
