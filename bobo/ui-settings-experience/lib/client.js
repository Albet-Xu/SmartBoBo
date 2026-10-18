window.__ModuleLoader__.load({
	id: "bobo-settings-experience-ui",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region ../../util/crypto/src/index.ts
		/**
		* Random v4 UUID, minted from `crypto.getRandomValues`.
		* @returns the UUID string.
		*/
		function randomUUID() {
			const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
			const hex = Array.from(bytes, (byte, index) => {
				return (index === 6 ? byte & 15 | 64 : index === 8 ? byte & 63 | 128 : byte).toString(16).padStart(2, "0");
			}).join("");
			return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		}
		//#endregion
		//#region lib/types/experience-pool.js
		/**
		* The `experience-pool` settings namespace contract shared by the Host
		* registration (the node half) and the browser page: the namespace key, the
		* gateway default, and the section's field types. Values only — the schemastery
		* schema itself stays in the node half so the browser bundle never carries it.
		*
		* @module bobo-settings-experience-ui/experience-pool
		*/
		/** Settings namespace the license page reads and writes on the Host. */
		const EXPERIENCE_POOL_NAMESPACE = "experience-pool";
		/** Gateway base URL a fresh section starts from; the page can edit it for testing. */
		const DEFAULT_GATEWAY_URL = "https://www.smartbobo.cn";
		//#endregion
		//#region lib/types/client/experience.js
		/**
		* Experience pool contract for the settings page: the pure folds that turn
		* one settings mirror snapshot into the page's state, the path operations one
		* settings write applies, and the outcome vocabulary the inject face answers
		* with. No fetch, no ctx — components and the apply closure share these.
		*
		* @module bobo-settings-experience-ui/experience
		*/
		/** Plain-object view of a wire value, or undefined for anything else. */
		function asRecord$1(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
		}
		/** A wire string, or undefined for a missing or mistyped field. */
		function text$1(value) {
			return typeof value === "string" ? value : void 0;
		}
		/** Narrow one wire cache record, or undefined when any stamp is missing. */
		function decodeCache(value) {
			const record = asRecord$1(value);
			if (record === void 0) return void 0;
			const planCode = text$1(record.planCode);
			const status = text$1(record.status);
			const licenseStart = text$1(record.licenseStart);
			const expiresAt = text$1(record.expiresAt);
			const serverTime = text$1(record.serverTime);
			if (planCode === void 0 || status === void 0 || licenseStart === void 0 || expiresAt === void 0 || serverTime === void 0) return;
			return {
				planCode,
				status,
				licenseStart,
				expiresAt,
				serverTime
			};
		}
		/**
		* Narrow one redacted settings section to the section the page edits. The
		* section arrives from the wire, so every field falls back to the value the
		* host schema defaults it to when the section omits or mistypes it; a
		* malformed cache drops to absent rather than failing the page.
		* @param section - the `experience-pool` namespace's resolved value.
		* @returns the settings, or undefined when the section is not an object at all.
		*/
		function decodeExperience(section) {
			const row = asRecord$1(section);
			if (row === void 0) return void 0;
			const baseUrl = text$1(row.baseUrl);
			const deviceId = text$1(row.deviceId);
			const license = decodeCache(row.license);
			return {
				baseUrl: baseUrl === void 0 || baseUrl === "" ? DEFAULT_GATEWAY_URL : baseUrl,
				deviceId: deviceId ?? "",
				...license === void 0 ? {} : { license }
			};
		}
		/**
		* The `experience-pool` namespace view inside one settings mirror snapshot.
		* @param mirror - the shared describe mirror's snapshot.
		* @returns the namespace view, or undefined while unanswered or unregistered.
		*/
		function experienceView(mirror) {
			return mirror.view?.namespaces.find((row) => row.ns === EXPERIENCE_POOL_NAMESPACE);
		}
		/**
		* Fold one settings mirror snapshot into the page's state.
		* @param mirror - the shared describe mirror's snapshot.
		* @returns the state the section renders.
		*/
		function experiencePageState(mirror) {
			if (mirror.status === "unavailable") return { status: "unavailable" };
			if (mirror.view === void 0) return mirror.error === null ? { status: "loading" } : {
				status: "failed",
				reason: "read",
				detail: mirror.error
			};
			const view = experienceView(mirror);
			if (view === void 0) return { status: "absent" };
			const settings = decodeExperience(view.value);
			if (settings === void 0) return {
				status: "failed",
				reason: "section",
				detail: null
			};
			return {
				status: "ready",
				settings,
				revision: view.revision,
				writable: mirror.view.writable,
				staleError: mirror.error
			};
		}
		/**
		* Path operations carrying one partial edit into the namespace. Only the
		* provided fields are written, so a field the page does not touch keeps its
		* stored value.
		* @param patch - the fields this write sets.
		* @returns the operations one settings write applies.
		*/
		function experienceWriteOps(patch) {
			const ops = [];
			if (patch.baseUrl !== void 0) ops.push({
				op: "set",
				path: ["baseUrl"],
				value: patch.baseUrl
			});
			if (patch.deviceId !== void 0) ops.push({
				op: "set",
				path: ["deviceId"],
				value: patch.deviceId
			});
			if (patch.license !== void 0) ops.push({
				op: "set",
				path: ["license"],
				value: patch.license
			});
			return ops;
		}
		//#endregion
		//#region lib/types/client/license-api.js
		/**
		* Authorization gateway HTTP contract for the experience pool page: the wire
		* types, the decoders that narrow them, and one fetch wrapper carrying the
		* timeout every call needs. Pure browser networking — no settings, no
		* credentials, no component state.
		*
		* @module bobo-settings-experience-ui/license-api
		*/
		/** Milliseconds before one gateway call aborts. */
		const REQUEST_TIMEOUT_MS = 1e4;
		/** Plain-object view of a wire value, or undefined for anything else. */
		function asRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
		}
		/** A wire string, or undefined for a missing or mistyped field. */
		function text(value) {
			return typeof value === "string" && value !== "" ? value : void 0;
		}
		/**
		* Call one gateway endpoint with a hard timeout and no credentials echoed back.
		* @param baseUrl - gateway base URL the settings section currently holds.
		* @param path - absolute path such as `/v1/health`.
		* @param init - method, headers, and body for this call.
		* @returns the parsed JSON body on 2xx, or the failure classification otherwise.
		*/
		async function callGateway(baseUrl, path, init) {
			const controller = new AbortController();
			const timer = setTimeout(() => {
				controller.abort();
			}, REQUEST_TIMEOUT_MS);
			const url = `${baseUrl.trim().replace(/\/+$/u, "")}${path}`;
			let response;
			try {
				response = await fetch(url, {
					...init,
					signal: controller.signal
				});
			} catch {
				clearTimeout(timer);
				return {
					ok: false,
					failure: controller.signal.aborted ? { kind: "timeout" } : { kind: "network" }
				};
			}
			let body;
			try {
				body = await response.json();
			} catch {
				if (controller.signal.aborted) return {
					ok: false,
					failure: { kind: "timeout" }
				};
				body = void 0;
			} finally {
				clearTimeout(timer);
			}
			if (!response.ok) {
				const record = asRecord(body);
				const description = record === void 0 ? void 0 : text(record.status_description);
				const errorCode = record === void 0 ? void 0 : text(record.error_code);
				return {
					ok: false,
					failure: {
						kind: "http",
						status: response.status,
						...description === void 0 ? {} : { description },
						...errorCode === void 0 ? {} : { errorCode }
					}
				};
			}
			return {
				ok: true,
				body
			};
		}
		/** Narrow one wire license record (snake case on the wire). */
		function decodeLicense(value) {
			const record = asRecord(value);
			if (record === void 0) return void 0;
			const planCode = text(record.plan_code);
			const status = text(record.status);
			const licenseStart = text(record.license_start);
			const expiresAt = text(record.expires_at);
			if (planCode === void 0 || status === void 0 || licenseStart === void 0 || expiresAt === void 0) return;
			return {
				planCode,
				status,
				licenseStart,
				expiresAt
			};
		}
		/**
		* Narrow a successful `activate` / `migrate/complete` body.
		* @param body - parsed JSON body of the response.
		* @returns the token, server clock, and license, or undefined for any other body.
		*/
		function decodeLicenseAuth(body) {
			const record = asRecord(body);
			if (record === void 0) return void 0;
			const accessToken = text(record.access_token);
			const serverTime = text(record.server_time);
			const license = decodeLicense(record.license);
			if (accessToken === void 0 || serverTime === void 0 || license === void 0) return void 0;
			return {
				accessToken,
				serverTime,
				license
			};
		}
		/**
		* Narrow a successful `GET /v1/license/me` body.
		* @param body - parsed JSON body of the response.
		* @returns the server clock and license, or undefined for any other body.
		*/
		function decodeLicenseMe(body) {
			const record = asRecord(body);
			if (record === void 0) return void 0;
			const serverTime = text(record.server_time);
			const license = decodeLicense(record.license);
			if (serverTime === void 0 || license === void 0) return void 0;
			return {
				serverTime,
				license
			};
		}
		/**
		* Narrow a successful `GET /v1/health` body.
		* @param body - parsed JSON body of the response.
		* @returns the upstream reachability fact, or undefined for any other body.
		*/
		function decodeHealth(body) {
			const record = asRecord(body);
			if (record === void 0 || typeof record.qdrant_reachable !== "boolean") return void 0;
			return { qdrantReachable: record.qdrant_reachable };
		}
		/**
		* Project one response's license and server clock into the cached display
		* facts the settings section stores.
		* @param license - the license the response carried.
		* @param serverTime - the response's server clock.
		* @returns the non-sensitive cache entry.
		*/
		function licenseCache(license, serverTime) {
			return {
				planCode: license.planCode,
				status: license.status,
				licenseStart: license.licenseStart,
				expiresAt: license.expiresAt,
				serverTime
			};
		}
		/** Milliseconds in one day. */
		const DAY_MS = 864e5;
		/**
		* Whole days from the server clock until expiry, never the client clock.
		* @param expiresAt - ISO expiry timestamp from the response.
		* @param serverTime - ISO server clock from the same response.
		* @returns whole days left (0 once expired), or undefined when either stamp is unparseable.
		*/
		function remainingDays(expiresAt, serverTime) {
			const expires = Date.parse(expiresAt);
			const observed = Date.parse(serverTime);
			if (!Number.isFinite(expires) || !Number.isFinite(observed)) return void 0;
			return Math.max(0, Math.ceil((expires - observed) / DAY_MS));
		}
		//#endregion
		//#region \0dsh-css:E:\BoBo-Handyman\dsh\packages\bobo\ui-settings-experience\src\client\ExperienceSection.module.css.mjs
		const css = ".hSBxOW_section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:14px;display:flex}.hSBxOW_header{align-items:flex-start;gap:12px;display:flex}.hSBxOW_header>div{flex:1;min-width:0}.hSBxOW_title,.hSBxOW_intro,.hSBxOW_status,.hSBxOW_notice,.hSBxOW_warning,.hSBxOW_hint,.hSBxOW_expiring{margin:0}.hSBxOW_title{font-size:15px;font-weight:600;line-height:22px}.hSBxOW_intro,.hSBxOW_status,.hSBxOW_hint{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}.hSBxOW_intro{margin-top:4px}.hSBxOW_notice{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.hSBxOW_notice[data-tone=success]{color:var(--dsw-alias-state-success-primary)}.hSBxOW_notice[data-tone=error]{color:var(--dsw-alias-state-error-primary)}.hSBxOW_notice[data-tone=warning]{color:var(--dsw-alias-state-warn-label)}.hSBxOW_warning{color:var(--dsw-alias-state-warn-label);font-size:13px;line-height:20px}.hSBxOW_card{border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;flex-direction:column;gap:10px;padding:14px;display:flex}.hSBxOW_cardHead{align-items:center;gap:8px;min-width:0;display:flex}.hSBxOW_expandButton{box-sizing:border-box;width:24px;height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:6px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.hSBxOW_expandButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.hSBxOW_expandButton:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}.hSBxOW_chevronOpen,.hSBxOW_chevronClosed{transition:transform .12s}.hSBxOW_chevronOpen{transform:rotate(0)}.hSBxOW_chevronClosed{transform:rotate(-90deg)}.hSBxOW_cardName{text-overflow:ellipsis;white-space:nowrap;flex:auto;min-width:0;font-size:14px;font-weight:600;line-height:22px;overflow:hidden}.hSBxOW_facts{grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 16px;margin:0;display:grid}.hSBxOW_fact{flex-direction:column;gap:2px;min-width:0;display:flex}.hSBxOW_factName{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.hSBxOW_factValue{overflow-wrap:anywhere;margin:0;font-size:13px;line-height:20px}.hSBxOW_expiring{color:var(--dsw-alias-state-warn-label);font-size:13px;font-weight:600;line-height:20px}.hSBxOW_fieldWide,.hSBxOW_urlField{flex-direction:column;gap:4px;display:flex}.hSBxOW_fieldLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.hSBxOW_actions{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.hSBxOW_urlRow{align-items:flex-end;gap:8px;display:flex}.hSBxOW_urlField{flex:1;min-width:0}.hSBxOW_healthRows{flex-direction:column;gap:8px;display:flex}.hSBxOW_healthRow{flex-wrap:wrap;align-items:center;gap:8px;display:flex}";
		const tagId = "bobo-settings-experience-ui/ExperienceSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "bobo-settings-experience-ui";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var ExperienceSection_module_css_default = {
			"actions": "hSBxOW_actions",
			"card": "hSBxOW_card",
			"cardHead": "hSBxOW_cardHead",
			"cardName": "hSBxOW_cardName",
			"chevronClosed": "hSBxOW_chevronClosed",
			"chevronOpen": "hSBxOW_chevronOpen",
			"expandButton": "hSBxOW_expandButton",
			"expiring": "hSBxOW_expiring",
			"fact": "hSBxOW_fact",
			"factName": "hSBxOW_factName",
			"factValue": "hSBxOW_factValue",
			"facts": "hSBxOW_facts",
			"fieldLabel": "hSBxOW_fieldLabel",
			"fieldWide": "hSBxOW_fieldWide",
			"header": "hSBxOW_header",
			"healthRow": "hSBxOW_healthRow",
			"healthRows": "hSBxOW_healthRows",
			"hint": "hSBxOW_hint",
			"intro": "hSBxOW_intro",
			"notice": "hSBxOW_notice",
			"section": "hSBxOW_section",
			"status": "hSBxOW_status",
			"title": "hSBxOW_title",
			"urlField": "hSBxOW_urlField",
			"urlRow": "hSBxOW_urlRow",
			"warning": "hSBxOW_warning"
		};
		//#endregion
		//#region lib/types/client/ExperienceSection.js
		/**
		* Experience pool settings section: the license card (one key input, or the
		* connected plan facts derived from the server clock plus refresh and
		* change-key), the migration card (the two-step transfer of the license to
		* this device), and the connection diagnostics card (gateway URL plus
		* `/v1/health` reachability). All three fold, and all three start folded: each
		* head keeps its own title — the diagnostics head also keeps its re-check
		* button — while the notices stay outside the cards, so a page folded shut
		* still shows what the last action reported.
		*
		* The page never renders a saved key or token — those live in the credential
		* store and this plugin's memory only — and every gateway failure becomes
		* either the server's own description or localized copy from this section's
		* dictionary.
		*
		* @module bobo-settings-experience-ui/ExperienceSection
		*/
		/**
		* One card's fold head: the chevron trigger, the card's title, and any control
		* the card keeps reachable while it is folded shut.
		*
		* The settings page already folds its cards this way in the proxy pool's
		* source list, so this follows that pattern rather than ui-primitives'
		* `FoldToggle` (a list rollup whose copy carries a head/tail count) or
		* `DisclosureRow` (a conversation process row).
		* @param props.title - the card's localized title, which also names the trigger.
		* @param props.open - whether this card's body is showing.
		* @param props.t - the section's dictionary translator.
		* @param props.onToggle - flips this card's fold.
		* @param props.children - controls kept beside the title while folded.
		* @returns the card head element tree.
		*/
		function CardHead({ title, open, t, onToggle, children }) {
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ExperienceSection_module_css_default.cardHead,
				children: [
					(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ExperienceSection_module_css_default.expandButton,
						"aria-expanded": open,
						"aria-label": open ? t("collapseCard", { name: title }) : t("expandCard", { name: title }),
						onClick: onToggle,
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {
							className: open ? ExperienceSection_module_css_default.chevronOpen : ExperienceSection_module_css_default.chevronClosed,
							"aria-hidden": "true"
						})
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: ExperienceSection_module_css_default.cardName,
						children: title
					}),
					children
				]
			});
		}
		/** Turn one gateway failure into the notice the page renders. */
		function failureNotice(failure) {
			switch (failure.kind) {
				case "timeout": return {
					tone: "error",
					key: "errTimeout"
				};
				case "network": return {
					tone: "error",
					key: "errNetwork"
				};
				case "malformed": return {
					tone: "error",
					key: "errMalformed"
				};
				case "http": return failure.description === void 0 ? {
					tone: "error",
					key: "errHttp",
					message: String(failure.status)
				} : {
					tone: "error",
					raw: failure.description
				};
			}
		}
		/** Turn a refused settings write into a notice; a commit needs no notice. */
		function saveNotice(outcome) {
			switch (outcome.kind) {
				case "written": return null;
				case "conflict": return {
					tone: "error",
					key: "conflict"
				};
				case "absent": return {
					tone: "error",
					key: "namespaceMissing"
				};
				case "refused": return {
					tone: "error",
					key: "operationFailed",
					message: outcome.message
				};
			}
		}
		/** Localized warning line for the stores an `ok` outcome could not finish. */
		function storageWarningText(outcome, t) {
			const warnings = [];
			const settingsWarning = saveNotice(outcome.settingsStorage);
			if (settingsWarning !== null && "key" in settingsWarning) warnings.push(settingsWarning.message === void 0 ? t(settingsWarning.key) : t(settingsWarning.key, { message: settingsWarning.message }));
			if (outcome.credentialsStorage !== null) warnings.push(t("operationFailed", { message: outcome.credentialsStorage }));
			return warnings.length === 0 ? null : warnings.join(" ");
		}
		/** Render the page status line for a state the editor cannot render from. */
		function StatusLine({ state, t, onRetry }) {
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ExperienceSection_module_css_default.section,
				children: [(0, react_jsx_runtime.jsxs)("p", {
					className: ExperienceSection_module_css_default.status,
					children: [
						state === "loading" ? t("loading") : null,
						state === "unavailable" ? t("unavailable") : null,
						state === "absent" ? t("namespaceMissing") : null,
						state === "read" || state === "section" ? t("loadFailed") : null
					]
				}), state === "read" ? (0, react_jsx_runtime.jsx)("p", { children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					onClick: onRetry,
					children: t("retry")
				}) }) : null]
			});
		}
		/**
		* Render the experience pool section content.
		* @param props - composed slot props (see {@link ExperienceSectionProps}).
		* @returns the settings section element tree.
		*/
		function ExperienceSection(props) {
			const { useSettings, load, save, activate, refresh, migrateRequest, migrateComplete, health, credentialsState, t } = props;
			const mirror = useSettings((snapshot) => snapshot);
			const page = (0, react.useMemo)(() => experiencePageState(mirror), [mirror]);
			const [showActivate, setShowActivate] = (0, react.useState)(false);
			const [sessionLicense, setSessionLicense] = (0, react.useState)(null);
			const [keyDraft, setKeyDraft] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			const [storageWarning, setStorageWarning] = (0, react.useState)(null);
			const [openCards, setOpenCards] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [mailSent, setMailSent] = (0, react.useState)(false);
			const [emailDraft, setEmailDraft] = (0, react.useState)("");
			const [recoveryDraft, setRecoveryDraft] = (0, react.useState)("");
			const [codeDraft, setCodeDraft] = (0, react.useState)("");
			const [healthView, setHealthView] = (0, react.useState)(null);
			const [healthBusy, setHealthBusy] = (0, react.useState)(false);
			const [credState, setCredState] = (0, react.useState)(null);
			const [credTick, setCredTick] = (0, react.useState)(0);
			const [urlDraft, setUrlDraft] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				if (mirror.status === "idle") load();
			}, [load, mirror.status]);
			const committedUrl = page.status === "ready" ? page.settings.baseUrl : null;
			(0, react.useEffect)(() => {
				if (committedUrl !== null) setUrlDraft(committedUrl);
			}, [committedUrl]);
			const runHealth = (0, react.useCallback)(async () => {
				setHealthBusy(true);
				setHealthView(await health());
				setHealthBusy(false);
			}, [health]);
			const healthStarted = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (page.status !== "ready" || healthStarted.current) return;
				healthStarted.current = true;
				runHealth();
			}, [page.status, runHealth]);
			const ready = page.status === "ready";
			(0, react.useEffect)(() => {
				if (!ready) return;
				let current = true;
				credentialsState().then((state) => {
					if (current) setCredState(state);
				});
				return () => {
					current = false;
				};
			}, [
				ready,
				credentialsState,
				credTick
			]);
			if (page.status !== "ready") return (0, react_jsx_runtime.jsx)(StatusLine, {
				state: page.status === "failed" ? page.reason : page.status,
				t,
				onRetry: () => {
					load();
				}
			});
			const committed = page.settings;
			const displayLicense = sessionLicense ?? committed.license;
			const connected = displayLicense !== void 0 && !showActivate;
			const remaining = displayLicense === void 0 ? void 0 : remainingDays(displayLicense.expiresAt, displayLicense.serverTime);
			const expiring = remaining !== void 0 && remaining <= 7;
			/** Fold one auth outcome into notice, license, and mode. */
			const applyAuth = (outcome, successKey) => {
				if (outcome.kind === "device") {
					setNotice({
						tone: "error",
						key: "deviceFailed"
					});
					return;
				}
				if (outcome.kind === "no-token") {
					setNotice({
						tone: "error",
						key: "noToken"
					});
					return;
				}
				if (outcome.kind === "gateway") {
					setNotice(failureNotice(outcome.failure));
					return;
				}
				setSessionLicense(outcome.license);
				setKeyDraft("");
				setShowActivate(false);
				setNotice({
					tone: "success",
					key: successKey
				});
				setStorageWarning(storageWarningText(outcome, t));
				setCredTick((value) => value + 1);
			};
			const onActivate = async () => {
				const key = keyDraft.trim();
				if (key === "") {
					setNotice({
						tone: "error",
						key: "keyRequired"
					});
					return;
				}
				setNotice(null);
				setStorageWarning(null);
				setBusy("activate");
				const outcome = await activate(key);
				setBusy(null);
				applyAuth(outcome, "activated");
			};
			const onRefresh = async () => {
				setNotice(null);
				setStorageWarning(null);
				setBusy("refresh");
				const outcome = await refresh();
				setBusy(null);
				applyAuth(outcome, "refreshed");
			};
			const onSendMail = async () => {
				if (emailDraft.trim() === "") {
					setNotice({
						tone: "error",
						key: "emailRequired"
					});
					return;
				}
				if (recoveryDraft.trim() === "") {
					setNotice({
						tone: "error",
						key: "recoveryRequired"
					});
					return;
				}
				setNotice(null);
				setBusy("sendMail");
				const outcome = await migrateRequest(emailDraft.trim(), recoveryDraft.trim());
				setBusy(null);
				setNotice(outcome.kind === "ok" ? {
					tone: "success",
					key: "mailSent"
				} : failureNotice(outcome.failure));
				if (outcome.kind === "ok") setMailSent(true);
			};
			const onSubmitMigration = async () => {
				if (emailDraft.trim() === "") {
					setNotice({
						tone: "error",
						key: "emailRequired"
					});
					return;
				}
				if (recoveryDraft.trim() === "") {
					setNotice({
						tone: "error",
						key: "recoveryRequired"
					});
					return;
				}
				if (codeDraft.trim() === "") {
					setNotice({
						tone: "error",
						key: "codeRequired"
					});
					return;
				}
				setNotice(null);
				setStorageWarning(null);
				setBusy("submit");
				const outcome = await migrateComplete(emailDraft.trim(), recoveryDraft.trim(), codeDraft.trim());
				setBusy(null);
				applyAuth(outcome, "migrated");
			};
			const onSaveUrl = async () => {
				const value = urlDraft.trim();
				if (value === "") {
					setNotice({
						tone: "error",
						key: "urlRequired"
					});
					return;
				}
				setNotice(null);
				setStorageWarning(null);
				setBusy("url");
				const outcome = await save({ baseUrl: value });
				setBusy(null);
				const saved = saveNotice(outcome);
				setNotice(saved === null ? {
					tone: "success",
					key: "urlSaved"
				} : saved);
			};
			const toggleCard = (id) => {
				setOpenCards((previous) => {
					const next = new Set(previous);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
			};
			const licenseOpen = openCards.has("license");
			const migrateOpen = openCards.has("migrate");
			const healthOpen = openCards.has("health");
			const noticeText = notice === null ? null : "raw" in notice ? notice.raw : notice.message === void 0 ? t(notice.key) : t(notice.key, { message: notice.message });
			return (0, react_jsx_runtime.jsxs)("section", {
				className: ExperienceSection_module_css_default.section,
				"aria-labelledby": "experience-pool-title",
				children: [
					(0, react_jsx_runtime.jsx)("header", {
						className: ExperienceSection_module_css_default.header,
						children: (0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("h3", {
							id: "experience-pool-title",
							className: ExperienceSection_module_css_default.title,
							children: t("title")
						}), (0, react_jsx_runtime.jsx)("p", {
							className: ExperienceSection_module_css_default.intro,
							children: t("intro")
						})] })
					}),
					noticeText === null ? null : (0, react_jsx_runtime.jsx)("p", {
						className: ExperienceSection_module_css_default.notice,
						"data-tone": notice?.tone ?? "error",
						role: notice?.tone === "success" ? "status" : "alert",
						children: noticeText
					}),
					storageWarning === null ? null : (0, react_jsx_runtime.jsx)("p", {
						className: ExperienceSection_module_css_default.warning,
						role: "status",
						children: storageWarning
					}),
					page.staleError === null ? null : (0, react_jsx_runtime.jsx)("p", {
						className: ExperienceSection_module_css_default.notice,
						"data-tone": "warning",
						role: "status",
						children: page.staleError
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: ExperienceSection_module_css_default.card,
						children: [(0, react_jsx_runtime.jsx)(CardHead, {
							title: t("licenseTitle"),
							open: licenseOpen,
							t,
							onToggle: () => {
								toggleCard("license");
							}
						}), licenseOpen ? connected ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							(0, react_jsx_runtime.jsxs)("dl", {
								className: ExperienceSection_module_css_default.facts,
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										className: ExperienceSection_module_css_default.fact,
										children: [(0, react_jsx_runtime.jsx)("dt", {
											className: ExperienceSection_module_css_default.factName,
											children: t("planLabel")
										}), (0, react_jsx_runtime.jsx)("dd", {
											className: ExperienceSection_module_css_default.factValue,
											children: displayLicense.planCode
										})]
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										className: ExperienceSection_module_css_default.fact,
										children: [(0, react_jsx_runtime.jsx)("dt", {
											className: ExperienceSection_module_css_default.factName,
											children: t("statusLabel")
										}), (0, react_jsx_runtime.jsx)("dd", {
											className: ExperienceSection_module_css_default.factValue,
											children: displayLicense.status
										})]
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										className: ExperienceSection_module_css_default.fact,
										children: [(0, react_jsx_runtime.jsx)("dt", {
											className: ExperienceSection_module_css_default.factName,
											children: t("remainingLabel")
										}), (0, react_jsx_runtime.jsx)("dd", {
											className: expiring ? ExperienceSection_module_css_default.expiring : ExperienceSection_module_css_default.factValue,
											children: remaining === void 0 ? "—" : String(remaining)
										})]
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										className: ExperienceSection_module_css_default.fact,
										children: [(0, react_jsx_runtime.jsx)("dt", {
											className: ExperienceSection_module_css_default.factName,
											children: t("expiresLabel")
										}), (0, react_jsx_runtime.jsx)("dd", {
											className: ExperienceSection_module_css_default.factValue,
											children: displayLicense.expiresAt
										})]
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										className: ExperienceSection_module_css_default.fact,
										children: [(0, react_jsx_runtime.jsx)("dt", {
											className: ExperienceSection_module_css_default.factName,
											children: t("serverTimeLabel")
										}), (0, react_jsx_runtime.jsx)("dd", {
											className: ExperienceSection_module_css_default.factValue,
											children: displayLicense.serverTime
										})]
									})
								]
							}),
							expiring ? (0, react_jsx_runtime.jsx)("p", {
								className: ExperienceSection_module_css_default.expiring,
								role: "status",
								children: t("expiringSoon")
							}) : null,
							credState?.token === true ? (0, react_jsx_runtime.jsx)("p", {
								className: ExperienceSection_module_css_default.hint,
								children: t("credentialsHint")
							}) : null,
							(0, react_jsx_runtime.jsxs)("div", {
								className: ExperienceSection_module_css_default.actions,
								children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									size: "sm",
									disabled: busy !== null,
									onClick: () => {
										onRefresh();
									},
									children: busy === "refresh" ? t("refreshing") : t("refresh")
								}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									size: "sm",
									disabled: busy !== null,
									onClick: () => {
										setKeyDraft("");
										setShowActivate(true);
										setNotice(null);
										setStorageWarning(null);
									},
									children: t("replaceKey")
								})]
							})
						] }) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsxs)("label", {
							className: ExperienceSection_module_css_default.fieldWide,
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: ExperienceSection_module_css_default.fieldLabel,
								children: t("keyLabel")
							}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								type: "password",
								autoComplete: "off",
								value: keyDraft,
								placeholder: t("keyPlaceholder"),
								"aria-label": t("keyLabel"),
								disabled: busy !== null,
								onChange: (event) => {
									setKeyDraft(event.currentTarget.value);
								}
							})]
						}), (0, react_jsx_runtime.jsxs)("div", {
							className: ExperienceSection_module_css_default.actions,
							children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								size: "sm",
								disabled: busy !== null,
								onClick: () => {
									onActivate();
								},
								children: busy === "activate" ? t("activating") : t("activate")
							}), displayLicense === void 0 ? null : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								size: "sm",
								disabled: busy !== null,
								onClick: () => {
									setShowActivate(false);
									setNotice(null);
									setStorageWarning(null);
								},
								children: t("backToStatus")
							})]
						})] }) : null]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: ExperienceSection_module_css_default.card,
						children: [(0, react_jsx_runtime.jsx)(CardHead, {
							title: t("migrateTitle"),
							open: migrateOpen,
							t,
							onToggle: () => {
								toggleCard("migrate");
							}
						}), migrateOpen ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							(0, react_jsx_runtime.jsx)("p", {
								className: ExperienceSection_module_css_default.hint,
								children: t("migrateIntro")
							}),
							(0, react_jsx_runtime.jsxs)("label", {
								className: ExperienceSection_module_css_default.fieldWide,
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: ExperienceSection_module_css_default.fieldLabel,
									children: t("emailLabel")
								}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									value: emailDraft,
									placeholder: t("emailPlaceholder"),
									"aria-label": t("emailLabel"),
									disabled: busy !== null,
									onChange: (event) => {
										setEmailDraft(event.currentTarget.value);
									}
								})]
							}),
							(0, react_jsx_runtime.jsxs)("label", {
								className: ExperienceSection_module_css_default.fieldWide,
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: ExperienceSection_module_css_default.fieldLabel,
									children: t("recoveryLabel")
								}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									value: recoveryDraft,
									placeholder: t("recoveryPlaceholder"),
									"aria-label": t("recoveryLabel"),
									disabled: busy !== null,
									onChange: (event) => {
										setRecoveryDraft(event.currentTarget.value);
									}
								})]
							}),
							(0, react_jsx_runtime.jsx)("div", {
								className: ExperienceSection_module_css_default.actions,
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									size: "sm",
									disabled: busy !== null,
									onClick: () => {
										onSendMail();
									},
									children: busy === "sendMail" ? t("sendingMail") : t("sendMail")
								})
							}),
							mailSent ? (0, react_jsx_runtime.jsx)("p", {
								className: ExperienceSection_module_css_default.hint,
								role: "status",
								children: t("mailSent")
							}) : null,
							mailSent ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsxs)("label", {
								className: ExperienceSection_module_css_default.fieldWide,
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: ExperienceSection_module_css_default.fieldLabel,
									children: t("confirmCodeLabel")
								}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									value: codeDraft,
									placeholder: t("confirmCodePlaceholder"),
									"aria-label": t("confirmCodeLabel"),
									disabled: busy !== null,
									onChange: (event) => {
										setCodeDraft(event.currentTarget.value);
									}
								})]
							}), (0, react_jsx_runtime.jsx)("div", {
								className: ExperienceSection_module_css_default.actions,
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "primary",
									size: "sm",
									disabled: busy !== null,
									onClick: () => {
										onSubmitMigration();
									},
									children: busy === "submit" ? t("migrating") : t("submitMigration")
								})
							})] }) : null
						] }) : null]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: ExperienceSection_module_css_default.card,
						children: [(0, react_jsx_runtime.jsx)(CardHead, {
							title: t("healthTitle"),
							open: healthOpen,
							t,
							onToggle: () => {
								toggleCard("health");
							},
							children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								size: "sm",
								disabled: healthBusy,
								onClick: () => {
									runHealth();
								},
								children: healthBusy ? t("healthChecking") : t("healthCheck")
							})
						}), healthOpen ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							(0, react_jsx_runtime.jsxs)("div", {
								className: ExperienceSection_module_css_default.urlRow,
								children: [(0, react_jsx_runtime.jsxs)("label", {
									className: ExperienceSection_module_css_default.urlField,
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: ExperienceSection_module_css_default.fieldLabel,
										children: t("urlLabel")
									}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
										value: urlDraft,
										placeholder: t("urlPlaceholder"),
										"aria-label": t("urlLabel"),
										disabled: busy !== null,
										onChange: (event) => {
											setUrlDraft(event.currentTarget.value);
										}
									})]
								}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									size: "sm",
									disabled: busy !== null || urlDraft.trim() === committed.baseUrl,
									onClick: () => {
										onSaveUrl();
									},
									children: busy === "url" ? t("savingUrl") : t("saveUrl")
								})]
							}),
							healthView === null && healthBusy ? (0, react_jsx_runtime.jsx)("p", {
								className: ExperienceSection_module_css_default.hint,
								children: t("healthChecking")
							}) : null,
							healthView === null ? null : (0, react_jsx_runtime.jsxs)("div", {
								className: ExperienceSection_module_css_default.healthRows,
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										className: ExperienceSection_module_css_default.healthRow,
										children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
											tone: healthView.gateway === "up" ? "success" : "danger",
											children: healthView.gateway === "up" ? t("gatewayUp") : t("gatewayDown")
										}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
											tone: healthView.qdrant === "up" ? "success" : healthView.qdrant === "down" ? "danger" : "neutral",
											children: healthView.qdrant === "up" ? t("qdrantUp") : healthView.qdrant === "down" ? t("qdrantDown") : t("qdrantUnknown")
										})]
									}),
									healthView.gateway === "down" ? (0, react_jsx_runtime.jsx)("p", {
										className: ExperienceSection_module_css_default.hint,
										children: t("gatewayDownHint")
									}) : null,
									healthView.detail === void 0 ? null : (0, react_jsx_runtime.jsx)("p", {
										className: ExperienceSection_module_css_default.hint,
										children: healthView.detail
									})
								]
							})
						] }) : null]
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** Copy dictionaries for the experience pool settings section. */
		/** Simplified Chinese dictionary and key source of truth. */
		const zh = {
			nav: "经验池",
			title: "经验池",
			intro: "接入授权服务后，可在本机查看套餐状态与到期时间、随时刷新校验，并把授权迁移到这台设备。密钥与访问令牌只保存在本机凭据库，页面不会回显。",
			expandCard: "展开「{name}」",
			collapseCard: "收起「{name}」",
			licenseTitle: "套餐授权",
			keyLabel: "套餐密钥",
			keyPlaceholder: "粘贴套餐密钥",
			keyRequired: "请输入套餐密钥。",
			activate: "激活",
			activating: "正在激活…",
			activated: "激活成功。",
			replaceKey: "更换密钥",
			backToStatus: "返回授权状态",
			refresh: "刷新状态",
			refreshing: "正在刷新…",
			refreshed: "状态已刷新。",
			noToken: "本会话没有可用的访问令牌（令牌保存后不可读取）。重新输入密钥激活即可恢复在线刷新。",
			deviceFailed: "无法保存设备标识，本次操作已取消。",
			planLabel: "套餐",
			statusLabel: "状态",
			remainingLabel: "剩余天数",
			expiresLabel: "到期时间",
			serverTimeLabel: "服务端时间",
			expiringSoon: "剩余不足 7 天，请及时续期。",
			credentialsHint: "密钥与访问令牌已保存在本机凭据库，不会在此显示。",
			storageWarning: "授权已生效，但部分本地保存未完成：{message}",
			migrateTitle: "迁移到本机",
			migrateIntro: "填写原设备绑定的邮箱与恢复码，先发送确认邮件，再输入邮件中的确认码完成迁移。",
			emailLabel: "邮箱",
			emailPlaceholder: "name@example.com",
			emailRequired: "请输入邮箱。",
			recoveryLabel: "恢复码",
			recoveryPlaceholder: "粘贴恢复码",
			recoveryRequired: "请输入恢复码。",
			sendMail: "发送确认邮件",
			sendingMail: "正在发送…",
			mailSent: "若该邮箱存在有效授权，确认邮件已发出；请查收邮件后在下方填写确认码。",
			confirmCodeLabel: "确认码",
			confirmCodePlaceholder: "输入邮件中的确认码",
			codeRequired: "请输入确认码。",
			submitMigration: "提交迁移",
			migrating: "正在提交…",
			migrated: "迁移完成，已在本机激活。",
			healthTitle: "连接诊断",
			healthCheck: "重新检测",
			healthChecking: "正在检测…",
			gatewayUp: "网关可达",
			gatewayDown: "网关无法连接",
			gatewayDownHint: "请检查上方网关地址是否正确、本机网络与系统代理是否可用；若域名尚未配置 DNS，请改成可连通的地址后再试。",
			qdrantUp: "上游 Qdrant 可达",
			qdrantDown: "上游 Qdrant 不可达",
			qdrantUnknown: "未获取到上游状态",
			urlLabel: "网关地址",
			urlPlaceholder: "https://www.smartbobo.cn",
			urlRequired: "网关地址不能为空。",
			saveUrl: "保存",
			savingUrl: "正在保存…",
			urlSaved: "网关地址已保存。",
			loading: "正在读取经验池设置…",
			loadFailed: "暂时无法读取经验池设置。",
			namespaceMissing: "经验池设置未在宿主注册：请确认启动补丁已挂载 ui-settings-experience。",
			unavailable: "此连接不提供设置存储，经验池页面无法保存数据。",
			retry: "重试",
			conflict: "设置在别处被修改，请重新打开本页后再试。",
			operationFailed: "操作失败：{message}",
			errTimeout: "请求超时（10 秒）。请检查网关地址与网络后重试。",
			errNetwork: "无法连接网关。请检查网络、系统代理与网关地址。",
			errMalformed: "网关返回了无法识别的响应。",
			errHttp: "网关返回错误（HTTP {status}）。"
		};
		/** English dictionary checked against the Chinese key set. */
		const en = {
			nav: "Experience pool",
			title: "Experience pool",
			intro: "Once activated, this page shows your plan status and expiry on this device, refreshes it on demand, and migrates the license here. The key and access token stay in the local credential store and are never echoed back.",
			expandCard: "Expand {name}",
			collapseCard: "Collapse {name}",
			licenseTitle: "License",
			keyLabel: "License key",
			keyPlaceholder: "Paste the license key",
			keyRequired: "Enter the license key.",
			activate: "Activate",
			activating: "Activating…",
			activated: "Activated.",
			replaceKey: "Change key",
			backToStatus: "Back to status",
			refresh: "Refresh status",
			refreshing: "Refreshing…",
			refreshed: "Status refreshed.",
			noToken: "This session holds no access token (a saved token is never readable). Enter the key again to restore online refresh.",
			deviceFailed: "The device id could not be saved, so the operation was cancelled.",
			planLabel: "Plan",
			statusLabel: "Status",
			remainingLabel: "Days left",
			expiresLabel: "Expires at",
			serverTimeLabel: "Server time",
			expiringSoon: "Fewer than 7 days left — renew soon.",
			credentialsHint: "The key and access token are stored in the local credential store and are not shown here.",
			storageWarning: "The license is active, but part of the local save did not finish: {message}",
			migrateTitle: "Migrate to this device",
			migrateIntro: "Enter the email and recovery code from the previous device, send the confirmation email, then submit the code from that email.",
			emailLabel: "Email",
			emailPlaceholder: "name@example.com",
			emailRequired: "Enter the email.",
			recoveryLabel: "Recovery code",
			recoveryPlaceholder: "Paste the recovery code",
			recoveryRequired: "Enter the recovery code.",
			sendMail: "Send confirmation email",
			sendingMail: "Sending…",
			mailSent: "If a valid license exists for that email, the confirmation email has been sent; check your inbox and enter the code below.",
			confirmCodeLabel: "Confirmation code",
			confirmCodePlaceholder: "Enter the code from the email",
			codeRequired: "Enter the confirmation code.",
			submitMigration: "Complete migration",
			migrating: "Submitting…",
			migrated: "Migration complete; activated on this device.",
			healthTitle: "Connection diagnostics",
			healthCheck: "Re-check",
			healthChecking: "Checking…",
			gatewayUp: "Gateway reachable",
			gatewayDown: "Gateway unreachable",
			gatewayDownHint: "Check that the gateway URL above is correct and that the network and system proxy work. If the domain has no DNS yet, switch to a reachable address and retry.",
			qdrantUp: "Upstream Qdrant reachable",
			qdrantDown: "Upstream Qdrant unreachable",
			qdrantUnknown: "Upstream status unavailable",
			urlLabel: "Gateway URL",
			urlPlaceholder: "https://www.smartbobo.cn",
			urlRequired: "The gateway URL cannot be empty.",
			saveUrl: "Save",
			savingUrl: "Saving…",
			urlSaved: "Gateway URL saved.",
			loading: "Reading experience pool settings…",
			loadFailed: "Experience pool settings are temporarily unavailable.",
			namespaceMissing: "The experience pool settings are not registered on the host: confirm the launch patch mounts ui-settings-experience.",
			unavailable: "This connection does not serve settings, so the experience pool page cannot save data.",
			retry: "Retry",
			conflict: "These settings changed elsewhere. Reopen the page and try again.",
			operationFailed: "Operation failed: {message}",
			errTimeout: "The request timed out (10 s). Check the gateway URL and network, then retry.",
			errNetwork: "Could not reach the gateway. Check the network, system proxy, and gateway URL.",
			errMalformed: "The gateway returned an unrecognized response.",
			errHttp: "The gateway returned an error (HTTP {status})."
		};
		//#endregion
		//#region lib/types/client/index.js
		/**
		* Experience pool settings page, browser half: contributes the Experience
		* Pool section to Settings and owns every call it makes — license activation,
		* status refresh, migration, connection diagnostics, and the settings and
		* credential writes behind them. The gateway URL, device id, and cached
		* license status persist through the `experience-pool` settings namespace the
		* node half registers; the access token and license key persist through the
		* `credentials` Remote namespace and are never echoed back to the page. The
		* session token itself is held in this closure only, so a page reload keeps
		* the cached status display but asks for the key again to go back online.
		*
		* Export discipline: packages/client/AGENTS.md.
		*/
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.experience";
		/** Credential reference holding the activation response's access token. */
		const TOKEN_REF = "bobo_experience_access_token";
		/** Credential reference holding the user's license key. */
		const KEY_REF = "bobo_experience_license_key";
		/**
		* Required services (cordis fiber inject). The target slot is declared by
		* ui-settings' apply, whose activation order relative to this one is NOT
		* constrained; registration depends on that slot through `slots.inject()`.
		*/
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.settings",
			"remote.credentials",
			"configForms"
		];
		/** Version string sent as `client_version`; unset builds report unknown. */
		function clientVersion() {
			return {}.DSH_CLIENT_VERSION ?? "unknown";
		}
		/** JSON body helper for the POST calls this plugin makes. */
		function jsonBody(value) {
			return {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(value)
			};
		}
		/**
		* Register the Experience Pool section once the `settings.section`
		* declaration is on the ledger, with every gateway call and store write
		* closed over this plugin's context.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-settings-experience: copy dictionaries");
			const describeFace = ctx.configForms.describe();
			const t = ctx.locale.bind(NS);
			let sessionToken;
			const load = async () => {
				await describeFace.ensure();
			};
			const currentSection = () => {
				const view = experienceView(describeFace.getSnapshot());
				if (view === void 0) return void 0;
				const settings = decodeExperience(view.value);
				if (settings === void 0) return void 0;
				return {
					settings,
					revision: view.revision
				};
			};
			const save = async (patch) => {
				const view = experienceView(describeFace.getSnapshot());
				if (view === void 0) return { kind: "absent" };
				const ops = experienceWriteOps(patch);
				if (ops.length === 0) return { kind: "written" };
				try {
					const response = await ctx.remote.settings.mutate(EXPERIENCE_POOL_NAMESPACE, ops, view.revision);
					if (response.ok) {
						describeFace.acceptView(response.value);
						return { kind: "written" };
					}
					return response.error.code === "settings/conflict" ? { kind: "conflict" } : {
						kind: "refused",
						message: response.error.message
					};
				} catch (error) {
					return {
						kind: "refused",
						message: error instanceof Error ? error.message : String(error)
					};
				}
			};
			/** Gateway URL every call in this session resolves from the mirror. */
			const currentBaseUrl = () => currentSection()?.settings.baseUrl ?? "https://www.smartbobo.cn";
			/**
			* Reuse the stored device id, or mint and persist one first so two
			* activations never present as two devices.
			* @returns the device id, or undefined when it could not be persisted.
			*/
			const ensureDeviceId = async () => {
				const stored = currentSection()?.settings.deviceId;
				if (stored !== void 0 && stored !== "") return stored;
				const deviceId = randomUUID();
				return (await save({ deviceId })).kind === "written" ? deviceId : void 0;
			};
			/**
			* Store one secret in the credentials domain.
			* @param ref - credential reference name.
			* @param value - the secret; it crosses the wire in this direction only.
			* @returns null on success, otherwise the host's refusal message.
			*/
			const storeCredential = async (ref, value) => {
				try {
					const response = await ctx.remote.credentials.set(ref, value);
					return response.ok ? null : response.error.message;
				} catch (error) {
					return error instanceof Error ? error.message : String(error);
				}
			};
			/**
			* Adopt a successful auth response: hold the token for this session, cache
			* the non-sensitive status in settings, and persist token (and key when the
			* caller has one) in credentials.
			* @param auth - the decoded activate / migrate-complete body.
			* @param key - the license key to persist, or null when there is none.
			* @returns the ok outcome carrying the license and both stores' answers.
			*/
			const adoptAuth = async (auth, key) => {
				sessionToken = auth.accessToken;
				const license = licenseCache(auth.license, auth.serverTime);
				const settingsStorage = await save({ license });
				const tokenStorage = await storeCredential(TOKEN_REF, auth.accessToken);
				const keyStorage = key === null ? null : await storeCredential(KEY_REF, key);
				return {
					kind: "ok",
					license,
					settingsStorage,
					credentialsStorage: tokenStorage ?? keyStorage
				};
			};
			/** Fold one gateway result into the auth outcome shape. */
			const authFromGateway = async (result, decode, key) => {
				if (!result.ok) return {
					kind: "gateway",
					failure: result.failure
				};
				const auth = decode(result.body);
				if (auth === void 0) return {
					kind: "gateway",
					failure: { kind: "malformed" }
				};
				return adoptAuth(auth, key);
			};
			const activate = async (key) => {
				const deviceId = await ensureDeviceId();
				if (deviceId === void 0) return { kind: "device" };
				return authFromGateway(await callGateway(currentBaseUrl(), "/v1/license/activate", jsonBody({
					key,
					device_id: deviceId,
					client_version: clientVersion()
				})), decodeLicenseAuth, key);
			};
			const refresh = async () => {
				if (sessionToken === void 0) return { kind: "no-token" };
				const result = await callGateway(currentBaseUrl(), "/v1/license/me", {
					method: "GET",
					headers: { Authorization: `Bearer ${sessionToken}` }
				});
				if (!result.ok) return {
					kind: "gateway",
					failure: result.failure
				};
				const me = decodeLicenseMe(result.body);
				if (me === void 0) return {
					kind: "gateway",
					failure: { kind: "malformed" }
				};
				const license = licenseCache(me.license, me.serverTime);
				return {
					kind: "ok",
					license,
					settingsStorage: await save({ license }),
					credentialsStorage: null
				};
			};
			const migrateRequest = async (email, recoveryCode) => {
				const result = await callGateway(currentBaseUrl(), "/v1/license/migrate/request", jsonBody({
					email,
					recovery_code: recoveryCode
				}));
				return result.ok ? { kind: "ok" } : {
					kind: "gateway",
					failure: result.failure
				};
			};
			const migrateComplete = async (email, recoveryCode, code) => {
				const deviceId = await ensureDeviceId();
				if (deviceId === void 0) return { kind: "device" };
				return authFromGateway(await callGateway(currentBaseUrl(), "/v1/license/migrate/complete", jsonBody({
					email,
					recovery_code: recoveryCode,
					code,
					device_id: deviceId
				})), decodeLicenseAuth, null);
			};
			const health = async () => {
				const result = await callGateway(currentBaseUrl(), "/v1/health", { method: "GET" });
				if (!result.ok) {
					if (result.failure.kind === "http") return {
						gateway: "up",
						qdrant: "unknown",
						...result.failure.description === void 0 ? {} : { detail: result.failure.description }
					};
					return {
						gateway: "down",
						qdrant: "unknown"
					};
				}
				const report = decodeHealth(result.body);
				if (report === void 0) return {
					gateway: "up",
					qdrant: "unknown"
				};
				return {
					gateway: "up",
					qdrant: report.qdrantReachable ? "up" : "down"
				};
			};
			const credentialsState = async () => {
				try {
					const response = await ctx.remote.credentials.describe([KEY_REF, TOKEN_REF]);
					if (!response.ok) return null;
					return {
						key: response.value[KEY_REF]?.configured ?? false,
						token: response.value[TOKEN_REF]?.configured ?? false
					};
				} catch {
					return null;
				}
			};
			const injected = () => ({
				load,
				save,
				activate,
				refresh,
				migrateRequest,
				migrateComplete,
				health,
				credentialsState,
				hooks: { settings: describeFace }
			});
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "experience-pool",
				order: 68,
				label: () => t("nav"),
				locale: NS,
				inject: injected
			}, ExperienceSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map