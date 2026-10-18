import { bold, cyan, gray, green, magenta, red, url, yellow } from "./_chunks/_utils.mjs";
import { loadServerEntry } from "./loader.mjs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { Readable } from "node:stream";
const NO_ENTRY_ERROR = "No server entry or public directory found";
async function cliServe(cliOpts) {
	try {
		if (!process.env.NODE_ENV) process.env.NODE_ENV = cliOpts.prod ? "production" : "development";
		let server;
		const loaded = await loadServerEntry({
			entry: cliOpts.entry,
			dir: cliOpts.dir,
			get srvxServer() {
				return server;
			}
		});
		const nested = loaded.srvxServer?.options;
		const nestedNode = nested?.node;
		const nestedMTLS = !!nestedNode && ("requestCert" in nestedNode || "ca" in nestedNode);
		if (nestedMTLS && loaded.srvxServer?.runtime !== "node") throw new Error(`[srvx] The server entry configures mutual TLS, which requires srvx's Node.js adapter (import { serve } from "srvx/node").`);
		const { serve: srvxServe } = loaded.nodeCompat || nestedMTLS ? await import("srvx/node") : await import("srvx");
		const { staticMiddleware } = await import("srvx/static");
		const { loggerMiddleware } = await import("srvx/log");
		const explicitStatic = !!cliOpts.static;
		const staticDir = resolve(cliOpts.dir || (loaded.url ? dirname(fileURLToPath(loaded.url)) : "."), cliOpts.static || "public");
		if (existsSync(staticDir)) cliOpts.static = staticDir;
		else if (explicitStatic) throw new Error(`--static directory not found: ${staticDir}`);
		else cliOpts.static = "";
		if (loaded.notFound && !cliOpts.static) {
			process.send?.({ error: "no-entry" });
			throw new Error(NO_ENTRY_ERROR, { cause: cliOpts });
		}
		const serverOptions = {
			...loaded.module?.default,
			default: void 0,
			...loaded.module
		};
		let tls = serverOptions.tls ?? nested?.tls;
		let protocol = serverOptions.protocol ?? nested?.protocol;
		if (cliOpts.tls) {
			if (!cliOpts.cert || !cliOpts.key) throw new Error("--tls requires both --cert and --key.");
			tls = {
				cert: cliOpts.cert,
				key: cliOpts.key
			};
			protocol = void 0;
		}
		const nodeOptions = nested?.node || serverOptions.node ? {
			...nested?.node,
			...serverOptions.node
		} : void 0;
		printInfo(cliOpts, loaded);
		server = srvxServe({
			...serverOptions,
			gracefulShutdown: !!cliOpts.prod,
			port: cliOpts.port ?? serverOptions.port,
			hostname: cliOpts.hostname ?? cliOpts.host ?? serverOptions.hostname,
			tls,
			protocol,
			node: nodeOptions,
			error: (error) => {
				console.error(error);
				return renderError(cliOpts, error);
			},
			fetch: loaded.fetch || (() => renderError(cliOpts, loaded.notFound ? "Server Entry Not Found" : "No Fetch Handler Exported", 501)),
			middleware: [
				loggerMiddleware(),
				cliOpts.static ? staticMiddleware({ dir: cliOpts.static }) : void 0,
				...serverOptions.middleware || []
			].filter(Boolean)
		});
		await server.ready();
	} catch (error) {
		console.error(error);
		process.exit(1);
	}
}
function renderError(cliOpts, error, status = 500, title = "Server Error") {
	const safeTitle = escapeHtml(title);
	let html = `<!DOCTYPE html><html><head><title>${safeTitle}</title></head><body>`;
	if (cliOpts.prod || process.env.NODE_ENV === "production") html += `<h1>${safeTitle}</h1><p>Something went wrong while processing your request.</p>`;
	else html += `
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f8f9fa; color: #333; }
      h1 { color: #dc3545; }
      pre { background: #fff; padding: 10px; border-radius: 5px; overflow: auto; }
      code { font-family: monospace; }
      #error { display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; }
    </style>
    <div id="error"><h1>${safeTitle}</h1><pre>${escapeHtml(error instanceof Error ? error.stack || error.message : String(error))}</pre></div>
    `;
	return new Response(html, {
		status,
		headers: { "Content-Type": "text/html; charset=utf-8" }
	});
}
const HTML_ESCAPES = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&#39;"
};
function escapeHtml(str) {
	return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}
