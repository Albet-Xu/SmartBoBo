# Rust · core services — ponytail-audit

> Scope: src-tauri/src/service/** (excl. plugin/) · ~20k LOC · read 2026-09-30

## Findings (ranked, biggest cut first)

- `shrink:` Drop the native-probe stamp cache (stamp path/key, `NATIVE_ARTIFACT_DIRS`, `collect_probe_stamp_entries`, `push_probe_stamp_entry`, `path_modified_nanos`, `file_modified_nanos`, `read_native_probe_stamp`, `write_native_probe_stamp` and both call sites); probe unconditionally or store only node size+mtime + core version. [src-tauri/src/service/core/runtime.rs:59-61, 248-270, 982-1122] (-110 LOC)
- `native:` Replace the hand-rolled `CreateFileW`+`DeviceIoControl(FSCTL_SET_REPARSE_POINT)` junction writer with the `junction` crate (`junction::create`) or `mklink /J`; adds one dependency. Also removes its 50-line test. [src-tauri/src/service/core/runtime.rs:787-914, 1689-1739] (-128 LOC, +1 dep)
- `shrink:` Collapse the ten duplicated `if let Err(e) = patch::<mod>::apply(&app_handle) { log::warn!(...) }` blocks into one loop over the module table that already exists at `patch/mod.rs:34-44`. [src-tauri/src/service/workflow/launch.rs:386-449] (-35 LOC)
- `shrink:` Delete `patch_dsh` (a one-line wrapper over `patch_core_file` + `active_core_install_dir`) and the nine per-module `apply` wrappers; keep one `apply_at(core_dir)` per patch module and resolve the active core dir in the caller. [src-tauri/src/utils/mod.rs:23-47, src-tauri/src/service/patch/{renderer.rs:72-77, composer.rs:104-109, session.rs:39-44, llm_session.rs:76-81, pi_ai_thinking.rs:140-145, model_selection.rs:58-63, workspace.rs:45-50, workspace_view.rs:81-86, plugin_visibility.rs:154-174}] (-45 LOC)
- `shrink:` Hoist `locate_return_module_exports` (`Option<(usize, &str)>`) and its `ANCHOR_KEYWORD` const into one shared `patch::insert_before_module_exports(source, text)` helper; it is duplicated verbatim today. [src-tauri/src/service/patch/renderer.rs:27, 56-67, src-tauri/src/service/patch/composer.rs:47, 91-99] (-24 LOC)
- `shrink:` Merge `append_log`'s inline rotation with `rotate_service_log`; both run the same remove-oldest → shift `.i`→`.i+1` → rename-into-`.1` sequence. One `fn rotate_log(log_path: &Path, keep: usize)`. [src-tauri/src/service/workflow/utils.rs:259-270, 295-315] (-20 LOC)
- `shrink:` Merge `run_command` and `run_process_with_timeout`; both build the identical `Command` (args, current_dir, piped stdout/stderr, `creation_flags(0x08000000)`). [src-tauri/src/service/core/runtime.rs:1490-1573] (-25 LOC)
- `shrink:` Extract one `asset_and_digest(...) -> (String, Option<String>)` — the asset lookup, `browser_download_url`, `digest` filter and the three-arm expanded-assets fallback ladder are written twice. [src-tauri/src/service/download/github.rs:315-362, 440-479] (-30 LOC)
- `shrink:` Delete the `#[allow(unused_imports)]` re-export blocks whose own comments admit the names have no caller; keep only the names with real callers. The API types stay (IPC payloads). [src-tauri/src/service/core/mod.rs:30-32, src-tauri/src/service/update/mod.rs:33-35] (-6 LOC, -2 allow attrs)
- `shrink:` Have one `download::utils::parse_digest_from_expanded_assets` and delete the byte-identical copy (same 4096-byte window, same char-boundary clamp, same 64-hex check) plus its duplicate test. [src-tauri/src/service/update/meta.rs:111-129, 279-296 vs src-tauri/src/service/download/github.rs:182-200, 824-866] (-20 LOC)
- `shrink:` Extract `fn is_link(file_type: &std::fs::FileType) -> bool`; the windows `is_symlink() || is_symlink_dir()` / unix `is_symlink()` pair is written out four times in this file alone. [src-tauri/src/service/core/runtime.rs:462-465, 493-500, 515-518, 752-757] (-30 LOC crate-wide)
- `shrink:` Replace the `temp_dir(tag)` test fixture with one `#[cfg(test)] test_util::temp_dir(prefix, tag)`; near-identical bodies exist in at least six modules. [src-tauri/src/service/cli/path/mod.rs:213-225, cli/shim/mod.rs:156-168, cli/shim/write.rs:278-290, workflow/win_inspector.rs:142-144, core/local.rs:471-482, migrate.rs:355-361] (-50 LOC)
- `shrink:` Make `package_dir_from_bin` return the resolved layout (`Npm`/`Pnpm`) so `local_core_uses_pnpm` stops re-walking the same `prefix_candidates` + `probe_package_dir` + `read_dir(prefix/global)` ladder. [src-tauri/src/service/core/local.rs:292-315, 347-367] (-25 LOC)
- `shrink:` Extract `validate_new_profile_id(root, name)`; `clone_with_root` re-implements `create`'s entire ladder with the same five error codes (`PROFILE_EMPTY_NAME`, `PROFILE_INVALID_NAME`, `PROFILE_NAME_TOO_LONG`, `PROFILE_RESERVED`, `PROFILE_EXISTS`). [src-tauri/src/service/profile/mod.rs:362-380, 657-682] (-26 LOC)
- `shrink:` Replace the two test-only execa re-implementations (`execa_escape_meta_chars` + `execa_escape_argument`) with the single expected escaped literal in the one test that uses them. [src-tauri/src/service/cli/shim/build.rs:894-915] (-20 LOC)
- `shrink:` Use the typed `read_manifest`/`write_manifest` in `backup/retention.rs`; it re-parses `.manifest.json` into a raw `Value` and hand-writes its own tmp+rename, duplicating `backup/mod.rs`. [src-tauri/src/service/backup/retention.rs:23-29, 49-57] (-18 LOC)
- `shrink:` Add one `utils::atomic_write(path, content)`; "pid + nanos temp name then rename" is implemented three times for three different files. [src-tauri/src/service/backup/mod.rs:116-128, backup/archive.rs:278-289, profile/mod.rs:939-957] (-16 LOC)
- `shrink:` Extract `async fn first_asset_matching(pred, missing_code)`; `fetch_dsh_pkg_version` and `fetch_latest_non_preview` are the same find-tag-then-`fetch_dsh_pkg_asset` shape. [src-tauri/src/service/download/github.rs:377-384, 393-403] (-14 LOC)
- `shrink:` Extract one `atom_entries(body) -> Vec<(String, String)>`; `parse_atom_entries` and `first_non_preview_tag_from_atom` each hand-scan the same `<entry>` feed. [src-tauri/src/service/update/meta.rs:51-69, src-tauri/src/service/download/github.rs:132-155] (-25 LOC)
- `shrink:` Extract `utils::recreate_symlink(target, dst)`; the unix-`symlink` / windows-`symlink_dir().or_else(symlink_file)` twin is written twice. [src-tauri/src/service/backup/archive.rs:15-27, src-tauri/src/service/profile/mod.rs:751-767] (-14 LOC)
- `shrink:` Make the tar extractor take the decompressor (`enum Compression { Zstd, Gzip }`); `extract_archive` and `extract_archive_gzip` differ only in `zstd::Decoder` vs `GzDecoder` and already share `extract_tar_entries`. [src-tauri/src/service/backup/archive.rs:172-192] (-10 LOC)
- `shrink:` Merge `append_version_dirs`/`version_key` with the inline windows version-dir loop — both do "read_dir a version root, sort, append bin dirs". [src-tauri/src/service/core/local.rs:166-194, 222-234] (-20 LOC)
- `shrink:` Inline the one-caller predicate `all_client_modules_ready` at its only call site (and drop its test). [src-tauri/src/service/workflow/health.rs:55-57, 90] (-6 LOC)
- `shrink:` Remove the two-file-level `#[allow(unused_imports)]` blocks in `cli/shim/write.rs` by importing the shim builders inside `mod tests` instead of at file scope. [src-tauri/src/service/cli/shim/write.rs:9-16] (-6 LOC)
- `shrink:` Inline `is_foreign_file` (`!is_generated_shim`) at its three call sites. [src-tauri/src/service/cli/shim/write.rs:31-33, 122, 145, 230] (-4 LOC)
- `shrink:` Turn `macro_rules! write_if_ours!` into a 4-line fn — its returned `target` is unused at all five expansion sites. [src-tauri/src/service/cli/shim/write.rs:184-190, 200-221] (-8 LOC)
- `shrink:` Give `harness_command(...)` to the unix retry path; the full `Command` (program, args, envs, current_dir, stdio, `process_group(0)`) is built twice. [src-tauri/src/service/workflow/launch.rs:765-775, 801-808] (-18 LOC)
- `shrink:` Extract `record_active_app_tag(app_handle, tag)`; the tag+commit store write (including the byte-identical `fetch_dsh_pkg_tags` commit lookup) appears twice. [src-tauri/src/service/core/version.rs:545-558, 653-666] (-28 LOC)
- `shrink:` Inline `NativeProbeFailure::is_platform_import` into `has_platform_import_failure`. [src-tauri/src/service/core/runtime.rs:160-162, 192-196] (-6 LOC)
- `shrink:` Inline `meets_baseline` into its only caller `core_supports_bundled_plugins`. [src-tauri/src/service/core/source.rs:87-95, 101-106] (-8 LOC)
- `shrink:` Collapse `is_dsh_running`'s async-`Option` round trip to `client.get(&url).send().await.is_ok_and(|r| r.status() == StatusCode::OK)`. [src-tauri/src/service/workflow/utils.rs:143-164] (-10 LOC)
- `shrink:` Make the no-op windows facade disappear: the `#[cfg(not(windows))] mod imp` stubs (`apply -> Ok(())`, `git_bash_bin_dirs -> Vec::new()`) plus the always-compiled `pub fn` wrappers are two layers for nothing — `#[cfg(windows)]` the call sites directly. Same pattern in the other cfg-twin stubs. [src-tauri/src/service/workflow/win_inspector.rs:222-249, cli/shim/write.rs:167-170, cli/path/pnpm.rs:154-157, update/version.rs:52-55] (-20 LOC)
- `shrink:` Make `create_file_with_retry` and `download::core::remove_path_if_exists` share one transient-error retry helper (`Some(32|5)` → sleep 250 ms, N attempts). [src-tauri/src/service/download/extractor.rs:14-37, download/core.rs:364-388] (-15 LOC)
- `shrink:` Reuse the character-set whitelist from `fs_guard::validate_id` in `plugin_visibility::is_safe_bundle_name`; the same "alphanumeric / `.-_`" rule is hand-written twice. [src-tauri/src/service/patch/plugin_visibility.rs:146-151 vs src-tauri/src/service/fs_guard.rs:29-36] (-8 LOC)
- `shrink:` Stop re-running `find_user_dsh_bin` in the list builder when `local_core` already resolved the bin — it is a full PATH walk. [src-tauri/src/service/core/version.rs:124-128] (-4 LOC)
- `shrink:` Cache the canonical `updates_dir` in `resolve_installer_path`; it re-canonicalizes a constant directory on every open. [src-tauri/src/service/update/install.rs:343-359] (-6 LOC)
- `shrink:` Delete `download_file` (one-line forward to `download_file_from_sources`); its single caller sits in `service/plugin/install/pnpm.rs`. [src-tauri/src/service/download/core.rs:21-26, download/mod.rs:10] (-6 LOC)
- `shrink:` Replace the `PathBuf`-typed log helpers with `&Path` — `append_log(&PathBuf)`/`rotate_service_log(&PathBuf)` force callers to clone. [src-tauri/src/service/workflow/utils.rs:245, 295] (-4 LOC)
- `delete:` Remove `restore_real_backup_to_temp`; it hardcodes one developer's absolute `/Users/coderstory/.dsh/.backups/2026-08-31T15-04-18.tar.zst`, self-skips when absent, and asserts nothing — ~70 lines of `println!` diagnostic. [src-tauri/src/service/backup/mod.rs:421-496] (-70 LOC)

## Considered and rejected

- `service/core/runtime.rs` size (2185 lines) — owned by `docs/specs/rust.optimize.md` §3.1, which mandates splitting large files; not an over-engineering finding.
- The four-source GitHub fallback ladder (api.github.com → releases.atom → expanded_assets HTML → tag build-id) — each rung fixes a documented 403/limit failure (issues #48, #92, #299, #379).
- `resolve_update`'s branch lattice and `record_matches_latest_release` — the branches encode real regressions (rc releases reusing a git commit, build-id vs full SHA records, tag aliases).
- Hand-rolled HTML/atom scanners (`parse_release_list_from_html`, `first_non_preview_tag_from_atom`, `parse_digest_from_expanded_assets`) — the tree has no HTML parser, and adding one needs a §4.2 dependency justification.
- `decode_multibyte` / `encode_multibyte` / `short_path` / `console_code_page` — no std equivalent; `WC_NO_BEST_FIT_CHARS` and the ANSI-code-page fallback are deliberate correctness choices.
- `win_spawn::quote_arg` and the `CREATE_NEW_CONSOLE | SW_HIDE` trick — reproduces MSVC argv quoting and suppresses the black-cmd popup; no std API covers either.
- `cli/shim/templates.rs`'s three shell-language template sets — a cmd/ps1/sh shim cannot share one implementation.
- `perm.rs` remedy strings (`remedy_hint`, `shell_quote`, `owner_suffix`) — that copy-pasteable chown/takeown text is the deliverable of issue #466; ~60 LOC and worth it.
- `backup/archive.rs` tar safety ladder (reject `..`, reject hard links, `AlreadyExists` symlink skip, tmp-then-rename) — each rung is a data-loss/security guard.
- `workflow/sweep.rs` (`sweep_orphan_harness`, `port_owner_pid`, `relaunch_via_shell_escape`) — every branch is a documented "never kill an unknown process" guard; the 448 RedirectionGuard relaunch is a real Windows 11 25H2 workaround.
- `workflow/process.rs` — the PID+handle pairing, `take_owned_process_if`, and the launch/core-transition lock encode the WARN-5/WARN-6 race fixes; do not merge the two guards.
- The nine core patches (`renderer`, `composer`, `session`, `llm_session`, `pi_ai_thinking`, `model_selection`, `workspace`, `workspace_view`, `plugin_visibility`) — each is a documented upstream-drift shim with an idempotence marker and an anchor-missing fallback; none is speculative.
- `workflow/health.rs::not_owned_probe_signal` and `workflow/install.rs`'s retry/outdated logic — both encode observed startup/rc race behaviour.
- `download/installable.rs`'s `Installable` trait — four real implementors (Nodejs, Dsh, Pnpm, Git); not a single-impl abstraction.
- `workflow/heap.rs::node_options_heap_limit` — the token forms (`--flag value`, `--flag=value`, quoted) are all real Node invocations.
- `migrate.rs` — every branch (linked-dir refusal, `node_modules` special case, mtime compare, stale pnpm metadata purge) is a documented data-loss guard (issues #103, #452).
- `service/plugin/**` — another agent's scope; the `download_file` caller and `extract_archive_gzip`'s caller live there but were not audited.

## net: -855 lines, -0 deps possible.

(Line total counts the junction finding as `native:`, which adds the `junction` crate; excluding it, the non-dependency total is -727 lines.)
