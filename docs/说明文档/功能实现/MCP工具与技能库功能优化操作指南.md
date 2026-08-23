# MCP 工具与技能库功能优化操作指南

本指南说明对设置面板「MCP 工具」与「技能库」两个页面所做的一轮前端微优化与功能接线。改动严格保持了界面整体风格不变——前端只做了小的样式修正与必要的功能交互，未重写布局或视觉体系。后端补上了此前缺失的真实接线（技能安装、MCP 配置写入、技能分组持久化）。

## 改动范围总览

- 前端：两个设置页面（`packages/client/ui-settings-mcp`、`packages/client/ui-settings-skills`）的样式微调、安装/开关/分组交互，以及 store 从"假数据"改为调用真实 RPC。
- 后端：`packages/host/apiproxy`（BFF）新增 `skill` / `mcp` 两个 RPC 域与 `skill-library` / `mcp-tools` 两个 settings namespace，并在两个设置插件各自的节点半部注册这些 namespace。

---

## 一、下拉箭头往中间靠拢（需求 1）

**问题**：原生 `<select>` 的三角箭头由浏览器渲染、固定在控件最右侧，与"全部"等选项文字之间留白过大，观感差。

**方案**：给筛选下拉改用 `appearance: none` 去掉原生箭头，改用 CSS 背景自绘一个小箭头（SVG data URI），箭头位置精确贴近选项文字。整体边框、圆角、字号、配色与原来一致。

**涉及文件**：
- `packages/client/ui-settings-mcp/src/client/MCPToolsSection.module.css`（`.filterSelect`）
- `packages/client/ui-settings-skills/src/client/SkillsSection.module.css`（`.filterSelect`）
- 对应 `.tsx` 的 3 处 `<select>` 改用 `className={styles.filterSelect}`

---

## 二、开关（Toggle）样式与滑动动效（需求 2）

**问题**：原开关用内联样式，只有背景色变化、没有白色圆球滑块、没有滑动动画。

**方案**：复用两个 CSS module 里已写好的 `.toggle` / `.toggleSlider`。现状即目标形态：胶囊轨道（`border-radius: 22px`）、白色圆球滑块（`:before` 16×16 贴边）、`translateX(18px)` 位移动画、轨道在灰色与主题蓝（`--dsw-alias-primary`）之间切换。将每个技能/MCP 卡片里的 `<label>`/`<span>` 内联样式换成 `styles.toggle` / `styles.toggleSlider`，其余不变。

**涉及文件**：
- `MCPToolsSection.tsx` / `SkillsSection.tsx`（开关区）
- 两个 `.module.css`（已有 `.toggle` 系列）

> 说明：本次未改变开关的形态设计（即"胶囊 + 白色圆球滑块"），与当前产品开关视觉一致。

---

## 三、技能库「安装」按钮（需求 3 - Skills）

**行为**：点击右上角「安装」→ 系统弹出文件夹选择器 → 选择含 `SKILL.md` 的技能目录 → 宿主读取其 `name`/`description` 并复制到用户技能根目录 `~/.dsh/skills/<技能名>/` → 技能列表刷新即出现新技能。

**技术链路**：
1. 前端按钮 → `api.host.pickDirectory({})`（系统目录选择 RPC，弹系统对话框）。
2. 拿到路径 → `api.skillLibrary.installLocal({ path })`。
3. 宿主校验目录含 `SKILL.md`，用其 frontmatter 的 `name`/`description` 命名（读取不到则用文件夹名），复制到 `$DSH_HOME/skills/<name>/`。
4. `skill-filesystem` 的 Chokidar watcher 自动发现新技能并发出变更事件，前端刷新列表即见。

**涉及文件**：
- 后端：`packages/host/apiproxy/src/api/skill-library.ts`（接口）、`skill-library.schema.ts`、`rpc-map.ts`、`fetch/client.ts`、`fetch/handler.ts`、`api-proxy.ts`
- 前端：`ui-settings-skills/src/client/store.ts`（`installFromLocal`）、`SkillsSection.tsx`（按钮 onClick）

---

## 四、MCP 工具「安装」按钮（需求 3 - MCP）

**行为**：点击右上角「安装」→ 弹出配置表单（服务器名必填、传输类型 stdio / streamable-http，stdio 填命令+参数+可选环境变量，streamable-http 填 URL+可选请求头，另有超时、失败是否阻断启动、自动重连等可选字段）→ 提交后写下一份 `mcp-client` 插件实例配置。

**生效方式（重要）**：本项目不支持运行时热加 MCP 连接，`mcp-client` 实例只能在启动时从 cordis 组合声明。因此「安装」把一段 `mcp-client` 配置**追加到 `$DSH_HOME/cordis.patch.yml`**（机器本地、可回退、按 `id` 去重），并记录到 `mcp-tools` 设置列表；**下次启动应用时该 MCP 自动挂载、工具可用**。

