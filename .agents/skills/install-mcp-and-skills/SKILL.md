---
name: install-mcp-and-skills
description: 从 GitHub 找到并安装 MCP 服务器或技能包到本地，登记到「MCP 工具」与「技能库」并完成校验。当用户要求安装某个 MCP 服务或某个技能时使用。
disable-model-invocation: false
user-invocable: false
---

# 安装 MCP 服务器 / 技能包 操作手册（SOP）

本技能定义从 GitHub 安装一个 **MCP 服务器** 或一个 **Skills 技能包** 的标准流程，并把它们登记到设置界面的「MCP 工具」与「技能库」。动手前先判断用户要装的是哪一种，再走对应流程。

## 使用前提

- 本技能只在具备技能能力的预设（标准模式 / code / cordis）下可用。
- 若用户处于**采集模式或极简模式**，不要走本流程，改为引导用户去「设置 → Agent 预设 → 选择 标准模式」。
- 涉及写配置时，共用的 DSH 主目录为 `$DSH_HOME`（默认 `~/.dsh`）。

## 第 0 步：判断安装对象

| 用户想要的 | 类型 | 特征 |
|---|---|---|
| 一个 MCP 服务（如文件系统、GitHub、数据库、浏览器） | MCP 服务器 | 通常是 npm 包名（`xxx-mcp-server`）或一个 MCP 端点 URL |
| 一个技能/skill 包（教模型某类任务的 `SKILL.md`） | 技能 | 一个目录，根部含 `SKILL.md`（带 `name`/`description` frontmatter） |

不确定时先到 GitHub 搜索确认，再判断。

## 第 1 步：GitHub 搜索并确认真实来源

1. 用搜索工具（`tool-web`，或 Bash 里的 `gh search repos` / `git ls-remote`）找到项目主页。
2. 确认真实性：
   - 优先官方仓库/高 star、有 README、最近有提交的项目；警惕同名钓鱼仓库。
   - 记录：仓库地址、默认分支、许可证、版本/发布状态。
3. 把结论告诉用户并**征得确认**后再安装（改前确认：将装什么、来源、写哪些文件、是否需要重启）。

## 第 2 步：安装 MCP 服务器

目标：让服务器在下次启动时挂载，并在「MCP 工具」设置页显示。

1. 确定配置：
   - `serverName`：稳定、唯一，匹配 `[A-Za-z0-9_-]{1,32}`。
   - `transport`：
     - **stdio**：填 `command`（通常是 `npx`）与 `args`（如 `-y <npm包名>`），按需填 `env`。
     - **streamable-http**：填 `url`（MCP 端点），按需填 `headers`。
   - 需要的密钥（如 API Token）一律走 `~/.dsh/.credentials.yaml` 的变量名或 `process.env.X` 引用，**禁止**把明文密钥写进配置文件。
2. 写入「挂载配置」：在 `$DSH_HOME/cordis.patch.yml` 追加一个 `mcp-client` 插件实例行（`id: mcp-<serverName>`、`name: '@deepseek-ai/dsh-mcp-client'`），带有上面算出的 `config`。
3. 写入「列表展示」：把该条目同步登记进 `mcp-tools` 设置命名空间（`$DSH_HOME/settings.yaml`），这样「MCP 工具」页面能看到它、开关状态为启用。
4. 去重：先检查 `cordis.patch.yml` 与 `mcp-tools` 里是否已有同 `serverName` / 同 `id`；已存在则跳过或按需更新，不重复追加。
5. 生效：MCP 只支持启动时挂载，告诉用户**需重启**（重启命令见下）。

## 第 3 步：安装技能包

目标：把技能放进技能发现根目录，**并登记到「技能库」**（`$DSH_HOME/settings.yaml` 的 `skill-library` 命名空间）。⚠️ **前端「技能库」只读 `skill-library` 命名空间，不会扫描磁盘上的 `skills/` 目录**；只复制文件夹而不登记，技能不会在 UI 里出现（会被 `skill-filesystem` 发现但前端看不到）。

1. 克隆/下载含 `SKILL.md` 的仓库（临时目录），或直接拉取 `SKILL.md`。
2. 校验：目录根部必须有 `SKILL.md`，且 frontmatter 含 `name` 与 `description`；`name` 必须是 kebab-case `^[a-z0-9]+(?:-[a-z0-9]+)*$`（只允许小写字母、数字与连字符，**不能用下划线**）。若仓库/作者名带下划线（如 `hello_js_reverse_skill`），安装前把 `SKILL.md` 的 `name` 改为合法 kebab 名（如 `hello-js-reverse-skill`），并以此为目录名——否则 `skill-filesystem` 会忽略它，前端安装接口也会拒绝。
3. 放置：把**改名后的**技能目录复制到 `$DSH_HOME/skills/<技能名>/`（`skill-filesystem` 的 Chokidar 监听自动发现，供模型调用，**无需重启**）。若希望仅本机项目内使用，可放项目根 `.agents/skills/<技能名>/`（注意：前端「技能库」同样不列此目录，仍需登记才显示）。
4. **登记（关键）**：把该技能追加登记进 `$DSH_HOME/settings.yaml` 的 `skill-library.skills` 列表，新增一条：
   - `name: <技能名>`（与目录名一致，kebab-case）
   - `description: <SKILL.md frontmatter 里的 description>`
   - `source: local`
   - `enabled: true`
   - `group: null`（或既有分组 id）
   - `path: $DSH_HOME/skills/<技能名>/SKILL.md`
   登记后「技能库」才会显示它，开关启用状态也可管理。
5. 去重：复制前若 `$DSH_HOME/skills/` 已存在同名技能，先跟用户确认是覆盖还是跳过；登记前检查 `skill-library.skills` 是否已存在同名条目，避免重复追加。
6. 生效并汇报：`skill-filesystem` 发现是即时的；技能出现在「技能库」需要**完成第 4 步登记**。汇报时说明：已复制到 `$DSH_HOME/skills/<技能名>/` 并登记进 `skill-library`，请到「设置 → 技能库」确认它已出现且可启用。

## 第 4 步：校验与汇报

- 校验文件确实写入：`git diff` 或直接读取 `cordis.patch.yml` / `settings.yaml` / `$DSH_HOME/skills/<name>/SKILL.md`，确认真实存在、格式合法（YAML 可解析）。
- 汇报给用户：
  - 装了什么、来源仓库；
  - 写入的配置文件 / 目录；
  - MCP：**提示必须重启** `pnpm bobo`（项目根 `E:/SmartBoBo/BoBo/dsh` 下执行）后才会挂载；重启后去「MCP 工具」查看工具是否有连接且工具计数 > 0。
  - 技能：提示去「技能库」查看是否出现并启用；要手动调用可在标准模式对话里用 `/install-mcp-and-skills`（仅作说明，用户侧默认禁调）。

## 安全与红线

- 不硬编码任何密钥到配置文件；一律用 `.credentials.yaml` 变量或 `process.env.X`。
- 不安装来源不明、要求本机任意执行权限的可疑仓库，改为向用户说明风险并征询。
- 改动配置文件前先备份（保存原文件或记录 diff），避免破坏既有 cordis 组合。
- 遇到不影响结果的内部细节（工作目录、中间临时目录）自行处理，不要向用户追问。