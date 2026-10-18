import { errorPlugin, wrapFetch } from "../_chunks/_plugins.mjs";
const FastURL = URL;
const FastResponse = Response;
const isBrowserWindow = typeof window !== "undefined" && typeof navigator !== "undefined";
const isServiceWorker = /* @__PURE__ */ (() => typeof self !== "undefined" && "skipWaiting" in self)();
function serve(options) {
	return new ServiceWorkerServer(options);
}
var ServiceWorkerServer = class {
	runtime = "service-worker";
	options;
	fetch;
	#fetchListener;
	#listeningPromise;
	#registration;
	constructor(options) {
		this.options = {
			...options,
			middleware: [...options.middleware || []]
		};
		for (const plugin of options.plugins || []) plugin(this);
		errorPlugin(this);
		const fetchHandler = wrapFetch(this);
		this.fetch = (request, event) => {
			Object.defineProperties(request, { runtime: {
				enumerable: true,
				value: {
					name: "service-worker",
					serviceWorker: { event }
				}
			} });
			return Promise.resolve(fetchHandler(request));
		};
		if (!options.manual) this.serve();
	}
	serve() {
		if (isBrowserWindow) {
			if (!navigator.serviceWorker) throw new Error("Service worker is not supported in the current window.");
			const swURL = this.options.serviceWorker?.url;
			if (!swURL) throw new Error("Service worker URL is not provided. Please set the `serviceWorker.url` serve option or manually register.");
			this.#listeningPromise = navigator.serviceWorker.register(swURL, {
				type: "module",
				scope: this.options.serviceWorker?.scope
			}).then((registration) => {
				this.#registration = registration;
				if (navigator.serviceWorker.controller) return;
				navigator.serviceWorker.addEventListener("controllerchange", () => {
					location.reload();
				}, { once: true });
			});
		} else if (isServiceWorker) {
			this.#fetchListener = (event) => {
				Object.defineProperty(event.request, "waitUntil", { value: event.waitUntil.bind(event) });
				event.respondWith((async () => {
					const response = await this.fetch(event.request, event);
					return response.status === 404 ? fetch(event.request) : response;
				})());
			};
			addEventListener("fetch", this.#fetchListener);
			self.addEventListener("install", () => {
				self.skipWaiting();
			});
			self.addEventListener("activate", () => {
				self.clients?.claim?.();
			});
		}
	}
	ready() {
		return Promise.resolve(this.#listeningPromise).then(() => this);
	}
	async close() {
		if (this.#fetchListener) removeEventListener("fetch", this.#fetchListener);
		if (isBrowserWindow) {
			await this.#registration?.unregister();
			this.#registration = void 0;
		} else if (isServiceWorker) await self.registration.unregister();
	}
};
export { FastResponse, FastURL, serve };