**涉及文件**：
- 后端：`packages/host/apiproxy/src/api/mcp.ts`（接口）、`mcp.schema.ts`、`rpc-map.ts`、`fetch/client.ts`、`fetch/handler.ts`、`api-proxy.ts`
- 前端：`ui-settings-mcp/src/client/store.ts`（`install`）、`MCPToolsSection.tsx`（安装表单与按钮）、`locales.ts`

> **行为更新**：MCP 的「禁用 / 卸载」现在会**同时**移除 `cordis.patch.yml` 里对应的 `mcp-client` 配置行（按 `- id: mcp-<name>` 精确删除该块及其缩进行，其余内容与你的手写注释原样保留），因此下次启动不再挂载；禁用后再「启用」会按设置中保存的配置重新写回该行。卸载则彻底移除配置行并从列表删除。

---

## 五、技能库分组（需求 4）

**行为**：技能列表上方新增分组导航栏：`全部`（默认）/ `已建组` / `未分组` / `+ 新建分组`。勾选技能后可批量开启 / 关闭 / 删除（作用范围为当前选中分组），并可「移入分组」。

- 新建分组：分组导航栏点 `+ 新建分组` → 输入名称。
- 重命名 / 删除分组：对分组标签操作，删除时组内技能回到"未分组"。
- 移入分组：勾选技能 → 批量栏「移入分组」→ 选目标组。
- 批量开 / 关 / 删：作用范围为当前分组筛选出的技能，复用既有 `batchToggle` / `batchUninstall`，只是按分组限定。

**持久化**：分组 CRUD 与技能的 `group` 归属存于 `skill-library` 设置命名空间（`groups: [{ id, name }]`），通过 settings seam 持久化到 `$DSH_HOME/settings.yaml`。

**涉及文件**：`ui-settings-skills/src/client/{SkillsSection.tsx, store.ts, locales.ts}` + 后端 `skillLibrary.*` RPC（`api-proxy.ts`）。

---

## 六、后端改动清单

| 类别 | 内容 | 位置 |
|------|------|------|
| 新增 RPC 域 | `skillLibrary.*`（installLocal / toggle / uninstall / createGroup / renameGroup / deleteGroup / moveToGroup） | `apiproxy/src/api/*` |
| 新增 RPC 域 | `mcp.*`（install / toggle / uninstall） | `apiproxy/src/api/*` |
| 新增 settings namespace | `skill-library`、`mcp-tools` | 两设置插件节点半部 `ui-settings-*/src/index.ts` |
| 依赖 | `apiproxy` 增 `yaml@^2.9.0`（仓库已用同版）、新增 `home-paths` 引用 | `apiproxy/package.json`、`tsconfig.json` |

---

## 七、复现 / 验证

**编译**（已确认通过）：

```sh
pnpm exec tsc --project packages/host/apiproxy/tsconfig.json --noEmit
pnpm exec tsc --project packages/api/remotes/tsconfig.json --noEmit
pnpm exec tsc --project packages/client/connection/tsconfig.json --noEmit
pnpm exec tsc --project packages/client/ui-settings-skills/tsconfig.json --noEmit
pnpm exec tsc --project packages/client/ui-settings-mcp/tsconfig.json --noEmit
```

**手动点测（需运行应用后在界面上验证）**：
1. 设置 → 技能库：下拉箭头贴近"全部"；开关出现滑动小球；「安装」能弹系统目录选择器，选一个含 `SKILL.md` 的目录后技能出现。
2. 设置 → 技能库：新建/重命名/删除分组，勾选技能移入分组，按分组批量开/关/删。
3. 设置 → MCP 工具：下拉箭头、开关动效；「安装」弹配置表单并提交，确认 `$DSH_HOME/cordis.patch.yml` 被追加一行 `- id: mcp-<name>`；重启应用后该 MCP 挂载。

**说明**：settings namespace 注册与各页面加载逻辑属运行时行为，编译通过不代表插件在应用内已正确装载，以上手动点测不可省略。

---

## 八、已知限制与待确认

- 本轮未新增针对本功能的自动化测试（两个设置包原本无测试文件）；`pnpm run test:gui` 的既有失败集中在 `ui-primitives` / `ui-sidebar` / `ui-conversation` / `ui-settings-models` 等本次未触碰的包，属分支既有漂移。
- Agent Note 已新增英文侧文件（`.agents/notes/implemented/feature/2026-08-23-managed-skill-library-and-mcp-install.md`），中文与 i18n 配对未生成。