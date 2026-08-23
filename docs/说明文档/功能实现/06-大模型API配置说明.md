# 大模型 API 配置说明文档

## 1. 问题背景

用户在前端设置界面填写大模型 API Key 后，无法正常调用大模型。经过排查，发现 API Key 已正确保存到 `~/.dsh/.credentials.yaml` 文件中，但可能存在以下问题：

1. `~/.dsh` 目录不存在或权限不正确
2. dsh 启动时没有正确加载 credentials 服务
3. 首次部署时缺少必要的配置步骤

## 2. API Key 存储机制

### 2.1 存储位置

API Key 保存在以下位置（按优先级排序）：

1. **环境变量**（最高优先级）：`DEEPSEEK_API_KEY`
2. **凭证文件**：`~/.dsh/.credentials.yaml`
3. **项目 .env 文件**：`<项目目录>/.env`
4. **用户 .env 文件**：`~/.dsh/.env`

### 2.2 凭证文件格式

`~/.dsh/.credentials.yaml` 文件格式：

```yaml
DEEPSEEK_API_KEY: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 2.3 权限要求

- `~/.dsh` 目录：`0700`（仅所有者可访问）
- `~/.dsh/.credentials.yaml` 文件：`0600`（仅所有者可读写）

## 3. 首次部署步骤

### 3.1 确保目录存在

在 Windows 系统上：

```powershell
# 创建 ~/.dsh 目录（如果不存在）
mkdir -Force "$env:USERPROFILE\.dsh"

# 设置目录权限（仅所有者可访问）
icacls "$env:USERPROFILE\.dsh" /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F"
```

在 Linux/Mac 系统上：

```bash
# 创建 ~/.dsh 目录（如果不存在）
mkdir -p ~/.dsh

# 设置目录权限
chmod 700 ~/.dsh
```

### 3.2 配置 API Key

#### 方法一：通过前端设置界面（推荐）

1. 启动 dsh 服务：`pnpm bobo`
2. 打开网页端：`http://127.0.0.1:7070`
3. 点击右上角设置图标
4. 选择"模型"选项卡
5. 找到 DeepSeek 提供商，点击"编辑"
6. 在 API Key 输入框填写你的 API Key
7. 点击"保存"

#### 方法二：通过 .env 文件

1. 在项目根目录创建 `.env` 文件：

```bash
cd E:/SmartBoBo/BoBo/dsh
cp .env.example .env
```

2. 编辑 `.env` 文件，填写 API Key：

```env
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

#### 方法三：通过环境变量

在启动 dsh 前设置环境变量：

```bash
# Windows PowerShell
$env:DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Windows CMD
set DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Linux/Mac
export DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 3.3 验证配置

1. 检查凭证文件是否存在：

```bash
# Windows
type %USERPROFILE%\.dsh\.credentials.yaml

# Linux/Mac
cat ~/.dsh/.credentials.yaml
```

2. 应该看到类似内容：

```yaml
DEEPSEEK_API_KEY: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

3. 测试 API 连接：

在网页端对话框中输入一条消息，观察是否能正常响应。

## 4. 常见问题排查

### 4.1 API Key 保存失败

**症状**：前端设置界面保存后，凭证文件没有更新

**排查步骤**：

1. 检查 `~/.dsh` 目录是否存在
2. 检查目录权限是否正确
3. 查看 dsh 启动日志，是否有错误信息

**解决方案**：

```bash
# Windows
icacls "$env:USERPROFILE\.dsh" /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F"
icacls "$env:USERPROFILE\.dsh\.credentials.yaml" /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F"

# Linux/Mac
chmod 700 ~/.dsh
chmod 600 ~/.dsh/.credentials.yaml
```

### 4.2 API 调用失败

**症状**：API Key 已保存，但对话时提示 "no API key" 或类似错误

**排查步骤**：

1. 检查 API Key 是否正确（无多余空格或换行）
2. 检查 API Key 是否有效（在 DeepSeek 官网验证）
3. 检查网络连接是否正常

**解决方案**：

1. 重新填写 API Key，确保无多余空格
2. 在 DeepSeek 官网验证 API Key 有效性
3. 检查网络代理设置

### 4.3 首次启动弹窗问题

**症状**：首次启动时弹出 DeepSeek API 填写弹窗

**解决方案**：

我们已经禁用了首次启动弹窗。如果仍然出现，请：

1. 清除浏览器缓存
2. 重启 dsh 服务
3. 重新访问网页端

## 5. 配置文件说明

### 5.1 项目配置文件

**位置**：`E:/SmartBoBo/BoBo/dsh/.env.example`

**内容**：

```env
# dsh 环境变量模板。复制为 .env 后填写真实值：
DEEPSEEK_API_KEY=你的DeepSeekKey
```

### 5.2 凭证文件

**位置**：`~/.dsh/.credentials.yaml`

**格式**：

```yaml
DEEPSEEK_API_KEY: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 5.3 设置文件

