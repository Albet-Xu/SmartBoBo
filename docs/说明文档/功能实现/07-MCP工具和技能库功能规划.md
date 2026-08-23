# MCP工具和技能库功能规划文档

## 1. 功能概述

在设置界面中新增两个功能设置：
1. **MCP工具**：管理 MCP (Model Context Protocol) 工具的安装、配置和开关
2. **技能库**：管理用户下载的 skills 技能包，提供查看、启用/禁用功能

## 2. 现有架构分析

### 2.1 MCP 工具架构

**现有实现**：
- `@deepseek-ai/dsh-mcp-client` 包提供 MCP 客户端桥接功能
- 通过 `cordis.yml` 配置文件定义 MCP 服务器
- 支持 `stdio` 和 `streamable-http` 两种传输方式
- 工具名称格式：`mcp__<serverName>__<rawName>`

**配置示例**：
```yaml
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN
```

### 2.2 技能库架构

**现有实现**：
- `@deepseek-ai/dsh-skill` 包提供技能注册表功能
- `@deepseek-ai/dsh-skill-filesystem` 提供本地文件系统技能发现
- 技能可以来自本地文件、HTTP 或其他后端
- 支持模型调用和用户调用两种策略

**技能存储位置**：
- 项目技能：`<项目根>/.agents/skills/`
- 用户技能：`~/.dsh/skills/`
- 运行时技能：通过 `ctx.skills.register()` 注册

### 2.3 设置界面架构

**现有设置项**：
- 通用设置（General）：语言、外观、权限等
- 模型（Models）：LLM 提供商配置
- 插件（Plugins）：插件管理
- Agent 预设（Agent Presets）：预设配置

**设置项注册方式**：
```typescript
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'mcp-tools',  // 新增的 MCP 工具设置项
  order: 50,
  label: () => t('mcpTools'),
  inject: injected,
}, MCPToolsSection))
```

## 3. 功能设计

### 3.1 MCP 工具管理

#### 3.1.1 功能列表

1. **已安装 MCP 工具列表**
   - 显示所有已配置的 MCP 服务器
   - 显示服务器状态（连接中/已连接/断开/错误）
   - 显示服务器提供的工具数量

2. **安装新 MCP 工具**
   - 提供 MCP 服务器搜索功能
   - 支持手动输入服务器配置
   - 支持从 URL 安装

3. **MCP 工具配置**
   - 编辑服务器配置（命令、参数、环境变量）
   - 配置传输方式（stdio/streamable-http）
   - 配置超时和重连策略

4. **MCP 工具开关**
   - 启用/禁用单个 MCP 服务器
   - 批量启用/禁用所有 MCP 工具

5. **MCP 工具详情**
   - 查看服务器提供的工具列表
   - 查看工具的输入/输出 schema
   - 测试工具调用

#### 3.1.2 数据模型

```typescript
interface MCPToolConfig {
  id: string
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  toolCallTimeoutMs?: number
  failOnStartupError?: boolean
  reconnect?: {
    enabled: boolean
    initialDelayMs?: number
    maxDelayMs?: number
    maxAttempts?: number
  }
}

interface MCPToolStatus {
  id: string
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  toolCount: number
  lastError?: string
  lastConnected?: Date
}
```

### 3.2 技能库管理

#### 3.2.1 功能列表

1. **已安装技能列表**
   - 显示所有可用技能
   - 显示技能来源（本地/HTTP/运行时）
   - 显示技能状态（启用/禁用）

2. **技能搜索和安装**
   - 搜索本地技能目录
   - 从 URL 下载技能
   - 从技能市场安装（未来扩展）

3. **技能配置**
   - 编辑技能元数据
   - 配置技能调用策略（模型/用户）
   - 配置技能依赖

4. **技能开关**
   - 启用/禁用单个技能
   - 批量启用/禁用所有技能

5. **技能详情**
   - 查看技能内容
   - 预览技能效果
   - 查看技能使用统计

#### 3.2.2 数据模型

```typescript
interface SkillConfig {
  name: string
  description?: string
  source: 'local' | 'http' | 'runtime'
  path?: string
  url?: string
  enabled: boolean
  invocation: {
    modelInvocable: boolean
    userInvocable: boolean
  }
  metadata?: Record<string, unknown>
}

interface SkillStatus {
  name: string
  status: 'active' | 'inactive' | 'error'
  provider: string
  lastUsed?: Date
  usageCount?: number
}
```

## 4. 实现方案

### 4.1 新增设置项

#### 4.1.1 创建 MCP 工具设置包

**包名**：`@deepseek-ai/dsh-client-settings-mcp`

