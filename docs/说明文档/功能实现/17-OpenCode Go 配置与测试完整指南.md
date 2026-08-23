# OpenCode Go 配置与测试完整指南

> **实施日期：** 2026-08-23  
> **API Key：** 已配置（sk-ifD4gxWGEkTkCijgD797MLAuAUQfIkH5xCL8HWPEDGCYTKbu4STo7Z1GbVi1Te3M）  
> **状态：** ✅ 已配置完成

---

## 一、已完成的配置

### 1. API Key 已存储

**文件：** `~/.dsh/.credentials.yaml`

**内容：**
```yaml
OPENCODE_GO_API_KEY: sk-ifD4gxWGEkTkCijgD797MLAuAUQfIkH5xCL8HWPEDGCYTKbu4STo7Z1GbVi1Te3M
```

### 2. Base 配置已简化

**文件：** `dsh/packages/bundle/base/cordis.patch.yml`

**配置：**
```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      # OpenCode Go（示例配置 - 用户可通过 Web 界面修改/删除/添加）
      opencode-go:
        apiKeyEnv: OPENCODE_GO_API_KEY
        api: openai-completions
        baseURL: https://api.openai.com/v1
        models:
          - id: opencode-go-default
            name: OpenCode Go Default
            contextWindow: 128000
```

### 3. Settings 已配置

**文件：** `~/.dsh/settings.yaml`

**内容：**
```yaml
llm-pi-ai:
  providers:
    opencode-go:
      apiKeyEnv: OPENCODE_GO_API_KEY
agent-default-model:
  provider: opencode-go
  model: opencode-go-default
```

---

## 二、测试步骤

### 1. 重启服务

```cmd
cd E:\SmartBoBo
启动.cmd
```

### 2. 观察启动日志

**成功标志：**
```
✅ llm-pi-ai: registered provider routes: opencode-go
```

### 3. 在 Web 界面测试

1. 访问 http://127.0.0.1:7070
2. 发送测试消息：`你好，请介绍一下你自己`
3. 如果能正常回复，说明配置成功 ✅

### 4. 测试采集功能

发送：
```
请帮我采集这个网站，https://www.douban.com/group/explore
```

**预期结果：**
- 智能体调用 `crawl_fetch` 工具
- 使用 opencode-go 模型生成回复
- 返回采集结果

---

## 三、Web 界面配置功能

### 当前状态

打开"设置"→"模型"，你应该看到：

```
模型
├─ opencode-go ● [编辑] [删除]
│  └─ API 密钥：已配置
└─ [+ 添加提供方]
```

### 如何添加新提供方

#### 方法 1：添加预定义提供方

1. 点击"+ 添加提供方"
2. 选择提供商（如 DeepSeek、OpenAI 等）
3. 填入 API Key
4. 点击"保存"

#### 方法 2：添加自定义提供方

1. 点击"+ 添加自定义提供方"
2. 填写：
   - **提供方名称**：如 `my-provider`
   - **API 密钥**：你的 Key
   - **API 协议**：选择 `openai-completions`
   - **Base URL**：如 `https://api.example.com/v1`
   - **模型列表**：添加至少一个模型
3. 点击"保存"

### 如何修改 API Key

1. 点击提供方右侧的"编辑"
2. 在"API 密钥"框中输入新 Key
3. 点击"保存"

### 如何删除提供方

1. 点击提供方右侧的"删除"（红色按钮）
2. 确认删除
3. 该提供方会从列表中移除

---

## 四、配置说明

### 配置存储位置

| 配置类型 | 存储位置 | 修改方式 |
|---------|---------|---------|
| **API Key** | `~/.dsh/.credentials.yaml` | Web 界面自动写入 |
| **提供方配置** | `~/.dsh/settings.yaml` | Web 界面自动写入 |
| **Base 配置** | `dsh/packages/bundle/base/cordis.patch.yml` | 手动编辑（初始化用） |

### 配置优先级

```
Web 界面配置（settings.yaml）
    ↓ 覆盖
Base 配置（bundle/base/cordis.patch.yml）
    ↓ 合并
最终配置（运行时）
```

**重要：** Web 界面的配置优先级更高，所以你在界面中添加/修改/删除提供方会立即生效。

