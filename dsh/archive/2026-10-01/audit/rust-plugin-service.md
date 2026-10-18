# Rust · plugin service — ponytail-audit

> Scope: src-tauri/src/service/plugin/** · 31 files · ~16.6k LOC · read 2026-09-30

Over-engineering only。正确性 / 安全 / 性能不在本报告范围。所有 `delete:` / `yagni:` 均给出全仓搜索串（`rg` 在本机不可用，改用 ripgrep 内核的内置 grep 工具与 `git grep`，搜索范围排除 `node_modules` / `dist` / `target`）。
重点结论：本模块的复杂度几乎全部来自 pnpm / Windows / 老核心版本的真实缺陷绕行（issue 编号遍布注释），**这些东西不该删**。可裁的是三类：迁移期兜底（v1 后整体退役）、同一语义的 N 份手写拷贝、只服务一个调用点的包装层。

## Findings (ranked, biggest cut first)

`delete:` `install/allowlist.rs:171-173` 的自述 `TODO(v1)` 遗留自愈：v1 起只需解析干净配置，`apply_allow_build_keys` 解析失败后的「同键去重再解析」兜底（`install/allowlist.rs:223-233`）与 `collapse_allow_builds_duplicates` 全体（`install/allowlist.rs:313-369`，含 doc ~57 行）、配套测试 `collapse_dedupes_allow_builds_keys`（`install/allowlist.rs:661-681`）与 `apply_overwrites_placeholder_value_without_duplicate` 里的损坏输入用例（`install/allowlist.rs:640-659`）一并删除。替换：无（只在 v1 版本边界后、确认无旧版字符串拼接残留文件时执行；旧 YAML 仍可读）。 [src-tauri/src/service/plugin/install/allowlist.rs:171-173] (-88 LOC)

`shrink:` `process.rs` 与 `verify.rs` 各有一份「隐藏控制台 spawn 子进程 → 抽干 stdout/stderr 线程 → 等退出 → 取回累积输出」的完整实现：`run_plugin_process`（`process.rs:256-344`）+ `drain_captured`（`process.rs:347-352`）+ `spawn_line_emitter`（`process.rs:357-400`） vs `spawn_and_wait`（`verify.rs:217-299`）+ `drain_pipe`（`verify.rs:303-313`）+ `drain_captured`（`verify.rs:316-321`，与 process.rs 版本逐字相同）。替换：一个 `spawn_and_drain(program, args, cwd, envs, sink: impl FnMut(&str))`，`preinstall-log` 事件与 payload 保持逐字不变。 [src-tauri/src/service/plugin/process.rs:256-400] (-70 LOC)

`delete:` `internal/mod.rs` 的 30 秒指纹复用缓存整套：`ENSURE_REUSE_WINDOW`（`internal/mod.rs:77`）、`EnsureReceipt`（`internal/mod.rs:89-93`）、`EnsureCoordinator.receipt` 字段与 `reuse`/`record`（`internal/mod.rs:117-138`）、`ensure_fingerprint`（`internal/mod.rs:284-316`，为算指纹要读 profile `package.json` + `cordis.yml` + 两层 patch 再哈希）。它只服务「同一次启动里第二路 `ensure` 少跑一遍」。替换：无，第二路照常完整重跑（本函数按设计幂等，重复执行是 no-op）。 [src-tauri/src/service/plugin/internal/mod.rs:89-138,284-316] (-70 LOC)

`shrink:` `dsh.profile.bundles` upsert 有两份手写实现，语义完全一致（缺段则建 → 写 `dependencies[id]` → 去重追加 bundle）：`write_back_manifest_refs_at`（`snapshot.rs:517-583`，66 行）与 `upsert_manifest`（`internal/materialize.rs:109-160`，52 行）。替换：`internal/manifest.rs` 里一个共享 `upsert_manifest(refs: &[(&str, &str)])`，两处调用。 [src-tauri/src/service/plugin/snapshot.rs:517-583] (-50 LOC)

`shrink:` 「同目录临时文件 → 写入 → 替换」在本模块树里写了三遍：`internal/manifest.rs:117-166`（temp + `sync_all` + 平台替换）、`write_patch_layer_atomically`（`patch_entries.rs:410-424`）、`write_archive_atomic`（`snapshot.rs:245-264`，其 `write_fn: impl FnOnce(&Path)` 闭包参数生产调用点只有 `snapshot.rs:378` 一处，其余是测试）。替换：一个 `atomic_write(dest: &Path, bytes: &[u8]) -> Result<(), String>`，三处调用，闭包参数去掉。 [src-tauri/src/service/plugin/patch_entries.rs:410-424] (-45 LOC)

`native:` `internal/manifest.rs:141-166` 用 FFI 手写 Windows 原子替换 `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)`，并为此写了 `#[cfg]` 双实现 + `unsafe` 块。`std::fs::rename` 在 Windows 上本就是 `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`，多出来的只有 `WRITE_THROUGH`（持久化），而持久化在同文件 `write_profile_manifest`（`internal/manifest.rs:117-139`）里已经用 `sync_all()` 做过。替换：`std::fs::rename` + 保留 `sync_all`（Windows/Unix 同一份代码，删掉 `#[cfg]` 分支与 `unsafe`）。 [src-tauri/src/service/plugin/internal/manifest.rs:141-166] (-26 LOC)

`yagni:` pnpm 版本探测的三个一次性包装：`probe_task_or_fallback`（`pnpm.rs:507-515`）、`probe_output_or_fallback`（`pnpm.rs:517-528`）、`probe_timeout_or_fallback`（`pnpm.rs:536-539`）。三者各自只做「调 6 行的 `log_probe_fallback`（`pnpm.rs:500-505`）+ 返回 `None`/`Ok(None)`」，各 1 个生产调用点（`pnpm.rs:184`、`pnpm.rs:192`、`pnpm.rs:244`）与 1 个测试直呼（`pnpm.rs:812`、`pnpm.rs:827`、`pnpm.rs:837`）。替换：调用点直接 `log_probe_fallback(pnpm, "<phase>", err)` + `None`，删三个函数与三个测试。 [src-tauri/src/service/plugin/install/pnpm.rs:507-539] (-15 LOC)

`shrink:` 插件 `package.json` 读取有两套同名函数、字段集不相交：`watch.rs:127-130` 的 `read_plugin_meta(dir) -> Option<PluginPackageJson>`（name/version/description/homepage/repository）与 `recovery/ownership.rs:22-39` 的 `read_plugin_meta(dir) -> Option<PluginMeta>`（dependencies/optionalDependencies/dsh.bundle.patch）。替换：合成一个 serde 结构 + 一个读取函数。 [src-tauri/src/service/plugin/recovery/ownership.rs:22-39] (-20 LOC)

`shrink:` 手写时间戳四份：`now_timestamp`（`snapshot.rs:138-152`，`YYYY-MM-DDTHH-MM-SS`）、`now_stamp`（`patch_guard.rs:149-163`，`yyyymmddhhmmss`）、`now_seconds_string`（`disable.rs:241-246`）、`errors.rs:60-63` 的 `d.as_secs().to_string()`——前两者都是 `time::OffsetDateTime` + `format!("{:04}{:02}…")` 手工补零，`time` crate 已在依赖里且自带 `format_description!`。替换：`now.format(format_description!("[year]-[month]-[day]T[hour]-[minute]-[second]"))` 与一个 `unix_secs()`。 [src-tauri/src/service/plugin/snapshot.rs:138-152] (-25 LOC)

`shrink:` `transient_fs_retry_delay`（`install/mod.rs:106-113`）与 `policy_verification_retry_delay`（`install/mod.rs:124-131`）是逐字相同的上限指数退避，只有 base/cap 常量不同（1s→64 / 5s→30）。替换：`fn capped_backoff(retry: usize, base_secs: u64, cap_secs: u64) -> Duration` + 两个一行包装。 [src-tauri/src/service/plugin/install/mod.rs:106-131] (-8 LOC)

`shrink:` `is_core_package` 两份逐字相同：`disable.rs:228-230`（`id.starts_with("@deepseek-ai/")`，注释 L227 自承「与 recovery 模块的保护名单一致」）与 `recovery/mod.rs:49-51`。替换：`recovery/mod.rs` 出一份 `pub(crate)`，`disable.rs` 引用。 [src-tauri/src/service/plugin/disable.rs:228-230] (-6 LOC)

`shrink:` cordis 补丁条目匹配谓词两份：`patch_entry_targets`（`recovery/uninstall.rs:153-161`，`map.iter().any(|(k,v)| k==id || v==id)`）与 `disable.rs:165-169` 的内联闭包（`disable.rs:57-59` 注释自承「匹配口径与 `recovery::uninstall::patch_entry_targets` 一致」）。替换：共享一个 `patch_entry_targets(entry, names: &[String]) -> bool`。 [src-tauri/src/service/plugin/disable.rs:165-169] (-10 LOC)

`shrink:` bundles 移除两份：`remove_from_bundles`（`disable.rs:195-207`）与 `remove_plugin_from_manifest` 内部的 retain（`recovery/uninstall.rs:23-34`）。替换：共享 `remove_bundle(manifest: &mut Value, id: &str) -> bool`。 [src-tauri/src/service/plugin/disable.rs:195-207] (-8 LOC)

`shrink:` 悬空 insert 项判定在 `patch_entries.rs` 写了两遍：`scan_layer` 的 `patch_entries.rs:224` 与 `strip_entries` 的 `patch_entries.rs:277-284` 都是 `is_bare_package_name(name) && !package_resolvable(profile_dir, install_anchor, name)`。替换：`fn dangling_package(profile_dir, anchor, item: &Value) -> Option<&str>`，两处复用。 [src-tauri/src/service/plugin/patch_entries.rs:224,277-284] (-8 LOC)

`shrink:` 同一段 `STATE.get_or_init(|| Mutex::new(WatchState { last_fp: None, last_emit: None, pending_fp: None }))` 在 `watch.rs:259-268`（`force_emit`）与 `watch.rs:321-330`（`check_and_emit`）各写一遍。替换：`WatchState` 派 `Default` + `fn state() -> MutexGuard<'static, WatchState>`。 [src-tauri/src/service/plugin/watch.rs:259-268] (-10 LOC)

`shrink:` git URL 归一逻辑两份：`normalize_repo_url`（`watch.rs:112-124`）与 debug-only 的 `normalize_dev_repo_url`（`preset.rs:133-145`），同为「剥 `git+` / `git://`→`https://` / 去掉尾部 `.git`」。替换：一个 `pub(crate) fn normalize_repo_url`（去掉 `#[cfg(debug_assertions)]` 门）。 [src-tauri/src/service/plugin/watch.rs:112-124] (-8 LOC)

`shrink:` `run_ensure_operation` 的 `tokio::select!` 超时臂与取消臂几乎逐字重复（各含 `terminate_owned_install(owner).await` + `timeout(ENSURE_CLEANUP_TIMEOUT, …)` + `mark_cleanup_failed`），只有 emit 的 detail 与 reason 串不同。替换：一个 `finish_with(detail, reason)` 闭包/内层 async fn。 [src-tauri/src/service/plugin/internal/mod.rs:575-597] (-10 LOC)

`stdlib:` `hex_value`（`update.rs:396-403`）手写十六进制 nibble 表（`b'0'..=b'9'` / `b'a'..=b'f'` / `b'A'..=b'F'`）。替换：`char::from(value).to_digit(16).map(|d| d as u8)`，函数体一行。 [src-tauri/src/service/plugin/update.rs:396-403] (-8 LOC)

`yagni:` `DisabledEntry.reason`（`disable.rs:25-26`）恒为 `"user"`（仅 `disable.rs:298`、`disable.rs:321` 两处写入），全仓无读者。搜索串 `disabledAt|disabled_at|DisabledEntry|disabled-plugins` 命中仅为：`disable.rs` 自身定义/写入/测试断言、`watch.rs:634` 测试 fixture 字符串、`watch.rs:297`（`disabled-plugins.json` 进指纹拼接）、`src/types/plugin.ts:24` 注释。替换：无（旧 JSON 里多出的键被 serde 忽略）。 [src-tauri/src/service/plugin/disable.rs:25-26] (-4 LOC)

`delete:` `SnapshotManifest.patches: Vec<String>`（`snapshot.rs:93-94`）注释自承「v1 为空」，只在 `snapshot.rs:371` 写 `Vec::new()`（测试 `snapshot.rs:751`、`snapshot.rs:795`），全仓无读者。替换：无（serde 忽略未知键，旧归档仍可反序列化）。 [src-tauri/src/service/plugin/snapshot.rs:93-94] (-2 LOC)

`yagni:` `remove_legacy_candidates(candidates, remove: impl FnMut(&Path) -> io::Result<()>)`（`preset.rs:399-419`）的闭包参数只有一个生产调用点直接传 `fs::remove_dir_all`（`preset.rs:395`），另一个调用点是测试为注入失败而传闭包（`preset.rs:873`）。降级说明：该参数是为测错误聚合而留的注入口，删掉需把测试改成构造真实不可删目录。替换：去掉参数、内部直接 `remove_dir_all`。 [src-tauri/src/service/plugin/preset.rs:395-419] (-6 LOC)

`shrink:` `RE_CANNOT_RESOLVE_BUNDLE`（`recovery/extract.rs:40-42`）的正则字面量与同文件 `PLUGIN_REF_PATTERNS` 第 2 条（`recovery/extract.rs:15`）完全相同，同一模式被编译两份。替换：命名一个 `static` 供两处引用（或让 `classify_reason` 复用 `PLUGIN_REF_PATTERNS[1]` 的具名别名）。 [src-tauri/src/service/plugin/recovery/extract.rs:40-42] (-3 LOC)

`shrink:` `monitor_probe_wait_task` 的错误分支（`pnpm.rs:423-428`）与 `monitor_orphaned_probe_pid` 的尾部（`pnpm.rs:444-449`）是同一段 6 行「`wait_for_probe_cleanup_with(|| !plugin_process_has_exited(pid), PNPM_PROBE_LIVENESS_INTERVAL).await` → `release_process_cleanup(owner, pid_guard, process_guard)`」。替换：`async fn await_exit_then_release(owner, pid, pid_guard, process_guard)`。 [src-tauri/src/service/plugin/install/pnpm.rs:423-449] (-8 LOC)

## Considered and rejected

- `compat.rs:98-122 normalize_range` 手写 npm 空格分隔比较符归一 —— `semver::VersionReq` 不接受 `>=1.0 <2.0` 这种 npm 写法，不是 stdlib 重复；三种形态都有测试钉住，删了会失去清单里按 npm 习惯书写的区间支持。
- `compat.rs:80-96 matches_including_prerelease` 绕过 semver 的预发布门槛 —— 这是刻意的口径（清单里 `^0.1.7-rc.1` 要能匹配 `0.1.7-rc.3`），有测试覆盖。
- `process.rs:42-43` 的 `NEXT_PROCESS_OWNER` + `ACTIVE_PLUGIN_PIDS: HashMap<ProcessOwner, u32>` 看似「单进程就够了」的过剩灵活性（`acquire_process_lock` 已经全局串行化进程启动，任一时刻最多一个活进程）。但 `process.rs:407-461` 的测试专门钉多 owner 并存、stale guard 与「别的 owner 的 cleanup failure 不得清掉我的状态」，属刻意设计，不裁。
- `recovery/mod.rs:54-95 is_package_name`（42 行 npm 包名校验）—— 这是从启动日志里取出的字符串进入文件系统操作前的路径穿越防线，没有 stdlib 等价物，不能删。
- `watch.rs:282-303 fingerprint` 用秒级轮询而不是引入 `notify` —— 模块头注 `watch.rs:5-8` 明确记录为刻意取舍（插件只有个位数、每次只读小 JSON），且 `DEBOUNCE` 2s 有防抖理由。属性能议题，本就不在范围。
- `recovery/ownership.rs:240-306` 的 pass 1（`bundle_owns_package`）→ pass 1b（`plugin_references_packages`）两轮近乎重复的归属循环 —— 语义不同：pass 1 命中多个候选时 pass 1b 仍可能返回唯一归属，合并会改变判定结果。
- `patch_guard.rs:94-106 backup_path(path, suffix, stamp)` 的 `suffix` 参数 —— 有 2 个真实调用点（`patch_guard.rs:118` 的 `broken`、`patch_entries.rs:158` 的 `bak`），不是单实现参数化。
- `install/spec.rs:147-229` 的 `normalize_git_spec` / `shell_quote_spec` / `joins_pnpm_args_in_shell` —— 三个按核心版本分档的 spec 变换。看着像「没人设的 flag」，但每个都绑着真实缺陷回归（issue #104 / #3948 / #647 / #369），且 `SHELL_JOINED_PNPM_CLI_BELOW` 是开区间上界，随着老核心退出使用会自然退役；现阶段删任一条都会让一部分用户必失败。
- `errors.rs:19-28 PluginError.at: String` 用字符串存 unix 秒（可缩成 `u64`）—— 但 `PluginError` 是经 `DshPlugin.error` 下发前端的 IPC payload，改类型就是改线格式，需与 `src/types/plugin.ts` 同步。不作为 finding。
- `install/env.rs` 全文件（`build_plugin_envs` 的各段环境注入、`git_https_isolation_env`、`rewrite_rule_targets_ssh_github`）—— 分支密集但没有一处冗余：每段都带 issue 编号与回归测试，删任一段都会让某类桌面环境安装必失败。
- `snapshot.rs:179-203 count_tree` 与 `snapshot.rs:293-316 count_archive_package` —— 一个走文件系统、一个走 tar 条目，无法合并。
- `preset.rs:289-347` 旧布局回退探测（`LEGACY_BUNDLED_PLUGINS_DIR`，`preset.rs:293`）与 `remove_legacy_bundled_plugins`（`preset.rs:377-430`）并存 —— 前者服务「就地升级的旧安装仍能自愈」，后者清残留，要按版本边界与 allowlist 的 v1 清理一起退役，不宜单删。
- `internal/mod.rs:950-1042` 一串 pnpm 输出字符串嗅探（`looks_like_link_readback_failure`、`failed_open_path`、`normalize_link_path`、`path_lives_under`）—— 服务一个具体的 pnpm 回读缺陷兜底，属健壮性而非过度设计。
- `internal/mod.rs:1044-1133 remove_legacy_profile_module_fallback*` —— 迁移清理，但有 `internal/mod.rs:1400` 的 issue #466 活体回归测试且两个调用点都在关键路径上；与 allowlist 的 v1 清理同批退役。
- `recovery/extract.rs:71-88` 每次调用重编译 `Regex`（同文件 `PLUGIN_REF_PATTERNS` 已用 `LazyLock` 编译一次）—— 不一致，但这是性能问题，明确 OUT OF SCOPE。

## risk/notes

- 迁移期兜底（findings #1、以及 rejected 里 `preset.rs` 旧布局回退 / `internal/mod.rs` legacy fallback 清理）应在同一个 v1 版本边界整批删除，不要零散摘除：它们共享「升级期间的旧文件形态」这一前提。
- `internal/manifest.rs:141-166` 换 `std::fs::rename` 时必须保留 `sync_all` 早于 rename 的顺序，否则崩溃窗口会留下零长度的 `package.json`。
- `process.rs` / `verify.rs` 合并会碰到 `preinstall-log` 事件发射点：事件名与 `PreinstallLogPayload` 载荷必须逐字不变（前端字符串通道）。
- `DisabledEntry.reason` 与 `SnapshotManifest.patches` 的删除不需要数据迁移：serde 默认忽略未知键，旧 JSON / 旧归档照常反序列化。

## net: -508 lines, -0 deps possible.

## 执行复核（2026-10-01）

- **已实施**：共享 `drain_captured`、上限指数退避、core 包保护谓词、补丁条目匹配、manifest bundle 移除、悬空 insert 判定、watch 默认状态、git URL 归一、重复 bundle 正则与 pnpm 退出后释放 guard 的步骤；hex nibble 改用标准库。均复用现有模块，不新增依赖。
- **进程边界保留**：process 的 ANSI 行解码、EOF 补换行、事件先于捕获和读错日志，与 verify 的整管 UTF-8-lossy 捕获/读错丢弃不同；owner、取消、等待和 Windows 修复宽限也不同。仅共享逐字相同的取回缓冲区操作，不合并 spawn/drain/wait。
- **配置边界保留**：snapshot upsert 保留已有重复 bundle，materialize 会去重并处理无效节点，不能直接合并；snapshot 原子写支持归档流式生成，manifest/patch 的持久化、临时文件、替换失败与清理策略不同，不改为字节数组层。Windows WRITE_THROUGH 不等同文件 sync_all，保留原替换实现。
- **迁移与性能保留**：未到 v1 版本边界，allowlist 损坏旧 YAML 修复、legacy 布局回退及删除失败注入保留。ensure receipt 的配置指纹及 30 秒窗口保留，避免重复执行非纯 no-op 的安装/验证/文件副作用。
- **协议保留**：DisabledEntry.reason 和 SnapshotManifest.patches 是序列化输出字段，不以本仓无读者为理由删除。pnpm 探测错误分类包装仍钉住日志/返回协议；ensure 取消与超时路径的原清理顺序不改。
- **其他不实施**：watch 的强类型元信息拒绝无效字段，ownership 的 Value 解析容忍无关字段，不能并成一个 schema；时间戳格式及 fallback 不同，time 依赖未启用 macros，不为小幅精简增加 feature 或新中间层。
- **兼容细节**：disable 剥离仍只接受 mapping，recovery 的 scalar 支持不扩大到 disable；bundle 移除必须先执行，不能被 dependencies 已修改的短路跳过；debug gating、空 repository 优先级、正则分类顺序、移位退避边界、锁中毒时返回空缓冲区及子进程退出前 guard 生命周期保留。
- **验证**：新增真实隔离目录、子进程及纯函数边界回归；`cargo test --all-features --locked` 全量 772 项通过，plugin 回归五轮独立乱序（4101/4202/4303/4404/4505）各 319 项通过。将退出等待谓词变为立即完成的变异被 live-probe guard 用例捕获（提前释放断言失败），恢复后全量和五轮均通过。全仓 cargo fmt 检出既有范围外格式差异，不格式化无关文件；修改文件 rustfmt 检查通过。未执行本地插件构建或修改用户数据。
