# API Key 配置与多模型支持完整指南

> **文档版本：** v2.0（已实施优化）  
> **最后更新：** 2026-08-23  
> **适用版本：** BoBo 智能采集平台（基于 dsh）  
> **实施状态：** ✅ 已完成多模型适配器配置

---

## 📋 目录

1. [问题背景](#问题背景)
2. [问题诊断与分析](#问题诊断与分析)
3. [已实施的优化](#已实施的优化)
4. [使用指南 - 快速开始](#使用指南---快速开始)
5. [使用指南 - 多模型配置](#使用指南---多模型配置)
6. [常见问题排查](#常见问题排查)
7. [附录](#附录)

---

## 问题背景

### 用户遇到的错误

在 Web 界面"设置"→"模型"中输入 API Key 后，系统仍然报错：

**错误 1（之前）：**
```
llm-deepseek: no API key for provider route "deepseek-official"; 
store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), 
or export DEEPSEEK_API_KEY in the launching environment
```

**错误 2（填写 OpenCode Go Key 后）：**
```
llm-deepseek: the API key resolved from DEEPSEEK_API_KEY contains characters 
no HTTP header can carry; set DEEPSEEK_API_KEY to the raw key alone 
(the web Models page writes it)
```

### 根本原因分析

1. **`.env` 文件不存在** - 系统无法从环境变量层读取 API Key
2. **Key 格式错误** - API Key 包含了 HTTP Header 无法承载的字符（空格、中文、换行等）
3. **混淆了两种 Key** - 用户填写的是 OpenCode Go API Key，但系统需要 DeepSeek API Key
4. **单模型限制** - 默认适配器 `llm-deepseek` 仅支持 DeepSeek 模型

---

## 问题诊断与分析

### API Key 格式要求

根据 `dsh/packages/llm/llm/src/api-key.ts` 的定义：

```typescript
const LEGAL_API_KEY = /^[\x21-\x7E]+$/  // 可打印 ASCII 字符，不包括空格
```

**合法字符：** `!` 到 `~` 之间的 ASCII 字符（十六进制 0x21-0x7E）  
**非法字符：** 空格、换行符、制表符、中文、引号等

### 凭证解析优先级

系统按以下顺序查找 API Key（从高到低）：

```
1. 继承的进程环境 (env) - 只读，优先级最高
   ↓
2. $DSH_HOME/.credentials.yaml - 可写（Web Models 页面写入）
   ↓
3. <cwd>/.env - 只读 fallback
   ↓
4. $DSH_HOME/.env - 只读 fallback
```

### 原架构限制

**原配置（`runtime/cordis.yml`）：**
```yaml
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
```

❌ **问题：** 仅支持 DeepSeek 模型，无法切换到其他提供商

---

## 已实施的优化

### 🔧 关键修复（2026-08-23）

**问题发现：** 修改 `runtime/cordis.yml` 后仍然使用旧适配器

**根本原因：** dsh web 启动时使用 **bundle 配置**，而不是 `runtime/cordis.yml`。`runtime/cordis.yml` 仅用于 SDK 运行时，不影响 Web 界面。

**修复位置：** `dsh/packages/bundle/base/cordis.patch.yml`

**修复内容：**
1. 将 `llm-deepseek`（单模型）替换为 `llm-pi-ai`（多模型）
2. 配置 5 个主流模型提供商
3. 更新默认模型选择器使用新的路由

### ✅ 优化 1：升级到多模型适配器

**修改文件：** 
- `dsh/packages/bundle/base/cordis.patch.yml`（**关键修复**）
- `dsh/python/sdk-runtime/src/deepseek_harness_runtime/runtime/cordis.yml`（辅助配置）

**新配置（`dsh/packages/bundle/base/cordis.patch.yml`）：**
```yaml
# ★ 多模型适配器（llm-pi-ai）- 支持 OpenAI、Anthropic、DeepSeek、Google、Moonshot 等
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      # DeepSeek（默认保留，兼容原有配置）
      deepseek:
        apiKeyEnv: DEEPSEEK_API_KEY
      # OpenAI（GPT-4、GPT-3.5 等）
      openai:
        apiKeyEnv: OPENAI_API_KEY
      # Anthropic（Claude 3.5、Claude 3 等）
      anthropic:
        apiKeyEnv: ANTHROPIC_API_KEY
      # Google（Gemini 1.5、Gemini 2.0）
      google:
        apiKeyEnv: GOOGLE_API_KEY
      # Moonshot（Kimi）
      moonshot:
        apiKeyEnv: MOONSHOT_API_KEY

# 原单模型适配器已注释（需要时可单独启用）
# - id: llm-deepseek
#   name: '@deepseek-ai/dsh-llm-deepseek'
```

**同时更新默认模型选择器：**
```yaml
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek  # 使用 pi-ai 的 deepseek 路由（不再是 deepseek-official）
    model: deepseek-v4-flash
```

**优势：**
- ✅ 支持 5+ 个主流模型提供商
- ✅ 可在 Web 界面自由切换模型
- ✅ 配置灵活，按需启用
- ✅ 向后兼容 DeepSeek

### ✅ 优化 2：标准化 `.env` 文件模板

**修改文件：** `dsh/.env`

**新特性：**
- ✅ 清晰的中文说明
- ✅ 多个提供商的 Key 配置位
- ✅ 格式验证指南
- ✅ 获取链接直达

### ✅ 优化 3：编写完整文档

本指南涵盖：
- ✅ 问题诊断流程
- ✅ 快速开始教程
- ✅ 多模型配置详解
- ✅ 常见问题排查

---

## 使用指南 - 快速开始

### 场景 A：首次使用（推荐 DeepSeek）

#### 步骤 1：获取 DeepSeek API Key

1. 访问 DeepSeek 开放平台：https://platform.deepseek.com/
2. 注册/登录账号
3. 进入 **API Keys** 管理页面
4. 点击 **创建 API Key**
5. 复制 Key（格式：`sk-xxxxxxxxxxxxxxxxxxxxxxxx`）

#### 步骤 2：配置 `.env` 文件

1. 打开文件：`E:\SmartBoBo\dsh\.env`
2. 找到这一行：
   ```
   DEEPSEEK_API_KEY=你的 DeepSeek API Key
   ```
3. 替换为真实 Key：
   ```
   DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
   ```

**⚠️ 注意事项：**
- Key 前后不能有空格
- 不能包含中文字符
- 不要用引号包裹
- 保存为 UTF-8 编码

#### 步骤 3：重启服务

```cmd
cd E:\SmartBoBo
启动.cmd
```

#### 步骤 4：验证配置

1. 浏览器访问：http://127.0.0.1:7070
2. 发送测试消息：`你好，请介绍一下你自己`
3. 如果智能体正常回复，说明配置成功 ✅

---

### 场景 B：已有其他模型 Key

如果你已经有 OpenAI、Claude 等模型的 Key：

#### 步骤 1：编辑 `.env`

打开 `E:\SmartBoBo\dsh\.env`，取消对应行的注释并填入 Key：

```env
# OpenAI
OPENAI_API_KEY=sk-你的 OpenAI Key

# Anthropic
ANTHROPIC_API_KEY=sk-ant-你的 Anthropic Key

# Google
GOOGLE_API_KEY=你的 Google Key

# Moonshot
MOONSHOT_API_KEY=sk-你的 Moonshot Key
```

#### 步骤 2：重启服务

```cmd
cd E:\SmartBoBo
启动.cmd
```

#### 步骤 3：在 Web 界面选择模型

1. 访问 http://127.0.0.1:7070
2. 点击 **设置** → **模型**
3. 从下拉列表中选择你想要的模型：
   - **OpenAI**: `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`
   - **Anthropic**: `claude-3-5-sonnet`, `claude-3-opus`
   - **DeepSeek**: `deepseek-v4-flash`, `deepseek-v4-pro`
   - **Google**: `gemini-1.5-pro`, `gemini-2.0-flash`
   - **Moonshot**: `moonshot-v1-8k`, `moonshot-v1-32k`

---

## 使用指南 - 多模型配置

### 模型提供商对比

| 提供商 | 代表模型 | 特点 | 适用场景 | 获取地址 |
|--------|----------|------|----------|----------|
| **DeepSeek** | V4-Flash, V4-Pro | 国产，性价比高，中文优秀 | 日常对话、文本采集 | [platform.deepseek.com](https://platform.deepseek.com/) |
| **OpenAI** | GPT-4o, GPT-4-Turbo | 全球最强，多语言 | 高质量内容生成 | [platform.openai.com](https://platform.openai.com/api-keys) |
| **Anthropic** | Claude-3.5-Sonnet | 代码能力强，长文本 | 编程辅助、文档分析 | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| **Google** | Gemini-1.5-Pro | 多模态，超长上下文 | 图像 + 文本混合任务 | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| **Moonshot** | Kimi-v1 | 国产，128K 上下文 | 长文档处理 | [platform.moonshot.cn](https://platform.moonshot.cn/) |

### 推荐配置方案

#### 方案 1：性价比之选（DeepSeek）

```env
DEEPSEEK_API_KEY=sk-xxxxxxxxx
```

**优点：**
- 💰 价格低廉（约 $0.1/百万 tokens）
- 🇳 中文支持优秀
-  响应速度快

#### 方案 2：质量之选（OpenAI + Anthropic）

```env
OPENAI_API_KEY=sk-xxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxx
```

**优点：**
-  顶级模型质量
- 💻 代码能力强大
- 🌍 多语言支持

#### 方案 3：国产全家桶

```env
DEEPSEEK_API_KEY=sk-xxxxxxxxx
MOONSHOT_API_KEY=sk-xxxxxxxxx
```

**优点：**
- 🇨🇳 完全国产化
- 📄 超长上下文支持
-  性价比高

### 切换模型的方法

#### 方法 1：Web 界面切换（推荐）

1. 访问 http://127.0.0.1:7070
2. 点击 **设置** → **模型**
3. 选择目标模型
4. 点击 **保存**

#### 方法 2：对话中指定

在对话中直接告诉智能体：

```
使用 claude-3-5-sonnet 模型帮我分析这段代码
```

或

```
切换到 gpt-4o 模型，帮我翻译这篇文章
```

---

## 常见问题排查

### 1. API Key 格式验证

**PowerShell 验证脚本：**
```powershell
function Test-ApiKey {
    param([string]$key)
    
    if ([string]::IsNullOrWhiteSpace($key)) {
        Write-Host " Key 为空" -ForegroundColor Red
        return $false
    }
    
    if ($key -match '^[\x21-\x7E]+$') {
        Write-Host "✅ Key 格式正确" -ForegroundColor Green
        return $true
    } else {
        Write-Host " Key 包含非法字符" -ForegroundColor Red
        Write-Host "   可能的问题：空格、换行、中文、引号" -ForegroundColor Yellow
        return $false
    }
}

# 使用示例
Test-ApiKey "sk-你的 Key"
```

**常见错误示例：**
```
❌ "sk-abc123"      → 有引号
❌ sk-abc123        → 前面有空格
❌ sk-abc123        → 后面有空格
❌ sk-abc 123       → 中间有空格
❌ sk-abc123 你的 Key → 有中文
❌ sk-abc123\n      → 有换行符
✅ sk-abc123xxxxxxxxxxxxxxxx → 正确
```

### 2. 重启后仍然报错

**检查清单：**

- [ ] `.env` 文件路径正确：`E:\SmartBoBo\dsh\.env`
- [ ] Key 格式正确（无空格、无中文）
- [ ] 文件编码为 UTF-8（无 BOM）
- [ ] 已完全重启服务（关闭终端重新运行）
- [ ] 浏览器已刷新（Ctrl+F5 强制刷新）

**查看日志：**
```cmd
cd E:\SmartBoBo\dsh
pnpm bobo
```

观察启动日志，确认没有以下错误：
- `MISSING_CREDENTIAL`
- `INVALID_CREDENTIAL`
- `llm-pi-ai: failed to resolve provider`

### 3. 模型列表为空

**可能原因：**
- `.env` 中没有任何 API Key 已配置
- `cordis.yml` 配置未生效
- 服务未完全重启

**解决步骤：**

1. **检查 cordis.yml**
   ```bash
   cat E:/SmartBoBo/dsh/python/sdk-runtime/src/deepseek_harness_runtime/runtime/cordis.yml
   ```
   确认包含 `llm-pi-ai` 配置

2. **检查 .env**
   ```bash
   cat E:/SmartBoBo/dsh/.env
   ```
   确认至少有一个 Key 已配置（不是注释状态）

3. **重启服务**
   ```cmd
   # 完全停止（Ctrl+C）
   cd E:\SmartBoBo
   启动.cmd
   ```

### 4. 某个模型无法使用

**排查步骤：**

1. **验证 API Key 有效性**
   
   OpenAI 示例：
   ```bash
   curl https://api.openai.com/v1/models \
     -H "Authorization: Bearer $OPENAI_API_KEY"
   ```

2. **检查模型配额**
   - 登录对应平台的管理控制台
   - 查看 API Key 的额度和使用量

3. **测试网络连接**
   ```bash
   ping api.openai.com
   ping api.anthropic.com
   ping api.deepseek.com
   ```

### 5. 查看当前配置状态

**查看已加载的提供商：**
```bash
cd E:\SmartBoBo\dsh
pnpm bobo
# 观察启动日志中的 provider 注册信息
```

**查看凭证状态：**
在 Web 界面：
1. 设置 → 模型
2. 查看各提供商的状态指示器

---

## 附录

### A. 文件修改记录

| 文件 | 修改内容 | 修改时间 | 状态 |
|------|----------|----------|------|
| `dsh/.env` | 创建标准化模板，支持多模型 | 2026-08-23 | ✅ 已完成 |
| `dsh/python/sdk-runtime/src/deepseek_harness_runtime/runtime/cordis.yml` | 升级到 llm-pi-ai 多模型适配器 | 2026-08-23 | ✅ 已完成 |
| `docs/说明文档/功能实现/10-API-Key 配置与多模型支持完整指南.md` | 编写完整操作指南 | 2026-08-23 | ✅ 已完成 |

### B. 技术参考

#### 适配器对比

| 特性 | `llm-deepseek` | `llm-pi-ai` |
|------|---------------|-------------|
| 支持的模型 | 仅 DeepSeek | 多提供商（5+） |
| 配置复杂度 | 简单 | 中等 |
| 灵活性 | 低 | 高 |
| 推荐场景 | 只用 DeepSeek | 多模型切换 |

#### 代码位置参考

- **DeepSeek 适配器**: `dsh/packages/llm/llm-deepseek/src/index.ts`
- **Pi-AI 适配器**: `dsh/packages/llm/llm-pi-ai/src/index.ts`
- **凭证本地存储**: `dsh/packages/credentials/credentials-local/src/index.ts`
- **API Key 校验**: `dsh/packages/llm/llm/src/api-key.ts`
- **主配置文件**: `dsh/python/sdk-runtime/src/deepseek_harness_runtime/runtime/cordis.yml`

#### 凭证解析流程

```
请求到达
    ↓
resolveApiKey()
    ↓
1. 检查 ctx.credentials 服务（Web 界面存储）
    ↓ (未找到)
2. 检查启动环境快照（.env 文件）
    ↓ (未找到)
3. 检查进程环境变量
    ↓ (未找到)
4. 抛出 MISSING_CREDENTIAL 错误
```

### C. 快速命令参考

```bash
# 重启服务
cd E:\SmartBoBo
启动.cmd

# 手动启动
cd E:\SmartBoBo\dsh
pnpm bobo

# 验证 .env 文件
cat E:/SmartBoBo/dsh/.env

# 验证 cordis.yml
cat E:/SmartBoBo/dsh/python/sdk-runtime/src/deepseek_harness_runtime/runtime/cordis.yml

# PowerShell 验证 Key 格式
$key = "sk-你的 Key"; $key -match '^[\x21-\x7E]+$'
```

### D. 各平台 API 文档

- **DeepSeek**: https://platform.deepseek.com/api-docs/
- **OpenAI**: https://platform.openai.com/docs/
- **Anthropic**: https://docs.anthropic.com/claude/docs
- **Google**: https://ai.google.dev/docs
- **Moonshot**: https://platform.moonshot.cn/docs/

### E. 故障排查流程图

```
开始
  ↓
检查错误类型
  ├─ MISSING_CREDENTIAL → 检查 .env 是否配置 Key
  ├─ INVALID_CREDENTIAL → 验证 Key 格式（无空格/中文）
  ├─ 模型列表为空 → 检查 cordis.yml 和 .env
  └─ 特定模型失败 → 验证该平台 API Key
  ↓
重启服务
  ↓
刷新浏览器（Ctrl+F5）
  ↓
测试对话
  ↓
成功？
  ├─ 是 → ✅ 完成
  └─ 否 → 查看日志详细错误
```

---

## 联系与支持

如有其他问题，请：
1. 首先查阅本指南的"常见问题排查"章节
2. 检查项目根目录的 `部署说明.md` 和 `启动说明.md`
3. 查看 dsh 官方文档：https://github.com/deepseek-ai/dsh

---

**文档版本：** v2.0  
**最后更新：** 2026-08-23  
**维护者：** BoBo 开发团队