**文件结构**：
```
packages/client/ui-settings-mcp/
├── src/
│   ├── client/
│   │   ├── index.ts                    # 插件入口
│   │   ├── MCPToolsSection.tsx         # MCP 工具设置页面
│   │   ├── MCPToolCard.tsx             # 单个 MCP 工具卡片
│   │   ├── MCPToolInstallDialog.tsx    # 安装对话框
│   │   ├── locales.ts                  # 本地化文本
│   │   └── store.ts                    # 状态管理
│   └── invariant.ts
├── package.json
├── tsconfig.json
└── README.md
```

#### 4.1.2 创建技能库设置包

**包名**：`@deepseek-ai/dsh-client-settings-skills`

**文件结构**：
```
packages/client/ui-settings-skills/
├── src/
│   ├── client/
│   │   ├── index.ts                    # 插件入口
│   │   ├── SkillsSection.tsx           # 技能库设置页面
│   │   ├── SkillCard.tsx               # 单个技能卡片
│   │   ├── SkillInstallDialog.tsx      # 安装对话框
│   │   ├── locales.ts                  # 本地化文本
│   │   └── store.ts                    # 状态管理
│   └── invariant.ts
├── package.json
├── tsconfig.json
└── README.md
```

### 4.2 后端 API 扩展

#### 4.2.1 MCP 工具 API

```typescript
// 新增 API 端点
interface MCPToolsAPI {
  // 获取已安装的 MCP 工具列表
  list(): Promise<MCPToolConfig[]>
  
  // 安装新的 MCP 工具
  install(config: MCPToolConfig): Promise<void>
  
  // 卸载 MCP 工具
  uninstall(id: string): Promise<void>
  
  // 更新 MCP 工具配置
  update(id: string, config: Partial<MCPToolConfig>): Promise<void>
  
  // 启用/禁用 MCP 工具
  toggle(id: string, enabled: boolean): Promise<void>
  
  // 获取 MCP 工具状态
  status(id: string): Promise<MCPToolStatus>
  
  // 测试 MCP 工具连接
  test(id: string): Promise<{ success: boolean; error?: string }>
}
```

#### 4.2.2 技能库 API

```typescript
// 新增 API 端点
interface SkillsAPI {
  // 获取已安装的技能列表
  list(): Promise<SkillConfig[]>
  
  // 安装新技能
  install(config: SkillConfig): Promise<void>
  
  // 卸载技能
  uninstall(name: string): Promise<void>
  
  // 更新技能配置
  update(name: string, config: Partial<SkillConfig>): Promise<void>
  
  // 启用/禁用技能
  toggle(name: string, enabled: boolean): Promise<void>
  
  // 获取技能状态
  status(name: string): Promise<SkillStatus>
  
  // 搜索技能
  search(query: string): Promise<SkillConfig[]>
}
```

### 4.3 配置存储

#### 4.3.1 MCP 工具配置

**存储位置**：`~/.dsh/mcp-tools.yaml`

**配置格式**：
```yaml
mcp-tools:
  - id: github
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
    enabled: true
    toolCallTimeoutMs: 60000
    reconnect:
      enabled: true
      initialDelayMs: 500
      maxDelayMs: 30000
      maxAttempts: 10

  - id: web
    serverName: web
    transport: streamable-http
    url: http://localhost:3000/mcp
    enabled: false
```

#### 4.3.2 技能库配置

**存储位置**：`~/.dsh/skills.yaml`

**配置格式**：
```yaml
skills:
  - name: my-skill
    description: 一个自定义技能
    source: local
    path: ~/.dsh/skills/my-skill/SKILL.md
    enabled: true
    invocation:
      modelInvocable: true
      userInvocable: true

  - name: remote-skill
    description: 远程技能
    source: http
    url: https://example.com/skills/remote-skill.md
    enabled: false
    invocation:
      modelInvocable: true
      userInvocable: false
```

## 5. 实现步骤

### 5.1 第一阶段：基础框架

1. **创建新的设置包**
   - 创建 `ui-settings-mcp` 包结构
   - 创建 `ui-settings-skills` 包结构
   - 配置 TypeScript 和构建

2. **实现基础 UI**
   - 创建设置页面组件
   - 实现列表展示
   - 实现开关功能

3. **集成到设置界面**
   - 在 `SettingsRoot` 中注册新设置项
   - 添加导航图标
   - 配置本地化文本

### 5.2 第二阶段：MCP 工具管理

1. **实现 MCP 工具 API**
   - 创建后端 API 端点
   - 实现配置读写
   - 实现状态查询

2. **实现 MCP 工具 UI**
   - 创建工具卡片组件
   - 实现安装对话框
   - 实现配置编辑器

3. **实现 MCP 工具逻辑**
   - 实现工具安装/卸载
   - 实现工具启用/禁用
   - 实现工具状态监控

### 5.3 第三阶段：技能库管理

1. **实现技能库 API**
   - 创建后端 API 端点
   - 实现配置读写
   - 实现状态查询

2. **实现技能库 UI**
   - 创建技能卡片组件
   - 实现安装对话框
   - 实现配置编辑器

