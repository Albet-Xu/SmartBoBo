> 该文档已被固定，禁止修改

# Rust 优化规范 (Rust Optimization Protocol)

> **目的**：统一 `src-tauri/` 下 Rust 代码的**结构优化（拆分）**与**性能优化（编译期 / 运行期）**的判定口径、实施顺序与验证门禁。
> **铁律**：**先量化、后优化**。无基线数据（编译耗时 / 启动耗时 / 包体积 / 单测耗时）不得发起优化；优化必须**行为契约不变**，严禁夹带功能变更。
> **路由**：命中本规范时必须叠加 `devlopment.md`（通用协议）；注释、错误前缀与平台细节叠加 `desktop.baisc.md` §5。

---

## 1. 适用范围

### 1.1 纳入范围

| 优化类型 | 触发对象 | 典型代表 |
| --- | --- | --- |
| 结构拆分 | 职责混杂的超大模块 | PR #210（service 层 6 个大文件拆分） |
| 编译期 | `Cargo.toml` profile / feature / 平台门控 / 构建缓存 | PR #535（平台门控清警告）、PR #720（target 种子拷贝） |
| 运行期 | 启动路径、阻塞调用、子进程、内存拷贝 | PR #772（启动路径去重并打点） |
| 卫生 | clippy / rustfmt / 死代码 | `48d2cd88`（lib+tests clippy 归零）、`50899e18`（rustfmt 折行） |

### 1.2 排除范围

* 前端 / 插件 TypeScript 侧优化（见 `plugin.*`、`desktop.baisc.md`）。
* 引入新依赖以换取性能（须另开依赖评估，不属于本规范）。
* 上游 vendored 代码（`src-tauri/vendor/**`）本身的优化；仅允许通过 `[patch.crates-io]`（`src-tauri/Cargo.toml:128-129`）承载必要的本地补丁。

### 1.3 术语

* **结构优化**：不改变运行语义的模块边界调整（拆分 / 内联 / 归位）。
* **契约**：对外暴露的命令名、事件名、函数签名、错误前缀、日志关键字段、文件落盘格式。
* **暖基线**：在目标平台上至少完整构建过一次的 `src-tauri/target`。

---

## 2. 红线（Red Lines）

1. **无量化不优化**：PR 正文必须给出「优化前 → 优化后」的实测数字与测量方法，禁止只写「更快 / 更清晰」。
2. **契约冻结**：拆分与优化均不得改动 §1.3 所列契约项；确需变更时拆成独立 PR 并在标题标 `!`（breaking）。
3. **一事一 PR**：结构拆分与性能优化**不得混在一个 PR**（#210 与 #720 即为正例）；拆分 PR 内的纯搬移不得夹带逻辑改写。
4. **无 `_legacy` 残留**：优化即彻底替换，禁止保留废弃存根与并行实现（`devlopment.md` §1）。
5. **平台门控不得靠 `allow(dead_code)` 兜底**：仅 Windows 使用的符号必须 `#[cfg(windows)]` 或 `#[cfg_attr(not(windows), allow(dead_code))]`，被单测引用的再加 `not(test)` 条件（PR #535）。

---

## 3. 结构优化：拆分与内聚

### 3.1 拆分触发阈值

| 行数（单文件） | 判定 | 动作 |
| --- | --- | --- |
| ≤ 800 | 正常 | — |
| 801–1200 | 预警 | 新功能落位前须先评估拆分 |
| > 1200 | 必须拆分 | 本 PR 内不得继续堆叠职责 |

当前超标存量（拆分候选，按行数降序）：`service/core/runtime.rs` (2185)、`bridge/pet.rs` (1854)、`service/profile/mod.rs` (1757)、`service/plugin/internal/mod.rs` (1439)、`desktop/builder.rs` (1362)、`service/download/github.rs` (1285)、`service/cli/shim/build.rs` (1232)、`service/plugin/preset.rs` (1219)。

除行数外，命中以下任一条即视为「职责混杂」，不受行数门槛保护：单个文件内出现 ≥ 3 个互不调用的领域概念；同一文件同时承担「协议解析 + 进程编排 + 落盘」两种以上角色；修改一处需同时理解 ≥ 4 个独立状态机。

### 3.2 拆分落位决策树

```text
新模块落点判定
├─ 属于既有领域（core / plugin / workflow / cli / download / profile …）
│   └─ ➔ service/<领域>/<子域>/
├─ 纯跨进程/前端桥接                ➔ bridge/
├─ 进程、窗口、托盘、平台壳行为      ➔ desktop/
├─ 配置结构与解析                   ➔ config/
├─ 单一命令的适配层                 ➔ task/
└─ 无状态纯函数（≥2 处消费）        ➔ utils/
```

