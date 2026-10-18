---
description: "Experience-pool settings page: activate a license key, show plan status, and manage migration against the SmartBoBo gateway."
kind: "package-reference"
---

# bobo-settings-experience-ui

English | [中文](README.zh.md)

## Summary

BoBo's Web settings page: adds the Experience pool section (id `experience-pool`, order 68) to the Settings panel and drives the enter-key → activate → show plan status → manage migration flow against the SmartBoBo license gateway. The section is three cards — license, migration, connection diagnostics — and each one folds to its own title; a fresh visit is fully folded, and no fold is persisted, so reopening Settings always starts folded. Configuration persists through the active profile; the access token and license key stay in the write-only credentials domain.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this plugin to put the license flow into Settings; the host half declares the `experience-pool` volatile Config the page reads and writes.

### Build

```sh
pnpm install --no-frozen-lockfile --ignore-scripts   # 首装配
cd packages/bobo/ui-settings-experience
pnpm exec tsc -b tsconfig.json && pnpm exec tsdown   # 生成 lib/（运行时只读 lib/）
```

This package is not in the `tsconfig.host.json` / `tsconfig.client.json` solutions; it carries its own `tsconfig.json` and `tsdown.config.ts`.

### Mount

Add a row to the `- insert:` list of `packages/bobo/cordis.patch.yml`:

```yaml
- id: experience-pool
  name: './ui-settings-experience/lib/index.js'
```

The relative path resolves against the patch file's directory; module scanning reads the `dsh.client` declaration of that package's `package.json` and then loads its `lib/client.js` (the browser half). The entry id doubles as the settings form namespace (`experience-pool`, the same constant on the browser half); the host half declares three `.volatile()` fields — if the entry is not mounted, the page shows "settings not registered on the host". The entry's declaration row must live at the profile layer or below (a bundle layer); a `--patch` overlay only applies id-targeted patches and cannot carry `config:`, or the form write is refused by config-editor as "overridden by home patch or command-line overlay".

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Where each value lives:

| Storage | Contents | Notes |
|---|---|---|
| Profile entry `experience-pool` volatile Config (host-declared) | `baseUrl` / `deviceId` / `license` (plan cache) | Non-sensitive; written through the settings form into the active profile's `cordis.patch.yml` |
| Credentials domain (`ctx.remote.credentials.set`) | `bobo_experience_access_token` / `bobo_experience_license_key` | Write-only: the domain exposes only `configured/source/writable`, so the page never echoes them back |
| Plugin closure memory | `access_token` returned by activation | The status refresh (`/v1/license/me`) uses it within this session; after a page reload the key must be re-entered to restore online refresh |

The page itself reads or writes no client-side file (`experience-pool.json` is later host-side work).

Gateway endpoints the browser calls directly:

- `GET /v1/health` — connection diagnostics (gateway reachable / upstream Qdrant reachable), probed once automatically after the page mounts.
- `POST /v1/license/activate` — exchanges `device_id` and `client_version` for a token.
- `GET /v1/license/me` — refreshes plan status; remaining days are always computed from the response's `server_time`, never the client clock.
- `POST /v1/license/migrate/request` — sends the migration confirmation email; **whether or not the mailbox exists, the page shows the same message** (server-side anti-enumeration semantics, mirrored verbatim by the frontend).
- `POST /v1/license/migrate/complete` — submits the confirmation code to finish migration; the success body equals activate's.

All requests time out after 10 seconds; errors prefer the server's `status_description` (the Chinese copy for 429/503 is shown as-is), while network/timeout failures show localized copy.

</details>

<a id="model-experience"></a>
## Model Experience

### Experience pool settings page

#### What the model sees

Nothing: the `experience-pool` page registers no prompt section, tool, or session event, and its browser-side HTTP calls never reach a model request.

#### Token effect

Zero: this package adds no tokens to any model request.

#### KV Cache effect

None: the request prefix contains no content from this package, so it neither appends to nor replaces cached prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only the enter-key → activate → show plan status → manage migration flow is implemented; no client-side file is written.
- The access token is unreadable after a page reload (the credentials domain has no read path — a deliberate anti-echo design), so status refresh requires re-entering the key once.
- Remaining days in the plan cache are derived from `server_time` at cache time, so a long-unrefreshed cache reads conservatively low.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