**位置**：`~/.dsh/settings.yaml`

**内容**：

```yaml
# 模型配置
llm-deepseek:
  # 可选：自定义 API 端点
  # baseURL: https://api.deepseek.com

  # 可选：启用/禁用思考模式
  # thinking: enabled

  # 可选：推理努力程度
  # reasoningEffort: high
```

## 6. 部署到其他电脑

### 6.1 完整部署步骤

1. **复制项目文件**：

```bash
# 复制整个项目目录
xcopy E:\SmartBoBo "D:\目标路径\SmartBoBo" /E /I /H
```

2. **安装依赖**：

```bash
cd D:\目标路径\SmartBoBo\BoBo
uv sync
```

3. **安装 Node.js 依赖**：

```bash
cd D:\目标路径\SmartBoBo\BoBo\dsh
pnpm install
```

4. **构建前端**：

```bash
pnpm run build:lib:host
```

5. **配置 API Key**（选择一种方法）：

```bash
# 方法一：创建 .env 文件
copy .env.example .env
# 编辑 .env 文件，填写 API Key

# 方法二：设置环境变量
set DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

6. **启动服务**：

```bash
pnpm bobo
```

### 6.2 自动化部署脚本

创建 `deploy.bat` 脚本（Windows）：

```batch
@echo off
echo 正在部署 SmartBoBo 项目...

REM 1. 创建 ~/.dsh 目录
if not exist "%USERPROFILE%\.dsh" mkdir "%USERPROFILE%\.dsh"

REM 2. 安装 Python 依赖
cd /d "%~dp0BoBo"
call uv sync

REM 3. 安装 Node.js 依赖
cd /d "%~dp0dsh"
call pnpm install

REM 4. 构建前端
call pnpm run build:lib:host

REM 5. 提示用户配置 API Key
echo.
echo 请配置 DeepSeek API Key：
echo 1. 编辑 %~dp0dsh\.env 文件
echo 2. 或设置环境变量：set DEEPSEEK_API_KEY=your_key
echo.
echo 配置完成后，运行：pnpm bobo
pause
```

## 7. 相关文件

- `BoBo/dsh/.env.example` - 环境变量模板
- `~/.dsh/.credentials.yaml` - API Key 凭证文件
- `~/.dsh/settings.yaml` - 模型配置文件
- `BoBo/dsh/packages/credentials/credentials-local/` - 凭证服务实现
- `BoBo/dsh/packages/llm/llm-deepseek/` - DeepSeek 适配器实现

## 8. 技术细节

### 8.1 凭证解析流程

1. dsh 启动时加载 `LaunchEnvironmentSnapshot`
2. DeepSeek 适配器通过 `ctx.credentials.resolve('DEEPSEEK_API_KEY')` 获取 API Key
3. 凭证服务按优先级查找：环境变量 → 凭证文件 → .env 文件
4. 找到后返回给适配器用于 API 调用

### 8.2 前端保存流程

1. 用户在设置界面填写 API Key
2. 前端调用 `api.credentials.set({ ref: 'DEEPSEEK_API_KEY', value: 'sk-xxx' })`
3. 后端将 API Key 保存到 `~/.dsh/.credentials.yaml`
4. 下次 API 调用时自动读取最新配置

## 9. 后续优化建议

### 9.1 配置向导

可以添加一个配置向导，引导用户完成首次配置：

1. 检查 `~/.dsh` 目录是否存在
2. 检查 API Key 是否已配置
3. 如果未配置，提示用户填写

### 9.2 自动检测

可以在启动时自动检测配置完整性：

1. 检查凭证文件权限
2. 验证 API Key 格式
3. 测试 API 连接

### 9.3 配置导入/导出

支持配置的导入和导出，方便迁移：

```bash
# 导出配置
dsh config export --output config.json

# 导入配置
dsh config import --input config.json
```