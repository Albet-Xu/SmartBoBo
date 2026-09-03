---
name: reverse-experience
description: 逆向经验记忆库（RAG 记忆增强）：把网页逆向的成功/失败经验按标准模板沉淀为本地 MD 日志并向量化入 Qdrant；逆向新站点前按「域名+标签+语义」检索相似历史案例，避免重复踩坑。当逆向/工作流模式需要查询历史逆向经验，或逆向任务结束时需要沉淀经验时使用。
disable-model-invocation: false
user-invocable: true
---

# reverse-experience：逆向经验记忆库（RAG）

本技能与 `reverse-memory` MCP server 配套使用。模型通过 `mcp__reverse-memory__*`
工具读写记忆库；本技能说明**何时**查、**何时**存、怎么组织内容，以及红线约束。

## 记忆库工具（模型可见名）

- `mcp__reverse-memory__search` —— 混合检索历史案例（域名精确 + 标签过滤 + 语义向量）
- `mcp__reverse-memory__save` —— 沉淀一条经验（**置信度 ≥ 1.8 才入库**；< 1.8 直接放弃）
- `mcp__reverse-memory__feedback` —— 采纳反馈：成功 +0.5 / 失败 −0.5
- `mcp__reverse-memory__stats` —— 库统计 / Qdrant 状态
- `mcp__reverse-memory__cleanup` —— 冷归档未复用旧案例（默认 dry-run）

> 注意：工作流模式挂载的是**只读**实例（服务端不注册 save/feedback/cleanup），
> 只能 search/stats，这是硬限制不是建议。

## 何时查（逆向/工作流模式通用）

1. **逆向新站点、且无法从域名直接判断套路时**：开始动手前提 `search`——
   传目标域名 + 已观察到的特征（反爬 SDK 名、签名参数名、混淆特征、412/403 现象等）。
2. **卡在某一步时**：用报错/特征词再查一次，看历史有没有同款坑。
3. search 结果 `mode=local` 表示 Qdrant 不可达、已降级为本地检索，结果仍可用但
   覆盖面较小。

**红线①：历史案例仅供启发思路，禁止照搬。** 检索结果一律当作「待验证假设」，
必须结合当前站点实测（不同站点/不同时间可能已变）。引用时说明来源，不把旧结论
当事实。

## 何时存（仅逆向模式；任务结束必做）

1. **任何逆向任务结束（成功/失败/部分成功）都要沉淀**——按 `log_template.md`
   组织内容，调用 `save`。
2. **失败日志同样要存**：`result=FAIL` 只要置信度 ≥ 1.8 照常入库，明确写出
   「试了什么无效 / 卡在哪」，这些教训对后来者价值最高。
3. **置信度如实自评（1-5，可 1 位小数）**：只跑通一次 ≤ 2.0；同一方案多次验证
   才给高分。< 1.8 的日志会被 server 直接丢弃（不留文件、不进库）。
4. **记录引用了哪条历史经验**（`used_experience_ids`），方便事后反馈打分。

**红线②：不沉淀猜测。** 只写本次实际做过、有结果的事；归因不明的失败写
「现象 + 猜测 + 已排除项」，不写确定的错误结论。

**红线③：敏感信息打码。** 日志不写真实 Cookie / Token / 密钥 / 登录态原文，
用占位符（`<cookie>` / `<sk>`）代替；签名参数写名称不写可用的真实值。

## 何时反馈（逆向模式）

引用过某条历史经验之后：**采纳且成功 → `feedback(id, "success")`；采纳后失败
→ `feedback(id, "fail")`**。让靠谱案例越用越靠前、不靠谱的慢慢下沉（跌破 1.8
自动出库）。

## 日志内容组织（要点）

见同目录 `log_template.md`。核心字段：`domain` / `result` / `confidence` /
`tags` / `anti_crawl` / `attempts`（方案+结果+原因）/ `final_solution` /
`positive_lessons` / `negative_lessons` / `tools_used` /
`used_experience_ids`。

## 反爬标签速查（tags 建议值）

`js混淆` `obfuscator.io` `控制流平坦化` `wasm加密` `签名参数` `时间戳签名`
`动态cookie` `响应加密` `cloudflare` `瑞数` `行为风控` `验证码` `TLS指纹`
`移动端` `JSVMP`

## 合规

经验仅用于合法授权的逆向与接口对接；不得沉淀用于绕过付费墙、破坏系统或非法
采集的手法细节（方案可留空，教训仍可记录）。