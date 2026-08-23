# MCP工具和技能库功能实现说明文档

## 1. 功能概述

在设置界面中新增了两个功能设置：
1. **MCP工具**：管理 Model Context Protocol (MCP) 工具的安装、配置和开关
2. **技能库**：管理用户下载的 skills 技能包，提供查看、启用/禁用功能

## 2. 实现内容

### 2.1 新增包结构

#### 2.1.1 MCP工具设置包

**包名**：`@deepseek-ai/dsh-client-ui-settings-mcp`

**目录结构**：
```
packages/client/ui-settings-mcp/
├── src/
│   ├── client/
│   │   ├── index.ts                    # 插件入口
│   │   ├── MCPToolsSection.tsx         # MCP 工具设置页面
│   │   ├── MCPToolsSection.module.css  # 样式文件
│   │   ├── store.ts                    # 状态管理
│   │   └── locales.ts                  # 本地化文本
│   └── invariant.ts                    # 包不变量
├── package.json                        # 包配置
├── tsconfig.json                       # TypeScript 配置
└── tsdown.config.ts                    # 构建配置
```

#### 2.1.2 技能库设置包

**包名**：`@deepseek-ai/dsh-client-ui-settings-skills`

**目录结构**：
```
packages/client/ui-settings-skills/
├── src/
│   ├── client/
│   │   ├── index.ts                    # 插件入口
│   │   ├── SkillsSection.tsx           # 技能库设置页面
│   │   ├── SkillsSection.module.css    # 样式文件
│   │   ├── store.ts                    # 状态管理
│   │   └── locales.ts                  # 本地化文本
│   └── invariant.ts                    # 包不变量
├── package.json                        # 包配置
├── tsconfig.json                       # TypeScript 配置
└── tsdown.config.ts                    # 构建配置
```

### 2.2 新增SVG图标

#### 2.2.1 MCP工具图标

**文件**：`packages/client/ui-primitives/src/icons/IconMcpToolsOutline16.tsx`

**图标描述**：
- 行李箱形状，带有 MCP 文字
- 顶部有指南针指示器
- 底部有三个圆点

```tsx
export const IconMcpToolsOutline16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none">
    {/* 行李箱主体 */}
    <rect x="2" y="5" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    {/* 行李箱把手 */}
    <path d="M5.5 5V3.5C5.5 2.94772 5.94772 2.5 6.5 2.5H9.5C10.0523 2.5 10.5 2.94772 10.5 3.5V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    {/* 指南针指示器 */}
    <circle cx="8" cy="3.5" r="1" stroke="currentColor" strokeWidth="1" />
    {/* MCP 文字 */}
    <text x="8" y="10" textAnchor="middle" fill="currentColor" stroke="none" fontSize="4" fontWeight="bold">MCP</text>
    {/* 底部圆点 */}
    <circle cx="5" cy="13" r="0.8" fill="currentColor" />
    <circle cx="8" cy="13" r="0.8" fill="currentColor" />
    <circle cx="11" cy="13" r="0.8" fill="currentColor" />
  </svg>
)
```

#### 2.2.2 技能库图标

**文件**：`packages/client/ui-primitives/src/icons/IconSkillsLibraryOutline16.tsx`

**图标描述**：
- 菱形形状，中间有闪电符号
- 四个角有连接点
- 连接线连接各点

```tsx
export const IconSkillsLibraryOutline16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none">
    {/* 菱形形状 */}
    <path d="M8 1L15 8L8 15L1 8L8 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    {/* 闪电符号 */}
    <path d="M9 5L7 9H8.5L7.5 12L10 8H8.5L9 5Z" fill="currentColor" />
    {/* 连接点 */}
    <circle cx="1" cy="8" r="1.2" stroke="currentColor" strokeWidth="1" />
    <circle cx="15" cy="8" r="1.2" stroke="currentColor" strokeWidth="1" />
    <circle cx="8" cy="1" r="1.2" stroke="currentColor" strokeWidth="1" />
    <circle cx="8" cy="15" r="1.2" stroke="currentColor" strokeWidth="1" />
    {/* 连接线 */}
    <line x1="2.2" y1="8" x2="6.5" y2="8" stroke="currentColor" strokeWidth="1" />
    <line x1="9.5" y1="8" x2="13.8" y2="8" stroke="currentColor" strokeWidth="1" />
    <line x1="8" y1="2.2" x2="8" y2="6.5" stroke="currentColor" strokeWidth="1" />
    <line x1="8" y1="9.5" x2="8" y2="13.8" stroke="currentColor" strokeWidth="1" />
  </svg>
)
```

### 2.3 数据模型

#### 2.3.1 MCP工具配置

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
```

**TypeScript 接口**：
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
```

#### 2.3.2 技能库配置

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

**TypeScript 接口**：
```typescript
interface SkillConfig {
  name: string
  description?: string
  source: 'local' | 'http' | 'github' | 'runtime'
  path?: string
  url?: string
  githubRepo?: string
  enabled: boolean
  invocation: {
    modelInvocable: boolean
    userInvocable: boolean
  }
  metadata?: Record<string, unknown>
}
```

