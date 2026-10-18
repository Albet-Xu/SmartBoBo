# 测试评审协议

> **本文件是「测试写得对不对、可不可信」的唯一权威来源**。
> **分工说明**：[plugin.test.md](./plugin.test.md) (插件运行)、[desktop.test.md](./desktop.test.md) (桌面运行)、**本文件** (测试质量与契约验证)。

---

## 1. 适用范围

* **适用**：评审新增/修改/AI生成的测试、PR 门禁审查、排查 Flaky 测试、定位假绿覆盖缺口、开发自检。
* **不适用**：评审业务代码本身（参见 `.spec.md`）；替代测试运行协议。

### 核心铁律

1. **未实跑算事故**：禁止纯静态看代码断言通过。运行命令必须带 `run` 并设超时。
2. **严禁迁就变绿**：测试与实现不符时，默认判定实现或测试有误，不得无故放松断言。
3. **精确定位输出**：结论统一格式：`文件:行` + 原文片段 + 判定 + 依据。
4. **人机分工明确**：机械规约交由扫描命令 (`rg`)，语义契约必须人工回读判断。
5. **本仓规范优先**：仓内约定与官方推荐冲突时，按本仓现状执行，差异列为「可选演进」。

---

## 2. 评审流程


```
[Step 0: 定范围] ➔ [Step 1: 建上下文] ➔ [Step 2: 机械扫描] ➔ [Step 3: 逐条过语义]
│
[Step 7: 最小化修复] ◀─ [Step 6: 出报告] ◀─ [Step 5: 缺陷定级] ◀─ [Step 4: 运行时实证]
```

* **Step 0 定范围**：锁定 PR 改动/点名文件/新增 `**/*.{test,spec,e2e}.ts`。
* **Step 1 建上下文**：阅读被测源码完整签名、同目录兄弟用例、`vitest*.config.ts` (确认 globals/include/setup)。
* **Step 2 机械扫描**：执行 §6 扫描命令，**必须回读原文**确认（排除误报/漏报）。
* **Step 3 逐条过语义**：重点对照 **D1 (真实契约)**、**D2 (是否执行)**、**D3 (假绿静默)**、**D5 (隔离确定性)**、**D7 (变异验证)**。
* **Step 4 运行时实证**：
  * 执行全量/单文件复测：`vitest run --project unit [file]`
  * 交叉验证：单跑绿但全量红 = 共享状态污染；变异测试 = **故意破坏实现**验证用例变红。
* **Step 5 缺陷定级**：按 Blocker / Major / Minor / Nit 归类。给出 Blocker 时必须附带**修复方案与复跑命令**。
* **Step 6 出报告**：按 §7 模板与四态（APPROVED / APPROVED_WITH_NOTES / CHANGES_REQUIRED / BLOCKED）输出。
* **Step 7 最小化修复**：仅在明确要求修代码时动手；禁止改动无关逻辑或降低断言标准。

---

## 3. 评审维度 (D1–D8)

### D1 断言是否验到真实契约 (基线: Blocker)
* **判据**：断言能否拦截错误返回值？期望值是否有**独立来源**（字面量/独立夹具），**严禁由被测实现现算**。
* **反例**：`expect(res).toBeDefined()` (弱断言)；`expect(f(x)).toBe(f(x))` (自比/借用实现当 oracle)。
* **正例**：`expect(user).toMatchObject({ name, email })` + `expect(user.id).toBeTypeOf('string')`。
* **特例**：纯 `toBeDefined` 收尾且无其它真断言判定为 Blocker；与真断言并存降为 Nit。同义反复/蕴含冗余基线为 Major。

### D2 用例是否真的会执行 (基线: Blocker)
* **判据**：用例是否落入 `include` 配置？条件跳过是否导致**唯一门禁用例被静默忽略**？
* **反例**：文件名后缀/归属不符导致不收集；`describe.skipIf(process.platform === 'darwin')` 导致某平台门禁永久静默变绿。

### D3 假绿与静默失败 (基线: Blocker)
| 形态 | 典型反例 | 风险分析与修复 |
| :--- | :--- | :--- |
| **吞异常** | `try { await x() } catch {}` | 抛错仍判绿。改用 `expect.fail()` 或断言 Catch 逻辑 |
| **宽泛过滤** | `.filter(e => !e.message.includes('fetch'))` | 掩盖真实错误。过滤逻辑必须极窄并注明理由 |
| **空值掩盖** | `res ?? []` 配合 `toHaveLength(0)` | 无法区分上游返回空还是未定义。应先断言来源契约 |
| **中途 Return**| `if (!ok) return` | 未到达断言即结束。改为 `expect(ok).toBe(true)` |
| **析取断言** | `expect(a \|\| b).toBe(true)` | 逻辑过于宽松。必须精确断言唯一契约值 |
| **可选链漏断**| `expect(await el?.getText()).toBe('x')` | 元素不存在返回 `undefined` 变相通过。先断言存在性 |
| **空壳用例** | `it('should work', () => {})` | 毫无逻辑。补齐真实断言或删除 |

