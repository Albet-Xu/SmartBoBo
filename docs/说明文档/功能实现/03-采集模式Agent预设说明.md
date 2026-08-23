# 采集模式 Agent 预设说明文档

## 1. 功能背景

在 BoBo 智能采集平台中，用户需要一种便捷的方式来采集网页内容。采集模式 Agent 预设提供了一种智能检测用户输入中网址链接并自动调用本地采集引擎的功能，简化了网页采集操作流程。

## 2. 功能目标

1. **智能检测 URL**：自动识别用户输入中的 http:// 或 https:// 链接
2. **自动采集**：检测到 URL 后自动调用本地采集引擎抓取网页内容
3. **结果保存**：将采集结果保存到本地指定目录
4. **多引擎支持**：支持 camoufox、scrapling、crawl4ai 三种采集引擎
5. **用户友好**：简洁的交互方式，自动汇报采集结果

## 3. 实现方案

采用 **方案 A：纯提示词驱动**，通过 Agent 预设系统实现：

### 3.1 核心组件

1. **预设配置文件** (`preset.yml`)：定义预设的基本信息
2. **Agent 插件配置** (`agent.cordis.yml`)：定义 Agent 的 persona 和工具集

### 3.2 文件结构

```
BoBo/dsh/apps/cli/config/agent-presets/crawl/
├── preset.yml           # 预设元数据
└── agent.cordis.yml     # Agent 插件配置
```

## 4. 详细配置说明

### 4.1 预设元数据 (`preset.yml`)

```yaml
name: 采集模式
description: 智能检测用户输入中的网址链接，自动调用本地采集引擎抓取网页内容并保存到本地。
order: 5
```

- **name**: 预设显示名称
- **description**: 预设功能描述
- **order**: 预设在设置界面中的显示顺序（数字越小越靠前）

### 4.2 Agent 插件配置 (`agent.cordis.yml`)

#### 4.2.1 Persona 配置（采集专用提示词）

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      你是 SmartBoBo 采集助手。你的核心能力是通过本地采集引擎抓取网页内容并保存到本地。

      ## 核心行为规则

      1. **自动检测 URL**：当用户输入中包含 http:// 或 https:// 开头的链接时，你必须自动调用 crawl_fetch 工具采集该网页。不需要用户额外说"请采集"——只要消息里有 URL，就采集。
      2. **多 URL 处理**：如果用户一次输入了多个 URL，逐个调用 crawl_fetch 采集，并汇总报告每个链接的采集结果。
      3. **结果汇报**：采集完成后，告诉用户：保存位置（文件路径）、HTTP 状态码、以及页面内容的简短摘要（前 200 字左右）。
      4. **默认引擎**：默认使用 camoufox 引擎（抗检测浏览器，能渲染 JavaScript 页面）。用户可以指定其他引擎，例如"用 scrapling 采集 https://..."。
      5. **用户可拒绝**：如果用户明确说"不采集"或只是提到 URL 但不要求采集（比如讨论某个网站），则不调用采集工具。
      6. **错误处理**：如果采集失败（超时、被拦截、网络错误），报告错误原因并建议用户尝试其他引擎。

      ## 可用引擎

      - camoufox（默认）：抗检测浏览器，能处理 JavaScript 渲染页面、弹窗、反爬。
      - scrapling：轻量级 HTTP 采集，适合静态页面，速度快。
      - crawl4ai：LLM 友好的 Markdown 提取，适合需要结构化文本的场景。

      ## 交互风格

      - 简洁直接，不废话，返回结果只需要给返回HTTP 状态码、引擎、保存路径。其他任何多余的信息都不用输出。
      - 采集前不需要确认（除非用户明确要求确认）。
      - 采集后用清晰的格式报告结果。
```

**Persona 设计要点**：

1. **自动检测规则**：明确要求 Agent 检测 http/https 链接并自动采集
2. **多 URL 处理**：支持一次输入多个 URL 的场景
3. **结果格式**：统一汇报格式（保存路径、HTTP 状态码、内容摘要）
4. **引擎选择**：默认使用 camoufox，支持用户指定其他引擎
5. **错误处理**：采集失败时的处理策略
6. **交互风格**：简洁直接，避免不必要的确认步骤

#### 4.2.2 采集工具配置

```yaml
- id: tool-acquisition
  name: 'file:///E:/SmartBoBo/BoBo/dsh/packages/acquisition/tool-acquisition/lib/index.js'
  config:
    pythonBin: E:/SmartBoBo/BoBo/.venv/Scripts/python.exe
    scriptsDir: E:/SmartBoBo/BoBo/scripts
    dataDir: E:/SmartBoBo/BoBo/data
    timeoutMs: 120000