---

## 五、故障排查

### 1. 启动失败

**错误：** `plugin tree failed to load`

**原因：** 配置格式错误

**解决：**
```bash
# 检查配置文件
cat ~/.dsh/settings.yaml
cat ~/.dsh/.credentials.yaml

# 如果有语法错误，删除或修复后重启
```

### 2. Connection Error

**错误：** `Connection error`

**可能原因：**
- API Key 无效
- baseURL 错误
- 网络问题

**解决：**
```bash
# 测试 API 连接
curl -X GET "https://api.openai.com/v1/models" \
  -H "Authorization: Bearer sk-ifD4gxWGEkTkCijgD797MLAuAUQfIkH5xCL8HWPEDGCYTKbu4STo7Z1GbVi1Te3M"
```

### 3. 模型列表为空

**原因：** 提供方未正确配置

**解决：**
1. 在 Web 界面点击"编辑"
2. 确认已配置模型列表
3. 至少需要一个模型

---

## 六、常用配置示例

### OpenAI

```yaml
openai:
  apiKeyEnv: OPENAI_API_KEY
  api: openai-completions
  baseURL: https://api.openai.com/v1
  models:
    - id: gpt-4o
      name: GPT-4o
      contextWindow: 128000
    - id: gpt-4-turbo
      name: GPT-4 Turbo
      contextWindow: 128000
```

### DeepSeek

```yaml
deepseek:
  apiKeyEnv: DEEPSEEK_API_KEY
  api: openai-completions
  baseURL: https://api.deepseek.com/v1
  models:
    - id: deepseek-v4-flash
      name: DeepSeek V4 Flash
      contextWindow: 1000000
```

### Moonshot（Kimi）

```yaml
moonshot:
  apiKeyEnv: MOONSHOT_API_KEY
  api: openai-completions
  baseURL: https://api.moonshot.cn/v1
  models:
    - id: moonshot-v1-8k
      name: Moonshot v1 8K
      contextWindow: 8000
    - id: moonshot-v1-32k
      name: Moonshot v1 32K
      contextWindow: 32000
```

### 自定义提供方

```yaml
my-custom-provider:
  apiKeyEnv: MY_CUSTOM_API_KEY
  api: openai-completions
  baseURL: https://api.mycompany.com/v1
  models:
    - id: custom-model
      name: Custom Model
      contextWindow: 100000
```

---

## 七、安全提示

### API Key 安全

1. **不要分享**你的 API Key
2. **不要提交**到版本控制系统
3. **定期检查**使用量和配额
4. **如已泄露**，立即在平台重新生成

### 文件权限

```bash
# Windows：右键文件 → 属性 → 安全
# 确保只有你的用户账户有读写权限

# Linux/macOS：
chmod 600 ~/.dsh/.credentials.yaml
chmod 600 ~/.dsh/settings.yaml
```

---

## 八、文件清单

| 文件 | 作用 | 状态 |
|------|------|------|
| `~/.dsh/.credentials.yaml` | 存储 API Key | ✅ 已配置 |
| `~/.dsh/settings.yaml` | 存储提供方配置 | ✅ 已配置 |
| `dsh/packages/bundle/base/cordis.patch.yml` | Base 配置 | ✅ 已简化 |
| `docs/说明文档/功能实现/17-OpenCode Go 配置与测试完整指南.md` | 本文档 | ✅ 已创建 |

---

## 九、总结

### 已完成

✅ API Key 已配置  
✅ Base 配置已简化（只保留 opencode-go）  
✅ Settings 已配置  
✅ 可以在 Web 界面自由添加/修改/删除提供方  

### 下一步

1. **重启服务**
   ```cmd
   cd E:\SmartBoBo
   启动.cmd
   ```

2. **测试功能**
   - 访问 http://127.0.0.1:7070
   - 发送测试消息
   - 测试采集功能

3. **添加其他提供方**（可选）
   - 在 Web 界面点击"+ 添加提供方"
   - 选择提供商并填入 API Key
   - 点击"保存"

---

**实施者：** AI Assistant  
**状态：** ✅ 配置完成，待用户测试验证  
**文档版本：** v1.0  
**最后更新：** 2026-08-23
