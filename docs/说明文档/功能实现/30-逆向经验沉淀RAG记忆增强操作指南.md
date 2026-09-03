# 30-逆向经验沉淀（RAG 记忆增强）实现与操作指南

> 本文档记录 SmartBoBo「逆向经验沉淀」功能的实现方式与运维步骤：逆向/工作流模式
> 共享一个「逆向经验记忆库」——逆向模式把网页逆向的成功/失败经验按标准模板沉淀为
> 本地 MD 日志并向量化入服务器 Qdrant；逆向新站点前按「域名 + 标签 + 语义」混合
> 检索历史案例，避免重复踩坑（RAG 记忆增强）。工作流模式**只读**访问该库。

---

## 1. 功能概述

1. 逆向模式 Agent 在逆向任务结束后（成功/失败/部分成功），按 `reverse-experience`
   技能模板自动生成经验日志，调用 `mcp__reverse-memory__save` 沉淀；
2. 日志先落本地 `bobo-data/reverse-experience/`（MD 文件，人类可读、可人工复查），
   再向量化（fastembed + bge-small-zh）存入服务器 Qdrant；
3. 逆向新站点前，Agent 调用 `mcp__reverse-memory__search` 按「域名精确 + 标签过滤 +
   语义向量」混合检索相似历史案例（含置信度、正向经验、失败教训、最终方案）；
4. 采纳过某条经验的后续结果会回写 `mcp__reverse-memory__feedback`：成功 +0.5 /
   失败 −0.5，靠谱案例越用越靠前，不靠谱的自动下沉；
5. 工作流模式挂载**只读实例**（服务端不注册写工具），批量采集遇到逆向难点时
   可检索历史经验参考，但不写入、不沉淀。

**核心规则（本功能成败关键）**：

- **置信度 < 1.8 的日志直接放弃**：不留本地文件、不入向量库（`save` 返回
  `confidence_below_threshold_discarded` 即被丢弃）；
- **检索到的历史案例仅供启发，禁止照搬**（写入 persona 与技能红线，配合
  "仅供参考、必须验证"约束）；
- **本地 MD 是事实源，Qdrant 只是索引**：Qdrant 不可达时功能自动降级（只落本地或
  只做本地检索），不阻塞逆向。

---

## 2. 功能架构

```
┌─ 逆向模式（读写实例）                    ┌─ 工作流模式（只读实例 env REVERSE_MEMORY_READONLY=1）
│  persona：逆向前 search / 结束后 save / 反馈 │  persona：仅 search / stats（无写工具）
└───────────────┬───────────────────────────└───────────────┬──────────────────────┘
                │  mcp__reverse-memory__search/save/feedback/stats/cleanup
                └───────────────┬──────────────────────────────────┘
                                │ stdio（FastMCP）
                 ┌──────────────▼────────────────┐
                 │ reverse-memory MCP server     │  scripts/reverse_memory_server.py
                 │ （核心实现 memory_store.py，    │  → 技能目录单一实现来源
                 │   复制于技能目录）                │
                 └───────┬───────────────┬───────┘
                         │               │
        ┌────────────────▼───┐   ┌───────▼─────────────────────────┐
        │ 服务器 Qdrant (Docker)│   │ bobo-data/reverse-experience/  │
        │ /home/idata/Qdrant   │   │ MD 日志 + registry.json         │
        │ DBX 面板可浏览        │   │ （事实源，gitignore）            │
        └──────────────────────┘   └────────────────────────────────┘
```

- **MCP 实例按预设声明**（不写全局 `cordis.patch.yml`）：逆向预设内为读写实例，
  工作流预设内为只读实例；同一 `serverName=reverse-memory`，每个会话只活一个实例，
  不冲突（先例：工作流预设的 `mcp-dbx`）。
- **Qdrant 连接复用 DBX 已保存的连接**：MCP server 通过 `dbx_connector.load_profiles()`
  找 `db_type == qdrant` 的连接（host/port/API Key），与 DBX 面板共用一条配置；
  也可用环境变量 `REVERSE_MEMORY_QDRANT_URL` / `REVERSE_MEMORY_QDRANT_CONN` /
  `REVERSE_MEMORY_QDRANT_API_KEY` 覆盖。

---