### D4 异步与 Mock / Snapshot 卫生 (基线: Blocker / Major)
* **异步控制 (Blocker)**：`resolves/rejects` 必须加 `await` 或 `return`；禁止使用 `setTimeout` 盲等，单测用 `vi.useFakeTimers()`/`vi.waitFor()`，E2E 用 `expect.poll()`。
* **Mock 边界 (Major)**：**严禁 Mock 被测对象本身**。纯函数/高效逻辑使用真实实现；网络拦截优先于 `fetch` 全局 Mock。E2E 中 Mock 后端命令定为 Blocker。
* **还原纪律 (Major)**：本仓无全局 `restoreMocks`，文件须自管（在 `afterEach` 里清理）。
* **Snapshot 规约 (Major)**：本仓现存零快照。不可盲目用快照替代结构断言（如 `toMatchObject`）。

### D5 隔离与确定性 (基线: Blocker)
* **数据安全**：**绝对禁止**触碰真实用户目录 (`~/.dsh` 等)。强制使用 `DSH_E2E_HOME` 等隔离环境。
* **副作用收敛**：不得拉起系统真实程序（文件管理器等），不得杀用户进程。
* **状态隔离**：全局变量/缓存/环境变量须在 `beforeEach/afterEach` 重置。
* **顺序无关**：必须在 `--sequence.shuffle` 随机乱序下可完全通过。

### D6 边界与错误路径 (基线: Major)
* **拒绝契约**：异常输入（缺参/越界/上游崩溃）必须断言抛出错误码或对应异常，而非静默改写或返回默认值。
* **四必查**：空值/缺失值、边界极值（0/上限）、依赖失败路径、空集合处理。

### D7 变异验证 (基线: 核心判据)
* **有效性验证**：核心用例必须进行变异抽查——**故意破坏实现逻辑，验证测试是否确实变红**。未变红说明断言无效。
* **Bug 修复保护**：修复 Bug 必须先写会变红的回归用例，验证其有效性后再修代码。

### D8 命名、分层与结构 (基线: Major / Minor)
* **契约命名 (Major)**：`it()` 标题即契约，须写清“对象+条件+预期结果”。严禁使用 `works`, `test1` 等无意义命名。
* **分层归属 (Major)**：严格遵守 L1/L2/L3 归属，禁止在单测做 E2E 级 UI 校验。
* **单一行为 (Minor)**：一个用例只验一个行为。标题出现 `and` / `并且` 的建议拆分。E2E 断言需带中文描述消息。

---

## 4. 缺陷分级与准入门禁

### 缺陷分级表

| 级别 | 定义 | 处理要求 |
| :--- | :--- | :--- |
| **Blocker** | 恒过/不运行/无断言/污染真实环境/假绿静默失败/E2E Mock 后端 | 阻断，必须修复并复跑 |
| **Major** | 弱断言/同义反复/过度 Mock/未做隔离/缺关键边界/分层错误 | 本 PR 内修复或记 Issue |
| **Minor** | 可读性/命名规范/多行为未拆分/日志残留/硬编码等待 | 建议顺手修复，不阻断 |
| **Nit** | 纯排版或风格偏好 | 可选处理 |

### 准入门禁（必须同时满足）
1. 独立连续运行 **≥ 5 次无 Flake**；
2. 失败信息可精确定位至“用例-步骤-期望与实际”；
3. `it()` 标题即契约且与内部断言一致；
4. 满足 `--sequence.shuffle` 乱序运行无报错；
5. 环境完全隔离，无真实用户数据写入。

---

## 5. 本仓 Vitest 坑点与规范

### 配置事实
* 根配置 `vitest.config.ts` 仅管理 Project，不直接收集用例；覆盖率仅在根配置生效。
* **无全局 API**：配置未启 `globals: true`，必须显式导入：`import { describe, it, expect, vi } from 'vitest'`。
* **无全局 Mock 还原**：需在测试文件内显式声明 `afterEach(() => vi.restoreAllMocks())`。

