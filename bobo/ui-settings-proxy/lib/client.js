window.__ModuleLoader__.load({
	id: "bobo-settings-proxy-ui",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region lib/types/client/proxy-pool.js
		/**
		* Proxy pool contract for the settings page: the field set the host
		* `/proxy` command reads, the defaults a new entry starts from, and the pure
		* folds that turn one settings namespace view into the page's state.
		*
		* Field names and types are the host package's own, imported rather than
		* restated, so a rename on either side fails to compile.
		*
		* @module bobo-settings-proxy-ui/proxy-pool
		*/
		/** Settings namespace the host `/proxy` command draws proxy addresses from. */
		const PROXY_POOL_NAMESPACE = "proxy-pool";
		/** Fetch strategies the host schema accepts. */
		const FETCH_STRATEGIES = ["cache", "realtime"];
		/** Proxy types the host schema records per source. */
		const PROXY_HTTP_TYPES = ["http", "socks5"];
		/** Fields a source carries before the page adds a name to it. */
		const NEW_PROXY_SOURCE = {
			name: "",
			apiUrl: "",
			apiKey: "",
			pwd: "",
			getnum: 50,
			httptype: "http",
			geshi: "2",
			fenge: "1",
			enabled: true
		};
		/** Plain-object view of a wire value, or undefined for anything else. */
		function asRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
		}
		/** A wire string, or the host schema's own default for a missing or mistyped field. */
		function text(value, fallback) {
			return typeof value === "string" ? value : fallback;
		}
		/** A wire count, or the fallback for a value the host schema could not have produced. */
		function natural(value, fallback) {
			return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
		}
		/** One source entry, or undefined when the wire entry is not an object. */
		function decodeSource(value, defaults) {
			const row = asRecord(value);
			if (row === void 0) return void 0;
			return {
				name: text(row.name, defaults.name),
				apiUrl: text(row.apiUrl, defaults.apiUrl),
				apiKey: text(row.apiKey, defaults.apiKey),
				pwd: text(row.pwd, defaults.pwd),
				getnum: natural(row.getnum, defaults.getnum),
				httptype: text(row.httptype, defaults.httptype),
				geshi: text(row.geshi, defaults.geshi),
				fenge: text(row.fenge, defaults.fenge),
				enabled: typeof row.enabled === "boolean" ? row.enabled : defaults.enabled
			};
		}
		/**
		* Narrow one redacted settings section to the pool the page edits. The section
		* arrives from the wire, so every field falls back to the value the host
		* schema defaults it to when the section omits or mistypes it.
		* @param section - the `proxy-pool` namespace's resolved value.
		* @returns the pool, or undefined when the section is not an object at all.
		*/
		function decodeProxyPool(section) {
			const row = asRecord(section);
			if (row === void 0) return void 0;
			const sources = Array.isArray(row.sources) ? row.sources : [];
			const strategy = row.fetchStrategy === "realtime" ? "realtime" : "cache";
			return {
				sources: sources.flatMap((entry) => {
					const source = decodeSource(entry, NEW_PROXY_SOURCE);
					return source === void 0 ? [] : [source];
				}),
				fetchStrategy: strategy,
				enabled: typeof row.enabled === "boolean" ? row.enabled : false,
				maxRetries: natural(row.maxRetries, 3),
				timeoutMs: natural(row.timeoutMs, 3e4)
			};
		}
		/**
		* The `proxy-pool` namespace view inside one settings mirror snapshot.
		* @param mirror - the shared describe mirror's snapshot.
		* @returns the namespace view, or undefined while unanswered or unregistered.
		*/
		function proxyPoolView(mirror) {
			return mirror.view?.namespaces.find((row) => row.ns === PROXY_POOL_NAMESPACE);
		}
		/**
		* Fold one settings mirror snapshot into the page's state.
		* @param mirror - the shared describe mirror's snapshot.
		* @returns the state the section renders.
		*/
		function proxyPoolPageState(mirror) {
			if (mirror.status === "unavailable") return { status: "unavailable" };
			if (mirror.view === void 0) return mirror.error === null ? { status: "loading" } : {
				status: "failed",
				reason: "read",
				detail: mirror.error
			};
			const view = proxyPoolView(mirror);
			if (view === void 0) return { status: "absent" };
			const settings = decodeProxyPool(view.value);
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
		* Path operations carrying a whole edited pool into its namespace. Every
		* field the page owns is restated, so a field the host adds later keeps its
		* stored value rather than being dropped by this page's write.
		* @param settings - the edited pool.
		* @returns the operations one settings write applies.
		*/
		function proxyPoolWriteOps(settings) {
			return [
				{
					op: "set",
					path: ["sources"],
					value: settings.sources
				},
				{
					op: "set",
					path: ["fetchStrategy"],
					value: settings.fetchStrategy
				},
				{
					op: "set",
					path: ["enabled"],
					value: settings.enabled
				},
				{
					op: "set",
					path: ["maxRetries"],
					value: settings.maxRetries
				},
				{
					op: "set",
					path: ["timeoutMs"],
					value: settings.timeoutMs
				}
			];
		}
		/**
		* Move one entry inside a list, leaving every other entry in place.
		* @param entries - the list to reorder; not modified.
		* @param from - index the entry currently sits at.
		* @param to - index the entry moves to.
		* @returns the reordered copy, or the same list when the move is a no-op.
		*/
		function moveEntry(entries, from, to) {
			if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) return entries;
			const next = [...entries];
			const [moved] = next.splice(from, 1);
			if (moved === void 0) return entries;
			next.splice(to, 0, moved);
			return next;
		}
		/**
		* Reorder the source list for a drag that carried one entry from `from` to
		* `to`, told apart from a gesture that asks for no write at all. Ordering is
		* the array's own order, so a drop and the priority buttons apply the same
		* move through {@link moveEntry}.
		* @param sources - the list the drag started from; not modified.
		* @param from - index the carried source occupied when the drag started.
		* @param to - index the drop targets, in that same list.
		* @returns the reordered copy, or null when the drop asks for nothing: the
		*   source dropped back onto itself, or an index outside the list.
		*/
		function reorderSources(sources, from, to) {
			const next = moveEntry(sources, from, to);
			return next === sources ? null : next;
		}
		/**
		* Shift the open rows of a list that dropped one entry, so the rows around the
		* hole keep the entries they were open on. Row positions are the page's own
		* view state, so they follow every list mutation that moves entries around.
		* @param expanded - row positions open before the removal; not modified.
		* @param index - position the removed entry occupied.
		* @returns the open positions in the shortened list.
		*/
		function dropExpanded(expanded, index) {
			const next = /* @__PURE__ */ new Set();
			for (const at of expanded) {
				if (at === index) continue;
				next.add(at > index ? at - 1 : at);
			}
			return next;
		}
		/**
		* Shift the open rows of a list that moved one entry, so a row open on the
		* carried entry stays open on it at its new position.
		* @param expanded - row positions open before the move; not modified.
		* @param from - position the moved entry occupied.
		* @param to - position the moved entry takes.
		* @returns the open positions in the reordered list.
		*/
		function moveExpanded(expanded, from, to) {
			const next = /* @__PURE__ */ new Set();
			for (const at of expanded) next.add(movedPosition(at, from, to));
			return next;
		}
		/**
		* Where one row position lands once the entry at `from` moves onto `to`: the
		* carried position moves to the target, and the positions it travels over
		* shift by one toward the hole it left.
		* @param at - the position to map.
		* @param from - position the moved entry occupied.
		* @param to - position the moved entry takes.
		* @returns the position that entry occupies in the reordered list.
		*/
		function movedPosition(at, from, to) {
			if (at === from) return to;
			if (from < at && at <= to) return at - 1;
			if (to <= at && at < from) return at + 1;
			return at;
		}
		//#endregion
		//#region \0dsh-css:E:\BoBo-Handyman\dsh\packages\bobo\ui-settings-proxy\src\client\ProxyPoolSection.module.css.mjs
		const css = ".ylxqqG_section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}.ylxqqG_header{flex-direction:column;gap:4px;display:flex}.ylxqqG_title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}.ylxqqG_intro,.ylxqqG_hint,.ylxqqG_status,.ylxqqG_notice,.ylxqqG_empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}.ylxqqG_notice{color:var(--dsw-alias-state-warn-label)}.ylxqqG_error{color:var(--dsw-alias-state-error-primary);flex:auto;margin:0;font-size:12px;line-height:18px}.ylxqqG_savedNotice{color:var(--dsw-alias-state-success-primary);flex:auto;margin:0;font-size:12px;line-height:18px}.ylxqqG_switchRow{align-items:center;gap:10px;display:flex}.ylxqqG_switchText{flex-direction:column;display:flex}.ylxqqG_switchTitle{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}.ylxqqG_settingsGrid{grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr);gap:12px;display:grid}.ylxqqG_sources{flex-direction:column;gap:8px;display:flex}.ylxqqG_sourcesHead{justify-content:space-between;align-items:center;gap:12px;display:flex}.ylxqqG_sectionLabel{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}.ylxqqG_list{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}.ylxqqG_empty{border:1px dashed var(--dsw-alias-border-l3);text-align:center;border-radius:12px;padding:12px}.ylxqqG_card{border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;flex-direction:column;gap:10px;padding:10px 12px;display:flex}.ylxqqG_cardDragging{opacity:.5}.ylxqqG_cardDropTarget{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}.ylxqqG_dragHandle{width:14px;height:24px;color:var(--dsw-alias-label-tertiary);cursor:grab;user-select:none;flex:none;justify-content:center;align-items:center;font-size:14px;line-height:1;display:inline-flex}.ylxqqG_dragHandle:hover{color:var(--dsw-alias-label-primary)}.ylxqqG_dragHandle:active{cursor:grabbing}.ylxqqG_cardHead{align-items:center;gap:8px;min-width:0;display:flex}.ylxqqG_cardName{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-primary);flex:auto;font-size:14px;font-weight:500;line-height:22px;overflow:hidden}.ylxqqG_nameInput{flex:auto}.ylxqqG_cardTag{border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:4px;flex:none;padding:1px 6px;font-size:11px;line-height:16px}.ylxqqG_cardActions{align-items:center;gap:4px;margin-left:auto;display:inline-flex}.ylxqqG_expandButton{box-sizing:border-box;width:24px;height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:6px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.ylxqqG_expandButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.ylxqqG_expandButton:focus-visible,.ylxqqG_cardActions button:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}.ylxqqG_chevronOpen,.ylxqqG_chevronClosed{transition:transform .12s}.ylxqqG_chevronOpen{transform:rotate(0)}.ylxqqG_chevronClosed{transform:rotate(-90deg)}.ylxqqG_fields{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding-top:2px;display:grid}.ylxqqG_field,.ylxqqG_fieldWide{flex-direction:column;gap:4px;min-width:0;display:flex}.ylxqqG_fieldWide{grid-column:1/-1}.ylxqqG_fieldLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.ylxqqG_select{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);width:100%;height:32px;font:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:8px;padding:0 10px;font-size:14px;line-height:22px}.ylxqqG_select:focus{border-color:var(--dsw-alias-brand-primary);outline:none}.ylxqqG_select:disabled{opacity:.6;cursor:default}.ylxqqG_actions{justify-content:flex-end;align-items:center;gap:8px;display:flex}@media (prefers-reduced-motion:reduce){.ylxqqG_chevronOpen,.ylxqqG_chevronClosed{transition:none}}";
		const tagId = "bobo-settings-proxy-ui/ProxyPoolSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "bobo-settings-proxy-ui";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var ProxyPoolSection_module_css_default = {
			"actions": "ylxqqG_actions",
			"card": "ylxqqG_card",
			"cardActions": "ylxqqG_cardActions",
			"cardDragging": "ylxqqG_cardDragging",
			"cardDropTarget": "ylxqqG_cardDropTarget",
			"cardHead": "ylxqqG_cardHead",
			"cardName": "ylxqqG_cardName",
			"cardTag": "ylxqqG_cardTag",
			"chevronClosed": "ylxqqG_chevronClosed",
			"chevronOpen": "ylxqqG_chevronOpen",
			"dragHandle": "ylxqqG_dragHandle",
			"empty": "ylxqqG_empty",
			"error": "ylxqqG_error",
			"expandButton": "ylxqqG_expandButton",
			"field": "ylxqqG_field",
			"fieldLabel": "ylxqqG_fieldLabel",
			"fieldWide": "ylxqqG_fieldWide",
			"fields": "ylxqqG_fields",
			"header": "ylxqqG_header",
			"hint": "ylxqqG_hint",
			"intro": "ylxqqG_intro",
			"list": "ylxqqG_list",
			"nameInput": "ylxqqG_nameInput",
			"notice": "ylxqqG_notice",
			"savedNotice": "ylxqqG_savedNotice",
			"section": "ylxqqG_section",
			"sectionLabel": "ylxqqG_sectionLabel",
			"select": "ylxqqG_select",
			"settingsGrid": "ylxqqG_settingsGrid",
			"sources": "ylxqqG_sources",
			"sourcesHead": "ylxqqG_sourcesHead",
			"status": "ylxqqG_status",
			"switchRow": "ylxqqG_switchRow",
			"switchText": "ylxqqG_switchText",
			"switchTitle": "ylxqqG_switchTitle",
			"title": "ylxqqG_title"
		};
		//#endregion
		//#region lib/types/client/ProxyPoolSection.js
		/**
		* Proxy Pool settings page: the master switch, the fetch strategy, and the
		* ordered source list the host `/proxy` command draws addresses from.
		*
		* The page edits one draft and commits it as a whole, so a half-typed URL
		* never reaches the host. The host stays the single fact source: an untouched
		* page always renders the last committed value, and a committed draft is
		* dropped in favour of the answer the write returned.
		*/
		/**
		* One source's own card: identity on the collapsed row, the full field set
		* once expanded, and the ordering controls that set its priority.
		*/
		function SourceCard({ source, index, count, readOnly, expanded, drag, t, onToggle, onChange, onRemove, onMove }) {
			const name = source.name.trim() === "" ? t("unnamed") : source.name;
			const classes = [ProxyPoolSection_module_css_default["card"]];
			if (drag?.dragging === true) classes.push(ProxyPoolSection_module_css_default["cardDragging"]);
			if (drag?.target === true) classes.push(ProxyPoolSection_module_css_default["cardDropTarget"]);
			return (0, react_jsx_runtime.jsxs)("li", {
				className: classes.join(" "),
				onDragOver: drag?.onOver,
				onDrop: drag?.onDrop,
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: ProxyPoolSection_module_css_default["cardHead"],
					children: [
						drag === void 0 ? null : (0, react_jsx_runtime.jsx)("span", {
							className: ProxyPoolSection_module_css_default["dragHandle"],
							draggable: true,
							title: t("dragHandleShort"),
							"aria-label": t("dragHandle", { name }),
							onDragStart: drag.onStart,
							onDragEnd: drag.onEnd,
							children: "≡"
						}),
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ProxyPoolSection_module_css_default["expandButton"],
							"aria-expanded": expanded,
							"aria-label": name,
							onClick: onToggle,
							children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { className: expanded ? ProxyPoolSection_module_css_default["chevronOpen"] : ProxyPoolSection_module_css_default["chevronClosed"] })
						}),
						expanded ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
							className: `${ProxyPoolSection_module_css_default["nameInput"]}`,
							value: source.name,
							placeholder: t("sourceNamePlaceholder"),
							"aria-label": t("sourceName"),
							disabled: readOnly,
							onChange: (event) => {
								onChange({ name: event.currentTarget.value });
							}
						}) : (0, react_jsx_runtime.jsx)("span", {
							className: ProxyPoolSection_module_css_default["cardName"],
							children: name
						}),
						source.enabled ? null : (0, react_jsx_runtime.jsx)("span", {
							className: ProxyPoolSection_module_css_default["cardTag"],
							children: t("disabledTag")
						}),
						(0, react_jsx_runtime.jsxs)("span", {
							className: ProxyPoolSection_module_css_default["cardActions"],
							children: [
								(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									size: "sm",
									disabled: readOnly || index === 0,
									title: t("moveUpShort"),
									"aria-label": t("moveUp", { name }),
									onClick: () => {
										onMove(index - 1);
									},
									children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronUpOutlineRegular, {})
								}),
								(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									size: "sm",
									disabled: readOnly || index === count - 1,
									title: t("moveDownShort"),
									"aria-label": t("moveDown", { name }),
									onClick: () => {
										onMove(index + 1);
									},
									children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {})
								}),
								(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
									checked: source.enabled,
									disabled: readOnly,
									label: t("enabledNamed", { name }),
									onChange: (next) => {
										onChange({ enabled: next });
									}
								}),
								(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									size: "sm",
									disabled: readOnly,
									title: t("remove"),
									"aria-label": t("removeNamed", { name }),
									onClick: onRemove,
									children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineMedium, {})
								})
							]
						})
					]
				}), expanded ? (0, react_jsx_runtime.jsxs)("div", {
					className: ProxyPoolSection_module_css_default["fields"],
					children: [
						(0, react_jsx_runtime.jsxs)("label", {
							className: ProxyPoolSection_module_css_default["fieldWide"],
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: ProxyPoolSection_module_css_default["fieldLabel"],
								children: t("apiUrl")
							}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								value: source.apiUrl,
								placeholder: t("apiUrlPlaceholder"),
								disabled: readOnly,
								onChange: (event) => {
									onChange({ apiUrl: event.currentTarget.value });
								}
							})]
						}),
						(0, react_jsx_runtime.jsxs)("label", {
							className: ProxyPoolSection_module_css_default["field"],
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: ProxyPoolSection_module_css_default["fieldLabel"],
								children: t("apiKey")
							}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								value: source.apiKey,
								disabled: readOnly,
								onChange: (event) => {
									onChange({ apiKey: event.currentTarget.value });
								}
							})]
						}),
						(0, react_jsx_runtime.jsxs)("label", {
							className: ProxyPoolSection_module_css_default["field"],
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: ProxyPoolSection_module_css_default["fieldLabel"],
								children: t("pwd")
							}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								value: source.pwd,
								disabled: readOnly,
								onChange: (event) => {
									onChange({ pwd: event.currentTarget.value });
								}
							})]
						}),
						(0, react_jsx_runtime.jsxs)("label", {
							className: ProxyPoolSection_module_css_default["field"],
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: ProxyPoolSection_module_css_default["fieldLabel"],
								children: t("getnum")
							}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								type: "number",
								min: 1,
								value: source.getnum,
								disabled: readOnly,
								onChange: (event) => {
									onChange({ getnum: countFrom(event.currentTarget.value, source.getnum) });
								}
							})]
						}),
						(0, react_jsx_runtime.jsxs)("label", {
							className: ProxyPoolSection_module_css_default["field"],
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: ProxyPoolSection_module_css_default["fieldLabel"],
								children: t("httpType")
							}), (0, react_jsx_runtime.jsxs)("select", {
								className: ProxyPoolSection_module_css_default["select"],
								value: source.httptype,
								"aria-label": t("httpType"),
								disabled: readOnly,
								onChange: (event) => {
									onChange({ httptype: event.currentTarget.value });
								},
								children: [PROXY_HTTP_TYPES.map((type) => (0, react_jsx_runtime.jsx)("option", {
									value: type,
									children: type
								}, type)), PROXY_HTTP_TYPES.some((type) => type === source.httptype) ? null : (0, react_jsx_runtime.jsx)("option", {
									value: source.httptype,
									children: source.httptype
								})]
							})]
						}),
						(0, react_jsx_runtime.jsxs)("label", {
							className: ProxyPoolSection_module_css_default["field"],
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: ProxyPoolSection_module_css_default["fieldLabel"],
								children: t("geshi")
							}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								value: source.geshi,
								disabled: readOnly,
								onChange: (event) => {
									onChange({ geshi: event.currentTarget.value });
								}
							})]
						}),
						(0, react_jsx_runtime.jsxs)("label", {
							className: ProxyPoolSection_module_css_default["field"],
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: ProxyPoolSection_module_css_default["fieldLabel"],
								children: t("fenge")
							}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								value: source.fenge,
								disabled: readOnly,
								onChange: (event) => {
									onChange({ fenge: event.currentTarget.value });
								}
							})]
						})
					]
				}) : null]
			});
		}
		/**
		* Read a positive count out of a number field, keeping the previous value for
		* an empty or fractional entry (a cleared field parses to no count at all).
		* @param raw - the field's text.
		* @param previous - the value to keep when the entry names no count.
		* @returns the count the pool should store.
		*/
		function countFrom(raw, previous) {
			const parsed = Number.parseInt(raw, 10);
			return Number.isInteger(parsed) && parsed > 0 ? parsed : previous;
		}
		/** Render the page status line for a state the editor cannot render from. */
		function StatusLine({ state, t }) {
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ProxyPoolSection_module_css_default["section"],
				children: [(0, react_jsx_runtime.jsxs)("p", {
					className: ProxyPoolSection_module_css_default["status"],
					children: [
						state === "loading" ? t("loading") : null,
						state === "unavailable" ? t("unavailable") : null,
						state === "absent" ? t("namespaceMissing") : null,
						state === "read" ? t("loadFailed") : null,
						state === "section" ? t("malformed") : null
					]
				}), state === "absent" ? (0, react_jsx_runtime.jsx)("p", {
					className: ProxyPoolSection_module_css_default["status"],
					children: t("namespaceHint")
				}) : null]
			});
		}
		/**
		* Render the Proxy Pool section content.
		* @param props - composed slot props (see {@link ProxyPoolSectionProps}).
		* @returns the settings section element tree.
		*/
		function ProxyPoolSection(props) {
			const { useSettings, load, save, t } = props;
			return (0, react_jsx_runtime.jsx)(Loaded, {
				face: {
					useSettings,
					load,
					save
				},
				t
			});
		}
		function Loaded({ face, t }) {
			const { useSettings, load, save } = face;
			const mirror = useSettings((snapshot) => snapshot);
			const page = (0, react.useMemo)(() => proxyPoolPageState(mirror), [mirror]);
			const [draft, setDraft] = (0, react.useState)(void 0);
			const [expanded, setExpanded] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [saving, setSaving] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)(void 0);
			const [saved, setSaved] = (0, react.useState)(false);
			const [dragIndex, setDragIndex] = (0, react.useState)(void 0);
			const [dropIndex, setDropIndex] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				if (mirror.status === "idle") load();
			}, [load, mirror.status]);
			if (page.status !== "ready") return (0, react_jsx_runtime.jsx)(StatusLine, {
				state: page.status === "failed" ? page.reason : page.status,
				t
			});
			const committed = page.settings;
			const settings = draft ?? committed;
			const dirty = draft !== void 0;
			const readOnly = !page.writable;
			const patch = (next) => {
				setSaved(false);
				setDraft((previous) => ({
					...previous ?? committed,
					...next
				}));
			};
			const patchSource = (index, next) => {
				patch({ sources: settings.sources.map((source, at) => at === index ? {
					...source,
					...next
				} : source) });
			};
			const addSource = () => {
				const source = {
					...NEW_PROXY_SOURCE,
					name: t("newSourceName", { index: settings.sources.length + 1 })
				};
				patch({ sources: [...settings.sources, source] });
				setExpanded((previous) => new Set([...previous, settings.sources.length]));
			};
			const removeSource = (index) => {
				patch({ sources: settings.sources.filter((_source, at) => at !== index) });
				setExpanded((previous) => dropExpanded(previous, index));
			};
			const moveSource = (from, to) => {
				patch({ sources: [...moveEntry(settings.sources, from, to)] });
				setExpanded((previous) => moveExpanded(previous, from, to));
			};
			/**
			* Settle the gesture. A drop and a release outside the list both end here,
			* so no row keeps a highlight the pointer has left behind.
			*/
			const endDrag = () => {
				setDragIndex(void 0);
				setDropIndex(void 0);
			};
			/**
			* Carry one source. The gesture carries its index as text as well, because a
			* drag that sets no data does not start at all in Firefox.
			* @param event - the row's dragstart.
			* @param index - the carried source's position in the rendered list.
			*/
			const startDrag = (event, index) => {
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData("text/plain", String(index));
				setDragIndex(index);
			};
			/**
			* Mark the row a live drag would land on. A gesture this page did not start
			* carries no source, so it keeps the browser's own refusal.
			* @param event - the row's dragover.
			* @param index - the hovered row's position in the rendered list.
			*/
			const overDrag = (event, index) => {
				if (dragIndex === void 0) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "move";
				setDropIndex(index);
			};
			/**
			* Apply the drop through the same fold the priority buttons use, and settle
			* the gesture. A drop that asks for no move leaves the draft untouched.
			* @param event - the row's drop.
			* @param index - the target row's position in the rendered list.
			*/
			const dropDrag = (event, index) => {
				if (dragIndex === void 0) return;
				event.preventDefault();
				const next = reorderSources(settings.sources, dragIndex, index);
				if (next !== null) {
					patch({ sources: [...next] });
					setExpanded((previous) => moveExpanded(previous, dragIndex, index));
				}
				endDrag();
			};
			const toggleSource = (index) => {
				setExpanded((previous) => {
					const next = new Set(previous);
					if (next.has(index)) next.delete(index);
					else next.add(index);
					return next;
				});
			};
			const submit = async () => {
				if (draft === void 0) return;
				setSaving(true);
				setFailure(void 0);
				setSaved(false);
				const outcome = await save(draft);
				setSaving(false);
				if (outcome.kind === "written") {
					setDraft(void 0);
					setExpanded(/* @__PURE__ */ new Set());
					setSaved(true);
					return;
				}
				if (outcome.kind === "conflict") setFailure(t("conflict"));
				else if (outcome.kind === "absent") setFailure(t("namespaceMissing"));
				else setFailure(outcome.message);
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ProxyPoolSection_module_css_default["section"],
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: ProxyPoolSection_module_css_default["header"],
						children: [(0, react_jsx_runtime.jsx)("h2", {
							className: ProxyPoolSection_module_css_default["title"],
							children: t("title")
						}), (0, react_jsx_runtime.jsx)("p", {
							className: ProxyPoolSection_module_css_default["intro"],
							children: t("intro")
						})]
					}),
					readOnly ? (0, react_jsx_runtime.jsx)("p", {
						className: ProxyPoolSection_module_css_default["notice"],
						children: t("readOnly")
					}) : null,
					page.staleError === null ? null : (0, react_jsx_runtime.jsx)("p", {
						className: ProxyPoolSection_module_css_default["notice"],
						children: page.staleError
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: ProxyPoolSection_module_css_default["switchRow"],
						children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
							checked: settings.enabled,
							disabled: readOnly,
							label: t("enabled"),
							onChange: (next) => {
								patch({ enabled: next });
							}
						}), (0, react_jsx_runtime.jsxs)("span", {
							className: ProxyPoolSection_module_css_default["switchText"],
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: ProxyPoolSection_module_css_default["switchTitle"],
								children: t("enabled")
							}), (0, react_jsx_runtime.jsx)("span", {
								className: ProxyPoolSection_module_css_default["hint"],
								children: t("enabledHint")
							})]
						})]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: ProxyPoolSection_module_css_default["settingsGrid"],
						children: [
							(0, react_jsx_runtime.jsxs)("label", {
								className: ProxyPoolSection_module_css_default["field"],
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: ProxyPoolSection_module_css_default["fieldLabel"],
									children: t("strategy")
								}), (0, react_jsx_runtime.jsx)("select", {
									className: ProxyPoolSection_module_css_default["select"],
									value: settings.fetchStrategy,
									"aria-label": t("strategy"),
									disabled: readOnly,
									onChange: (event) => {
										patch({ fetchStrategy: event.currentTarget.value });
									},
									children: FETCH_STRATEGIES.map((strategy) => (0, react_jsx_runtime.jsx)("option", {
										value: strategy,
										children: strategy === "cache" ? t("strategyCache") : t("strategyRealtime")
									}, strategy))
								})]
							}),
							(0, react_jsx_runtime.jsxs)("label", {
								className: ProxyPoolSection_module_css_default["field"],
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: ProxyPoolSection_module_css_default["fieldLabel"],
									children: t("maxRetries")
								}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									type: "number",
									min: 1,
									value: settings.maxRetries,
									disabled: readOnly,
									onChange: (event) => {
										patch({ maxRetries: countFrom(event.currentTarget.value, settings.maxRetries) });
									}
								})]
							}),
							(0, react_jsx_runtime.jsxs)("label", {
								className: ProxyPoolSection_module_css_default["field"],
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: ProxyPoolSection_module_css_default["fieldLabel"],
									children: t("timeoutMs")
								}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									type: "number",
									min: 1e3,
									step: 1e3,
									value: settings.timeoutMs,
									disabled: readOnly,
									onChange: (event) => {
										patch({ timeoutMs: countFrom(event.currentTarget.value, settings.timeoutMs) });
									}
								})]
							})
						]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: ProxyPoolSection_module_css_default["sources"],
						children: [
							(0, react_jsx_runtime.jsxs)("div", {
								className: ProxyPoolSection_module_css_default["sourcesHead"],
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: ProxyPoolSection_module_css_default["sectionLabel"],
									children: t("sources")
								}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									size: "sm",
									icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineMedium, {}),
									disabled: readOnly,
									onClick: addSource,
									children: t("addSource")
								})]
							}),
							(0, react_jsx_runtime.jsx)("p", {
								className: ProxyPoolSection_module_css_default["hint"],
								children: t("sourcesHint")
							}),
							settings.sources.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
								className: ProxyPoolSection_module_css_default["empty"],
								children: t("sourcesEmpty")
							}) : (0, react_jsx_runtime.jsx)("ol", {
								className: ProxyPoolSection_module_css_default["list"],
								children: settings.sources.map((source, index) => {
									const drag = readOnly ? void 0 : {
										dragging: dragIndex === index,
										target: dropIndex === index && dragIndex !== index,
										onStart: (event) => {
											startDrag(event, index);
										},
										onOver: (event) => {
											overDrag(event, index);
										},
										onDrop: (event) => {
											dropDrag(event, index);
										},
										onEnd: endDrag
									};
									return (0, react_jsx_runtime.jsx)(SourceCard, {
										source,
										index,
										count: settings.sources.length,
										readOnly,
										expanded: expanded.has(index),
										drag,
										t,
										onToggle: () => {
											toggleSource(index);
										},
										onChange: (next) => {
											patchSource(index, next);
										},
										onRemove: () => {
											removeSource(index);
										},
										onMove: (to) => {
											moveSource(index, to);
										}
									}, index);
								})
							})
						]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: ProxyPoolSection_module_css_default["actions"],
						children: [
							failure === void 0 ? null : (0, react_jsx_runtime.jsx)("p", {
								className: ProxyPoolSection_module_css_default["error"],
								children: failure
							}),
							saved ? (0, react_jsx_runtime.jsx)("p", {
								className: ProxyPoolSection_module_css_default["savedNotice"],
								children: t("saved")
							}) : null,
							(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								disabled: !dirty || saving,
								onClick: () => {
									setDraft(void 0);
									setExpanded(/* @__PURE__ */ new Set());
									setFailure(void 0);
									setSaved(false);
								},
								children: t("cancel")
							}),
							(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								disabled: !dirty || saving || readOnly,
								onClick: () => {
									submit();
								},
								children: saving ? t("saving") : t("save")
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** Copy dictionaries for the Proxy Pool settings section. */
		/** English strings (the key-set source of truth for this pair). */
		const en = {
			nav: "Proxy Pool",
			title: "Proxy pool",
			intro: "Collection tools route their requests through this pool while proxy mode is on.",
			enabled: "Serve requests through the pool",
			enabledHint: "While off, proxy-mode sessions connect directly.",
			strategy: "Fetch strategy",
			strategyCache: "Fetch a batch, then rotate",
			strategyRealtime: "Fetch for every request",
			maxRetries: "Max retries",
			timeoutMs: "Timeout (ms)",
			sources: "Proxy sources",
			sourcesHint: "The topmost enabled source is tried first.",
			sourcesEmpty: "No proxy source yet. Add one to collect through proxies.",
			addSource: "Add source",
			sourceName: "Name",
			sourceNamePlaceholder: "Source name",
			newSourceName: "Source {index}",
			unnamed: "Unnamed source",
			apiUrl: "API URL",
			apiUrlPlaceholder: "https://proxy.example/api",
			apiKey: "API key",
			pwd: "Password",
			getnum: "Addresses per fetch",
			httpType: "Proxy type",
			geshi: "Format parameter",
			fenge: "Separator parameter",
			enabledNamed: "Enable {name}",
			disabledTag: "Off",
			remove: "Delete",
			removeNamed: "Delete {name}",
			moveUp: "Move {name} up",
			moveDown: "Move {name} down",
			moveUpShort: "Move up",
			moveDownShort: "Move down",
			dragHandle: "Drag {name} to reorder",
			dragHandleShort: "Drag to reorder",
			save: "Save",
			saving: "Saving…",
			saved: "Saved.",
			cancel: "Cancel",
			loading: "Loading…",
			unavailable: "This connection does not serve settings.",
			loadFailed: "Loading the proxy pool failed.",
			malformed: "This host serves an unexpected proxy-pool section.",
			readOnly: "The settings document is read-only, so this page cannot be saved.",
			conflict: "These settings changed elsewhere. Reopen the page and apply your edits again.",
			namespaceMissing: "No proxy pool is registered on this host yet.",
			namespaceHint: "A collection preset (crawl, reverse, workflow, empirical) registers it when its first session starts."
		};
		/** Chinese strings (same keys as {@link en}). */
		const zh = {
			nav: "代理池",
			title: "代理池",
			intro: "代理模式开启后，采集工具将通过代理池发送请求。",
			enabled: "通过代理池发送请求",
			enabledHint: "关闭时，代理模式的会话直接连接网络。",
			strategy: "取用策略",
			strategyCache: "批量获取后轮询",
			strategyRealtime: "每次请求都获取",
			maxRetries: "最大重试次数",
			timeoutMs: "超时（毫秒）",
			sources: "代理源",
			sourcesHint: "越靠上的代理源越先被使用。",
			sourcesEmpty: "还没有代理源。新增一个即可通过代理采集。",
			addSource: "新增代理源",
			sourceName: "名称",
			sourceNamePlaceholder: "代理源名称",
			newSourceName: "代理源 {index}",
			unnamed: "未命名代理源",
			apiUrl: "API 地址",
			apiUrlPlaceholder: "https://proxy.example/api",
			apiKey: "API Key",
			pwd: "密码",
			getnum: "每次获取数量",
			httpType: "代理类型",
			geshi: "格式参数",
			fenge: "分隔参数",
			enabledNamed: "启用{name}",
			disabledTag: "已停用",
			remove: "删除",
			removeNamed: "删除{name}",
			moveUp: "把{name}上移",
			moveDown: "把{name}下移",
			moveUpShort: "上移",
			moveDownShort: "下移",
			dragHandle: "拖动{name}调整顺序",
			dragHandleShort: "拖动调整顺序",
			save: "保存",
			saving: "保存中…",
			saved: "已保存。",
			cancel: "取消",
			loading: "加载中…",
			unavailable: "当前连接不提供设置。",
			loadFailed: "加载代理池失败。",
			malformed: "此主机提供的 proxy-pool 配置格式不符合预期。",
			readOnly: "设置文档为只读，本页无法保存。",
			conflict: "这些设置已在别处改动。请重新打开本页后再应用你的修改。",
			namespaceMissing: "此主机上还没有注册代理池。",
			namespaceHint: "采集类模式（采集 / 逆向 / 工作流 / 实证）在首个会话启动时注册它。"
		};
		//#endregion
		//#region lib/types/client/index.js
		/**
		* Proxy pool settings page, browser half: contributes the Proxy Pool section
		* to Settings over the `proxy-pool` namespace the host `/proxy` command reads.
		* The namespace's data model, its host-side owner, and the session projection
		* that arms it all live in `bobo-proxy-tool`; this package owns
		* only the page, and reads and writes that namespace through the shared
		* settings describe mirror.
		*
		* Export discipline: packages/client/AGENTS.md.
		*/
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.proxy";
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
			"configForms"
		];
		/**
		* Register the Proxy Pool section once the `settings.section` declaration is
		* on the ledger, over the shared settings describe mirror.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-settings-proxy: dictionaries");
			const describeFace = ctx.configForms.describe();
			const t = ctx.locale.bind(NS);
			const load = async () => {
				await describeFace.ensure();
			};
			const save = async (settings) => {
				const view = proxyPoolView(describeFace.getSnapshot());
				if (view === void 0) return { kind: "absent" };
				try {
					const response = await ctx.remote.settings.mutate(PROXY_POOL_NAMESPACE, proxyPoolWriteOps(settings), view.revision);
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
			const injected = () => ({
				load,
				save,
				hooks: { settings: describeFace }
			});
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "proxy-pool",
				order: 70,
				label: () => t("nav"),
				locale: NS,
				inject: injected
			}, ProxyPoolSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map