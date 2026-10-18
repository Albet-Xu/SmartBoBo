function limitRequestBody(request, maxRequestBodySize, options) {
	if (!request.body) return request;
	const createError = options?.createError ?? createBodyTooLargeError;
	const contentLengthHeader = request.headers.get("content-length");
	const contentLength = contentLengthHeader && /^\d+$/.test(contentLengthHeader) ? Number(contentLengthHeader) : NaN;
	const initiallyUsed = request.bodyUsed;
	const overLimit = contentLength > maxRequestBodySize;
	if (overLimit) request.body.cancel(createError(maxRequestBodySize)).catch(() => {});
	let limited;
	let nativeRequest;
	const limitedBody = () => limited ??= new Response(overLimit ? erroredStream(createError(maxRequestBodySize)) : limitBodyStream(request.body, maxRequestBodySize, options));
	return new Proxy(request, { get(target, prop) {
		if (prop === "body") return limitedBody().body;
		if (prop === "bodyUsed") return initiallyUsed || (limited?.bodyUsed ?? false);
		if (typeof prop === "string" && bodyReadMethods.has(prop)) return () => limitedBody()[prop]();
		if (prop === "_request" && "_request" in target) return nativeRequest ??= new Request(target.url, {
			method: target.method,
			headers: target.headers,
			signal: target.signal,
			body: limitedBody().body,
			duplex: "half"
		});
		if (prop === "clone") return () => limitRequestBody(target.clone(), maxRequestBodySize, options);
		const value = Reflect.get(target, prop, target);
		return typeof value === "function" ? value.bind(target) : value;
	} });
}
function limitBodyStream(stream, maxRequestBodySize, options) {
	const createError = options?.createError ?? createBodyTooLargeError;
	const reader = stream.getReader();
	let size = 0;
	return new ReadableStream({
		async pull(controller) {
			const { done, value } = await reader.read();
			if (done) {
				controller.close();
				return;
			}
			size += value.byteLength;
			if (size > maxRequestBodySize) {
				const error = createError(maxRequestBodySize);
				reader.cancel(error).catch(() => {});
				controller.error(error);
				return;
			}
			controller.enqueue(value);
		},
		cancel(reason) {
			return reader.cancel(reason);
		}
	});
}
const bodyReadMethods = /* @__PURE__ */ new Set([
	"arrayBuffer",
	"blob",
	"bytes",
	"formData",
	"json",
	"text"
]);
function createBodyTooLargeError(maxRequestBodySize) {
	return Object.assign(/* @__PURE__ */ new Error(`Request body exceeds the maximum allowed size of ${maxRequestBodySize} bytes.`), {
		code: "ERR_BODY_TOO_LARGE",
		statusCode: 413,
		status: 413
	});
}
function erroredStream(error) {
	return new ReadableStream({ start(controller) {
		controller.error(error);
	} });
}
export { createBodyTooLargeError, limitBodyStream, limitRequestBody };
