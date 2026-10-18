window.__ModuleLoader__.load({ id: "dsh-dbx", factory: (require) => {
	var module = { exports: {} };
	var exports = module.exports;
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

	const React = require("react");
	const { useState, useEffect, createElement: h, Fragment } = React;
	const { Button, IconRefreshOutlineMedium, IconDatabaseOutlineMedium } = require("@deepseek-ai/dsh-client-ui-primitives");

	const DBX_WEB_URL = "http://127.0.0.1:4230";
	const PROBE_TIMEOUT_MS = 5000;
	const FRAME_TIMEOUT_MS = 20000;
	const NS = "dbx";
	const PANEL_ID = "dbx";
	const PANEL_ORDER = 10;

	const zh = {
		panel: "数据库",
		title: "数据库",
		checking: "正在连接 DBX 服务…",
		offline: "DBX 服务未启动。",
		offlineHint: "插件会自动拉起它（dbx-runtime/dbx-web.exe，端口 4230）；也可手动启动后点重试。",
		retry: "重试",
		frameTitle: "DBX Web 控制台",
	};
	const en = {
		panel: "Database",
		title: "Database",
		checking: "Connecting to the DBX service…",
		offline: "The DBX service is not running.",
		offlineHint: "The plugin starts it automatically (dbx-runtime/dbx-web.exe, port 4230). You can also start it yourself, then retry.",
		retry: "Retry",
		frameTitle: "DBX Web console",
	};

	const CSS = `
.dbx-panel { display: flex; flex-direction: column; box-sizing: border-box; height: 100%; min-height: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.dbx-head { display: flex; align-items: center; flex: none; padding: 12px 20px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dbx-title { margin: 0; font-size: 16px; font-weight: 500; line-height: 24px; }
.dbx-frame { flex: 1; min-height: 0; width: 100%; border: 0; background: var(--dsw-alias-bg-layer-1); }
.dbx-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; flex: 1; padding: 0 32px; text-align: center; }
.dbx-state-title { margin: 0; font-size: 14px; line-height: 22px; }
.dbx-state-hint { margin: 0; max-width: 560px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }
`;

	function ensureStyles() {
		if (document.querySelector('style[data-plugin="dsh-dbx"]')) return;
		const style = document.createElement("style");
		style.setAttribute("data-plugin", "dsh-dbx");
		style.textContent = CSS;
		document.head.appendChild(style);
	}

	function DbxPanel(props) {
		const t = props.t;
		const [phase, setPhase] = useState("probing");
		const [attempt, setAttempt] = useState(0);
		const [loaded, setLoaded] = useState(false);

		useEffect(() => {
			const controller = new AbortController();
			const timer = window.setTimeout(() => { controller.abort(); }, PROBE_TIMEOUT_MS);
			let alive = true;
			setPhase("probing");
			setLoaded(false);
			fetch(DBX_WEB_URL, { mode: "no-cors", cache: "no-store", signal: controller.signal }).then(
				() => { if (alive) setPhase("ready"); },
				() => { if (alive) setPhase("offline"); },
			).finally(() => { window.clearTimeout(timer); });
			return () => {
				alive = false;
				window.clearTimeout(timer);
				controller.abort();
			};
		}, [attempt]);

		useEffect(() => {
			if (phase !== "ready" || loaded) return undefined;
			const timer = window.setTimeout(() => { setPhase("offline"); }, FRAME_TIMEOUT_MS);
			return () => { window.clearTimeout(timer); };
		}, [phase, loaded]);

		const offline = phase === "offline";
		const body = phase === "ready"
			? h("iframe", {
				key: attempt,
				className: "dbx-frame",
				src: DBX_WEB_URL,
				title: t("frameTitle"),
				onLoad: () => { setLoaded(true); },
			})
			: h("div", { className: "dbx-state", role: offline ? "alert" : "status" },
				offline
					? h(Fragment, null,
						h("p", { className: "dbx-state-title" }, t("offline")),
						h("p", { className: "dbx-state-hint" }, t("offlineHint")),
						h(Button, {
							variant: "primary",
							icon: h(IconRefreshOutlineMedium),
							onClick: () => { setAttempt((current) => current + 1); },
						}, t("retry")))
					: h("p", { className: "dbx-state-title" }, t("checking")));

		return h("section", { className: "dbx-panel", "data-dbx-panel": true, "aria-busy": phase === "probing" },
			h("header", { className: "dbx-head" },
				h("h1", { className: "dbx-title" }, t("title"))),
			body);
	}

	function DbxPanelIcon(props) {
		return h(IconDatabaseOutlineMedium, { size: props.size });
	}

	const inject = ["slots", "locale"];

	function apply(ctx) {
		ensureStyles();
		ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-dbx: dictionaries");
		const t = ctx.locale.bind(NS);
		ctx.slots.inject("main", () => ctx.slots.register({
			name: "main",
			key: PANEL_ID,
			locale: NS,
		}, DbxPanel));
		ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
			name: "sidebar.panellist",
			id: PANEL_ID,
			order: PANEL_ORDER,
			label: () => t("panel"),
			locale: NS,
		}, DbxPanelIcon));
	}

	exports.name = "dsh-dbx";
	exports.inject = inject;
	exports.apply = apply;
	return module.exports;
}});
