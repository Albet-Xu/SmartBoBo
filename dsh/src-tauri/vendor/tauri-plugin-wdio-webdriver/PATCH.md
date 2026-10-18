# Vendored patch: cross-origin frame execution (Windows)

`tauri-plugin-wdio-webdriver` **1.4.0**, copied verbatim from crates.io and wired in via
`[patch.crates-io]` in `src-tauri/Cargo.toml`. Exactly one behaviour is changed, and only
under `#[cfg(target_os = "windows")]`. Everything else is upstream and should be kept that
way, so dropping this directory is a one-line revert when upstream ships the feature.

## Why

Upstream represents a frame context by evaluating the script inside `frame.contentWindow`
(`wrap_script_for_frame_context()` in `src/platform/executor.rs`). That only works
same-origin. Our shell is `tauri://localhost` and the embedded harness is served from
`http://127.0.0.1:<port>`, so `contentDocument` is `null` and the injected `ctx.eval(...)`
never runs:

```
WebDriverError: Script execution timed out when running execute/sync
```

`switchFrame()` itself resolves (validation only checks the tag name), so the failure
surfaces one call later — on the first `execute` inside the frame.

## What changed

- `src/platform/windows.rs`
  - `FrameRegistry` — captures `ICoreWebView2Frame` handles from `FrameCreated`
    (`ICoreWebView2_4::add_FrameCreated`), keyed by window label, in the same order as
    `document.querySelectorAll('iframe, frame')` so indices line up with upstream's wrapper.
    Holds one COM reference per frame behind `SendableComPtr`.
  - `register_frame_handler()` — registered from the existing `register_webview_handlers()`
    hook (`on_webview_ready`).
  - `WindowsExecutor::evaluate_js()` now dispatches:
    - empty frame context → top-level, unchanged;
    - depth-1 frame with a captured handle → `ICoreWebView2Frame2::ExecuteScript`, which the
      engine routes to the frame irrespective of origin;
    - anything else (nested frame, or handle not yet captured) → the upstream JS wrapper,
      unchanged.
  - `evaluate_js_inner()` split into `evaluate_js_top_level()` (the original body minus the
    wrapper) and `evaluate_js_in_frame()`.
- `src/platform/mod.rs` — re-export `FrameRegistry`.
- `src/lib.rs` — `app.manage(FrameRegistry::default())`.

There is no behaviour change when `frame_context` is empty, which is every non-frame test.

## Removal

Delete this directory and the `[patch.crates-io]` block plus its comment in
`src-tauri/Cargo.toml`. `Cargo.lock` regains the `source` + `checksum` lines for the
registry copy.

Upstream issue: <https://github.com/webdriverio/desktop-mobile/issues/665>
(offers the fix upstream; drop this directory once it ships).
