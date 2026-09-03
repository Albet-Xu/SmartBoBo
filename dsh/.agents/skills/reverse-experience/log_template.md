# 逆向任务日志模板（reverse-experience）

> 用于「逆向经验沉淀」。模型在逆向任务结束时按本模板组织内容，调用
> `mcp__reverse-memory__save` 时逐字段传入；memory_store 会按同样的结构
> 生成可读的 MD 日志文件并向量化入库。

## 必填字段

| 字段 | 说明 |
|---|---|
| `domain` | 目标域名（如 `example.com`），必填 |
| `result` | `SUCCESS` / `FAIL` / `PARTIAL_SUCCESS` |
| `confidence` | 置信度 **1-5**（连续值，可带 1 位小数）。**< 1.8 不入库（直接放弃）**；≥ 1.8 才沉淀 |
| `tags` | 任务标签（反爬/技术类型），如 `js混淆` `obfuscator.io` `wasm加密` `签名参数` `动态cookie` `cloudflare` `行为风控` `验证码` `响应加密` |
| `anti_crawl` | 识别到的具体反爬手段（可多条） |
| `attempts` | 尝试过的方案：`[{"method": "方案A：…", "result": "success|fail", "note": "原因/结果"}]` |

## 选填字段

| 字段 | 说明 |
|---|---|
| `url` / `title` | 目标网址 / 任务标题 |
| `final_solution` | 最终可行方案（有则写） |
| `positive_lessons` | 经验总结（正向），如「碰到 x 特征优先做 AST 去混淆」 |
| `negative_lessons` | 教训总结（负向），如「不要只改 UA，必须同步处理 TLS 指纹」 |
| `tools_used` | 使用过的工具（js-reverse / camoufox / scrapling / AST / Frida 等） |
| `used_experience_ids` | 本次参考过的历史经验 id 列表（供后续反馈打分） |

## 日志文件呈现结构

```markdown
# 逆向任务日志
- ID: …
- 域名: …
- 目标URL: …
- 时间: …
- 结果: SUCCESS / FAIL / PARTIAL_SUCCESS
- 置信度: 2.5 (1-5，入库门槛 1.8)
- 使用工具: …
- 任务标签: js混淆, 时间戳签名
- 识别到的反爬手段:
  1. 时间戳签名 sign
  2. JS 控制 cookie __sec
- 参考的历史经验: <id1>, <id2>

## 尝试过的方案
- ✅ 方案A：xxx → success，原因：…
- ❌ 方案B：直接替换 UA → fail，原因：校验 TLS 指纹

## 最终可行方案
……

## 经验总结（正向）
- 碰到 xxx 特征优先做 AST 去混淆

## 教训总结（负向）
- 不要只改 UA，必须同步处理 TLS 指纹
```

## 写作要求

- 方案描述写清「做了什么 / 结果 / 为什么」，能让人理解因果，不要只写结论。
- 失败日志同样宝贵：`result=FAIL` 的日志照常沉淀（置信度 ≥ 1.8 即可），
  明确写出「试过的方法哪些无效、卡在哪」。
- 敏感信息打码：不写入真实 Cookie / Token / 密钥原文，用 `<cookie>`、`<sk>` 等占位。
- 只写本次任务实际发生的事，不写猜测；置信度如实自评（只跑通一次给 ≤ 2.0，
  同一方案多次验证才给高分）。