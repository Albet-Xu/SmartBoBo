# API Key 配置问题修复指南

## 问题描述

在 Web 界面"设置"→"模型"界面中输入 DeepSeek API Key 后，系统仍然无法成功调用大模型 API，报错信息如下：

```
llm-deepseek: no API key for provider route "deepseek-official"; 
store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), 
or export DEEPSEEK_API_KEY in the launching environment
```

## 问题原因

### 凭证优先级机制

dsh 的凭证系统遵循以下优先级（从高到低）：

1. **继承的进程环境** (`env`) - 只读，优先级最高
2. **`$DSH_HOME/.credentials.yaml`** - 可写（通过 Web Models 页面写入）
3. **`<cwd>/.env`** - 只读 fallback
4. **`$DSH_HOME/.env`** - 只读 fallback

### 根本原因

1. `dsh/.env` 文件**不存在**
2. `~/.dsh/.credentials.yaml` 中**没有** `DEEPSEEK_API_KEY` 条目
3. Web 界面的凭证保存功能可能因为 `DSH_HOME` 环境变量未设置而写入到错误位置

## 解决方案（已实施）

### 方案一：创建 `dsh/.env` 文件（推荐）

这是最简单且符合项目文档说明的方式。

#### 操作步骤

1. **定位文件位置**
   
   文件路径：`E:\SmartBoBo\dsh\.env`

2. **编辑文件内容**
   
   文件已创建模板，内容如下：
   
   ```env
   # DeepSeek API Key 配置文件
   # 请将下方的 你的 DeepSeek API Key 替换为真实的 Key（以 sk- 开头）
   # 示例：DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
   DEEPSEEK_API_KEY=你的 DeepSeek API Key
   ```

3. **填入真实的 API Key**
   
   - 登录 DeepSeek 开放平台：https://platform.deepseek.com/
   - 进入 API Keys 管理页面
   - 创建或复制你的 API Key（格式：`sk-xxxxxxxxxxxxxxxxxxxxxxxx`）
   - 将 `.env` 文件中的 `你的 DeepSeek API Key` 替换为真实的 Key

4. **重启服务**
   
   在项目根目录运行：
   
   ```cmd
   # Windows
   启动.cmd
   ```
   
   或：
   
   ```bash
   cd E:\SmartBoBo\dsh
   pnpm bobo
   ```

5. **验证是否生效**
   
   - 打开浏览器访问：http://127.0.0.1:7070
   - 发送测试消息：`请采集 https://example.com 这个网页`
   - 如果智能体正常回复，说明配置成功

---

## 备选方案

### 方案二：手动编辑 `.credentials.yaml`

如果方案一不可用，可尝试此方案。

#### 操作步骤

1. **找到凭证文件位置**
   
   默认位置：`C:\Users\你的用户名\.dsh\.credentials.yaml`
   
   或通过环境变量 `DSH_HOME` 指定的目录

2. **编辑文件内容**
   
   ```yaml
   OPENCODE_GO_API_KEY: sk-...（已有的内容）
   DEEPSEEK_API_KEY: sk-你的真实 API Key  # 新增这一行
   ```

3. **重启服务**（同上）

---

### 方案三：在启动环境中设置环境变量

#### Windows CMD
```cmd
set DEEPSEEK_API_KEY=sk-你的真实 API Key
cd E:\SmartBoBo\dsh
pnpm bobo
```

#### Windows PowerShell
```powershell
$env:DEEPSEEK_API_KEY="sk-你的真实 API Key"
cd E:\SmartBoBo\dsh
pnpm bobo
```

#### Linux / macOS
```bash
export DEEPSEEK_API_KEY=sk-你的真实 API Key
cd E:\SmartBoBo/dsh
pnpm bobo
```

---

## 常见问题排查

### 1. 重启后仍然报错

**检查项：**
- 确认 `.env` 文件路径正确：`E:\SmartBoBo\dsh\.env`
- 确认 Key 格式正确（以 `sk-` 开头，无多余空格）
- 确认文件编码为 UTF-8（无 BOM）

### 2. 如何验证 Key 是否有效

单独测试脚本：

```bash
cd E:\SmartBoBo
uv run python scripts/run_camoufox.py --url https://example.com --out data/test --auto-name
```

如果脚本能正常运行，说明 Python 侧配置正确。

### 3. 查看日志确认配置加载

启动后查看控制台输出，确认没有以下错误：
- `MISSING_CREDENTIAL`
- `credentials-local: reload commit failed`

---

## 文件修改记录

| 文件 | 修改内容 | 修改时间 |
|------|----------|----------|
| `dsh/.env` | 新建文件，包含 API Key 配置模板 | 2026-08-23 |

---

## 相关文档

- 《部署说明.md》- 第三节：配置 API Key
- 《启动说明.md》- 第三节：唯一要确认的事：API Key（已配置）
- `docs/说明文档/功能实现/06-大模型 API 配置说明.md`（如存在）

---

## 技术说明（供参考）

### 凭证解析流程

```
请求到达 → resolveApiKey() → 
  1. 检查 ctx.credentials 服务 → 
  2. 检查启动环境快照 → 
  3. 抛出 MISSING_CREDENTIAL 错误
```

### 代码位置

- 凭证解析：`dsh/packages/llm/llm-deepseek/src/index.ts` (第 225-246 行)
- 凭证本地存储：`dsh/packages/credentials/credentials-local/src/index.ts`
- 凭证优先级：`dsh/packages/credentials/credentials-local/README.zh.md`

---

**文档版本：** v1.0  
**最后更新：** 2026-08-23  
**适用版本：** BoBo 智能采集平台（基于 dsh）
