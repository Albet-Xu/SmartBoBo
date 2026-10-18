function isTrustedProxy(trustProxy, remoteAddress) {
	if (trustProxy === void 0 || trustProxy === false) return false;
	if (trustProxy === true) return true;
	if (trustProxy === "loopback") return isLoopbackAddress(remoteAddress);
	if (remoteAddress === void 0) return false;
	if (trustProxy.includes(remoteAddress)) return true;
	const mapped = ipv4FromMapped(remoteAddress);
	return mapped !== void 0 && trustProxy.includes(mapped);
}
function ipv4FromMapped(address) {
	return address.startsWith("::ffff:") && address.includes(".") ? address.slice(7) : void 0;
}
function isLoopbackAddress(address) {
	return !!address && (address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127."));
}
const HOST_RE = /^(\[(?:[A-Fa-f0-9:.]+)\]|(?:[A-Za-z0-9_-]+\.)*[A-Za-z0-9_-]+|(?:\d{1,3}\.){3}\d{1,3})(:\d{1,5})?$/;
function forwardedHostHasPort(host) {
	const bracket = host.lastIndexOf("]");
	return bracket === -1 ? host.includes(":") : host.indexOf(":", bracket) !== -1;
}
function forwardedList(value) {
	if (!value) return [];
	const raw = Array.isArray(value) ? value.join(",") : value;
	const out = [];
	for (const part of raw.split(",")) {
		const entry = part.trim();
		if (entry) out.push(entry);
	}
	return out;
}
function resolveClientIP(trustProxy, peer, forwardedFor) {
	if (!isTrustedProxy(trustProxy, peer)) return peer;
	const list = forwardedList(forwardedFor);
	for (let i = list.length - 1; i >= 0; i--) if (!isTrustedProxy(trustProxy, list[i])) return list[i];
	return list.length > 0 ? list[0] : peer;
}
function trustedHops(trustProxy, peer, forwardedFor) {
	if (!isTrustedProxy(trustProxy, peer)) return 0;
	const list = forwardedList(forwardedFor);
	let hops = 1;
	for (let i = list.length - 1; i >= 0; i--) {
		if (!isTrustedProxy(trustProxy, list[i])) return hops;
		hops++;
	}
	return Number.POSITIVE_INFINITY;
}
function forwardedHopValue(value, hops) {
	if (hops <= 0) return;
	const list = forwardedList(value);
	if (list.length === 0) return;
	return list[Math.max(0, list.length - hops)];
}
const trustProxyPlugin = (server) => {
	const trustProxy = server.options.trustProxy;
	if (trustProxy === void 0 || trustProxy === false) return;
	server.options.middleware.unshift((request, next) => {
		applyTrustedProxy(request, trustProxy);
		return next();
	});
};
function applyTrustedProxy(request, trustProxy) {
	const peer = request.ip;
	const headers = request.headers;
	const hops = trustedHops(trustProxy, peer, headers.get("x-forwarded-for"));
	if (hops === 0) return;
	const forwardedProto = forwardedHopValue(headers.get("x-forwarded-proto"), hops);
	const forwardedHost = forwardedHopValue(headers.get("x-forwarded-host"), hops);
	if (forwardedProto || forwardedHost) {
		const url = new URL(request.url);
		if (forwardedProto === "https" || forwardedProto === "http") url.protocol = `${forwardedProto}:`;
		if (forwardedHost && HOST_RE.test(forwardedHost)) {
			url.host = forwardedHost;
			if (url.port && !forwardedHostHasPort(forwardedHost)) url.port = "";
		}
		Object.defineProperty(request, "url", {
			value: url.href,
			enumerable: true,
			configurable: true
		});
	}
	const client = resolveClientIP(trustProxy, peer, headers.get("x-forwarded-for"));
	if (client && client !== peer) Object.defineProperty(request, "ip", {
		value: client,
		enumerable: true,
		configurable: true
	});
}
export { HOST_RE, forwardedHopValue, resolveClientIP, trustProxyPlugin, trustedHops };