## 3. 服务器端部署（Qdrant Docker）

> 已部署于 `36.151.151.51`，数据卷只挂 `/home/idata/Qdrant`（按约定不触碰
> 服务器其它目录；Docker 自身数据仍在 `/var/lib/docker`）。

```bash
# 首次部署（服务器已装 docker；国内网络需走镜像站拉取，直连 Docker Hub 会超时）
docker pull dockerproxy.net/qdrant/qdrant     # 或 hub.rat.dev / docker.1ms.run
docker tag dockerproxy.net/qdrant/qdrant qdrant/qdrant

# 启动（数据只落 /home/idata/Qdrant；API Key 由部署时生成，不写入仓库）
docker run -d --name qdrant --restart unless-stopped \
  -p 6333:6333 -p 6334:6334 \
  -v /home/idata/Qdrant:/qdrant/storage \
  -e QDRANT__SERVICE__API_KEY=<部署时生成的随机密钥> \
  qdrant/qdrant

# 验证（服务器本机）
curl -s -o /dev/null -w '%{http_code}' http://localhost:6333/collections        # 预期 401（无 Key 被拒）
curl -s -o /dev/null -w '%{http_code}' -H 'api-key: <密钥>' http://localhost:6333/collections  # 预期 200
```

### API Key 与网络

- **API Key**：部署时随机生成（`openssl rand -hex 32`），只出现在部署会话与 DBX
  连接配置里，**不进 git、不进文档**。更换方式：改容器环境变量后 `docker restart qdrant`，
  并同步更新 DBX 里的 Qdrant 连接。
- **网络放行**：6333 端口对外访问由用户侧配置。实测本服务器为公有云（京东云），
  OS 层防火墙（ufw 关闭、iptables ACCEPT）不拦截、Docker 已在 0.0.0.0:6333 监听——
  **拦截点在云控制台安全组**，需在安全组入方向放行 6333 到本地来源 IP。未放行前，
  MCP/DBX 连不上公网地址，功能自动走降级模式（本地检索），不影响使用；
  联调期可通过 SSH 隧道 `127.0.0.1:6333` 访问。
  Qdrant 默认无认证，**放行后仍必须靠 API Key 保护**，不要把 6333 暴露给全网。
- **数据备份/迁移**：整个 `/home/idata/Qdrant` 目录即 Qdrant 全部数据，备份该目录即可。

---

## 4. 文件改动清单（快速定位）

| 作用 | 文件 | 类型 | 说明 |
|---|---|---|---|
| 依赖 | `BoBo/pyproject.toml` | 修改 | 新增 `fastembed>=0.4`、`qdrant-client>=1.9`（`uv sync` 安装） |
| 技能（用户级安装） | `~/.dsh/skills/reverse-experience/` | 新增 | SKILL.md + log_template.md + memory_store.py，由仓库副本安装 |
| 技能（仓库源） | `BoBo/dsh/.agents/skills/reverse-experience/` | 新增 | 同上（版本管理用，改动后需同步到用户级） |
| MCP server | `BoBo/scripts/reverse_memory_server.py` | 新增 | FastMCP 薄层，含只读模式 |
| 逆向预设 | `BoBo/dsh/apps/cli/config/agent-presets/reverse/agent.cordis.yml` | 修改 | + `mcp-reverse-memory`（读写）+ persona RAG 行为段 |
| 工作流预设 | `BoBo/dsh/apps/cli/config/agent-presets/workflow/agent.cordis.yml` | 修改 | + `mcp-reverse-memory`（只读 env）+ persona 只读段 |
| 技能库登记 | `~/.dsh/settings.yaml` | 修改 | `skill-library` 追加 `reverse-experience` |
| 数据目录 | `BoBo/bobo-data/reverse-experience/` | 新增 | MD 日志 + registry.json（已 gitignore） |

---

## 5. 各配置说明

### 5.1 MCP server（scripts/reverse_memory_server.py）

模型可见工具（`serverName=reverse-memory` → `mcp__reverse-memory__*`）：

