# MCP 工具和 Skills 技能包安装指南

> 本文档供 AI 大模型阅读，当用户提出需要安装 MCP 工具或 Skills 技能包时，请参考本文档进行操作。

## 概述

SmartBoBo 平台支持两种扩展能力：
1. **MCP 工具**：基于 Model Context Protocol 的外部工具服务器，提供额外的工具能力
2. **Skills 技能包**：可复用的指令/提示词集合，增强 Agent 的特定领域能力

## MCP 工具安装

### 什么是 MCP？

MCP (Model Context Protocol) 是一种标准化协议，允许 AI 模型与外部工具服务器通信。MCP 工具服务器可以提供文件系统访问、数据库查询、API 调用等能力。

### 常见的 MCP 工具

| 工具名称 | 功能描述 | 安装方式 |
|---------|---------|---------|
| `@modelcontextprotocol/server-filesystem` | 文件系统访问 | npm 全局安装 |
| `@modelcontextprotocol/server-github` | GitHub API 访问 | npm 全局安装 |
| `@modelcontextprotocol/server-memory` | 知识图谱记忆 | npm 全局安装 |
| `@modelcontextprotocol/server-fetch` | HTTP 请求 | npm 全局安装 |
| `@modelcontextprotocol/server-puppeteer` | 浏览器自动化 | npm 全局安装 |
| `@modelcontextprotocol/server-sqlite` | SQLite 数据库 | npm 全局安装 |
| `js-reverse` | JavaScript 逆向分析 | npm 全局安装 |

### 安装 MCP 工具的步骤

#### 方法一：通过网页端设置界面安装

1. 打开 SmartBoBo 网页端
2. 点击左侧边栏底部的"设置"按钮
3. 在设置面板中选择"MCP 工具"
4. 点击"安装"按钮
5. 选择安装方式：
   - **从本地文件导入**：如果有 MCP 配置文件
   - **手动输入配置**：直接填写工具配置信息

#### 方法二：手动配置

1. 首先确保工具服务器已安装：

```bash
# 安装 js-reverse MCP 工具
npm install -g js-reverse

# 或者使用 npx 运行（无需全局安装）
npx js-reverse
```

2. 在设置界面手动输入配置：

```yaml
# stdio 类型的 MCP 工具配置示例
id: js-reverse
serverName: js-reverse
transport: stdio
command: npx
args: ['-y', 'js-reverse']
enabled: true
toolCallTimeoutMs: 60000
reconnect:
  enabled: true
```

### MCP 工具配置格式

```yaml
# ~/.dsh/mcp-tools.yaml
mcp-tools:
  - id: 工具唯一标识
    serverName: 工具名称（用于工具调用的前缀）
    transport: stdio  # 或 streamable-http
    # stdio 类型配置
    command: npx       # 可执行文件
    args: ['-y', '包名']  # 命令参数
    env:               # 可选：环境变量
      API_KEY: xxx
    # streamable-http 类型配置
    # url: http://localhost:3000/mcp
    # headers:
    #   Authorization: Bearer xxx
    enabled: true
    toolCallTimeoutMs: 60000
    reconnect:
      enabled: true
      initialDelayMs: 500
      maxDelayMs: 30000
      maxAttempts: 10
```

### 常见 MCP 工具配置示例

#### js-reverse（JavaScript 逆向分析）

```yaml
- id: js-reverse
  serverName: js-reverse
  transport: stdio
  command: npx
  args: ['-y', 'js-reverse']
  enabled: true
  toolCallTimeoutMs: 120000
```

#### 文件系统访问

```yaml
- id: filesystem
  serverName: fs
  transport: stdio
  command: npx
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/directory']
  enabled: true
```

#### GitHub 访问

```yaml
- id: github
  serverName: github
  transport: stdio
  command: npx
  args: ['-y', '@modelcontextprotocol/server-github']
  env:
    GITHUB_TOKEN: ${GITHUB_TOKEN}
  enabled: true
```

---

## Skills 技能包安装

### 什么是 Skills？

Skills 是可复用的指令集合，包含特定领域的提示词和行为指南。加载 Skill 后，Agent 会获得该技能的能力。

### 常见的 Skills 技能包

| 技能名称 | 功能描述 | 来源 |
|---------|---------|-----|
| `Summarize` | 内容摘要总结 | 本地/Skills Hub |
| `CodeReview` | 代码审查 | 本地/Skills Hub |
| `Translate` | 多语言翻译 | 本地/Skills Hub |
| `DataAnalysis` | 数据分析 | 本地/Skills Hub |
| `WebScraper` | 网页采集优化 | 本地/Skills Hub |