拆分目录一律采用 `mod.rs`（门面：仅再导出与编排）+ 平级职责文件，沿用既有惯例（`service/cli/shim/{mod,templates,build,write}.rs`、`service/plugin/install/{mod,spec,env,pnpm,allowlist,diagnose,artifact,single}.rs`）。

### 3.3 实施要求

1. **保历史**：纯文件搬移必须 `git mv`，避免拆分 PR 出现「删一个加一个」的假删除。
2. **门面收口**：`mod.rs` 只做 `pub use` 与顺序编排；调用方只依赖门面，禁止跨包 `pub(crate) mod` 穿透。
3. **单消费者内联**：拆分过程中若发现某模块只有一个消费者，回退为内联到调用处（`devlopment.md` §1「零中间层」）。
4. **SSOT**：同一状态/常量只保留一处定义；拆出的子模块不得各自缓存副本。
5. **搬迁即验证**：搬移后逐条核对原文件行数总和守恒（删除行数 ≈ 新增行数），偏差必须能对应到本次真正改写的逻辑。
6. **冲突处理要写进 PR 正文**：拆分 PR 撞上 main 的新提交时，必须逐条列出「main 的新逻辑落到拆分后哪个模块」，不得静默丢弃（#210 的处理方式即模板）。

### 3.4 拆分 PR 正文模板

```text
## 拆分清单
| 原文件 | 拆分后 |
| --- | --- |
| <path> (<原行数>) | <dir>/: mod / a / b |

## 冲突处理（rebase 到最新 main）
- <上游提交> <其新逻辑> → <落到拆分后哪个文件>

## 验证
- cargo check --all-targets  → 0 warning
- cargo test --all-features --locked → N passed / 0 failed
```

---

## 4. 编译期优化

### 4.1 profile 与调试信息

`src-tauri/Cargo.toml` 的 `[profile.dev] debug = 1`（行号表而非完整调试信息）是**默认基线**：panic / 回溯仍可定位到行，target 体积、链接耗时与工作树种子拷贝量同时下降。改动该值须在 PR 内给出体积与链接耗时的前后对比；`debug = 2` 会使已有暖基线失效，必须提示各 checkout 重建一次。

### 4.2 依赖与 feature 面

* 新增依赖前先证明标准库 / 已有依赖无法完成；PR 正文给出体积影响。
* 依赖默认 `default-features = false` + 显式 feature 白名单（参考 `tray-icon` 的 `ksni` 选择，`src-tauri/Cargo.toml:118-119`）。
* Tauri 插件 crate 与 `package.json` 的 `@tauri-apps/plugin-*` 必须同 minor，否则 Tauri CLI 在构建前直接退出（`src-tauri/Cargo.toml:43-50` 已注明）。

### 4.3 平台门控

* 平台专属实现统一用 `#[cfg(target_os = ...)]` / `#[cfg(windows)]`，禁止运行期 `if cfg!` 兜底掩盖未使用代码。
* 仅某平台使用的常量与函数：`#[cfg(windows)]`（纯 Windows 专用）或 `#[cfg_attr(not(windows), allow(dead_code))]`（跨平台声明但仅 Windows 使用）。
* 被单测引用的符号加 `not(test)`：`#[cfg_attr(all(not(windows), not(test)), allow(dead_code))]`，保住 Linux/macOS 上的单测覆盖（PR #535）。
* 门控后的目标：三平台矩阵（`ubuntu-22.04` / `macos-14` / `windows-latest`）**零编译警告**。

### 4.4 构建缓存与工作树

每个新工作树的 `src-tauri/target` 为空会导致 `Cargo.lock` 全量重编，需按 PR #720 的结论执行：

* **禁止**共享同一 `target` 目录（junction / `CARGO_TARGET_DIR`）——同包名会共享 `-C metadata`，cargo 误判 `fresh` 并运行另一棵树的二进制（静默错误产物）。
* **禁止**依赖 sccache 跨工作树命中——缓存键含 target 目录路径，实测 0 命中。
* **做法**：种子拷贝 `src-tauri/target`（过滤 `incremental`、`preserveTimestamps`、失败删残片），拷贝后**必须刷新工作树本地 `.rs` 时间戳**，否则 cargo 会把工作区 crate 判成新鲜而沿用源仓库产物。

---

## 5. 运行期优化

### 5.1 启动路径

* 启动路径上的重复开销必须收敛，并为每段打点后再优化（PR #772 模式）：**先测量分段耗时，再删重复**，禁止凭直觉改启动顺序。
* 启动阶段禁止同步阻塞等待网络 / 子进程；可延后的动作（更新检查、能力表拉取、预热）一律后置或懒加载。
* 启动路径新增的每次 `ensure` / `resolve` 调用都必须证明其失效条件正确，避免「复用」变成长时间不刷新。