function printInfo(cliOpts, loaded) {
	let entryInfo;
	if (loaded.notFound) entryInfo = gray(`(create ${bold(`server.ts`)})`);
	else entryInfo = loaded.fetch ? cyan("./" + relative(".", fileURLToPath(loaded.url))) : red(`No fetch handler exported from ${loaded.url}`);
	console.log(gray(`${bold(gray("◆"))} Server handler: ${entryInfo}`));
	let staticInfo;
	if (cliOpts.static) staticInfo = cyan("./" + relative(".", cliOpts.static) + "/");
	else staticInfo = gray(`(create ${bold("public/")} dir)`);
	console.log(gray(`${bold(gray("◇"))} Static files:   ${staticInfo}`));
	console.log("");
}
async function cliFetch(cliOpts) {
	const stdin = cliOpts.stdin || process.stdin;
	const stdout = cliOpts.stdout || process.stdout;
	const stderr = cliOpts.stderr || process.stderr;
	let fetchHandler = globalThis.fetch;
	let inputURL = cliOpts.url || "/";
	if (inputURL[0] === "/") {
		const loaded = await loadServerEntry({
			dir: cliOpts.dir,
			entry: cliOpts.entry,
			...cliOpts?.loader
		});
		if (cliOpts.verbose && loaded.url) {
			stderr.write(`* Entry: ${fileURLToPath(loaded.url)}\n`);
			if (loaded.nodeCompat) stderr.write(`* Using node compat mode\n`);
		}
		if (loaded.notFound) throw new Error(`Server entry file not found in ${resolve(cliOpts.dir || ".")}`, { cause: {
			dir: cliOpts.dir || process.cwd(),
			entry: cliOpts.entry || void 0
		} });
		else if (!loaded.fetch) throw new Error("No fetch handler exported", { cause: {
			dir: cliOpts.dir || process.cwd(),
			entry: cliOpts.entry || void 0,
			loaded
		} });
		fetchHandler = loaded.fetch;
	} else {
		stderr.write(`* Fetching remote URL: ${inputURL}\n`);
		if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(inputURL)) inputURL = `http${cliOpts.tls ? "s" : ""}://${inputURL}`;
		fetchHandler = globalThis.fetch;
	}
	const headers = new Headers();
	if (cliOpts.header) for (const header of cliOpts.header) {
		const colonIndex = header.indexOf(":");
		if (colonIndex > 0) {
			const name = header.slice(0, colonIndex).trim();
			const value = header.slice(colonIndex + 1).trim();
			headers.append(name, value);
		}
	}
	if (!headers.has("User-Agent")) headers.set("User-Agent", "srvx (curl)");
	if (!headers.has("Accept")) headers.set("Accept", "text/markdown, application/json;q=0.9, text/plain;q=0.8, text/html;q=0.7, text/*;q=0.6, */*;q=0.5");
	let body;
	let isStream = false;
	if (cliOpts.data !== void 0) {
		if (cliOpts.data === "@-") {
			isStream = true;
			body = new ReadableStream({ async start(controller) {
				for await (const chunk of stdin) controller.enqueue(chunk);
				controller.close();
			} });
		} else if (cliOpts.data.startsWith("@")) {
			isStream = true;
			body = Readable.toWeb(createReadStream(cliOpts.data.slice(1)));
		} else body = cliOpts.data;
	}
	const method = cliOpts.method || (body === void 0 ? "GET" : "POST");
	const url = new URL(inputURL, `http${cliOpts.tls ? "s" : ""}://${cliOpts.host || cliOpts.hostname || "localhost"}`);
	const reqInit = {
		method,
		headers,
		body
	};
	if (isStream) reqInit.duplex = "half";
	const req = new Request(url, reqInit);
	if (cliOpts.verbose) {
		const parsedUrl = new URL(url);
		stderr.write(`> ${method} ${parsedUrl.pathname}${parsedUrl.search} HTTP/1.1\n`);
		stderr.write(`> Host: ${parsedUrl.host}\n`);
		for (const [name, value] of headers) stderr.write(`> ${name}: ${value}\n`);
		stderr.write(">\n");
	}
	const res = await fetchHandler(req);
	if (cliOpts.verbose) {
		stderr.write(`< HTTP/1.1 ${res.status} ${res.statusText}\n`);
		for (const [name, value] of res.headers) stderr.write(`< ${name}: ${value}\n`);
		stderr.write("<\n");
	}
	if (res.body) {
		const { isBinary, encoding } = getResponseFormat(res);
		if (isBinary) for await (const chunk of res.body) stdout.write(chunk);
		else {
			const decoder = new TextDecoder(encoding);
			for await (const chunk of res.body) stdout.write(decoder.decode(chunk, { stream: true }));
			const remaining = decoder.decode();
			if (remaining) stdout.write(remaining);
			if (stdout.isTTY) stdout.write("\n");
		}
	}
	return res;
}
function getResponseFormat(res) {
	const contentType = res.headers.get("content-type") || "";
	return {
		isBinary: contentType.startsWith("application/octet-stream") || contentType.startsWith("image/") || contentType.startsWith("audio/") || contentType.startsWith("video/") || contentType.startsWith("application/pdf") || contentType.startsWith("application/zip") || contentType.startsWith("application/gzip"),
		encoding: contentType.includes("charset=") ? contentType.split("charset=")[1].split(";")[0].trim() : "utf8"
	};
}
const srvxMeta = {
	name: "srvx",
	version: "1.0.4",
	description: "Universal Server."
};
function usage(mainOpts) {
	const command = mainOpts.usage?.command || "srvx";
	const name = mainOpts.meta?.name || srvxMeta.name;
	const ver = mainOpts.meta?.version || srvxMeta.version;
	const desc = mainOpts.meta?.description || srvxMeta.description;
	return `
${cyan(name)}${gray(`${ver ? ` ${ver}` : ""} ${desc ? `- ${desc}` : ""}`)}

${bold("SERVE MODE")}

${bold(green(`# ${command} serve [options]`))}
${gray("$")} ${cyan(command)} serve --entry ${gray("./server.ts")}    ${gray("# Start development server")}
${gray("$")} ${cyan(command)} serve --prod                 ${gray("# Start production  server")}
${gray("$")} ${cyan(command)} serve --port=8080            ${gray("# Listen on port 8080")}
${gray("$")} ${cyan(command)} serve --host=localhost       ${gray("# Bind to localhost only")}
${gray("$")} ${cyan(command)} serve --static=./dist        ${gray("# Serve static files (no entry needed)")}
${gray("$")} ${cyan(command)} serve --import=jiti/register ${gray(`# Enable ${url("jiti", "https://github.com/unjs/jiti")} loader`)}
${gray("$")} ${cyan(command)} serve --tls --cert=cert.pem --key=key.pem  ${gray("# Enable TLS (HTTPS/HTTP2)")}

${bold("FETCH MODE")}

${bold(green(`# ${command} fetch|curl [options] [url]`))}
${gray("$")} ${cyan(command)} fetch                  ${gray("# Fetch from default entry")}
${gray("$")} ${cyan(command)} fetch /api/users       ${gray("# Fetch a specific URL/path")}
${gray("$")} ${cyan(command)} fetch --entry ./server.ts /api/users ${gray("# Fetch using a specific entry")}
${gray("$")} ${cyan(command)} fetch -X POST /api/users ${gray("# POST request")}
${gray("$")} ${cyan(command)} fetch -H "Content-Type: application/json" /api ${gray("# With headers")}
${gray("$")} ${cyan(command)} fetch -d '{"name":"foo"}' /api ${gray("# With request body")}
${gray("$")} ${cyan(command)} fetch -v /api/users    ${gray("# Verbose output (show headers)")}
${gray("$")} echo '{"name":"foo"}' | ${cyan(command)} fetch -d @- /api ${gray("# Body from stdin")}

${bold("COMMON OPTIONS")}

  ${green("--entry")} ${yellow("<file>")}            Server entry file to use
  ${green("--dir")} ${yellow("<dir>")}               Working directory for resolving entry file
  ${green("-h, --help")}                Show this help message
  ${green("--version")}                 Show server and runtime versions

${bold("SERVE OPTIONS")}

  ${green("-p, --port")} ${yellow("<port>")}         Port to listen on (default: ${yellow("3000")})
  ${green("--host, --hostname")} ${yellow("<host>")} Host to bind to (default: all interfaces)
  ${green("-s, --static")} ${yellow("<dir>")}        Serve static files from the specified directory (default: ${yellow("public")})
  ${green("--prod")}                    Run in production mode (no watch, no debug)
  ${green("--import")} ${yellow("<loader>")}         ES module to preload
  ${green("--tls")}                     Enable TLS (HTTPS/HTTP2)
  ${green("--cert")} ${yellow("<file>")}             TLS certificate file
  ${green("--key")}  ${yellow("<file>")}             TLS private key file

${bold("FETCH OPTIONS")}

  ${green("-X, --method")} ${yellow("<method>")}     HTTP method (default: ${yellow("GET")}, or ${yellow("POST")} if body is provided; ${green("--request")} is a curl alias)
  ${green("-H, --header")} ${yellow("<header>")}     Add header (format: "Name: Value", can be used multiple times)
  ${green("-d, --data")} ${yellow("<data>")}         Request body (use ${yellow("@-")} for stdin, ${yellow("@file")} for file)
  ${green("--host")} ${yellow("<host>")}             Host for a schemeless URL/path (default: ${yellow("localhost")})
  ${green("--tls")}                     Use ${yellow("https")} for a schemeless URL/path
  ${green("-v, --verbose")}             Show request and response headers

  Exits with code ${yellow("22")} on a non-2xx response (like ${cyan("curl --fail")}).

${bold("ENVIRONMENT")}

  ${green("PORT")}                      Default port to listen on
  ${green("HOST")}                      Default host to bind to
  ${green("NODE_ENV")}                  Set to ${yellow("production")} for production mode.

${mainOpts.usage?.docs ? `➤ ${url("Documentation", mainOpts.usage.docs)}` : ""}
${mainOpts.usage?.issues ? `➤ ${url("Report issues", mainOpts.usage.issues)}` : ""}
`.trim();
}
async function main(mainOpts) {
	const args = mainOpts.args ?? process.argv.slice(2);
	let cliOpts;
	try {
		cliOpts = parseArgs$1(args);
	} catch (error) {
		const command = mainOpts.usage?.command || "srvx";
		console.error(red(error.message || String(error)));
		console.error(gray(`Run \`${command} --help\` for usage.`));
		process.exit(1);
	}
	if (cliOpts.version) {
		process.stdout.write(versions(mainOpts).join("\n") + "\n");
		process.exit(0);
	}
	if (cliOpts.help) {
		console.log(usage(mainOpts));
		process.exit(0);
	}
	const envFiles = [".env", cliOpts.prod ? ".env.production" : ".env.local"].filter((f) => existsSync(f));
	if (cliOpts.mode === "fetch") {
		for (const envFile of [...envFiles].reverse()) process.loadEnvFile?.(envFile);
		try {
			const res = await cliFetch(cliOpts);
			process.exit(res.ok ? 0 : 22);
		} catch (error) {
			console.error(error);
			process.exit(1);
		}
	}
	if (process.send) return startServer(cliOpts);
	console.log(gray([...versions(mainOpts), cliOpts.prod ? "prod" : "dev"].join(" · ")));
	if (envFiles.length > 0) console.log(`${gray(`Loading environment variables from ${magenta(envFiles.join(", "))}`)}`);
	if (cliOpts.prod && !cliOpts.import) {
		for (const envFile of [...envFiles].reverse()) process.loadEnvFile?.(envFile);
		await startServer(cliOpts);
		return;
	}
	const isBun = !!process.versions.bun;
	const isDeno = !!process.versions.deno;
	const isNode = !isBun && !isDeno;
	const runtimeArgs = [];
	runtimeArgs.push(...envFiles.map((f) => `--env-file=${f}`));
	if (!cliOpts.prod) runtimeArgs.push("--watch");
	if (cliOpts.import && (isNode || isBun)) runtimeArgs.push(`--import=${cliOpts.import}`);
	await forkCLI(args, runtimeArgs);
}
function parseArgs$1(args) {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			help: {
				type: "boolean",
				short: "h"
			},
			version: { type: "boolean" },
			dir: { type: "string" },
			entry: { type: "string" },
			host: { type: "string" },
			hostname: { type: "string" },
			tls: { type: "boolean" },
			url: { type: "string" },
			prod: { type: "boolean" },
			port: {
				type: "string",
				short: "p"
			},
			static: {
				type: "string",
				short: "s"
			},
			import: { type: "string" },
			cert: { type: "string" },
			key: { type: "string" },
			method: {
				type: "string",
				short: "X"
			},
			request: { type: "string" },
			header: {
				type: "string",
				multiple: true,
				short: "H"
			},
			verbose: {
				type: "boolean",
				short: "v"
			},
			data: {
				type: "string",
				short: "d"
			}
		}
	});
	let mode = "serve";
	const sub = positionals[0];
	if (sub === "fetch" || sub === "curl") {
		mode = "fetch";
		positionals.shift();
	} else if (sub === "serve") positionals.shift();
	const prod = values.prod ?? process.env.NODE_ENV === "production";
	if (mode === "fetch") {
		const method = values.method || values.request;
		const url = values.url || positionals[0] || "/";
		return {
			mode,
			...values,
			prod,
			url,
			method
		};
	}
	const maybeEntryOrDir = positionals[0];
	if (maybeEntryOrDir) {
		if (values.entry || values.dir) throw new Error("Cannot use a positional path together with --entry or --dir.");
		if (!existsSync(maybeEntryOrDir)) throw new Error(`No such file or directory: ${maybeEntryOrDir}`);
		if (statSync(maybeEntryOrDir).isDirectory()) values.dir = maybeEntryOrDir;
		else values.entry = maybeEntryOrDir;
	}
	return {
		mode,
		...values,
		prod
	};
}
async function startServer(cliOpts) {
	setupProcessErrorHandlers();
	await cliServe(cliOpts);
}
async function forkCLI(args, runtimeArgs) {
	const srvxBin = fileURLToPath(globalThis.__SRVX_BIN__ || new URL("../bin/srvx.mjs", import.meta.url));
	const child = fork(srvxBin, [...args], { execArgv: [...process.execArgv, ...runtimeArgs].filter(Boolean) });
	child.on("error", (error) => {
		console.error("Error in child process:", error);
		process.exit(1);
	});
	child.on("exit", (code) => {
		if (code !== 0) {
			console.error(`Child process exited with code ${code}`);
			process.exit(code);
		}
	});
	child.on("message", (msg) => {
		if (msg && msg.error === "no-entry") {
			console.error("\n" + red(NO_ENTRY_ERROR) + "\n");
			process.exit(3);
		}
	});
	let cleanupCalled = false;
	const cleanup = (signal, exitCode) => {
		if (cleanupCalled) return;
		cleanupCalled = true;
		try {
			child.kill(signal || "SIGTERM");
		} catch (error) {
			console.error("Error killing child process:", error);
		}
		if (exitCode !== void 0) process.exit(exitCode);
	};
	process.on("exit", () => cleanup("SIGTERM"));
	process.on("SIGTERM", () => cleanup("SIGTERM", 143));
	if (runtimeArgs.includes("--watch")) process.on("SIGINT", () => cleanup("SIGINT", 130));
}
function setupProcessErrorHandlers() {
	process.on("uncaughtException", (error) => {
		console.error("Uncaught exception:", error);
		process.exit(1);
	});
	process.on("unhandledRejection", (reason) => {
		console.error("Unhandled rejection:", reason);
		process.exit(1);
	});
}
function versions(mainOpts) {
	const versions = [];
	if (mainOpts.meta?.name) versions.push(`${mainOpts.meta.name} ${mainOpts.meta.version || ""}`.trim());
	versions.push(`${srvxMeta.name} ${srvxMeta.version}`);
	versions.push(runtime());
	return versions;
}
function runtime() {
	if (process.versions.bun) return `bun ${process.versions.bun}`;
	else if (process.versions.deno) return `deno ${process.versions.deno}`;
	else return `node ${process.versions.node}`;
}
export { cliFetch, main };