3. **实现技能库逻辑**
   - 实现技能安装/卸载
   - 实现技能启用/禁用
   - 实现技能状态监控

### 5.4 第四阶段：高级功能

1. **搜索和发现**
   - 实现 MCP 工具搜索
   - 实现技能搜索
   - 实现推荐功能

2. **导入/导出**
   - 实现配置导出
   - 实现配置导入
   - 实现配置同步

3. **统计和监控**
   - 实现使用统计
   - 实现性能监控
   - 实现错误报告

## 6. UI 设计

### 6.1 MCP 工具设置页面

```
┌─────────────────────────────────────────────────────────────┐
│ MCP 工具                                              [+ 安装] │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🔌 GitHub MCP Server                    [启用] [配置] │ │
│ │ 服务器名称: github                                      │ │
│ │ 传输方式: stdio                                         │ │
│ │ 状态: 已连接 (12 个工具)                                │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🌐 Web Search MCP Server               [启用] [配置] │ │
│ │ 服务器名称: web                                         │ │
│ │ 传输方式: streamable-http                               │ │
│ │ 状态: 已连接 (3 个工具)                                 │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 📁 File System MCP Server              [启用] [配置] │ │
│ │ 服务器名称: filesystem                                  │ │
│ │ 传输方式: stdio                                         │ │
│ │ 状态: 断开                                              │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 技能库设置页面

```
┌─────────────────────────────────────────────────────────────┐
│ 技能库                                                [+ 安装] │
├─────────────────────────────────────────────────────────────┤
│ 🔍 搜索技能...                                              │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 📝 代码审查技能                     [启用] [配置] │ │
│ │ 描述: 自动审查代码质量和安全性                           │ │
│ │ 来源: 本地 (.agents/skills/code-review)                 │ │
│ │ 状态: 已启用                                            │ │
│ │ 调用策略: 模型 ✓  用户 ✓                                │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 📊 数据分析技能                     [启用] [配置] │ │
│ │ 描述: 分析数据集并生成报告                               │ │
│ │ 来源: HTTP (https://example.com/skills/data-analysis.md) │ │
│ │ 状态: 已禁用                                            │ │
│ │ 调用策略: 模型 ✓  用户 ✗                                │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🔧 调试技能                         [启用] [配置] │ │
│ │ 描述: 帮助调试和修复代码问题                             │ │
│ │ 来源: 运行时                                            │ │
│ │ 状态: 已启用                                            │ │
│ │ 调用策略: 模型 ✓  用户 ✓                                │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 7. 技术细节

### 7.1 MCP 工具集成

**配置加载**：
```typescript
// 在 base bundle 中添加 MCP 工具配置行
- id: mcp-tools-config
  name: '@deepseek-ai/dsh-mcp-tools-config'
  config:
    path: !!js dshHomePath('mcp-tools.yaml')
```

**工具注册**：
```typescript
// 动态注册 MCP 工具
for (const tool of mcpTools) {
  if (tool.enabled) {
    await ctx.loader.create({
      name: '@deepseek-ai/dsh-mcp-client',
      config: tool
    })
  }
}
```

### 7.2 技能库集成

**技能发现**：
```typescript
// 扩展技能发现路径
const skillPaths = [
  join(process.cwd(), '.agents', 'skills'),
  dshHomePath('skills'),
  // 用户自定义路径
  ...config.customPaths
]
```

**技能注册**：
```typescript
// 动态注册技能
for (const skill of skills) {
  if (skill.enabled) {
    ctx.skills.register({
      name: skill.name,
      description: skill.description,
      source: skill.source,
      path: skill.path,
      invocation: skill.invocation
    })
  }
}
```

## 8. 测试策略

### 8.1 单元测试

- MCP 工具配置解析测试
- 技能配置解析测试
- 状态管理测试
- API 接口测试

### 8.2 集成测试

- MCP 工具安装/卸载流程测试
- 技能安装/卸载流程测试
- 启用/禁用功能测试
- 配置持久化测试

### 8.3 端到端测试

- 完整的设置界面交互测试
- MCP 工具连接测试
- 技能加载和执行测试
- 错误处理测试

## 9. 部署考虑

### 9.1 向后兼容

- 保持现有 `cordis.yml` 配置方式
- 支持从旧配置迁移
- 渐进式功能启用

### 9.2 性能影响

- 异步加载配置
- 懒加载工具详情
- 缓存频繁访问的数据

### 9.3 安全性

- 验证 MCP 工具来源
- 限制技能文件访问
- 防止恶意代码执行

## 10. 后续扩展

### 10.1 技能市场

- 实现技能商店
- 支持技能评分和评论
- 实现技能版本管理

### 10.2 MCP 工具市场

- 实现 MCP 服务器目录
- 支持一键安装
- 实现工具组合

### 10.3 高级配置

- 支持配置模板
- 实现配置继承
- 支持环境变量绑定