### 2.4 功能特性

#### 2.4.1 MCP工具管理

1. **工具列表展示**
   - 显示所有已配置的 MCP 工具
   - 显示工具名称、传输方式、状态
   - 支持启用/禁用开关

2. **工具安装**
   - 支持从本地文件导入配置
   - 支持手动输入配置
   - 首次安装需要确认，之后自动安装

3. **工具配置**
   - 编辑服务器配置
   - 配置传输方式
   - 配置超时和重连策略

4. **批量操作**
   - 批量启用/禁用工具
   - 批量卸载工具
   - 全选/清除选择

5. **搜索和筛选**
   - 搜索工具名称
   - 按状态筛选（全部/已启用/已禁用）

#### 2.4.2 技能库管理

1. **技能列表展示**
   - 显示所有已安装的技能
   - 显示技能名称、来源、状态
   - 显示调用策略（模型/用户）
   - 支持启用/禁用开关

2. **技能安装**
   - 从本地文件安装
   - 从 URL 下载安装
   - 从 GitHub 仓库安装
   - 首次安装需要确认，之后自动安装

3. **技能配置**
   - 配置调用策略
   - 配置技能描述
   - 配置技能元数据

4. **批量操作**
   - 批量启用/禁用技能
   - 批量卸载技能
   - 全选/清除选择

5. **搜索和筛选**
   - 搜索技能名称和描述
   - 按状态筛选（全部/已启用/已禁用）
   - 按来源筛选（全部/本地/URL/GitHub/运行时）

## 3. 集成说明

### 3.1 设置界面集成

#### 3.1.1 修改图标导航

**文件**：`packages/client/ui-settings-general/src/client/SettingsRoot.tsx`

**修改内容**：
```typescript
import {
  IconAgentPresetOutline16, IconCloseOutline16, IconDataOutline16,
  IconMcpToolsOutline16, IconPersonalizationOutline16, IconSettingsOutline16,
  IconSkillsLibraryOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'

function navIcon(id: string) {
  if (id === 'models') return <IconDataOutline16 className={css.navIcon} size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutline16 className={css.navIcon} size={16} />
  if (id === 'plugins') return <IconPersonalizationOutline16 className={css.navIcon} size={16} />
  if (id === 'mcp-tools') return <IconMcpToolsOutline16 className={css.navIcon} size={16} />
  if (id === 'skills-library') return <IconSkillsLibraryOutline16 className={css.navIcon} size={16} />
  return <IconSettingsOutline16 className={css.navIcon} size={16} />
}
```

#### 3.1.2 添加包依赖

**文件**：`packages/bundle/web-app/package.json`

**修改内容**：
```json
{
  "dependencies": {
    "@deepseek-ai/dsh-client-ui-settings-mcp": "workspace:^",
    "@deepseek-ai/dsh-client-ui-settings-skills": "workspace:^",
    // ... 其他依赖
  }
}
```

#### 3.1.3 添加插件配置

**文件**：`packages/bundle/web-app/cordis.patch.yml`

**修改内容**：
```yaml
- insert:
    - id: ui-settings-mcp
      name: '@deepseek-ai/dsh-client-ui-settings-mcp'

    - id: ui-settings-skills
      name: '@deepseek-ai/dsh-client-ui-settings-skills'
```

### 3.2 本地化支持

#### 3.2.1 MCP工具本地化

**文件**：`packages/client/ui-settings-mcp/src/client/locales.ts`

**中文文本**：
```typescript
export const zh = {
  'nav': 'MCP 工具',
  'title': 'MCP 工具管理',
  'description': '管理 Model Context Protocol (MCP) 工具的安装、配置和启用/禁用。',
  'install': '安装',
  'installNew': '安装新工具',
  'uninstall': '卸载',
  'enable': '启用',
  'disable': '禁用',
  // ... 更多本地化文本
}
```

**英文文本**：
```typescript
export const en = {
  'nav': 'MCP Tools',
  'title': 'MCP Tools Management',
  'description': 'Manage Model Context Protocol (MCP) tools installation, configuration, and enable/disable.',
  'install': 'Install',
  'installNew': 'Install New Tool',
  'uninstall': 'Uninstall',
  'enable': 'Enable',
  'disable': 'Disable',
  // ... 更多本地化文本
}
```

#### 3.2.2 技能库本地化

**文件**：`packages/client/ui-settings-skills/src/client/locales.ts`

**中文文本**：
```typescript
export const zh = {
  'nav': '技能库',
  'title': '技能库管理',
  'description': '管理技能包的安装、配置和启用/禁用。支持本地文件、URL 下载和 GitHub 仓库。',
  'install': '安装',
  'installNew': '安装新技能',
  'uninstall': '卸载',
  'enable': '启用',
  'disable': '禁用',
  // ... 更多本地化文本
}
```