### 运行标准命令
```bash
# 规范命令（禁止使用 pnpm run 脚本，显式带 run 参数）
vitest run --project unit                            # 全量单测
vitest run --project unit path/to/file.test.ts        # 单文件（位置参数）
vitest run --project unit --sequence.shuffle          # 乱序排查
```

### 关键 API 陷阱

* **严禁 Jest API**：全仓使用 `vi.*`，禁止 `jest.*`。
* **`vi.spyOn` 特性**：默认仍会执行原实现，仅追踪调用。
* **引用变更陷阱**：`.mock.calls` 记录实参引用，若实参后续被修改会导致断言失败，建议在 Mock 内做 `structuredClone`。

---

## 6. 可机检扫描命令 (`rg`)

> **注意**：扫描结果仅作为排查线索，命中后必须回读代码人工确认语义。

| # | 检查项 | 命令 | 默认等级 |
| --- | --- | --- | --- |
| 1 | 聚焦标记残留 | `rg -n '\.only\s*\(|fdescribe\s*\(|\bfit\s*\(' packages test src -g '*.ts'` | Blocker |
| 2 | Jest API 混用 | `rg -n '\bjest\s*\.' packages test src -g '*.ts'` | Blocker |
| 3 | 缺少 await 的 Promise 断言 | `rg -n '(resolves|rejects)\.' packages test src -g '*.ts' | rg -v '\bawait\b|\breturn\b'` | Blocker |
| 4 | 跳过/待办标记 | `rg -n 'skipIf|it\.skip|test\.skip|describe\.skip|it\.todo|test\.todo' packages test src -g '*.ts'` | Major |
| 5 | 弱断言收尾 | `rg -n '\.(toBeDefined|toBeTruthy|toBeFalsy)\(' packages test src -g '*.ts'` | Blocker ~ Nit |
| 6 | 触碰真实用户数据 | `rg -n '\.dsh\.dev|\.store\.dev\.dat|[^-]\.store\.dat' test packages -g '*.test.ts' -g '*.e2e.ts'` | Blocker |
| 7 | 硬编码 setTimeout | `rg -n 'await new Promise' packages test src -g '*.ts' | rg 'setTimeout|setInterval'` | Minor/Major |
| 8 | 调试/残留注释 | `rg -n 'console\.(log|debug|info)\(' packages test src -g '*.ts'` | Minor |
| 9 | 遗留 TODO/FIXME | `rg -n '(TODO|FIXME|XXX)' test packages -g '*.test.ts' -g '*.e2e.ts'` | Minor |
| 10 | 误用 test() 代替 it() | `rg -n '^\s*test\(' packages test src -g '*.ts'` | Minor |

---

## 7. 评审报告规范

### 判定四态

* `APPROVED`：测试真实守护契约，无 Blocker/Major，运行与变异实证齐全。
* `APPROVED_WITH_NOTES`：无 Blocker，含 Minor/Nit 或既有技术债，可后续处理。
* `CHANGES_REQUIRED`：存在 Blocker 或未说明风险的 Major。
* `BLOCKED`：前置缺失/环境异常导致测试无法运行。

---

## 8. CI 门禁

| 车道 | 平台 | 门禁关键项 |
| --- | --- | --- |
| `unit` | ubuntu-latest | `typecheck` + `lint` (退出码 0) + `test:unit -- --run` |
| `plugins-e2e` | ubuntu-latest | 构建插件与 CLI 环境后跑 `test:e2e:plugin -- --run` |
| `desktop-e2e` | windows-latest | 构建前端与 Debug 二进制后跑 `test:e2e:desktop -- --run` |
| `rust-test` | 多平台 | `cargo test --all-features --locked` |

* **前置失败即 Fail**：禁止使用 `skipIf` 掩盖环境缺失或依赖未构建问题。
* **覆盖率不作为门禁**：覆盖率数据仅用于定位未覆盖的风险分支，准入以契约完整性为准。

---

## 9. 既有债与免误判清单

### 免误判清单（看似可疑，实则合规）

1. **显式导入 `describe/it/expect/vi**`：符合本仓无全局 API 的配置设定。
2. **使用 `vi.mock('./path')` 字符串路径**：本仓既有写法，无需强求改为 `import()`。
3. **E2E 统一使用 `expect.poll**`：此为异步等待的标准正确写法。
4. **E2E 断言带有中文第二参数**：此为本仓提供高可读错误日志的标准规范。
5. **单个 `toBeDefined()` 配合 `toMatchObject()` 使用**：属于合法断言组合。
