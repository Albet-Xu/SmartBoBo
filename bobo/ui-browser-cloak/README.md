---
description: "Right-sidebar built-in browser panel: renders the shared CloakBrowser browser, forwards input, and surfaces itself when a manual takeover waits."
kind: "package-reference"
---

# bobo-browser-ui

English | [中文](README.zh.md)

## Summary

The right-sidebar built-in browser panel: registers the `CloakBrowser` tab type, renders JPEG frames of the shared browser, forwards mouse, wheel, and keyboard input, and surfaces itself when the host reports a manual takeover waiting. It mirrors the same browser instance that `crawl_fetch` and `browser_handoff` operate on.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the plugin to add the panel; the host-side bridge it talks to is mounted separately:

```yaml
- id: ui-browser-CloakBrowser
  name: './ui-browser-CloakBrowser/lib/index.js'
```

The panel needs the `bobo-browser-bridge` row (`./tool-acquisition/lib/bridge.js`) and the CloakBrowser service behind it; together they give every mode the same shared browser and login state.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Every contribution is its own effect: the tab type and dictionary register against the right sidebar's services, and the panel body registers through `slots.inject('sidebar.right.pane.tab')` so the declaring entry's load order is not this plugin's business. The panel keeps all state in the component — no store, no injected business face — and drives the bridge's `POST /bobo-CloakBrowser/cmd` for status, screenshots, input forwarding, and reload.

The handoff watcher (`handoff-watch.ts`) listens for the host's pending manual takeover and surfaces the panel so the user can complete a captcha or login; the `browser_handoff` tool that creates those takeovers belongs to `bobo-crawl-tool`.

</details>

<a id="model-experience"></a>
## Model Experience

### Built-in browser panel

#### What the model sees

Nothing: the panel is browser-side presentation; registering the tab type, frames, and input forwarding adds no prompt section, tool, or session event — the model-visible handoff flow is owned by `bobo-crawl-tool`.

#### Token effect

Zero: this package adds no tokens to any model request.

#### KV Cache effect

None: the request prefix contains no content from this package under any mount.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The panel renders frames only while the bridge row and the CloakBrowser service are reachable; without them it reports the failure instead of a live image.
- Display is JPEG frame polling with forwarded pointer and keyboard events — there is no audio and no direct DevTools surface.
- Panel state is component-local, so closing or remounting the tab resets the view; nothing about the displayed page is persisted client-side.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
