# 论文写作经验日志模板（paper-experience）

> 用于「论文写作经验沉淀」。模型在 S5 评审返修后 / S6 交付前按本模板组织内容，调用
> `mcp__paper-memory-<模式键>__paper_experience_save` 时逐字段传入；memory_store 会按同样
> 结构生成可读的 MD 日志文件并向量化入 Qdrant 集合 `paper_experience`。

## 必填字段

| 字段 | 说明 |
|---|---|
| `scope` | 领域/主题键，**两级** `领域/子领域`，小写（如 `corporate-finance/policy-evaluation`、`econometrics/did`）。只做排序加权，不做硬过滤 |
| `applicable_when` | **适用条件，必填**。写清「在什么条件下这条经验成立」。没有它服务端会**直接拒绝**——防负向经验过度泛化 |
| `stage` | 挂在哪一步：`S0`–`S6` |
| `confidence` | 置信度 **1–5**（可带 1 位小数）。**只有严格大于 2.0 才入库**；≤ 2.0 直接放弃。锚点见 SKILL.md（本次试一次=2.0、反复验证或两个独立证据点=2.5、与**方法论文献**一致=3.0、**跨项目复现**=3.5–5） |
| `method_tags` | 方法标签（优先取类型包词表里的值，如 `DiD` `负权重` `PRISMA` `独立test set` `FDR` `多种子`） |
| `kind` | `method` / `data` / `tooling` / `review` / `process` |
| `result` | `SUCCESS` / `FAIL` / `PARTIAL_SUCCESS` |
| `attempts` | 尝试过的方案：`[{"method":"…","result":"success|fail","note":"原因/结果"}]` |

## 选填字段

| 字段 | 说明 |
|---|---|
| `pitfalls` | 踩到的**具体坑**（对应逆向经验的 `anti_crawl` 位置） |
| `final_recipe` | 最终可行的做法 |
| `positive_lessons` | 经验总结（正向），如「交错处理先做负权重诊断，再选估计量」 |
| `negative_lessons` | 教训总结（负向），如「不要默认 TWFE 在交错处理下可用」 |
| `tools_used` | 涉及工具（`statsmodels` / `sympy` / `matplotlib` / `pandas` 等） |
| `used_experience_ids` | 本次参考过的历史经验 id（供后续 `feedback` 打分） |
| `paper_project` | 论文项目目录名。**审计用**，也是 `confirmed_projects` 累加的依据——不填则换项目复现时无法机械计数 |
| `artifacts` | 产物定位，如 `["05-评审/review.json#I-003"]`（**只用于复核来源，不是证据**） |

## 日志文件呈现结构

```markdown
# 论文写作经验日志

- ID: …
- scope（领域/主题键）: corporate-finance/policy-evaluation
- stage: S3    kind: method
- 方法标签: DiD, 交错处理, 负权重
- 结果: FAIL
- 置信度: 3.0
- 跨项目复现数 confirmed_projects: 1
- 使用工具: statsmodels, matplotlib
- 参考过的历史经验: <id1>
- 时间: …
- 论文项目: <论文项目目录名>
- 产物定位: 05-评审/review.json#I-003

## 适用条件（applicable_when）

处理时点交错、且存在已处理单位作为后期处理组的对照时。

## 踩到的坑

- 用 TWFE 处理交错时点却不查负权重
- 只画事件研究图就下结论，不与稳健估计量对照

## 尝试过的方案

- ❌ TWFE 双向固定效应直接估计 → fail，原因：负权重导致系数符号与事件研究图矛盾
- ✅ 改用对负权重稳健的估计量复核 → success，原因：与事件研究图方向一致

## 最终做法（final_recipe）

先跑事件研究图看动态效应，再用对负权重稳健的估计量复核；两者不一致时先解释清楚再写结论。

## 经验总结（正向）
- 交错处理先做负权重诊断，再决定估计量

## 教训总结（负向）
- 不要默认 TWFE 在交错处理下可用
```

## 写作要求

- **先过迁移判据再动笔**：这条经验**换一个数据集、换一个课题之后还成立吗**？不成立就不沉淀。
  项目特定细节（"我们的 dataset_v1 有 3842 行"）收了就是噪音，还会稀释检索质量。
- **不写具体研究结论与数值**：只写方法与坑。字段命名刻意避开 `finding` / `result_value` /
  `effect_size`，别把它们塞进 `pitfalls` 或 `final_recipe`。
- **不写用户私有数据**：数据集字段值、企业名、受访者信息一律不写。
- **负向经验必须写清边界**：`applicable_when` 写具体，不要写成"一般情况下"。
  过度泛化的负向经验会变成迷信，误导后续课题。
- **失败日志同样宝贵**：`result=FAIL` 照常沉淀（置信度严格大于 2.0 即可），
  明确写出「试过的方法哪些无效、卡在哪」——`results.tsv` 里的 `crash` / `discard` 行
  是最有价值的原料之一。
- **只写实际发生的事**：不写猜测；归因不明的写「现象 + 已排除项」，不写确定结论。
- **换了论文项目又验证一次同一件事，就如实再存一次**——同指纹会走「强化」，
  自动累加 `confirmed_projects` 并把置信度提升 0.5，不会被当成重复条目。
