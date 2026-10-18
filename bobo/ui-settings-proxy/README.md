---
description: "Proxy Pool settings section: edits the proxy-pool namespace the host /proxy command reads, through the shared settings describe mirror."
kind: "package-reference"
---

# bobo-settings-proxy-ui

English | [中文](README.zh.md)

## Summary

The Proxy Pool section in Settings: edits the `proxy-pool` namespace — sources, fetch strategy, master switch, retries, timeout — through the shared settings describe mirror. The namespace's data model, its host-side owner, and the session projection live in `bobo-proxy-tool`; this package owns only the page.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the page after the host row that registers the namespace:

```yaml
- id: ui-settings-proxy
  name: './ui-settings-proxy/lib/index.js'
```

The host `command-proxy` row must already be mounted, or the section has no `proxy-pool` namespace to read or write.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The section registers into the `settings.section` slot through `slots.inject` (declared by upstream `ui-settings`), at section order `70`, so activation order relative to the slot's owner does not matter. `src/client/proxy-pool.ts` folds one settings-mirror snapshot into the page's view state (`loading` / `unavailable` / `absent` / `read` / `section`) and builds the write operations that carry a whole edited pool into the namespace; the component renders that state and reports save failures inline.

Copy lives in the `settings.proxy` locale namespace; the view types are shared with the host through `bobo-proxy-tool`'s `ProxyPoolSettings` type so the page edits exactly the object the host serves.

</details>

<a id="model-experience"></a>
## Model Experience

### Proxy pool settings section

#### What the model sees

Nothing: the page writes settings that `crawl_fetch` and the proxy scripts read at call time; it registers no prompt section, tool, or session event itself.

#### Token effect

Zero: this package adds no tokens to any model request.

#### KV Cache effect

None: the request prefix contains no content from this package; a saved pool value changes tool behavior, not request text.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The section requires the host `command-proxy` row to serve the `proxy-pool` namespace; without it the page reports the namespace unavailable instead of a form.
- Saving goes through settings forms into the active profile's `cordis.patch.yml`, so a home patch or command-line overlay pinning those fields refuses the write — the page shows that refusal rather than a silent no-op.
- The page edits pool configuration only; whether a session actually routes through the pool stays the session-level `/proxy` switch owned by `bobo-proxy-tool`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