### 5.2 阻塞与并发

* `async` 上下文中禁止直接执行阻塞 IO / 重计算；改用 `tokio::task::spawn_blocking`，批量纯计算用 `rayon`（依赖已在 `src-tauri/Cargo.toml:78`）。
* 不得为「看起来快」而把串行不变量改成并发：涉及落盘顺序、进程生命周期、工作树互斥的逻辑必须保留串行或显式加锁。

### 5.3 子进程与 IO

* 同一目的的子进程调用必须合并：优先一次性取回完整信息再本地解析，避免逐项 `rev-parse` / 逐会话 `status`。
* 子进程输出读取不得依赖系统代码页；非 UTF-8 行不得中断管道（中文 Windows 必须按确定编码解码）。
* 高频事件流禁止「逐事件全量折叠」；改为增量下发。

### 5.4 内存与拷贝

* 热路径避免无意义 `clone()` / 全量 `serde` 往返 / 大块 `Vec` 复制；拷贝量必须能在 PR 中用体积数据说明。
* 大文件与归档处理流式进行，禁止整包读入内存。

---

## 6. 判定与优先级

| 级别 | 判据 | 处理 |
| --- | --- | --- |
| **P0** | 启动卡死、静默错误产物、崩溃、跨平台编译失败 | 立即修，可打断当前优化 |
| **P1** | 有量化收益的启动 / 编译 / 内存优化；超 1200 行模块拆分 | 排期实施 |
| **P2** | 纯可读性重构、无实测收益的「微优化」 | 随相关改动顺带，禁止单独占 PR |

**不做**：无实测数据的「优化」、仅为减少行数的机械拆文件、把 `allow(dead_code)` 当作清理手段、用并发掩盖顺序问题。

---

## 7. 验证门禁与命令

本地提交前必须全部通过（工作目录：`src-tauri/`）：

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo check --all-targets --all-features
cargo test --all-features --locked
```

* CI 现有门禁为三平台矩阵 `cargo test --all-features --locked`（`.github/workflows/ci.yml:209-245`，`ubuntu-22.04` / `macos-14` / `windows-latest`，`rust-cache` 仅 main 写入）；clippy 与 rustfmt **尚未进 CI**，属本地强制门禁。
* 触及结构拆分时，额外核对：`git diff --stat` 中删除行数与新增行数是否与拆分清单守恒。
* 触及构建配置 / 平台门控时，必须在**目标平台之外**的至少一个平台验证零警告（门控类改动三平台全覆盖）。
* 触及启动路径时，附分段打点的前后耗时表。

---

## 8. 反面模式 (Forbidden Patterns)

1. 「重构 + 行为变更」混提，导致回归无法二分定位。
2. 拆分后保留 `mod.rs` 之外的第二套再导出，形成双入口。
3. 用 `#[allow(dead_code)]` 无差别压在模块顶部遮蔽真实死代码。
4. 跨工作树共享 `target` 或依赖 sccache 跨树命中。
5. 启动路径为省一次调用而缓存状态却不定义失效条件。
6. 在 `async fn` 里直接 `std::process::Command::output()` / 同步文件遍历。
7. 以「性能」为名删除错误处理、日志或平台校验。
8. 只为凑行数阈值做机械拆文件，拆完仍无内聚边界。

---

## 9. 自检清单 (Checklist)

1. **[ ] 量化**：PR 正文是否有「优化前 → 优化后」实测数字与测量方法？
2. **[ ] 契约**：命令名 / 事件名 / 签名 / 错误前缀 / 落盘格式是否零变更？
3. **[ ] 单一意图**：本 PR 是否只做「拆」或只做「优化」？
4. **[ ] 落位**：新模块是否命中 §3.2 决策树，且与既有目录惯例一致？
5. **[ ] 历史**：搬移是否用 `git mv`，删除/新增行数是否守恒？
6. **[ ] 残留**：是否无 `_legacy` / 废弃存根 / 双入口？
7. **[ ] 门控**：平台专属符号是否 `#[cfg]` 化，三平台是否零警告？
8. **[ ] 验证**：§7 四条命令是否全绿（clippy `-D warnings` 含在内）？
9. **[ ] 收益留痕**：`[profile.dev] debug`、种子目录等配置改动是否在正文记录了代价（体积 / 拷贝量 / 基线失效）？

---

## 10. 维护约定

* 本文档只登记**规则与门禁**；单次优化的实测数据留在对应 PR 正文，不回流到本文。
* 存量超阈值的拆分候选名单（§3.1）在每次完成一个大文件拆分后更新，避免重复立项。
* 新增平台或新增 Tauri 插件时，同步核对 §4.2 的 minor 对齐约束。