### 安装 Skills 技能包的步骤

#### 方法一：通过网页端设置界面安装

1. 打开 SmartBoBo 网页端
2. 点击左侧边栏底部的"设置"按钮
3. 在设置面板中选择"技能库"
4. 点击"安装"按钮
5. 选择安装方式：
   - **从本地文件安装**：选择本地的 SKILL.md 文件
   - **从 URL 安装**：输入技能包的下载地址
   - **从 GitHub 安装**：输入 GitHub 仓库地址

#### 方法二：手动安装

1. **从本地文件安装**：

```bash
# 创建技能目录
mkdir -p ~/.dsh/skills/my-skill

# 创建 SKILL.md 文件
cat > ~/.dsh/skills/my-skill/SKILL.md << 'EOF'
# My Skill

## Description
这是一个自定义技能包。

## Instructions
当用户要求执行相关操作时，按照以下步骤执行：
1. 步骤一
2. 步骤二
3. 步骤三
EOF
```

2. **从 URL 下载安装**：

```bash
# 下载技能包
curl -o ~/.dsh/skills/my-skill/SKILL.md https://example.com/skills/my-skill.md
```

3. **从 GitHub 安装**：

```bash
# 克隆仓库
git clone https://github.com/user/skill-repo ~/.dsh/skills/my-skill
```

### Skills 技能包配置格式

```yaml
# ~/.dsh/skills.yaml
skills:
  - name: 技能名称
    description: 技能描述
    source: local  # local / http / github / runtime
    path: ~/.dsh/skills/my-skill/SKILL.md  # local 类型
    # url: https://example.com/skill.md  # http 类型
    # githubRepo: user/repo  # github 类型
    enabled: true
    invocation:
      modelInvocable: true   # 模型可调用
      userInvocable: true    # 用户可调用
    metadata: {}
```

### Skills 技能包格式

每个 Skill 必须包含一个 `SKILL.md` 文件，格式如下：

```markdown
# Skill Name

## Description
简短描述这个技能的功能。

## Instructions
当用户要求执行相关操作时，按照以下步骤执行：

1. 第一步：分析用户需求
2. 第二步：执行具体操作
3. 第三步：返回结果

## Examples
### 示例 1
用户输入：xxx
预期输出：yyy

### 示例 2
用户输入：aaa
预期输出：bbb
```

### Summarize 技能包示例

```markdown
# Summarize

## Description
内容摘要总结技能，能够对长文本、网页、文档进行智能摘要。

## Instructions
当用户要求总结内容时：

1. **分析内容类型**：判断是网页、文档、代码还是其他类型
2. **提取关键信息**：
   - 标题和主题
   - 主要观点和结论
   - 关键数据和事实
3. **生成摘要**：
   - 保持简洁，控制在 200 字以内
   - 突出重点信息
   - 保持客观中立
4. **格式化输出**：
   - 使用 Markdown 格式
   - 包含标题、要点列表
   - 必要时添加来源链接

## Examples
### 网页摘要
输入：一段网页内容
输出：
**摘要**：这是一篇关于 XXX 的文章，主要讲述了...

### 文档摘要
输入：一份技术文档
输出：
**文档摘要**：
- 主题：XXX
- 要点：1. ... 2. ... 3. ...
- 结论：...
```

---

## 故障排除

### MCP 工具常见问题

1. **工具无法连接**
   - 检查 `command` 路径是否正确
   - 确保工具服务器已全局安装：`npm install -g <package>`
   - 检查环境变量是否正确配置

2. **工具调用超时**
   - 增加 `toolCallTimeoutMs` 配置值
   - 检查工具服务器是否正常运行

3. **权限错误**
   - 确保工具服务器有必要的文件系统访问权限
   - 检查 `env` 中的 API Key 是否有效

### Skills 技能包常见问题

1. **技能包未加载**
   - 检查 `SKILL.md` 文件是否存在且格式正确
   - 确认技能包路径正确
   - 在设置界面检查技能是否已启用

2. **技能包内容不生效**
   - 确认 `modelInvocable` 设置为 `true`
   - 检查技能包的 Instructions 是否清晰

---

## 参考资源

- [MCP 官方文档](https://modelcontextprotocol.io/)
- [MCP 工具服务器列表](https://github.com/modelcontextprotocol/servers)
- [Skills 技能包规范](../packages/skill/skill/README.md)