| 工具 | 模式 | 说明 |
|---|---|---|
| `reverse_memory_search(domain, tags, features, query, top_k)` | 读写+只读 | 混合检索（域名精确 > 标签过滤 > 向量语义）；Qdrant 不可达自动降级本地（mode=local） |
| `reverse_memory_save(...)` | 仅读写 | 沉淀经验；**confidence>=1.8 才入库，<1.8 直接放弃**；同域名同特征指纹自动去重替换 |
| `reverse_memory_feedback(experience_id, outcome)` | 仅读写 | success +0.5 / fail −0.5；跌破 1.8 从 Qdrant 移除并归档本地 |
| `reverse_memory_stats()` | 读写+只读 | 库统计与 Qdrant 状态 |
| `reverse_memory_cleanup(dry_run)` | 仅读写 | 冷归档≥90 天未复用且置信度<2.5 的旧案例（默认 dry-run） |

只读模式（`REVERSE_MEMORY_READONLY=1`）：**只注册 search/stats**，其余不注册
（服务端硬限制）+ `memory_store` 内部同样拒绝写操作（双保险）。

### 5.2 核心实现（memory_store.py，技能目录单一实现来源）

- 环境变量：`REVERSE_MEMORY_READONLY`（只读）、`REVERSE_MEMORY_QDRANT_URL/CONN/API_KEY`
  （连接覆盖）、`REVERSE_MEMORY_EMBEDDING=0`（禁用向量化）；
- 常量：`CONFIDENCE_THRESHOLD=1.8`（入库门槛）、`CONFIDENCE_STEP=0.5`（反馈幅度），
  均在文件顶部可调；
- 本地 registry.json 为机器可读索引（记录含归档/待同步状态），MD 保持人类可读；
- 向量化 `BAAI/bge-small-zh-v1.5`（512 维，fastembed/ONNX），首次使用自动下载
  模型（约 100MB）：直连 huggingface 失败时（常见于国内网络）**自动回退
  hf-mirror.com 重试**，也可显式设 `HF_ENDPOINT=https://hf-mirror.com`；下载失败
  自动退化为关键词检索，不影响功能；
- 可命令行自检：`python memory_store.py stats|save|search|feedback|cleanup`。

### 5.3 技能（reverse-experience）

- `SKILL.md`：何时查/何时存/何时反馈的 SOP + 红线（仅供参考必须验证、不沉淀猜测、
  敏感信息打码）+ 反爬标签速查；
- `log_template.md`：日志字段模板（domain/result/confidence/tags/anti_crawl/attempts/
  final_solution/positive_lessons/negative_lessons/tools_used/used_experience_ids）。

### 5.4 预设 persona 要点

- **逆向模式**（读写）：①逆向前必查 `search`（域名+特征+tags），案例当待验证假设；
  ②结束时必沉淀（成功/失败都存，置信度如实自评，密钥打码）；③采纳后 `feedback`；
  ④`stats` 查状态。
- **工作流模式**（只读）：采集遇到逆向难点时可 `search` 参考；明确告知
  save/feedback/cleanup 不存在、不要尝试写入；经验沉淀只在逆向模式发生。

---

## 6. 如何生效

| 改动 | 生效方式 |
|---|---|
| 预设 `agent.cordis.yml`（MCP 实例 + persona） | 预设启动时加载，**重启** `pnpm bobo` 生效 |
| `~/.dsh/skills/reverse-experience/` 与 `settings.yaml` 登记 | 技能发现即时，无需重启 |
| `pyproject.toml` 依赖 | 已 `uv sync`，重启即具备 |
| 服务器 Qdrant | 已部署；本地连接需 DBX 新建 Qdrant 连接 + 网络放行 |

---

## 7. 使用方法

### 7.1 首次接入（一次性）

1. 在 BoBo 左侧「数据库」打开 DBX 面板 → 新建连接 → **Qdrant**：
   - 地址 `36.151.151.51`、端口 `6333`、API Key 填部署时生成的密钥（按需开 ssl）；
   - 保存后 MCP server 会自动复用该连接（`db_type == qdrant` 即命中）。
2. 重启 BoBo（`pnpm bobo`），确认设置 → Agent 预设 → 逆向/工作流模式可用。

### 7.2 逆向模式

- 正常发起逆向任务即可：Agent 会在逆向前自动检索历史经验、结束后自动沉淀；
- 沉淀结果可见于 `bobo-data/reverse-experience/<域名>/*.md` 与 DBX 面板的
  `reverse_experience` 集合（点开 payload 看案例内容）。

