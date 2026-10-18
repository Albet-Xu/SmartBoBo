window.__ModuleLoader__.load({
	id: "bobo-browser-ui",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:E:\BoBo-Handyman\dsh\packages\bobo\ui-browser-cloak\src\client\CloakPanel.module.css.mjs
		const css = ".g69FgG_root{height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);flex-direction:column;flex:auto;display:flex}.g69FgG_toolbar{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:center;gap:4px;height:38px;padding:5px 6px;display:flex}.g69FgG_tabs{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);scrollbar-width:thin;flex:none;align-items:center;gap:4px;max-width:100%;padding:5px 6px 4px;display:flex;overflow-x:auto}.g69FgG_tab,.g69FgG_tabActive{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:6px;flex:none;align-items:center;max-width:148px;display:inline-flex}.g69FgG_tabActive{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color);background:var(--dsw-alias-interactive-bg-hover)}.g69FgG_tabPick{min-width:0;height:24px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);text-align:left;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;background:0 0;border:0;flex:auto;padding:0 4px 0 8px;overflow:hidden}.g69FgG_tabActive .g69FgG_tabPick{color:var(--dsw-alias-label-primary)}.g69FgG_tabClose{width:20px;height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;flex:none;justify-content:center;align-items:center;padding:0 4px 0 0;display:inline-flex}.g69FgG_tabClose:hover{color:var(--dsw-alias-label-primary)}.g69FgG_address,.g69FgG_insert{box-sizing:border-box;min-width:0;height:28px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;flex:auto;padding:0 9px}.g69FgG_address:focus,.g69FgG_insert:focus{outline:1px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color);outline-offset:-1px}.g69FgG_tool{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:6px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.g69FgG_tool:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.g69FgG_tool:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.g69FgG_status{min-width:0;font:var(--dsw-font-xxxs-11);border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:baseline;gap:6px;padding:4px 10px;display:flex}.g69FgG_phase{color:var(--dsw-alias-label-secondary);flex:none}.g69FgG_pageTitle{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:0 auto;overflow:hidden}.g69FgG_pageUrl{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;overflow:hidden}.g69FgG_fault{color:var(--dsw-alias-state-error-primary);font:var(--dsw-font-xxxs-11);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);flex:none;padding:6px 12px}.g69FgG_stage{flex:auto;justify-content:center;align-items:center;min-height:0;display:flex;overflow:hidden}.g69FgG_surface{touch-action:none;width:100%;height:100%;position:relative}.g69FgG_surface:focus-visible{outline:1px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color);outline-offset:-1px}.g69FgG_canvas{object-fit:contain;background:var(--dsw-alias-bg-layer-1);width:100%;height:100%;display:block}.g69FgG_notice{text-align:center;flex-direction:column;justify-content:center;align-items:center;gap:10px;padding:24px;display:flex}.g69FgG_noticeText{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13);margin:0}.g69FgG_insertRow{flex:none;align-items:center;gap:4px;padding:5px 6px 0;display:flex}.g69FgG_hint{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11);flex:none;margin:0;padding:4px 10px 6px}.g69FgG_titleIcon{flex:none;margin-right:4px}.g69FgG_imeInput{position:absolute;width:1px;height:1px;padding:0;border:none;opacity:0;resize:none;overflow:hidden;z-index:1;background:transparent;color:transparent;caret-color:transparent}";
		const tagId = "bobo-browser-ui/CloakPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "bobo-browser-ui";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var CloakPanel_module_css_default = {
			"address": "g69FgG_address",
			"canvas": "g69FgG_canvas",
			"fault": "g69FgG_fault",
			"hint": "g69FgG_hint",
			"insert": "g69FgG_insert",
			"insertRow": "g69FgG_insertRow",
			"notice": "g69FgG_notice",
			"noticeText": "g69FgG_noticeText",
			"pageTitle": "g69FgG_pageTitle",
			"pageUrl": "g69FgG_pageUrl",
			"phase": "g69FgG_phase",
			"root": "g69FgG_root",
			"stage": "g69FgG_stage",
			"status": "g69FgG_status",
			"surface": "g69FgG_surface",
			"imeInput": "g69FgG_imeInput",
			"tab": "g69FgG_tab",
			"tabActive": "g69FgG_tabActive",
			"tabClose": "g69FgG_tabClose",
			"tabPick": "g69FgG_tabPick",
			"tabs": "g69FgG_tabs",
			"titleIcon": "g69FgG_titleIcon",
			"tool": "g69FgG_tool",
			"toolbar": "g69FgG_toolbar"
		};
		//#endregion
		//#region src/client/CloakPanel.tsx
		/**
		* The right Sidebar's built-in browser panel: a frame-by-frame JPEG mirror of
		* the deployment's long-lived Cloak page, plus the input channel that drives
		* that page.
		*
		* SHARED SESSION PAGE — READ BEFORE CHANGING BEHAVIOUR. The panel owns no
		* browser and no page. Every command goes to the host bridge on
		* `/bobo-cloak/cmd`, which forwards it to the deployment's derived-port
		* Cloak service (`scripts/browser_server.py`); that service holds the
		* session page, shared with the agent's own browser work. So navigating here
		* replaces the page an agent is reading, an agent's `debug_navigate` replaces
		* the page here (the very next frame shows it), and the panel's navigations show
		* up in the agent's `debug_network`. That sharing is deliberate: one login, one
		* cookie jar, one current page.
		*
		* TABS AND POPUPS. A link that opens a new window — `target="_blank"`,
		* `window.open`, a middle-click — is followed by the service, which keeps the
		* page it came from as a background tab; the strip above the toolbar lists those
		* tabs and switches or closes them. An agent's `debug_navigate` is a takeover
		* rather than a new tab, and `debug_close` empties the whole set.
		*
		* State discipline: this component holds only local state. It never reads a
		* Context, never subscribes through a custom store, and never touches `ctx` —
		* the sole business input is the injected `t` seat, and every request leaves
		* from an event handler or an effect this component owns.
		*/
		/**
		* The one bridge route, shared with the handoff watcher that asks the bridge for
		* a waiting handoff on it; same-origin, so the browser attaches the session
		* cookie by itself.
		*/
		const COMMAND_URL = "/bobo-cloak/cmd";
		/**
		* Interval between two frame requests. The service streams frames via CDP
		* screencast (a frame arrives the moment the page changes and is cached;
		* nothing new is rendered per poll), so this is now just the poll that picks
		* the newest cached frame up — 50ms reads as live while a page scrolls, and a
		* steady page costs almost nothing (`unchanged` replies carry no image).
		* Tune here; nothing else depends on the value.
		*/
		const FRAME_INTERVAL_MS = 50;
		/** Leading-edge throttle for pointer moves: the service only needs the newest position. */
		const MOVE_THROTTLE_MS = 50;
		/**
		* Interval between two tab-list reads. The strip is a few small fields per tab,
		* so it costs far less than a frame, and 1s is enough for a tab that a link
		* opened to appear right after the picture has already followed it.
		*/
		const TABS_INTERVAL_MS = 1e3;
		/** Frame quality sent with every screenshot; lower means smaller frames and softer text. */
		const FRAME_QUALITY = 60;
		/** One frame request's budget: usually a cached-frame read, a live render only on the first frame. */
		const SCREENSHOT_TIMEOUT_MS = 3e4;
		/** Settle time before a resize follow sends `panel_resize`: a drag fires continuously. */
		const RESIZE_DEBOUNCE_MS = 300;
		/**
		* The home/new-tab page: iTab's web edition, shown whenever the shared session
		* has no page (first start, every tab closed) — a real browser's new-tab
		* behaviour. Verified rendering in headless Cloak (search box, widgets).
		*/
		const PANEL_HOME_URL = "https://web.itab.link/";
		/** Every other command's budget, `debug_navigate` included. */
		const COMMAND_TIMEOUT_MS = 15e3;
		/** Budget for `start`, which may launch a whole browser process. */
		const START_TIMEOUT_MS = 6e4;
		/**
		* Pixels per wheel line, used to convert a `deltaMode === LINE` wheel event to
		* pixels. Firefox reports wheel deltas in *lines* (a notch ≈ 3 lines) while the
		* service's `page.mouse.wheel` takes pixels: forwarding a raw `deltaY: 3`
		* scrolls the mirrored page 3px per notch, which reads as "the wheel does
		* nothing". PAGE deltas scale by the mirrored page's height instead.
		*/
		const WHEEL_LINE_PX = 16;
		/**
		* The tail both of the service's no-page refusals share ("…请先打开一个网址");
		* the screenshot op and the input ops word the prefix differently, and the
		* bridge forwards service replies verbatim. Matching this suffix is how the
		* panel learns that the page went away and the frame loop must stop.
		*/
		const NO_PAGE_REASON = "请先打开一个网址";
		/** DOM `KeyboardEvent.key` values forwarded as named presses rather than as text. */
		const NAMED_KEYS = {
			Enter: "Enter",
			Tab: "Tab",
			Escape: "Escape",
			Backspace: "Backspace",
			Delete: "Delete",
			ArrowUp: "ArrowUp",
			ArrowDown: "ArrowDown",
			ArrowLeft: "ArrowLeft",
			ArrowRight: "ArrowRight",
			Home: "Home",
			End: "End",
			PageUp: "PageUp",
			PageDown: "PageDown",
			" ": "Space"
		};
		/** A JSON object, or null for an array, a scalar, or a parse failure. */
		function asObject$1(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
		}
		/** A reply field read as text; anything but a string is the empty string. */
		function asText(value) {
			return typeof value === "string" ? value : "";
		}
		/** A reply field read as a positive number; anything else is null. */
		function asNumber(value) {
			return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
		}
		/**
		* The reply's `pages` array read as tab facts. A malformed entry is dropped
		* rather than guessed at: every tab id is positive (the service never reuses
		* one), so the same reader that validates the id validates the entry.
		* @param value - the `pages` field of a `panel_pages` reply.
		* @returns the tabs in service order, oldest first.
		*/
		function tabsFrom(value) {
			if (!Array.isArray(value)) return [];
			const tabs = [];
			for (const entry of value) {
				const item = asObject$1(entry);
				if (item === null) continue;
				const id = asNumber(item.id);
				if (id === null) continue;
				tabs.push({
					id,
					url: asText(item.url),
					title: asText(item.title),
					active: item.active === true
				});
			}
			return tabs;
		}
		/** Tab strip label: the page's title, or its address while the title is empty. */
		function tabLabel(tab) {
			return tab.title !== "" ? tab.title : tab.url;
		}
		/**
		* Post one command to the host bridge.
		*
		* Never rejects: transport failures, timeouts, aborts, and unreadable replies
		* all collapse into `unreachable`, so a caller can render an error bar instead
		* of catching. The signal aborts the request without changing the answer kind
		* (an aborted call is a cancelled call, and its caller checks that itself).
		*
		* @param payload - the command body; `op` is the only field every op needs.
		* @param timeoutMs - budget covering the request and its answer.
		* @param signal - optional caller-owned cancellation (unmount, tab switch).
		* @returns the classified answer.
		*/
		async function send(payload, timeoutMs, signal) {
			const controller = new AbortController();
			const relay = () => {
				controller.abort();
			};
			signal?.addEventListener("abort", relay, { once: true });
			const timer = window.setTimeout(relay, timeoutMs);
			try {
				const response = await fetch(COMMAND_URL, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload),
					credentials: "same-origin",
					signal: controller.signal
				});
				if (response.status === 401 || response.status === 403) return { kind: "refused" };
				let body = null;
				try {
					body = asObject$1(JSON.parse(await response.text()));
				} catch {
					body = null;
				}
				if (body === null) return { kind: "unreachable" };
				if (body.ok === false) return {
					kind: "failed",
					reason: asText(body.error)
				};
				return {
					kind: "ok",
					body
				};
			} catch {
				return { kind: "unreachable" };
			} finally {
				window.clearTimeout(timer);
				signal?.removeEventListener("abort", relay);
			}
		}
		/**
		* Turn a non-success answer into the line the error bar shows.
		*
		* A refusal the browser service explained is shown verbatim: that text is
		* written where the condition is understood (the service and the bridge), and
		* it names the actual cause. Everything else falls back to this panel's own
		* dictionary, keyed by which command failed.
		*
		* @param t - translate function of this panel's namespace.
		* @param result - any answer other than success.
		* @param fallback - dictionary key for a command that got no answer at all.
		* @returns the text to display.
		*/
		function failureText(t, result, fallback) {
			switch (result.kind) {
				case "refused": return t("error.denied");
				case "unreachable": return t(fallback);
				case "failed": return result.reason === "" ? t(fallback) : result.reason;
			}
		}
		/** Pointer button name for the service's `button` field. */
		function buttonName(button) {
			return button === 1 ? "middle" : button === 2 ? "right" : "left";
		}
		/** Clamp one mapped page coordinate into the page box, in whole CSS pixels. */
		function clampToPage(value, extent) {
			return Math.min(Math.max(Math.round(value), 0), Math.max(0, extent - 1));
		}
		/**
		* Normalize one wheel event's delta into the pixels `page.mouse.wheel` expects.
		*
		* `deltaMode` 0 (pixel) passes through; 1 (line) is the Firefox notch case and
		* scales by `WHEEL_LINE_PX`; 2 (page) scales by the mirrored page's height.
		* @param event - the wheel event carrying `deltaX`/`deltaY`/`deltaMode`.
		* @param pageHeight - the mirrored page's CSS height, used for page-mode deltas.
		* @returns the delta in CSS pixels for both axes.
		*/
		function wheelPixels(event, pageHeight) {
			if (event.deltaMode === 1) return {
				x: event.deltaX * WHEEL_LINE_PX,
				y: event.deltaY * WHEEL_LINE_PX
			};
			if (event.deltaMode === 2) return {
				x: event.deltaX * pageHeight,
				y: event.deltaY * pageHeight
			};
			return {
				x: event.deltaX,
				y: event.deltaY
			};
		}
		/**
		* Render the built-in browser panel.
		* @param props - body-seat props from the framework; this panel uses only the `t` copy seat.
		* @returns the toolbar, status row, frame surface, and input controls.
		*/
		function CloakPanel({ t }) {
			const [phase, setPhase] = (0, react.useState)("probing");
			const [fault, setFault] = (0, react.useState)(void 0);
			const [page, setPage] = (0, react.useState)({
				url: "",
				title: ""
			});
			const [tabs, setTabs] = (0, react.useState)([]);
			const [size, setSize] = (0, react.useState)(void 0);
			const [hidden, setHidden] = (0, react.useState)(false);
			const [address, setAddress] = (0, react.useState)("");
			const [text, setText] = (0, react.useState)("");
			const surfaceRef = (0, react.useRef)(null);
			const canvasRef = (0, react.useRef)(null);
			const decoderRef = (0, react.useRef)(null);
			const sizeRef = (0, react.useRef)(void 0);
			/** Last painted frame's sequence number: sent as `since`, so a steady page answers `unchanged` without an image. */
			const lastSeqRef = (0, react.useRef)(0);
			/** Reentrancy guard for the home navigation (probe and the frame loop can race it). */
			const homeFlightRef = (0, react.useRef)(false);
			/** The home navigation, reachable from effects declared before it exists. */
			const goHomeRef = (0, react.useRef)(() => {});
			/** The invisible IME carrier (composition candidate window follows it). */
			const imeInputRef = (0, react.useRef)(null);
			/** Serializes compose/commit: a commit must land after the last compose. */
			const imeQueueRef = (0, react.useRef)(Promise.resolve());
			/** The composition text last mirrored, so a repeated update is not re-sent. */
			const lastComposeRef = (0, react.useRef)("");
			/** Whether an IME composition is open on the carrier (onChange must not double-commit). */
			const imeComposingRef = (0, react.useRef)(false);
			const editingRef = (0, react.useRef)(false);
			const lastMoveRef = (0, react.useRef)(0);
			const moveInFlightRef = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				sizeRef.current = size;
			}, [size]);
			(0, react.useEffect)(() => {
				const update = () => {
					setHidden(document.hidden);
				};
				update();
				document.addEventListener("visibilitychange", update);
				return () => {
					document.removeEventListener("visibilitychange", update);
				};
			}, []);
			/**
			* Point the address box at the page the service is showing, unless the user is
			* typing in it. Every reply that names a page goes through here, so the box
			* follows in-page navigation and tab switches alike.
			* @param url - the page's address, as the service reported it.
			*/
			const syncAddress = (0, react.useCallback)((url) => {
				if (editingRef.current) return;
				setAddress((current) => current === url ? current : url);
			}, []);
			/**
			* Read the service's tab list. A read that fails or is cancelled leaves the
			* last list in place: the strip is a view of the service, and a dropped poll
			* is not a change to report.
			* @param signal - caller-owned cancellation for the poll.
			*/
			const refreshTabs = (0, react.useCallback)(async (signal) => {
				const result = await send({ op: "panel_pages" }, COMMAND_TIMEOUT_MS, signal);
				if (signal?.aborted === true || result.kind !== "ok") return;
				setTabs(tabsFrom(result.body.pages));
			}, []);
			(0, react.useEffect)(() => {
				if (phase !== "live") return void 0;
				const lifecycle = new AbortController();
				refreshTabs(lifecycle.signal);
				const timer = window.setInterval(() => {
					refreshTabs(lifecycle.signal);
				}, TABS_INTERVAL_MS);
				return () => {
					lifecycle.abort();
					window.clearInterval(timer);
				};
			}, [phase, refreshTabs]);
			/**
			* Read the service's own view of the world and adopt it: not running means
			* the start button, running without a page means the address bar, and
			* anything else means the frame loop.
			* @param signal - caller-owned cancellation for the probe.
			*/
			const probe = (0, react.useCallback)(async (signal) => {
				const result = await send({ op: "status" }, COMMAND_TIMEOUT_MS, signal);
				if (signal?.aborted === true) return;
				if (result.kind !== "ok") {
					setFault(failureText(t, result, "error.notRunning"));
					setPhase("idle");
					return;
				}
				setPage({
					url: asText(result.body.url),
					title: asText(result.body.title)
				});
				syncAddress(asText(result.body.url));
				if (result.body.running !== true) {
					setPhase("idle");
					return;
				}
				const hasPage = result.body.has_page === true;
				setPhase(hasPage ? "live" : "nopage");
				if (!hasPage) goHomeRef.current();
			}, [syncAddress, t]);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				probe(controller.signal);
				return () => {
					controller.abort();
				};
			}, [probe]);
			/**
			* One frame tick. Only one request is ever in flight: the interval fires
			* again while a slow frame is still travelling, and piling those up would
			* queue renders on the shared page for no visible gain. A frame stops the
			* loop by moving to the no-page phase — the effect's cleanup then aborts the
			* request and clears the interval.
			*/
			(0, react.useEffect)(() => {
				if (phase !== "live" || hidden) return void 0;
				const lifecycle = new AbortController();
				let inFlight = false;
				const tick = async () => {
					if (inFlight) return;
					inFlight = true;
					try {
						const result = await send({
							op: "screenshot",
							quality: FRAME_QUALITY,
							scale: "css",
							since: lastSeqRef.current
						}, SCREENSHOT_TIMEOUT_MS, lifecycle.signal);
						const canvas = canvasRef.current;
						if (canvas === null) return;
						if (result.kind !== "ok") {
							if (result.kind === "failed" && result.reason.includes(NO_PAGE_REASON)) {
								setFault(void 0);
								setPhase("nopage");
								goHomeRef.current();
								return;
							}
							setFault(failureText(t, result, "error.frame"));
							return;
						}
						const seq = asNumber(result.body.seq);
						const url = asText(result.body.url);
						const title = asText(result.body.title);
						const cssWidth = asNumber(result.body.css_width);
						const cssHeight = asNumber(result.body.css_height);
						if (result.body.unchanged === true) {
							if (seq !== null) lastSeqRef.current = seq;
							setFault(void 0);
							if (cssWidth !== null && cssHeight !== null) {
								setSize((current) => current !== void 0 && current.width === cssWidth && current.height === cssHeight ? current : {
									width: cssWidth,
									height: cssHeight
								});
							}
							setPage((current) => current.url === url && current.title === title ? current : {
								url,
								title
							});
							syncAddress(url);
							return;
						}
						const data = asText(result.body.data);
						if (data === "" || cssWidth === null || cssHeight === null) {
							setFault(t("error.frame"));
							return;
						}
						const image = decoderRef.current ?? (decoderRef.current = new Image());
						image.src = `data:image/jpeg;base64,${data}`;
						const context = canvas.getContext("2d");
						if (context === null) {
							setFault(t("error.frame"));
							return;
						}
						const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
						const pixelWidth = Math.max(1, Math.round(cssWidth * ratio));
						const pixelHeight = Math.max(1, Math.round(cssHeight * ratio));
						try {
							await image.decode();
							if (canvasRef.current !== canvas) return;
							if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
							if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
							context.drawImage(image, 0, 0, pixelWidth, pixelHeight);
						} catch {
							setFault(t("error.frame"));
							return;
						}
						if (seq !== null) lastSeqRef.current = seq;
						setFault(void 0);
						setSize((current) => current !== void 0 && current.width === cssWidth && current.height === cssHeight ? current : {
							width: cssWidth,
							height: cssHeight
						});
						setPage((current) => current.url === url && current.title === title ? current : {
							url,
							title
						});
						syncAddress(url);
					} finally {
						inFlight = false;
					}
				};
				const timer = window.setInterval(() => {
					tick();
				}, FRAME_INTERVAL_MS);
				tick();
				return () => {
					lifecycle.abort();
					window.clearInterval(timer);
				};
			}, [
				phase,
				hidden,
				syncAddress,
				t
			]);
			/**
			* Viewport follow: when the surface's own box changes (sidebar drag, window
			* resize, the first mount), tell the service to resize the mirrored page's
			* viewport to match — the page reflows and the mirror fills the surface 1:1.
			* Debounced: a drag fires continuously and only the settled size is worth a
			* reflow; a failed follow is silent (the next resize retries).
			*/
			(0, react.useEffect)(() => {
				if (phase !== "live" || hidden) return void 0;
				const surface = surfaceRef.current;
				if (surface === null) return void 0;
				let timer = 0;
				let lastWidth = 0;
				let lastHeight = 0;
				const observer = new ResizeObserver((entries) => {
					const rect = entries[entries.length - 1]?.contentRect;
					if (rect === void 0) return;
					window.clearTimeout(timer);
					timer = window.setTimeout(() => {
						const width = Math.round(rect.width);
						const height = Math.round(rect.height);
						if (width < 100 || height < 100) return;
						if (width === lastWidth && height === lastHeight) return;
						lastWidth = width;
						lastHeight = height;
						send({ op: "panel_resize", width, height }, COMMAND_TIMEOUT_MS).then(() => void 0);
					}, RESIZE_DEBOUNCE_MS);
				});
				observer.observe(surface);
				return () => {
					window.clearTimeout(timer);
					observer.disconnect();
				};
			}, [phase, hidden]);
			/**
			* Map a viewport point onto the page's CSS coordinate space.
			*
			* The canvas fills its stage and letterboxes the page inside it
			* (`object-fit: contain`), so the page rect inside the stage is the stage's
			* own rect shrank by one scale factor on both axes. A point on the letterbox
			* clamps to the nearest page edge rather than being dropped.
			* @param clientX - viewport X of the pointer event.
			* @param clientY - viewport Y of the pointer event.
			* @returns whole page CSS pixels, or undefined while no frame size is known.
			*/
			const pointAt = (0, react.useCallback)((clientX, clientY) => {
				const surface = surfaceRef.current;
				const current = sizeRef.current;
				if (surface === null || current === void 0) return void 0;
				const rect = surface.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0) return void 0;
				const scale = Math.min(rect.width / current.width, rect.height / current.height);
				if (!Number.isFinite(scale) || scale <= 0) return void 0;
				const left = rect.left + (rect.width - current.width * scale) / 2;
				const top = rect.top + (rect.height - current.height * scale) / 2;
				return {
					x: clampToPage((clientX - left) / scale, current.width),
					y: clampToPage((clientY - top) / scale, current.height)
				};
			}, []);
			/**
			* Forward one command without blocking the caller. Failures land in the
			* error bar; the quiet flag is for the pointer-move stream, where a dead
			* service would otherwise rewrite the same line twenty times a second.
			* @param payload - command body to send.
			* @param quiet - suppress the error bar for this command.
			*/
			const forward = (0, react.useCallback)((payload, quiet) => {
				send(payload, COMMAND_TIMEOUT_MS).then((result) => {
					if (result.kind === "ok" || quiet) return;
					setFault(failureText(t, result, "error.request"));
				});
			}, [t]);
			/**
			* Send one mouse command to the page.
			* @param action - `move`/`down`/`up`/`click`/`dblclick`/`wheel`/`contextmenu`.
			* @param at - page CSS coordinates, mapped from the pointer event.
			* @param extra - additional mouse fields (`button`, `delta_x`, `delta_y`).
			*/
			const sendMouse = (0, react.useCallback)((action, at, extra = {}) => {
				const quiet = action === "move";
				if (quiet) {
					if (moveInFlightRef.current) return;
					moveInFlightRef.current = true;
				}
				send({
					op: "mouse",
					action,
					...at === void 0 ? {} : {
						x: at.x,
						y: at.y
					},
					...extra
				}, COMMAND_TIMEOUT_MS).then((result) => {
					if (quiet) moveInFlightRef.current = false;
					if (result.kind === "ok" || quiet) return;
					setFault(failureText(t, result, "error.request"));
				});
			}, [t]);
			/**
			* Mirror one IME composition step into the remote page, strictly in order:
			* a commit must reach the service after the last compose it finalizes, so
			* every step awaits the previous one on a single promise chain.
			*/
			const queueIme = (0, react.useCallback)((action, text, at) => {
				imeQueueRef.current = imeQueueRef.current.then(async () => {
					const result = await send({
						op: "ime",
						action,
						text,
						...at === void 0 ? {} : {
							x: at.x,
							y: at.y
						}
					}, COMMAND_TIMEOUT_MS);
					if (result.kind === "ok" || action === "compose") return;
					setFault(failureText(t, result, "error.request"));
				});
			}, [t]);
			/**
			* Park the invisible IME carrier at the pointer: the system's candidate
			* window follows this box, so composing appears next to the clicked field.
			*/
			const parkIme = (0, react.useCallback)((clientX, clientY) => {
				const surface = surfaceRef.current;
				const ime = imeInputRef.current;
				if (surface === null || ime === null) return;
				const rect = surface.getBoundingClientRect();
				ime.style.left = `${Math.max(0, Math.round(clientX - rect.left))}px`;
				ime.style.top = `${Math.max(0, Math.round(clientY - rect.top))}px`;
			}, []);
			const onImeCompositionStart = (0, react.useCallback)(() => {
				imeComposingRef.current = true;
			}, []);
			const onImeCompositionUpdate = (0, react.useCallback)((event) => {
				const text = event.data ?? "";
				if (text === lastComposeRef.current) return;
				lastComposeRef.current = text;
				queueIme("compose", text);
			}, [queueIme]);
			const onImeCompositionEnd = (0, react.useCallback)((event) => {
				lastComposeRef.current = "";
				imeComposingRef.current = false;
				const ime = imeInputRef.current;
				if (ime !== null) ime.value = "";
				queueIme("commit", event.data ?? "");
			}, [queueIme]);
			const onImeChange = (0, react.useCallback)((event) => {
				if (imeComposingRef.current) return;
				const ime = event.currentTarget;
				const text = ime.value;
				if (text === "") return;
				ime.value = "";
				queueIme("commit", text);
			}, [queueIme]);
			(0, react.useEffect)(() => {
				if (phase !== "live") return void 0;
				const surface = surfaceRef.current;
				/* v8 ignore next -- the surface is mounted by the same render that sets this phase. */
				if (surface === null) return void 0;
				const onWheel = (event) => {
					event.preventDefault();
					const delta = wheelPixels(event, sizeRef.current?.height ?? surface.clientHeight);
					sendMouse("wheel", pointAt(event.clientX, event.clientY), {
						delta_x: delta.x,
						delta_y: delta.y
					});
				};
				surface.addEventListener("wheel", onWheel, { passive: false });
				return () => {
					surface.removeEventListener("wheel", onWheel);
				};
			}, [
				phase,
				pointAt,
				sendMouse
			]);
			/** Start the deployment's browser service, reporting progress while it boots. */
			const startBrowser = (0, react.useCallback)(async () => {
				setPhase("starting");
				setFault(void 0);
				const result = await send({ op: "start" }, START_TIMEOUT_MS);
				if (result.kind !== "ok") {
					setFault(failureText(t, result, "error.notRunning"));
					setPhase("idle");
					return;
				}
				await probe();
			}, [probe, t]);
			/**
			* Open one address in the shared session page.
			* @param value - the raw address the user typed; the service validates it.
			*/
			const navigate = (0, react.useCallback)(async (value) => {
				if (value === "") return;
				const result = await send({
					op: "debug_navigate",
					url: value
				}, COMMAND_TIMEOUT_MS);
				if (result.kind !== "ok") {
					setFault(failureText(t, result, "error.request"));
					return;
				}
				const url = asText(result.body.url);
				setPage({
					url,
					title: asText(result.body.title)
				});
				setAddress(url === "" ? value : url);
				setFault(void 0);
				setPhase("live");
				refreshTabs();
			}, [refreshTabs, t]);
			/** Open the home page in the shared session page; at most one flight at a time. */
			const goHome = (0, react.useCallback)(() => {
				if (homeFlightRef.current) return;
				homeFlightRef.current = true;
				navigate(PANEL_HOME_URL).finally(() => {
					homeFlightRef.current = false;
				});
			}, [navigate]);
			goHomeRef.current = goHome;
			/**
			* Show another tab. The service switches its session page and the frame loop
			* picks the new page up on its next tick.
			* @param id - the tab id from the strip.
			*/
			const selectTab = (0, react.useCallback)((id) => {
				send({
					op: "panel_select",
					id
				}, COMMAND_TIMEOUT_MS).then((result) => {
					if (result.kind !== "ok") {
						setFault(failureText(t, result, "error.request"));
						return;
					}
					setPage({
						url: asText(result.body.url),
						title: asText(result.body.title)
					});
					syncAddress(asText(result.body.url));
					setFault(void 0);
					setPhase("live");
					refreshTabs();
				});
			}, [
				refreshTabs,
				syncAddress,
				t
			]);
			/**
			* Close one tab. Closing the tab being mirrored hands the mirror to the most
			* recently used of the remaining ones, which the reply names — or empties the
			* session, which is the same "enter a URL" state as having closed everything.
			* @param id - the tab id from the strip.
			*/
			const closeTab = (0, react.useCallback)((id) => {
				send({
					op: "panel_close",
					id
				}, COMMAND_TIMEOUT_MS).then((result) => {
					if (result.kind !== "ok") {
						setFault(failureText(t, result, "error.request"));
						return;
					}
					const url = asText(result.body.url);
					setPage({
						url,
						title: asText(result.body.title)
					});
					if (result.body.has_page === true) syncAddress(url);
					setFault(void 0);
					setPhase(result.body.has_page === true ? "live" : "nopage");
					refreshTabs();
				});
			}, [
				refreshTabs,
				syncAddress,
				t
			]);
			/** Reload the session page in place. */
			const reload = (0, react.useCallback)(() => {
				send({ op: "reload" }, COMMAND_TIMEOUT_MS).then((result) => {
					if (result.kind !== "ok") {
						setFault(failureText(t, result, "error.request"));
						return;
					}
					setPage({
						url: asText(result.body.url),
						title: asText(result.body.title)
					});
					setFault(void 0);
				});
			}, [t]);
			/**
			* Forward one keystroke to the page.
			*
			* Three mappings: an accelerator (`Control+`/`Meta+` plus one character) as a
			* named press, a named control key as a named press — Space is one, although
			* it is also a single character — and any other single character as text
			* insertion, which keeps the page's ordinary typing path intact. Anything
			* else (modifier-only presses, F-keys, OS shortcuts) is left alone, so the
			* panel never swallows a key it cannot mirror.
			* @param event - the surface's key event.
			*/
			const onKeyDown = (0, react.useCallback)((event) => {
				if (event.isComposing || event.keyCode === 229) return;
				const chord = event.ctrlKey ? "Control" : event.metaKey ? "Meta" : void 0;
				if (chord !== void 0) {
					if (event.key.length !== 1) return;
					event.preventDefault();
					forward({
						op: "key",
						action: "press",
						key: `${chord}+${NAMED_KEYS[event.key] ?? event.key}`
					}, false);
					return;
				}
				const named = NAMED_KEYS[event.key];
				if (named !== void 0) {
					event.preventDefault();
					forward({
						op: "key",
						action: "press",
						key: named
					}, false);
					return;
				}
				if (event.key.length === 1) {
					event.preventDefault();
					forward({
						op: "key",
						action: "insert",
						text: event.key
					}, false);
				}
			}, [forward]);
			const submitAddress = (event) => {
				event.preventDefault();
				navigate(address.trim());
			};
			const submitText = (event) => {
				event.preventDefault();
				forward({
					op: "key",
					action: "insert",
					text
				}, false);
				setText("");
			};
			/** Breadcrumb text: what the panel is doing right now. */
			const phaseLabel = phase === "probing" || phase === "starting" ? t(phase === "starting" ? "start.pending" : "phase.probing") : phase === "idle" ? t("phase.idle") : hidden ? t("phase.paused") : t("phase.live");
			const toolbarVisible = phase === "live" || phase === "nopage";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: CloakPanel_module_css_default.root,
				"data-cloak-panel": true,
				children: [
					phase === "live" && tabs.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: CloakPanel_module_css_default.tabs,
						"aria-label": t("tabs.label"),
						children: tabs.map((tab) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: tab.active ? CloakPanel_module_css_default.tabActive : CloakPanel_module_css_default.tab,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: CloakPanel_module_css_default.tabPick,
								title: tab.url === "" ? tabLabel(tab) : tab.url,
								"aria-current": tab.active ? "page" : void 0,
								onClick: () => {
									if (!tab.active) selectTab(tab.id);
								},
								children: tabLabel(tab)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: CloakPanel_module_css_default.tabClose,
								"aria-label": t("tabs.close"),
								title: t("tabs.close"),
								onClick: () => {
									closeTab(tab.id);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineMedium, { size: 12 })
							})]
						}, tab.id))
					}),
					toolbarVisible && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: CloakPanel_module_css_default.toolbar,
						onSubmit: submitAddress,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: CloakPanel_module_css_default.address,
								value: address,
								"aria-label": t("address.placeholder"),
								placeholder: t("address.placeholder"),
								spellCheck: false,
								onChange: (event) => {
									setAddress(event.currentTarget.value);
								},
								onFocus: () => {
									editingRef.current = true;
								},
								onBlur: () => {
									editingRef.current = false;
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "submit",
								className: CloakPanel_module_css_default.tool,
								"aria-label": t("go"),
								title: t("go"),
								disabled: address.trim() === "",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconLinkOutlineRegular, { size: 14 })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: CloakPanel_module_css_default.tool,
								"aria-label": t("reload"),
								title: t("reload"),
								disabled: page.url === "",
								onClick: reload,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, {})
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: CloakPanel_module_css_default.status,
						role: "status",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: CloakPanel_module_css_default.phase,
								children: phaseLabel
							}),
							page.title !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: CloakPanel_module_css_default.pageTitle,
								children: page.title
							}),
							page.url !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: CloakPanel_module_css_default.pageUrl,
								children: page.url
							})
						]
					}),
					fault !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: CloakPanel_module_css_default.fault,
						role: "alert",
						children: fault
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: CloakPanel_module_css_default.stage,
						children: phase === "live" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: CloakPanel_module_css_default.surface,
							ref: surfaceRef,
							tabIndex: 0,
							"aria-label": t("frame.label"),
							onPointerMove: (event) => {
								const now = Date.now();
								if (now - lastMoveRef.current < MOVE_THROTTLE_MS) return;
								lastMoveRef.current = now;
								const at = pointAt(event.clientX, event.clientY);
								if (at === void 0) return;
								sendMouse("move", at);
							},
							onPointerDown: (event) => {
								parkIme(event.clientX, event.clientY);
								imeInputRef.current?.focus();
								const at = pointAt(event.clientX, event.clientY);
								if (at === void 0) return;
								sendMouse("down", at, { button: buttonName(event.button) });
							},
							onPointerUp: (event) => {
								imeInputRef.current?.focus();
								const at = pointAt(event.clientX, event.clientY);
								if (at === void 0) return;
								sendMouse("up", at, { button: buttonName(event.button) });
							},
							onDoubleClick: (event) => {
								const at = pointAt(event.clientX, event.clientY);
								if (at === void 0) return;
								sendMouse("dblclick", at, { button: "left" });
							},
							onContextMenu: (event) => {
								event.preventDefault();
								const at = pointAt(event.clientX, event.clientY);
								if (at === void 0) return;
								sendMouse("contextmenu", at, { button: "right" });
							},
							onKeyDown,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("canvas", {
									className: CloakPanel_module_css_default.canvas,
									ref: canvasRef,
									"aria-hidden": true
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									ref: imeInputRef,
									className: CloakPanel_module_css_default.imeInput,
									"aria-label": t("insert.placeholder"),
									onCompositionStart: onImeCompositionStart,
									onCompositionUpdate: onImeCompositionUpdate,
									onCompositionEnd: onImeCompositionEnd,
									onChange: onImeChange
								})
							]
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: CloakPanel_module_css_default.notice,
							children: phase === "idle" || phase === "starting" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: CloakPanel_module_css_default.noticeText,
								children: t(phase === "starting" ? "start.pending" : "phase.idle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBrowseOutlineMedium, { size: 14 }),
								disabled: phase === "starting",
								onClick: () => {
									startBrowser();
								},
								children: t("start")
							})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: CloakPanel_module_css_default.noticeText,
								children: phase === "nopage" ? t("nopage") : phaseLabel
							})
						})
					}),
					phase === "live" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: CloakPanel_module_css_default.insertRow,
						onSubmit: submitText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: CloakPanel_module_css_default.insert,
							value: text,
							"aria-label": t("insert.placeholder"),
							placeholder: t("insert.placeholder"),
							onChange: (event) => {
								setText(event.currentTarget.value);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "submit",
							className: CloakPanel_module_css_default.tool,
							"aria-label": t("insert.send"),
							title: t("insert.send"),
							disabled: text === "",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSendOutlineRegular, {})
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: CloakPanel_module_css_default.hint,
						children: t("keyboard.hint")
					})] })
				]
			});
		}
		//#endregion
		//#region src/client/definition.tsx
		/** Built-in browser tab kind. */
		const CLOAK_KIND = "cloak";
		/** Built-in browser implementation identity and keyed Slot dispatch key. */
		const CLOAK_ID = "bobo-browser-ui";
		/** Guide position: after the shipped Browser entry, which holds order 30. */
		const GUIDE_ORDER = 35;
		/**
		* Build the built-in browser type with locale-live copy.
		* @param t - translate function of the `browserCloak` namespace.
		* @returns the tab type, its guide entry, and its chip title.
		*/
		function cloakDefinition(t) {
			return {
				id: CLOAK_ID,
				kind: CLOAK_KIND,
				multiple: true,
				priority: "extension",
				title: () => t("type.label"),
				guide: [{
					id: "new",
					order: GUIDE_ORDER,
					title: () => t("guide.title"),
					description: () => t("guide.description"),
					icon: _deepseek_ai_dsh_client_ui_primitives.IconBrowseOutlineMedium
				}]
			};
		}
		/**
		* Chip content: the panel glyph plus the title the layout captured when the tab
		* opened. The page's own title lives in the panel's status row, which the frame
		* loop refreshes; the chip has no store to read and stays the type's name.
		* @param props - title-seat props from the framework.
		* @returns the glyph and the tab's recorded title.
		*/
		function CloakTitle({ useTabInfo }) {
			const { tab } = useTabInfo();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBrowseOutlineMedium, { className: CloakPanel_module_css_default.titleIcon }), tab.title] });
		}
		//#endregion
		//#region src/client/handoff-watch.ts
		/**
		* Interval between two handoff polls.
		*
		* This is what the user feels between the agent giving up and the panel
		* arriving, so it cannot be a minute; it is also a round trip that every open
		* window repeats forever, so it cannot be the panel's frame rate. Four seconds
		* is shorter than reading the question the user is being asked, and the bridge
		* answers this op from memory — no browser, no page — so the cost at that
		* cadence is one request.
		* Tune here; nothing else depends on the value.
		*/
		const HANDOFF_POLL_MS = 4e3;
		/**
		* Budget for one poll, covering the request and its answer.
		*
		* The bridge answers `handoff_state` without touching the browser, so this
		* bounds only a bridge that accepted the connection and then stopped talking;
		* without a bound, one such socket would hold the loop's single in-flight slot
		* until the plugin unloads.
		*/
		const HANDOFF_TIMEOUT_MS = 1e4;
		/** A JSON object, or null for an array, a scalar, or a parse failure. */
		function asObject(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
		}
		/**
		* A reply's `at` field read as epoch milliseconds; anything else is absent.
		*
		* An unrecognizable stamp is the same answer as no handoff at all: the stamp is
		* how this watcher tells one handoff from the next, and a handoff it cannot name
		* is one it would put in front of the user again on every poll.
		* @param value - the `at` field of a `handoff_state` reply.
		* @returns the stamp, or undefined when there is nothing to compare against.
		*/
		function asStamp(value) {
			return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
		}
		/**
		* Ask the bridge whether a handoff is waiting.
		*
		* Never rejects. The trust fence refusing this caller (401/403), an op this
		* bridge does not allow, a browser service that is not running, a timeout, a
		* socket failure, and an unreadable body all collapse into "no handoff", because
		* the watcher has no line of its own to write any of them into.
		*
		* Only the stamp is read from the reply: this watcher adds no copy, so the rest
		* of what the bridge reports about the handoff has no reader here.
		*
		* @param signal - the watcher's lifetime; aborting it cancels the request.
		* @returns the pending handoff's `at` stamp, or undefined when there is none.
		*/
		async function readPending(signal) {
			const controller = new AbortController();
			const relay = () => {
				controller.abort();
			};
			signal.addEventListener("abort", relay, { once: true });
			const timer = window.setTimeout(relay, HANDOFF_TIMEOUT_MS);
			try {
				const response = await fetch(COMMAND_URL, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ op: "handoff_state" }),
					credentials: "same-origin",
					signal: controller.signal
				});
				if (response.status === 401 || response.status === 403) return void 0;
				const body = asObject(JSON.parse(await response.text()));
				if (body === null || body.ok !== true) return void 0;
				const pending = asObject(body.pending);
				return pending === null ? void 0 : asStamp(pending.at);
			} catch {
				return;
			} finally {
				window.clearTimeout(timer);
				signal.removeEventListener("abort", relay);
			}
		}
		/**
		* Put the built-in browser panel in front of the user.
		*
		* A cloak tab already open in the column *is* the panel, so it is focused
		* rather than joined by a second one: the kind registers `multiple: true`, so
		* `openTab` would add another panel mirroring the same shared page, and every
		* later handoff would add one more. `focus` leaves a tab that is not in the
		* mounted session's layout alone, so the whole open-tab inventory can be handed
		* to it and only this session's tab reacts.
		*
		* Opening content expands the column in the same step, so a handoff that opens a
		* tab needs no separate expansion call.
		*
		* @param ctx - the plugin context; only its right-Sidebar face is read.
		*/
		function placePanel(ctx) {
			const open = ctx.sidebarRight.openTabs.getSnapshot().filter((tab) => tab.kind === CLOAK_KIND);
			if (open.length === 0) {
				ctx.sidebarRight.openTab(CLOAK_KIND);
				return;
			}
			for (const tab of open) ctx.sidebarRight.focus(tab.tabId);
		}
		/**
		* Watch for pending manual handoffs and surface the panel for each new one.
		*
		* One poll is in flight at a time. A handoff is recorded as surfaced only after
		* the call that placed the panel returned, so a poll that landed while no
		* session surface was mounted — the user is on another panel, or the app just
		* booted — is retried on the next tick rather than being dropped.
		*
		* @param ctx - the plugin context.
		* @returns the disposer that stops the loop; the caller's effect scope owns it.
		*/
		function watchHandoffs(ctx) {
			let surfaced = 0;
			let inFlight = false;
			const lifetime = new AbortController();
			const poll = async () => {
				if (inFlight) return;
				inFlight = true;
				try {
					const at = await readPending(lifetime.signal);
					if (at === void 0 || at === surfaced) return;
					try {
						placePanel(ctx);
					} catch (_unmountedSeat) {
						return;
					}
					surfaced = at;
				} finally {
					inFlight = false;
				}
			};
			const timer = window.setInterval(() => {
				poll();
			}, HANDOFF_POLL_MS);
			poll();
			return () => {
				lifetime.abort();
				window.clearInterval(timer);
			};
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Locale-owned copy for the built-in browser panel.
		*
		* The Simplified Chinese dictionary is the key-set authority; the English one
		* is checked against it, so a key added to one without the other is a compile
		* error.
		*/
		/** Copy for the right Sidebar's built-in browser tab. */
		const zh = {
			"type.label": "内置浏览器",
			"guide.title": "内置浏览器",
			"guide.description": "BoBo内置的CloakBrowser浏览器",
			"phase.probing": "正在连接…",
			"phase.idle": "未启动",
			"phase.live": "已连接",
			"phase.paused": "画面已暂停",
			"start": "启动浏览器",
			"start.pending": "正在启动浏览器…",
			"address.placeholder": "输入网址，回车前往",
			go: "前往",
			reload: "刷新",
			"nopage": "输入网址开始浏览",
			"tabs.label": "标签页",
			"tabs.close": "关闭标签页",
			"frame.label": "浏览器画面",
			"keyboard.hint": "点击画面后可键盘输入",
			"insert.placeholder": "文本（中文可直接输入）",
			"insert.send": "发送文本",
			"error.notRunning": "浏览器服务未启动。",
			"error.frame": "画面获取失败。",
			"error.pageClosed": "页面已关闭。",
			"error.denied": "操作被拒绝。",
			"error.request": "操作未送达，请重试。"
		};
		/** English copy, keyed by the same keys as {@link zh}. */
		const en = {
			"type.label": "Built-in browser",
			"guide.title": "Built-in browser",
			"guide.description": "BoBo's built-in CloakBrowser",
			"phase.probing": "Connecting…",
			"phase.idle": "Not started",
			"phase.live": "Connected",
			"phase.paused": "Frames paused",
			"start": "Start browser",
			"start.pending": "Starting the browser…",
			"address.placeholder": "Enter a URL and press Enter",
			go: "Go",
			reload: "Reload",
			"nopage": "Enter a URL to start browsing",
			"tabs.label": "Tabs",
			"tabs.close": "Close tab",
			"frame.label": "Browser frame",
			"keyboard.hint": "Click the frame to type",
			"insert.placeholder": "Text (Chinese input supported)",
			"insert.send": "Send text",
			"error.notRunning": "The browser service is not running.",
			"error.frame": "Could not capture the frame.",
			"error.pageClosed": "The page was closed.",
			"error.denied": "The operation was refused.",
			"error.request": "The operation did not reach the browser service."
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "browserCloak";
		/** Required services: the slot seats, the dictionary registry, the tab-type registry, and the column the watcher surfaces. */
		const inject = [
			"slots",
			"locale",
			"sidebarRightTabs",
			"sidebarRight"
		];
		/**
		* Register the built-in browser type, its copy, its body, its title, and the
		* watcher that surfaces it for a handoff.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-browser-cloak: dictionaries");
			ctx.effect(() => ctx.sidebarRightTabs.register(cloakDefinition(t)), "ui-browser-cloak: type");
			ctx.effect(() => watchHandoffs(ctx), "ui-browser-cloak: handoff watcher");
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: CLOAK_ID,
				locale: NS
			}, CloakPanel)), "ui-browser-cloak: body");
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
				name: "sidebar.right.pane.tab.title",
				key: CLOAK_ID
			}, CloakTitle)), "ui-browser-cloak: title");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map