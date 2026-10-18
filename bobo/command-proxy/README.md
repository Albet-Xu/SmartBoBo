---
description: "Session proxy control: the /proxy command, the proxy-pool settings entry, and the proxyMode projection that collection tools read."
kind: "package-reference"
---

# bobo-proxy-tool

English | [中文](README.zh.md)

## Summary

Adds session-level proxy control: the `/proxy` on/off command, the `proxy-pool` settings entry holding the pool configuration, and the `proxyMode` session projection that collection tools read. The host layer mounts a settings-only instance for every mode; crawling modes mount the command too. Turning the pool on with no usable source is refused instead of failing later.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The host layer mounts one instance that provides the settings form and the session projection for all modes; preset declarations mount a command-only instance where `/proxy` should exist.

```yaml
- id: command-proxy
  name: './command-proxy/lib/index.js'
  config:
    command: false
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `sources` | `[]` | Proxy sources, each with `name`, `apiUrl` (IP-fetch endpoint), `enabled` |
| `fetchStrategy` | `cache` | IP-fetch strategy: `cache` batch-fetch then rotate / `realtime` fetch per request |
| `enabled` | `false` | Pool master switch (separate from the session `/proxy` switch) |
| `maxRetries` | `3` | Maximum retries before one request gives up |
| `timeoutMs` | `30000` | Per-request timeout (milliseconds) |
| `namespace` | `true` | Whether this instance owns the `proxy-pool` settings display policy (host `true`, preset instances `false`) |
| `projection` | `true` | Whether this instance registers the `proxyMode` session projection |
| `command` | `true` | Whether this instance registers the `/proxy` command |

Full behavior notes live in [DETAILS.md](DETAILS.md).

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`/proxy [on|off] [rest]` flips the session switch idempotently, then forwards any trailing content to the model as an ordinary user message. State is the last `proxy/enabled` event in the Session log, so a new session starts off and any past state replays from the log. The pool-empty guard refuses `/proxy on` when no enabled source has a non-empty `apiUrl`.

The `proxy-pool` entry's fields are `.volatile()` Config edited through settings forms and persisted into the active profile's `cordis.patch.yml`; preset instances and the collection tools read the same current value through the settings describe projection rather than their own Config defaults. `proxyMode` folds the session's last `proxy/enabled` event for `crawl_fetch` and the reverse-engineering scripts, which fetch IPs through `scripts/proxy_pool.py`.

The command mounts in `crawl`, `reverse`, `workflow`, `empirical`, and `report`; `modeling`, `review`, `experiment`, and the upstream four modes do not mount it because they have no collection need. The settings display policy and the `proxyMode` projection are host singletons: a preset instance must disable `namespace` and `projection` or activation fails.

</details>

<a id="model-experience"></a>
## Model Experience

### Session proxy toggle and pool settings

#### What the model sees

Nothing new: this package registers no tool; `crawl_fetch` and the reverse-engineering scripts read the `proxyMode` projection and decide per call whether to use the pool.

#### Token effect

Zero: no prompt section or tool definition enters a request from this package.

#### KV Cache effect

None: the request prefix contains nothing from this package; toggling `/proxy` writes a `proxy/enabled` Session event, not request content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Pool-empty refusal: with no enabled source whose `apiUrl` is non-empty, `/proxy on` is rejected with a message and the session stays off, so a doomed collection never starts through the pool.
- Per-session state: the switch affects only the current session; a new session starts with the proxy off even when the pool master switch is on.
- Mount scope: modes that do not mount this package have no `/proxy` command at all; the settings form and projection are host singletons and are never re-registered per preset.
- Script-side give-up: after every proxy retry fails, the collection script prints a notice and exits with code 3 for the AI to ask the user whether to fall back to the local network.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
