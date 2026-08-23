# Agent Note: Web-managed skill library and MCP server install

Status: implemented

## Problem

The web settings surfaces `ui-settings-skills` and `ui-settings-mcp` shipped with stores that faked their back ends: `load()` issued bare `fetch('/api/skills')` / `fetch('/api/mcp-tools')` (routes that do not exist) and fell back to hard-coded defaults, while every mutation was an in-memory state edit behind a `// TODO: Implement actual API call`. There was no host path to install a skill folder or an MCP server, no persistence for the manager lists, and no grouping.

## Decision

Add two real, settings-persisted manager domains to the api-proxy gateway plus two new settings namespaces, and wire the existing store classes to them without converting them to factories.

- `skillLibrary.*` — host-backed management of the user skill library. `installLocal` opens no dialog itself; the client first calls `host.pickDirectory` and then passes the picked absolute path. The host validates the folder has `SKILL.md`, reads `name`/`description` scalars from its YAML frontmatter (kebab `name` required), copies the folder to `~/.dsh/skills/<name>/`, upserts a `skill-library` settings row, and lets the skill-filesystem watcher rediscover it. `toggle`, `uninstall`, `createGroup`, `renameGroup`, `deleteGroup`, and `moveToGroup` read-modify-write the same `skill-library` namespace. `uninstall` also deletes the bundled folder, but only when its resolved path is inside the user skills root; a failure to delete is non-fatal.
- `mcp.*` — `install` writes one `mcp-client` plugin-instance row into the home cordis overlay `$DSH_HOME/cordis.patch.yml` (the machine-local patch layer every profile loads, and which the web profile's config-only watcher live-reloads) and records the server in the `mcp-tools` namespace. `toggle`/`uninstall` mutate only that namespace; the written cordis row is intentionally not rewritten, so a server already in the overlay mounts at next startup regardless of the manager's enabled flag.
- The two namespaces are registered by each surface plugin's node half (`ctx.inject(['settings'])`), matching the `ui-theme`/`ui-settings-general` precedent: `skill-library` and `mcp-tools`, both `[a-z][a-z0-9-]*` kebab, persist to `$DSH_HOME/settings.yaml`.
- New error codes (`settings-unavailable`, `skill-install-failed`, `skill-not-found`, `skill-group-not-found`, `mcp-install-failed`, `mcp-config-rejected`, `mcp-tool-not-found`) were added to both the `RpcErrorCode` union and the wire schema's error discriminated union, so a client parse stays valid.
- The browsers read the manager lists via `settings.describe` (they are the authoritative UI source); all mutations go through `skillLibrary.*` / `mcp.*` RPCs as the spec demanded. The stores stay classes, only `_api` became a used `api` and the constructor param's `Pick` widened.

## Alternatives considered

**Reuse the read-only `skills` domain** — rejected. That domain's contract is a session-addressed catalog lookup; management is a distinct, session-free concern, so it lives in new `skillLibrary`/`mcp` domains.

**Persist toggles/groups via client-side `settings.update` only** — rejected. The spec asked store mutations to call real RPCs; server-side read-modify-write keeps the namespace consistent and lets `uninstall` also delete the folder.

**Rewrite `$DSH_HOME/cordis.patch.yml` on every change to dedupe/reconfigure** — rejected. Re-stringifying would drop the user's own comments/rows; the chosen append is deduped by scanning for the `- id: mcp-<name>` marker, so re-installing an existing server is a no-op write to the overlay while still updating the manager listing. Reconfiguring an already-installed server leaves its earlier cordis row in place (a documented follow-up).

## Consequences

Installing a local skill and an MCP server from the web surfaces now takes effect end to end: skill copies are discovered by the watcher, MCP rows mount on the next startup (and live-reload where the profile watches the home patch), and both lists persist in settings. Grouping is UI-managed and maps to the namespace `groups`. MCP `enabled` and uninstall remain manager-list facts; removing a mounted server's cordis row is deliberately out of scope.

## Verification

Per-package `tsc --project <pkg>/tsconfig.json --noEmit` is clean for `packages/host/apiproxy`, `packages/api/remotes` (client + host), `packages/client/connection`, `packages/client/ui-settings-skills`, and `packages/client/ui-settings-mcp`. `pnpm run test:gui` was run; it is red on 13 tests across 4 pre-existing, unrelated suites (`ui-primitives` FishLogo icon geometry, `ui-settings-models` apply/invalidations, `ui-sidebar` rail SVG snapshots, `ui-conversation` hero) — none of them touch the skill/MCP surface described here, and that surface ships no dedicated GUI spec. Runtime end-to-end behavior (picker → copy → discovery, cordis row write → next-startup mount) requires a live `dsh web` host and is not covered by these static checks.