```

- **id**: 工具标识符
- **name**: 工具插件路径（使用 file: URL 指向编译产物）
- **config.pythonBin**: Python 解释器路径（使用 .venv 中的 Python）
- **config.scriptsDir**: 采集脚本目录
- **config.dataDir**: 采集结果保存目录
- **config.timeoutMs**: 采集超时时间（120秒）

#### 4.2.3 基础工具配置

```yaml
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'
```

- **tool-bash/tool-pwsh**: 根据操作系统自动选择 Shell 工具（Windows 使用 PowerShell，其他系统使用 bash）
- **tool-fs**: 文件系统操作工具
- **tool-ask-user**: 用户交互工具

## 5. 工作流程

### 5.1 用户激活采集模式

1. 用户在设置 → Agent 预设中选择"采集模式"
2. 系统加载采集模式预设配置
3. Agent 启动并应用采集专用 persona

### 5.2 URL 检测与采集流程

```
用户输入 → Agent 检测 URL → 调用 crawl_fetch → 保存结果 → 汇报结果
```

**详细步骤**：

1. **输入分析**：Agent 分析用户输入，检测 http:// 或 https:// 链接
2. **引擎选择**：
   - 默认使用 camoufox 引擎
   - 如果用户指定引擎（如"用 scrapling 采集..."），则使用指定引擎
3. **调用采集工具**：调用 `crawl_fetch` 工具采集网页
4. **结果处理**：
   - 保存采集结果到 `E:/SmartBoBo/BoBo/data/` 目录
   - 记录 HTTP 状态码
   - 提取页面内容摘要（前 200 字）
5. **结果汇报**：向用户报告采集结果

### 5.3 多 URL 处理流程

```
用户输入多个 URL → 逐个采集 → 汇总报告
```

1. Agent 识别所有 URL
2. 逐个调用 `crawl_fetch` 采集
3. 汇总每个 URL 的采集结果
4. 统一报告所有结果

## 6. 使用示例

### 6.1 单 URL 采集

**用户输入**：
```
请采集这个网页：https://news.qq.com/rain/a/20210912A0A92C00
```

**Agent 行为**：
1. 检测到 URL `https://news.qq.com/rain/a/20210912A0A92C00`
2. 调用 `crawl_fetch` 使用 camoufox 引擎采集
3. 保存结果到 `E:/SmartBoBo/BoBo/data/` 目录
4. 汇报结果

**预期输出**：
```
采集完成：
- URL: https://news.qq.com/rain/a/20210912A0A92C00
- HTTP 状态码: 200
- 引擎: camoufox
- 保存路径: E:/SmartBoBo/BoBo/data/20210912A0A92C00.md
- 内容摘要: 这是一篇关于腾讯新闻的文章...
```

### 6.2 指定引擎采集

**用户输入**：
```
用 scrapling 采集 https://example.com
```

**Agent 行为**：
1. 检测到 URL 和指定引擎
2. 调用 `crawl_fetch` 使用 scrapling 引擎采集
3. 保存结果并汇报

### 6.3 多 URL 采集

**用户输入**：
```
请采集这两个网页：
https://example.com/article1
https://example.com/article2
```

**Agent 行为**：
1. 检测到两个 URL
2. 逐个调用 `crawl_fetch` 采集
3. 汇总报告两个 URL 的采集结果

## 7. 技术实现细节

### 7.1 预设发现机制

dsh 预设系统会自动扫描 `apps/cli/config/agent-presets/` 目录下的子目录，每个子目录被视为一个预设。预设系统会读取：
- `preset.yml`：预设元数据
- `agent.cordis.yml`：Agent 插件配置

### 7.2 工具加载机制

`tool-acquisition` 工具通过 file: URL 指向编译产物 `lib/index.js`，确保工具能够正确加载。配置中的路径都是绝对路径，避免相对路径解析问题。

### 7.3 Python 环境集成

工具使用 `.venv/Scripts/python.exe` 作为 Python 解释器，确保采集脚本能够在正确的 Python 环境中运行，依赖完整的采集引擎库。

## 8. 验证方法

### 8.1 预设加载验证

1. 重启 dsh 服务：`pnpm bobo`
2. 进入设置 → Agent 预设
3. 检查是否显示"采集模式"预设

### 8.2 功能测试

1. 选择"采集模式"预设
2. 在对话中输入包含 URL 的内容
3. 观察 Agent 是否自动检测并采集 URL
4. 检查采集结果是否保存到指定目录

### 8.3 错误测试

1. 输入无效 URL，测试错误处理
2. 输入不存在的网站，测试超时处理
3. 输入需要登录的网站，测试反爬处理

## 9. 注意事项

1. **预设切换**：需要重启 dsh 服务才能看到新的预设
2. **引擎兼容性**：不同引擎适用于不同类型的网站
3. **超时设置**：默认超时 120 秒，复杂网站可能需要更长时间
4. **存储空间**：采集结果会占用本地磁盘空间，定期清理不需要的采集数据
5. **网络环境**：采集功能依赖网络连接，网络不稳定可能导致采集失败

## 10. 扩展建议

### 10.1 功能扩展

1. **批量采集**：支持从文本文件读取 URL 列表进行批量采集
2. **定时采集**：支持设置定时任务，定期采集指定网站
3. **采集监控**：添加采集进度监控和实时日志显示
4. **结果过滤**：支持按内容类型、大小等条件过滤采集结果

### 10.2 引擎扩展

1. **自定义引擎**：支持添加自定义采集引擎
2. **引擎配置**：为每个引擎提供独立的配置选项
3. **引擎切换**：根据网站特性自动选择最佳引擎

### 10.3 结果处理扩展

1. **内容提取**：支持提取特定元素（标题、正文、图片等）
2. **格式转换**：支持将采集结果转换为不同格式（JSON、CSV、PDF 等）
3. **内容分析**：集成 LLM 对采集内容进行分析和总结

## 11. 相关文件

- `BoBo/dsh/apps/cli/config/agent-presets/crawl/preset.yml` - 预设元数据
- `BoBo/dsh/apps/cli/config/agent-presets/crawl/agent.cordis.yml` - Agent 插件配置
- `BoBo/dsh/packages/acquisition/tool-acquisition/` - 采集工具插件
- `BoBo/scripts/` - 采集脚本目录
- `BoBo/data/` - 采集结果保存目录