### 7.3 工作流模式

- 只读：批量采集遇反爬/登录态/签名时，Agent 会检索历史经验作参考；无任何写工具。

### 7.4 命令行自检（排障用）

```bash
cd BoBo
.venv/Scripts/python.exe dsh/.agents/skills/reverse-experience/memory_store.py stats
.venv/Scripts/python.exe dsh/.agents/skills/reverse-experience/memory_store.py save --domain x.com --confidence 2.5 --tags "js混淆,时间戳签名"
.venv/Scripts/python.exe dsh/.agents/skills/reverse-experience/memory_store.py search --features "obfuscator 时间戳" --top-k 5
.venv/Scripts/python.exe dsh/.agents/skills/reverse-experience/memory_store.py feedback --id <id> --outcome success
```

---

## 8. 验证方法

1. **配置语法**：两个预设 `agent.cordis.yml` 均可被加载（含 `mcp-reverse-memory` 行）。
2. **工具注册**：`python -c "import reverse_memory_server as m; ..."` 读写实例 5 工具；
   `REVERSE_MEMORY_READONLY=1` 只读实例仅 search/stats。
3. **核心逻辑**：memory_store CLI——`save` 高置信（≥1.8）→ saved=true 且生成 MD；
   `save` 低置信（<1.8）→ saved=false 直接放弃；`search` 命中；`feedback` 连续 fail
   跌破 1.8 → 归档、检索不到。
4. **端到端（BoBo 内）**：逆向模式发逆向任务 → 结束后 `stats` 看到新增；工作流模式
   检索到该经验、且工具列表无写工具。
5. **DBX 面板**：连接 Qdrant 后能看到 `reverse_experience` 集合与案例 payload。

---

## 9. 以后如何维护

- **改阈值/反馈幅度**：`memory_store.py` 顶部 `CONFIDENCE_THRESHOLD=1.8` /
  `CONFIDENCE_STEP=0.5`，改后同步到 `~/.dsh/skills/reverse-experience/`，重启 BoBo。
- **改 Agent 行为**：两个预设 `agent.cordis.yml` 的 persona 段落，改后重启。
- **改检索/沉淀逻辑**：`memory_store.py`，改后同步副本、重启。
- **清理知识库**：`mcp__reverse-memory__cleanup`（默认 dry-run），或直接维护
  `bobo-data/reverse-experience/`（删除 MD 时同步清理 registry.json 与 Qdrant 点）。
- **换服务器/网络地址**：改 DBX 的 Qdrant 连接即可（MCP server 每次启动重新读取）；
  立即生效无需重启时用 `REVERSE_MEMORY_QDRANT_URL/API_KEY` 环境变量。**换 Qdrant
  服务器后**（如整体迁移到新机），更新完 DBX 连接再调用 `mcp__reverse-memory__sync`
  （或 `python memory_store.py sync`）把本地未归档经验幂等重同步到新库，无需重新沉淀。
- **换 Qdrant 密钥**：服务器 `docker run` 容器环境变量改 `QDRANT__SERVICE__API_KEY`
  后 `docker restart qdrant`；再同步 DBX 连接里的 Key。

---

## 10. 注意事项

- **敏感信息**：API Key 与服务器口令不进 git、不进文档；日志不写真实 Cookie/Token/
  密钥原文（技能红线）。
- **路径可移植性**：两个预设里 MCP `command` 指向本机 `E:/SmartBoBo/.venv/...`；
  换机器部署时改为实际路径（参考 tool-acquisition 的 `findProjectRoot` 约定）。
- **既有问题备注**：工作流预设原有 `mcp-dbx` 行的命令路径仍是旧布局
  `E:/SmartBoBo/BoBo/...`，在本机已失效——如工作流模式连库异常，先改该行路径。
- **降级行为**：Qdrant 不可达时 save 只落本地（MD 标"待同步"）、search 走本地检索；
  复连后新沉淀自动同步，历史待同步记录不会自动补传（可手动重新 save）。
- **只读是硬约束**：工作流模式的只读由服务端不注册写工具保证，不是仅提示词约束。
- **合规**：经验仅用于合法授权的逆向与接口对接；不沉淀绕过付费墙/破坏系统的手法。