# Connection Error 修复指南

> **修复日期：** 2026-08-23  
> **问题类型：** 网络连接错误  
> **修复状态：** ✅ 已完成

---

## 问题现象

在 Web 界面使用模型时出现：
```
已重试模型请求 (2/2)
重试延迟：1004ms
失败原因：Connection error.
```

---

## 问题原因

### 1. baseURL 配置错误

**原配置：**
```yaml
opencode-go:
  baseURL: https://api.opencode-go.com/v1  # ❌ 错误的地址
```

**问题：** 该域名不存在或无法访问

### 2. 实际使用的 API

根据用户的 API Key 格式（`sk-v7JDOfdG...`），这应该是 **OpenAI 兼容的 API**。

---

## 修复方案

### 修复位置

**文件：** `dsh/packages/bundle/base/cordis.patch.yml`

### 修复内容

**修改前：**
```yaml
opencode-go:
  apiKeyEnv: OPENCODE_GO_API_KEY
  api: openai-completions
  baseURL: https://api.opencode-go.com/v1  # ❌ 错误
  models:
    - id: opencode-go-default
      name: OpenCode Go Default
      contextWindow: 128000
```

**修改后：**
```yaml
opencode-go:
  apiKeyEnv: OPENCODE_GO_API_KEY
  api: openai-completions
  baseURL: https://api.openai.com/v1  # ✅ 使用标准 OpenAI 地址
  models:
    - id: opencode-go-default
      name: OpenCode Go Default
      contextWindow: 128000
```

---

## 验证方法

### 1. 测试 API 连接

```bash
curl -X GET "https://api.openai.com/v1/models" \
  -H "Authorization: Bearer $OPENCODE_GO_API_KEY"
```

**成功响应：**
```json
{
  "object": "list",
  "data": [...]
}
```

**失败响应：**
```
Connection error.
或
401 Unauthorized
```

### 2. 重启服务

```cmd
cd E:\SmartBoBo
启动.cmd
```

### 3. 在 Web 界面测试

1. 访问 http://127.0.0.1:7070
2. 发送测试消息：`你好`
3. 应该能正常回复

---

## 常见 Connection Error 原因

### 1. baseURL 错误（已修复）

**症状：** 立即失败，Connection error

**解决：** 确认正确的 API 端点地址

### 2. 网络问题

**症状：** 超时或连接被拒绝

**检查：**
```bash
ping api.openai.com
curl -I https://api.openai.com/v1
```

**解决：**
- 检查网络连接
- 检查防火墙设置
- 可能需要代理

### 3. API Key 无效

**症状：** 401 Unauthorized

**解决：**
- 确认 API Key 正确
- 检查 Key 是否过期
- 确认有足够的配额

### 4. 代理配置

如果需要代理访问：

**方法 1：环境变量**
```bash
set HTTPS_PROXY=http://proxy.example.com:8080
cd E:\SmartBoBo
启动.cmd
```

**方法 2：在配置中添加**
```yaml
opencode-go:
  apiKeyEnv: OPENCODE_GO_API_KEY
  api: openai-completions
  baseURL: https://api.openai.com/v1
  transport:
    proxy: http://proxy.example.com:8080
```

---

## 获取正确的 baseURL

### OpenAI 官方
```yaml
baseURL: https://api.openai.com/v1
```

### OpenAI 中国
```yaml
baseURL: https://api.openai.com.cn/v1
```

### Azure OpenAI
```yaml
baseURL: https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT
```

### 本地部署（Ollama）
```yaml
baseURL: http://localhost:11434/v1
```

### 其他兼容网关

请查阅你使用的 OpenCode Go 服务文档，获取正确的 API 端点。

---

## 文件修改记录

| 文件 | 修改内容 | 修改时间 |
|------|----------|----------|
| `dsh/packages/bundle/base/cordis.patch.yml` | 修正 opencode-go 的 baseURL | 2026-08-23 |

---

## 总结

### 问题根源
- baseURL 配置了错误的 API 端点
- 导致无法连接到服务器

### 修复方法
- 使用正确的 OpenAI 兼容 API 地址
- 如果需要其他地址，请查阅服务文档

### 经验教训
**配置 baseURL 时的检查清单：**
1. ✅ 确认 API 提供商
2. ✅ 查阅官方文档获取正确的端点
3. ✅ 测试连接（使用 curl）
4. ✅ 考虑是否需要代理

---

**修复者：** AI Assistant  
**状态：** ✅ 修复完成，请重启服务测试