**英文文本**：
```typescript
export const en = {
  'nav': 'Skills Library',
  'title': 'Skills Library Management',
  'description': 'Manage skill packages installation, configuration, and enable/disable. Supports local files, URL downloads, and GitHub repositories.',
  'install': 'Install',
  'installNew': 'Install New Skill',
  'uninstall': 'Uninstall',
  'enable': 'Enable',
  'disable': 'Disable',
  // ... 更多本地化文本
}
```

## 4. 使用说明

### 4.1 MCP工具管理

#### 4.1.1 访问MCP工具设置

1. 打开网页端设置界面
2. 在左侧导航栏点击"MCP工具"图标
3. 进入MCP工具管理页面

#### 4.1.2 安装MCP工具

1. 点击"安装"按钮
2. 选择安装方式：
   - 从本地文件导入
   - 手动输入配置
3. 填写工具配置信息
4. 点击"保存"完成安装

#### 4.1.3 启用/禁用MCP工具

1. 在工具列表中找到目标工具
2. 点击工具右侧的开关按钮
3. 开关变为绿色表示启用，灰色表示禁用

#### 4.1.4 批量操作MCP工具

1. 勾选需要操作的工具
2. 点击"批量启用"、"批量禁用"或"批量卸载"
3. 确认操作

### 4.2 技能库管理

#### 4.2.1 访问技能库设置

1. 打开网页端设置界面
2. 在左侧导航栏点击"技能库"图标
3. 进入技能库管理页面

#### 4.2.2 安装技能

1. 点击"安装"按钮
2. 选择安装方式：
   - 从本地文件安装
   - 从 URL 安装
   - 从 GitHub 安装
3. 填写技能信息
4. 点击"保存"完成安装

#### 4.2.3 启用/禁用技能

1. 在技能列表中找到目标技能
2. 点击技能右侧的开关按钮
3. 开关变为绿色表示启用，灰色表示禁用

#### 4.2.4 批量操作技能

1. 勾选需要操作的技能
2. 点击"批量启用"、"批量禁用"或"批量卸载"
3. 确认操作

## 5. 技术实现细节

### 5.1 状态管理

使用 `SnapshotStore` 进行状态管理，支持：
- 实时状态更新
- 错误处理
- 加载状态管理

### 5.2 组件结构

采用 React 函数组件 + Hooks：
- `useState` 管理局部状态
- `useCallback` 优化事件处理
- `useEffect` 处理副作用

### 5.3 样式方案

使用 CSS Modules：
- 避免样式冲突
- 支持主题变量
- 响应式设计

### 5.4 本地化

支持中英文双语：
- 基于 key 的本地化
- 支持变量插值
- 易于扩展其他语言

## 6. 后续优化

### 6.1 功能扩展

1. **MCP工具市场**：集成 MCP 服务器目录
2. **技能市场**：集成技能商店
3. **配置导入/导出**：支持配置文件的导入导出
4. **使用统计**：记录工具和技能的使用情况

### 6.2 性能优化

1. **懒加载**：按需加载工具和技能详情
2. **缓存**：缓存配置和状态数据
3. **批量操作优化**：减少网络请求

### 6.3 用户体验

1. **拖拽排序**：支持拖拽调整工具/技能顺序
2. **快捷键**：支持键盘快捷操作
3. **搜索增强**：支持模糊搜索、标签筛选

## 7. 测试说明

### 7.1 单元测试

- 状态管理测试
- 组件渲染测试
- 事件处理测试

### 7.2 集成测试

- 设置界面集成测试
- 工具/技能安装流程测试
- 批量操作测试

### 7.3 端到端测试

- 完整用户流程测试
- 错误处理测试
- 性能测试

## 8. 部署说明

### 8.1 构建

```bash
cd E:/SmartBoBo/BoBo/dsh
pnpm run build:lib:host
```

### 8.2 重启服务

```bash
pnpm bobo
```

### 8.3 验证

1. 打开网页端设置界面
2. 检查"MCP工具"和"技能库"设置项是否显示
3. 测试各功能是否正常工作

## 9. 相关文件

### 9.1 新增文件

- `packages/client/ui-settings-mcp/` - MCP工具设置包
- `packages/client/ui-settings-skills/` - 技能库设置包
- `packages/client/ui-primitives/src/icons/IconMcpToolsOutline16.tsx` - MCP工具图标
- `packages/client/ui-primitives/src/icons/IconSkillsLibraryOutline16.tsx` - 技能库图标

### 9.2 修改文件

- `packages/client/ui-settings-general/src/client/SettingsRoot.tsx` - 添加图标导航
- `packages/bundle/web-app/package.json` - 添加包依赖
- `packages/bundle/web-app/cordis.patch.yml` - 添加插件配置

## 10. 总结

本次实现完成了以下功能：

1. ✅ 创建了MCP工具和技能库的设置包结构
2. ✅ 实现了SVG图标
3. ✅ 实现了MCP工具管理功能
4. ✅ 实现了技能库管理功能
5. ✅ 集成到设置界面
6. ✅ 生成了详细的说明文档

所有功能都按照规划实现，支持：
- 本地文件导入配置
- 手动输入配置
- 首次确认，之后自动安装
- 搜索、筛选功能
- 批量操作功能
- 中英文双语支持