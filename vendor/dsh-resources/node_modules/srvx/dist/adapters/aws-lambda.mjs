import { errorPlugin, wrapFetch } from "../_chunks/_plugins.mjs";
import { HOST_RE, forwardedHopValue, resolveClientIP, trustedHops } from "../_chunks/_trust-proxy.mjs";
function awsRequest(event, context, trustProxy) {
	const sourceIp = awsEventIP(event);
	const forwardedFor = awsForwardedFor(event);
	const hops = trustedHops(trustProxy, sourceIp, forwardedFor);
	const req = new Request(awsEventURL(event, hops), {
		method: awsEventMethod(event),
		headers: awsEventHeaders(event),
		body: awsEventBody(event)
	});
	req.runtime = {
		name: "aws-lambda",
		awsLambda: {
			event,
			context
		}
	};
	req.ip = resolveClientIP(trustProxy, sourceIp, forwardedFor);
	return req;
}
function awsForwardedFor(event) {
	return event.headers["X-Forwarded-For"] || event.headers["x-forwarded-for"];
}
function awsEventMethod(event) {
	return event.httpMethod || event.requestContext?.http?.method || "GET";
}
function awsEventIP(event) {
	return event.requestContext?.http?.sourceIp || event.requestContext?.identity?.sourceIp;
}
function awsEventURL(event, hops) {
	const rawPath = event.path || event.rawPath || "/";
	const path = rawPath[0] === "/" ? rawPath : `/${rawPath}`;
	const query = awsEventQuery(event);
	const forwardedHost = forwardedHopValue(event.headers["X-Forwarded-Host"] || event.headers["x-forwarded-host"], hops);
	const host = (forwardedHost && HOST_RE.test(forwardedHost) ? forwardedHost : void 0) || event.headers.host || event.headers.Host || event.requestContext?.domainName;
	const hostname = host && HOST_RE.test(host) ? host : "_invalid_";
	const protocol = forwardedHopValue(event.headers["X-Forwarded-Proto"] || event.headers["x-forwarded-proto"], hops) === "http" ? "http" : "https";
	return new URL(`${protocol}://${hostname}${path}${query ? `?${query}` : ""}`);
}
function awsEventQuery(event) {
	if (typeof event.rawQueryString === "string") return event.rawQueryString;
	return stringifyQuery({
		...event.queryStringParameters,
		...event.multiValueQueryStringParameters
	});
}
function awsEventHeaders(event) {
	const headers = new Headers();
	for (const [key, value] of Object.entries(event.headers)) if (value) headers.set(key, value);
	const cookies = "cookies" in event && event.cookies?.length ? event.cookies : void 0;
	if (cookies) {
		headers.delete("cookie");
		for (const cookie of cookies) headers.append("cookie", cookie);
	}
	return headers;
}
function awsEventBody(event) {
	if (!event.body) return;
	if (event.isBase64Encoded) return Buffer.from(event.body || "", "base64");
	return event.body;
}
function awsResponseHeaders(response, event) {
	const headers = Object.create(null);
	for (const [key, value] of response.headers) {
		if (key === "set-cookie") continue;
		if (value) headers[key] = Array.isArray(value) ? value.join(",") : String(value);
	}
	const cookies = response.headers.getSetCookie();
	if (cookies.length === 0) return { headers };
	if (event?.version === "2.0" || !!event?.requestContext?.http) return {
		headers,
		cookies
	};
	const albEvent = event;
	if (albEvent?.requestContext?.elb && !albEvent.multiValueHeaders) {
		headers["set-cookie"] = cookies[cookies.length - 1];
		return { headers };
	}
	return {
		headers,
		multiValueHeaders: { "set-cookie": cookies }
	};
}
async function awsResponseBody(response) {
	if (!response.body) return { body: "" };
	const buffer = await toBuffer(response.body);
	return isTextType(response.headers.get("content-type") || "") ? { body: buffer.toString("utf8") } : {
		body: buffer.toString("base64"),
		isBase64Encoded: true
	};
}
async function awsStreamResponse(response, responseStream, event) {
	const metadata = {
		statusCode: response.status,
		...awsResponseHeaders(response, event)
	};
	const reader = response.body?.getReader();
	let writer;
	const startWriter = (hasBody) => {
		if (hasBody && !isBodylessStatus(response.status) && !metadata.headers["transfer-encoding"]) metadata.headers["transfer-encoding"] = "chunked";
		writer = globalThis.awslambda.HttpResponseStream.from(responseStream, metadata);
		return writer;
	};
	try {
		const first = await readFirstChunk(reader);
		if (first.done) {
			startWriter(false).write("");
			return;
		}
		await streamToNodeStream(reader, startWriter(true), first);
	} finally {
		(writer ?? startWriter(false)).end();
	}
}
function isBodylessStatus(status) {
	return status < 200 || status === 204 || status === 205 || status === 304;
}
async function readFirstChunk(reader) {
	if (!reader) return {
		done: true,
		value: void 0
	};
	try {
		return await reader.read();
	} catch (error) {
		reader.releaseLock();
		throw error;
	}
}
async function streamToNodeStream(reader, writer, first) {
	try {
		let result = first;
		while (!result.done) {
			if (!writer.write(result.value)) await waitForDrain(writer);
			result = await reader.read();
		}
	} catch (error) {
		reader.cancel(error).catch(() => {});
		throw error;
	} finally {
		reader.releaseLock();
	}
}
function waitForDrain(writer) {
	const closedError = () => /* @__PURE__ */ new Error("Response stream closed before it could drain");
	const stream = writer;
	if (stream.destroyed || stream.writableEnded) return Promise.reject(stream.errored ?? closedError());
	return new Promise((resolve, reject) => {
		const settle = (error) => {
			writer.removeListener("drain", onDrain);
			writer.removeListener("error", onError);
			writer.removeListener("close", onClose);
			if (error) reject(error);
			else resolve();
		};
		const onDrain = () => settle();
		const onError = (error) => settle(error);
		const onClose = () => settle(closedError());
		writer.once("drain", onDrain);
		writer.once("error", onError);
		writer.once("close", onClose);
	});
}
function isTextType(contentType = "") {
	const mimeType = contentType.split(";")[0].trim();
	return /^text\/|\/(javascript|json|xml)|\+(json|xml)$/i.test(mimeType);
}
function toBuffer(data) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		data.pipeTo(new WritableStream({
			write(chunk) {
				chunks.push(chunk);
			},
			close() {
				resolve(Buffer.concat(chunks));
			},
			abort(reason) {
				reject(reason);
			}
		})).catch(reject);
	});
}
function stringifyQuery(obj) {
	const parts = [];
	for (const [key, value] of Object.entries(obj)) for (const item of Array.isArray(value) ? value : [value]) {
		const pair = new URLSearchParams([[key, item == null ? "" : String(item)]]).toString();
		const bare = (item == null || item === "") && key !== "";
		parts.push(bare ? pair.slice(0, -1) : pair);
	}
	return parts.join("&");
}
async function requestToAwsEvent(request) {
	const url = new URL(request.url);
	const headers = {};
	const cookies = [];
	for (const [key, value] of request.headers) {
		if (key.toLowerCase() === "cookie") cookies.push(...splitCookieHeader(value));
		headers[key] = value;
	}
	let body;
	let isBase64Encoded = false;
	if (request.body) {
		const buffer = await toBuffer(request.body);
		if (isTextType(request.headers.get("content-type") || "")) body = buffer.toString("utf8");
		else {
			body = buffer.toString("base64");
			isBase64Encoded = true;
		}
	}
	const now = Date.now();
	return {
		httpMethod: request.method,
		path: url.pathname,
		resource: url.pathname,
		queryStringParameters: Object.fromEntries(url.searchParams),
		multiValueQueryStringParameters: parseMultiValueQuery(url.searchParams),
		pathParameters: void 0,
		stageVariables: void 0,
		multiValueHeaders: Object.fromEntries([...request.headers].map(([k, v]) => [k, [v]])),
		version: "2.0",
		rawPath: url.pathname,
		rawQueryString: url.search.slice(1),
		cookies: cookies.length > 0 ? cookies : void 0,
		routeKey: `${request.method} ${url.pathname}`,
		headers,
		body: body ?? null,
		isBase64Encoded,
		requestContext: {
			accountId: "000000000000",
			apiId: "local",
			resourceId: "local",
			stage: "$default",
			requestId: crypto.randomUUID(),
			identity: {
				sourceIp: "127.0.0.1",
				userAgent: request.headers.get("user-agent") || "",
				accessKey: null,
				accountId: null,
				apiKey: null,
				apiKeyId: null,
				caller: null,
				clientCert: null,
				cognitoAuthenticationProvider: null,
				cognitoAuthenticationType: null,
				cognitoIdentityId: null,
				cognitoIdentityPoolId: null,
				principalOrgId: null,
				user: null,
				userArn: null
			},
			resourcePath: url.pathname,
			httpMethod: request.method,
			path: url.pathname,
			protocol: "HTTP/1.1",
			requestTimeEpoch: now,
			authorizer: void 0,
			domainName: url.hostname,
			http: {
				method: request.method,
				path: url.pathname,
				protocol: "HTTP/1.1",
				sourceIp: "127.0.0.1",
				userAgent: request.headers.get("user-agent") || ""
			},
			routeKey: `${request.method} ${url.pathname}`,
			time: new Date(now).toISOString(),
			timeEpoch: now,
			domainPrefix: url.hostname.split(".")[0]
		}
	};
}
function splitCookieHeader(value) {
	return value.split(";").map((c) => c.trim()).filter(Boolean);
}
function parseMultiValueQuery(params) {
	const result = {};
	for (const [key, value] of params) {
		if (!result[key]) result[key] = [];
		result[key].push(value);
	}
	return result;
}
function awsResultToResponse(result) {
	if (typeof result === "string") return new Response(result, { status: 200 });
	const headers = new Headers();
	if (result.headers) {
		for (const [key, value] of Object.entries(result.headers)) if (value !== void 0) headers.set(key, String(value));
	}
	if ("multiValueHeaders" in result && result.multiValueHeaders) {
		for (const [key, values] of Object.entries(result.multiValueHeaders)) if (values) for (const value of values) headers.append(key, String(value));
	}
	if ("cookies" in result && result.cookies) for (const cookie of result.cookies) headers.append("set-cookie", cookie);
	let body;
	if (typeof result.body === "string") {
		if (result.isBase64Encoded) body = Buffer.from(result.body, "base64");
		else body = result.body;
	}
	const statusCode = typeof result.statusCode === "number" ? result.statusCode : 200;
	return new Response(body, {
		status: statusCode,
		headers
	});
}
function createMockContext() {
	const id = crypto.randomUUID();
	return {
		callbackWaitsForEmptyEventLoop: true,
		functionName: "local",
		functionVersion: "$LATEST",
		invokedFunctionArn: `arn:aws:lambda:us-east-1:000000000000:function:local`,
		memoryLimitInMB: "128",
		awsRequestId: id,
		logGroupName: "/aws/lambda/local",
		logStreamName: `${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}/[$LATEST]${id}`,
		getRemainingTimeInMillis: () => 3e4,
		done: () => {},
		fail: () => {},
		succeed: () => {}
	};
}
function toLambdaHandler(options) {
	const server = new AWSLambdaServer(options);
	return (event, context) => server.fetch(event, context);
}
async function handleLambdaEvent(fetchHandler, event, context, trustProxy) {
	const response = await fetchHandler(awsRequest(event, context, trustProxy));
	return {
		statusCode: response.status,
		...awsResponseHeaders(response, event),
		...await awsResponseBody(response)
	};
}
async function handleLambdaEventWithStream(fetchHandler, event, responseStream, context, trustProxy) {
	await awsStreamResponse(await fetchHandler(awsRequest(event, context, trustProxy)), responseStream, event);
}
async function invokeLambdaHandler(handler, request) {
	return awsResultToResponse(await handler(await requestToAwsEvent(request), createMockContext()));
}
var AWSLambdaServer = class {
	runtime = "aws-lambda";
	options;
	fetch;
	constructor(options) {
		this.options = {
			...options,
			middleware: [...options.middleware || []]
		};
		for (const plugin of options.plugins || []) plugin(this);
		errorPlugin(this);
		const fetchHandler = wrapFetch(this);
		this.fetch = (event, context) => handleLambdaEvent(fetchHandler, event, context, this.options.trustProxy);
	}
	serve() {}
	ready() {
		return Promise.resolve().then(() => this);
	}
	close() {
		return Promise.resolve();
	}
};
export { handleLambdaEvent, handleLambdaEventWithStream, invokeLambdaHandler, toLambdaHandler };
