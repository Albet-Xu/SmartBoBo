# -*- coding: utf-8 -*-
"""report_experience 种子数据导入脚本（一次性 / 可重跑）。

背景
----
文献汇报 PPT 有了一套完整的**方法论**（叙事层 / 生成层 / 评审层三个类型包 + 机械质检 +
交付闸门），但「汇报经验库」`report_experience` 是**空的**：仓库里还没有跑完一整轮
R0–R6 的真实汇报项目，因此没有任何真实沉淀。空库的后果很具体——R0 定盘后第一次检索
（叙事骨架）、R3 页策划前第二次检索（版式与视觉）、R5 评分返修后第三次检索（常见扣分点）
**全部查不到东西**，经验层在流程里等于不存在。

本脚本的作用是**把三个类型包里已有的可迁移方法论做成种子**，让库先可用起来。

诚实标注（重要）
----------------
- `confidence = 3.0`：对应 `report-experience` 技能里的锚点
  「与**公开的演示设计规范**一致」——即"这条能指向具体的排版/可读性/流程准则，
  不是自己的单个观察"。**不是**「跨汇报复现过」（那要 ≥3.5 且 `confirmed_projects > 0`）。
- `confirmed_projects = 0`：这些经验在本仓库里**从未在真实汇报项目中复现过**。
- `provenance.seed = True` 且 `report_project = None`：明确标记为「技能种子」，
  便于日后审计时与真实沉淀区分开（`stats` 的 `seed_count` / `earned_count` 就是按它分的）。
- **没有伪造任何汇报项目名、产物路径、页码或分数**。每条的 `provenance.artifacts`
  指向它被提炼出来的那份规范原文，可逐条回查。

内容边界
--------
只收录**换几篇论文、换一个汇报场合之后仍然成立**的方法论（技能里的迁移判据），
不含任何论文结论、具体页数页码、具体分数或用户数据（技能红线 2/3/6）。
"本次汇报第 7 页有 380 字"这类项目特定内容一律不收——`report_qa.py` 已经机械判它了，
不需要经验层再记一遍。

种子从哪里提炼（全部已逐条读过）
--------------------------------
- `dsh/packages/bobo/presets/report/skills/report-narrative/SKILL.md` —— 五类汇报的页序模板、
  内容取舍、对比矩阵与共同结论/分歧点、时间分配、叙事层失败模式
- `dsh/packages/bobo/presets/report/skills/report-slides/SKILL.md` —— deck plan 字段契约、
  `role` 与结构元素的绑定、中英文字符预算、字体配色、机械规则与逐条修复动作、渲染与指纹
- `dsh/packages/bobo/presets/report/skills/report-review/SKILL.md` —— 独立评分者协议、
  rubric 与权重、四个评审文件的字段契约、返修闭环与停止条件、六种评审反模式
- `scripts/report_qa.py` —— 机械规则与字符预算的权威实现（BUDGET / check_plan /
  check_pptx / check_pixels）
- `scripts/report_pptx.py` —— deck plan 字段与版式行为的权威实现（THEMES / _set_font /
  _fit_size / 设计原则）
- `dsh/.agents/skills/report-experience/SKILL.md` —— 标签词表、置信度锚点、六条红线、
  三个检索点与两个沉淀点
- `dsh/packages/bobo/plugins/report-gate.mjs` —— 闸门判据（阶段完成、手写机器产物、
  评分者身份、指纹一致、未了结 high、轮数上限）

指纹只有一份实现
----------------
`feature_hash` **由 `report-experience/memory_store.py` 的 `ReportPPTAdapter` 计算，本脚本
import 它**，不自己再实现一遍。论文池的种子脚本自己算了一份、归一化口径与运行期不一致，
导致同一条经验永远走不到「强化」分支——这个坑不重复。

幂等性
------
重跑本脚本**不产生重复条目**，也不会让 `confidence` 漂移：同指纹的种子会**复用已有条目的
id**，走 `store.save()` 的"同 id 原地更新"分支，而不是 `merge_duplicate()`
（后者每合并一次 `confidence = max(旧,新) + 0.5`；种子连跑两次就会变成 3.5，
读起来像"跨汇报复现过"——那是虚假的机械事实）。种子之间指纹重复时打印
「指纹重复，跳过」并丢弃后者。

用法
----
    export DSH_HOME=<BoBo根>/bobo-data/dsh
    export BOBO_ROOT=<BoBo根>

    # 只看会写入多少条与分布，不落盘、不连 Qdrant
    .venv/Scripts/python.exe bobo-data/report-experience/seed_report_experience.py --dry-run

    # 正式写入（Qdrant 端点从 REPORT_MEMORY_QDRANT_URL 或 DBX 的 qdrant 连接解析）
    .venv/Scripts/python.exe bobo-data/report-experience/seed_report_experience.py

    # 显式只写本地（向量检索不可用，会响亮说明；不是静默降级）
    .venv/Scripts/python.exe bobo-data/report-experience/seed_report_experience.py --local-only
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "bobo-data" / "report-experience"
COLLECTION = "report_experience"

#: 与 `report-experience/SKILL.md` 的置信度锚点一致：3.0 = 与公开的演示设计规范一致。
CONFIDENCE = 3.0
CONFIDENCE_THRESHOLD = 2.0

#: 技能目录的两处落点：分发态（dsh/.agents/skills）与项目内副本（bobo-data/dsh/skills）。
_SKILL_CANDIDATES = (
    ROOT / "dsh" / ".agents" / "skills" / "report-experience",
    ROOT / "bobo-data" / "dsh" / "skills" / "report-experience",
)
for _cand in _SKILL_CANDIDATES:
    if (_cand / "memory_store.py").is_file():
        sys.path.insert(0, str(_cand))
        break
else:
    raise SystemExit(
        "找不到 report-experience/memory_store.py（字段语义层与指纹的唯一实现）。已尝试：\n  "
        + "\n  ".join(str(c) for c in _SKILL_CANDIDATES))

import memory_store as ms  # noqa: E402

# ---------------------------------------------------------------------------
# 种子条目
#
# 字段语义见 `report-experience/memory_store.py`：
#   report_type 五类硬过滤 / stage R0–R6 / kind 六类 / tags 写**现象**不写结论
#   applicable_when 必填（空值 adapter 直接 ValueError）/ confidence 必须严格大于 2.0
#   provenance.artifacts 记来源，provenance.seed=True 标记"不是 earned 经验"
# ---------------------------------------------------------------------------

_N = "dsh/packages/bobo/presets/report/skills/report-narrative/SKILL.md"
_S = "dsh/packages/bobo/presets/report/skills/report-slides/SKILL.md"
_R = "dsh/packages/bobo/presets/report/skills/report-review/SKILL.md"
_QA = "scripts/report_qa.py"
_PPTX = "scripts/report_pptx.py"
_EXP = "dsh/.agents/skills/report-experience/SKILL.md"
_GATE = "dsh/packages/bobo/plugins/report-gate.mjs"

_SEED_NOTE = "技能种子：非真实汇报项目 earned 经验，confirmed_projects 恒为 0"

SEEDS: list[dict] = [
    # ══ R2 叙事组织 · 五类汇报各自的叙事要点 ══════════════════════════════
    dict(
        report_type="multi", stage="R2", kind="narrative",
        result="FAIL", confidence=CONFIDENCE,
        tags=["逐篇罗列", "对比矩阵", "主线不清"],
        page_roles=["compare", "result", "takeaway"],
        applicable_when="一次汇报要讲两篇以上论文、且这些论文能被放在同一组问题下比较时（R2 排页序）",
        pitfalls=[
            "页序按论文切：第 1 篇 XX 的研究、第 2 篇 YY 的研究，每页结构完全相同",
            "对比矩阵页放在结果页之后，听众先看零散结果、后面才补上对照框架",
        ],
        attempts=[
            dict(method="按论文逐篇排页序（背景→方法→结果→结论，重复三遍）", result="fail",
                 note="听完只记得'有三篇论文'，说不出它们合起来回答了什么问题"),
            dict(method="改按问题/维度切页，论文降为页内证据；对比矩阵提前到结果页之前", result="success",
                 note="先用矩阵建立可比框架再看结果，听众记住的是维度与判断"),
        ],
        final_recipe="多篇汇报的页序按问题/维度切，不按论文切；对比矩阵页（role=compare）放在结果页之前，"
                     "先给对照框架再看结果；同一维度下并列各篇怎么说，而不是逐篇复述",
        positive_lessons=["页序按论文切是逐篇罗列的根因——改页序比改文案有效得多"],
        negative_lessons=["不要把'每篇都讲到'当成汇报完整"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_N} §1.2 / §3.4 / §7 逐篇罗列"]),
    ),
    dict(
        report_type="multi", stage="R2", kind="narrative",
        result="FAIL", confidence=CONFIDENCE,
        tags=["共同结论", "分歧点", "结论前置"],
        page_roles=["takeaway"],
        applicable_when="多篇论文结论方向不一致、且要求在 20 分钟内讲完时（takeaway 页一定会被现场追问）",
        pitfalls=[
            "只写共同结论不写分歧，等于把最值得讨论的部分藏掉",
            "分歧只写'结论不一致'，不指出分歧发生在哪一层",
            "几篇结论明显不同还硬凑一条共同结论",
        ],
        attempts=[
            dict(method="takeaway 只罗列共同结论", result="fail",
                 note="现场第一个问题就是'那它们到底哪里不一样'，答不上来"),
            dict(method="共同结论与分歧点并列；分歧按测量口径 / 样本与情境 / 方法前提 / 外推范围分层写明",
                 result="success", note="分歧从被追问的漏洞变成讨论的入口"),
        ],
        final_recipe="takeaway 页同时承载共同结论（2–4 条，注明哪几篇支持）与分歧点；分歧必须指到具体层"
                     "（测量口径 / 样本与情境 / 方法前提 / 外推范围）；确实没有共同结论就如实写"
                     "「目前无一致结论，分歧在 X」，硬凑一条会被现场追问，比承认没有更糟",
        positive_lessons=["矛盾与分歧比一致更有信息量，是汇报里最值钱的部分"],
        negative_lessons=["不要为了叙事顺畅只报一致结论的方向"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_N} §3.3 / §7 共同结论硬凑", f"{_GATE} multi_no_takeaway"]),
    ),
    dict(
        report_type="survey", stage="R2", kind="narrative",
        result="FAIL", confidence=CONFIDENCE,
        tags=["缺少对比", "章节失衡"],
        page_roles=["outline", "compare", "takeaway"],
        applicable_when="综述式串讲多篇文献、听众需要看清这一片文献的脉络与缺口时",
        pitfalls=[
            "按年份或作者顺序串讲，听众听到的是一份带日期的清单",
            "只讲每篇做了什么，不说清支与支之间的关系",
        ],
        attempts=[
            dict(method="按发表年份从早到晚依次串讲", result="fail",
                 note="像朗读文献清单，说不清这一片文献分成哪几支"),
            dict(method="先立分类脉络（分几支、支间什么关系），compare 用两页：一页横向对照表、一页按维度汇总",
                 result="success", note="听众能复述出脉络与缺口，不再只记得一串年份"),
        ],
        final_recipe="综述串讲先立分类脉络（分几支、支与支的关系），再按脉络展开——体现不出分类就还是罗列；"
                     "compare 页建议 ≥2 页（一页横向对照、一页按维度汇总）；takeaway 写"
                     "「这一片文献合起来说明了什么、还缺什么」",
        negative_lessons=["按年份/作者罗列不是综述，是清单"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_N} §1.5 / §2"]),
    ),
    dict(
        report_type="single", stage="R2", kind="narrative",
        result="FAIL", confidence=CONFIDENCE,
        tags=["缺少启发", "复述摘要"],
        page_roles=["takeaway", "result"],
        applicable_when="精读单篇论文、听众是与自己同一课题组的成员时",
        pitfalls=[
            "takeaway 是论文结论章的复述，没有落到本组",
            "启发写成'该方法值得借鉴''需要进一步研究'这类空话",
            "每页 bullets 是论文摘要的翻译",
        ],
        attempts=[
            dict(method="把 takeaway 写成论文结论的提炼", result="fail",
                 note="听众问'那我们能用什么'时无话可说"),
            dict(method="takeaway 落成具体可迁移点：哪份数据能用、哪个方法能改、哪个假设被推翻",
                 result="success", note="汇报有了本组价值，讨论能接着往下走"),
        ],
        final_recipe="单篇精读的 takeaway 必须给出「对我们（本组课题 / 数据 / 方法）的启发」，"
                     "落成具体可迁移点；每页先写本页主张（claims）再找支撑，支撑不上的句子删掉——"
                     "先写主张再找证据，才不会退化成摘要复述",
        positive_lessons=["启发要具体到本组的某份数据或某个假设，形容词没有用"],
        negative_lessons=["不要用'值得借鉴'代替可迁移点"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_N} §1.1 / §7 摘要复述·启发空转"]),
    ),
    dict(
        report_type="seminar", stage="R2", kind="narrative",
        result="FAIL", confidence=CONFIDENCE,
        tags=["背景过长", "缺少启发"],
        page_roles=["background", "takeaway"],
        applicable_when="组会汇报（进展或文献分享）、听众已经熟悉本领域基本情况时",
        pitfalls=[
            "background 从论文摘要起笔，讲了三页领域综述",
            "takeaway 写'值得深入研究'，没有下一步动作",
        ],
        attempts=[
            dict(method="background 按论文引言的顺序讲领域背景", result="fail",
                 note="组会听众早就知道这个领域，占掉的时间让结果页只剩一页"),
            dict(method="background 从本组上一轮的结论或卡点起笔，只负责把问题逼出来", result="success",
                 note="背景一页讲完，时间留给结果与讨论，落点是下一步动作"),
        ],
        final_recipe="组会汇报的 background 从本组上一轮的结论或卡点起笔，不从论文摘要起笔，"
                     "只负责把问题逼出来（超过一页就是没做取舍）；takeaway 落成具体动作——"
                     "下一步读什么、跑什么、改什么假设",
        positive_lessons=["组会的价值在'接下来做什么'，背景越短越好"],
        negative_lessons=["background 超过一页就是没做取舍"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_N} §1.3 / §2 硬规则 2 / §7 背景过长"]),
    ),
    dict(
        report_type="proposal", stage="R2", kind="narrative",
        result="FAIL", confidence=CONFIDENCE,
        tags=["章节失衡", "方法讲太细"],
        page_roles=["question", "compare", "limitation", "takeaway"],
        applicable_when="开题/选题汇报，听众会追问'这个问题别人做过没有''数据能不能拿到'时",
        pitfalls=[
            "question 写成主题方向而不是可检验的问题",
            "limitation 写'文章存在一定局限'，不写数据可得性与识别前提",
            "把拟用方法的公式推导讲满一页",
        ],
        attempts=[
            dict(method="按'领域现状 → 我要做什么'两段式讲", result="fail",
                 note="被追问'为什么不是已有论文已经回答过的问题'时答不上来"),
            dict(method="question 写成可被证伪的形式并说明与已有工作的差异；compare 页并排'已有做法 vs "
                        "拟用做法'及各自前提假设；limitation 写可行性与风险", result="success",
                 note="被追问最多的三处都提前有了答案"),
        ],
        final_recipe="开题的 question 必须可被检验/可被证伪，并说明为什么不是已有论文已回答的问题；"
                     "compare 页并排「已有做法 vs 拟用做法」及各自的前提假设（这是被追问最多的地方）；"
                     "limitation 写可行性与风险——数据能不能拿到、识别前提能不能满足，不写'文章存在局限'；"
                     "takeaway 给预期贡献与下一步时间表",
        negative_lessons=["开题的局限页写形式化套话，等于把最会被追问的地方留空"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_N} §1.4 / §7 局限形式化"]),
    ),

    # ══ R1/R2 内容取舍 ════════════════════════════════════════════════════
    dict(
        report_type="single", stage="R2", kind="content",
        result="FAIL", confidence=CONFIDENCE,
        tags=["背景过长", "主线不清"],
        page_roles=["background", "outline"],
        applicable_when="通读材料后觉得可讲的内容明显多于时长能装下时（R2 做内容取舍）",
        pitfalls=[
            "一页塞两个主张，听众一个都记不住",
            "决定不讲的内容不留痕，返修时被反复加回来",
            "删不掉任何东西，于是每页都讲一点",
        ],
        attempts=[
            dict(method="先把论文内容按页平均分配", result="fail",
                 note="每页都成立，但整场说不出想让人记住什么"),
            dict(method="先定 2–3 条记忆点，再按'删掉它听众还能不能复述记忆点'逐条取舍；"
                        "决定不讲的内容与理由写进 storyline.md", result="success",
                 note="返修时不再反复加回已经砍掉的内容"),
        ],
        final_recipe="取舍判据只有一条——删掉它，听众还能不能复述你想让他们记住的那两三句话；"
                     "一页只放一个能被质疑的主张（写进 claims）；background 超过一页就砍；"
                     "「决定不讲」的内容与理由必须写下来，否则返修时一定会被加回来",
        positive_lessons=["把'不讲什么'写下来，比写'讲什么'更能省掉一轮返修"],
        negative_lessons=["砍掉的内容不在文档里留痕，返修时一定会被加回来"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_N} §2 三条硬取舍规则 / §5 叙事主线"]),
    ),
    dict(
        report_type="seminar", stage="R1", kind="content",
        result="FAIL", confidence=CONFIDENCE,
        tags=["关键数字缺失", "局限缺失"],
        page_roles=["method", "result", "limitation"],
        applicable_when="做逐篇论文抽取、准备进入叙事组织之前（R1 出口）",
        pitfalls=[
            "只抽'这篇讲了什么'的自由文本，没有固定字段",
            "局限一栏空着，到 limitation 页才发现无话可说",
            "抽取阶段就去想页序，结果六字段抽不齐",
        ],
        attempts=[
            dict(method="读一篇写一段摘要，进叙事阶段再回头找细节", result="fail",
                 note="叙事阶段发现缺局限与可迁移点，只能重读原文，等于把返工写进流程"),
            dict(method="每篇固定抽六字段并记页码：研究问题 / 方法（识别策略与前提）/ 数据与样本 / "
                        "主要结果 / 作者自己承认的局限 / 对我们的可迁移点", result="success",
                 note="叙事层只做组织，不再回炉读原文"),
        ],
        final_recipe="R1 每篇按六字段抽取并记页码：研究问题 / 方法（识别策略及其前提）/ 数据与样本 / "
                     "主要结果 / 作者自己承认的局限 / 对我们的可迁移点；抽不齐六字段的论文"
                     "不要指望在叙事层补齐——回 R1 补齐",
        negative_lessons=["到了叙事阶段才回头找局限与可迁移点，等于把返工写进流程"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_N} §8 与上下游的接口", f"{_GATE} 阶段判据 R1"]),
    ),

    # ══ R3 页策划 ═════════════════════════════════════════════════════════
    dict(
        report_type="survey", stage="R3", kind="content",
        result="FAIL", confidence=CONFIDENCE, language="zh",
        tags=["对比矩阵", "文字溢出"],
        page_roles=["compare"],
        applicable_when="综述/多篇汇报要现场展示对比矩阵页、且矩阵同时存在人读底稿与 deck plan 两处时",
        pitfalls=[
            "矩阵单元格写整句论证，一张表挤成小字",
            "底稿与 deck plan 的 compare 页内容不一致",
            "把作者、期刊、年份做成矩阵维度",
        ],
        attempts=[
            dict(method="把每条判断的完整论证写进表格单元格", result="fail",
                 note="单元格塞满整句，字号被压到下限、列宽挤到看不清"),
            dict(method="单元格只写结论短语，论证移到 notes 讲稿；底稿与 plan 两处保持同一份内容",
                 result="success", note="现场能一眼扫懂，被追问时讲稿里有论证"),
        ],
        final_recipe="矩阵页单元格写结论短语，论证放 notes 讲稿；维度只列 3–6 个服务主线判断的、"
                     "跨篇都填得上的项（某一篇真的没报告就写'未报告'，不要套用别的含义）；"
                     "人读底稿与 deck plan 的 compare 页必须一致；"
                     "不要用作者/期刊/年份做维度——那是 reference 页的事",
        positive_lessons=["底稿放写作对照、矩阵页放现场展示，两处内容一致但详略不同"],
        negative_lessons=["不要把元数据做成对比维度，那种表扫不出任何差异"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_N} §3.1 / §3.2 / §7 矩阵变成元数据表", f"{_S} §1.4 table"]),
    ),
    dict(
        report_type="single", stage="R3", kind="content",
        result="FAIL", confidence=CONFIDENCE,
        tags=["断章取义", "关键数字缺失"],
        page_roles=["background", "question", "method", "data", "result", "compare", "limitation", "takeaway"],
        applicable_when="R3 写 deck plan 的实质页（background/question/method/data/result/compare/"
                        "limitation/takeaway）时",
        pitfalls=[
            "claim 的 source 只写'该论文'或作者姓氏",
            "evidence_id 是编的，证据层里查不到",
            "把论文讨论里的展望当结论写进 claim",
        ],
        attempts=[
            dict(method="凭印象给每条 claim 写来源", result="fail",
                 note="机械质检报 claim_no_source / evidence_not_found，high 未清零不许进评分"),
            dict(method="每条 claim 配 evidence_id（真实存在于证据层）与具体页码/图表编号", result="success",
                 note="内容准确与可追溯这一维（权重最高）有了可核对的依据"),
        ],
        final_recipe="实质页每条 claim 三字段缺一不可：claim（本页一个可被质疑的主张）、"
                     "evidence_id（必须真实存在于证据层）、source（论文具体页码/图表编号）——"
                     "source 只写'该论文'或作者姓氏一律按缺失处理；evidence_id 查不到时改 id，"
                     "不许改证据文件去凑",
        negative_lessons=["没有出处的主张等于编的——这是闸门与评分者都会拦的硬项"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_S} §1.5 claims（证据层入口）", f"{_QA} check_plan 证据链检查",
                                   f"{_N} §8 证据层红线"]),
    ),
    dict(
        report_type="single", stage="R3", kind="visual",
        result="FAIL", confidence=CONFIDENCE,
        tags=["图文不符", "图表错配"],
        page_roles=["method", "data", "result", "compare"],
        applicable_when="要在页面上放图或表格、正在给页面选 role 时",
        pitfalls=[
            "把结果图放在 result 页——完全不渲染，页面退化成纯文字页",
            "把表格放在 method/result 页——同样不渲染",
            "机械质检全绿，但页面上少了一张图，只能靠评分者发现",
            "image 声明的文件不存在，静默退化为纯文字页",
        ],
        attempts=[
            dict(method="按内容语义选 role，图片随手放在结果页", result="fail",
                 note="image 只认 method/data，图静默消失且机械质检不报错"),
            dict(method="要放图就把该页 role 写成 data（或 method），要放表/分栏就写成 compare；"
                        "image + bullets 的双栏正是 data 页的默认版式", result="success",
                 note="图与表都真的渲染出来，版式维度不再被扣"),
        ],
        final_recipe="结构元素只认特定 role：image 只认 method/data，table 与 columns 只认 compare，"
                     "subtitle 只认 cover/thanks；写错位置不报错、只是不出现——"
                     "要放结果图就把该页 role 改成 data，要放表就用 compare；"
                     "同时确认 image.path 真的在盘上（相对路径按 项目根 → 文献目录 → 叙事目录 依次解析），"
                     "找不到会静默退化成纯文字页",
        positive_lessons=["选 role 之前先确认这一页要放的结构元素在哪几个 role 上生效"],
        negative_lessons=["不要用'机械质检全绿'当作页面完整的证据——元素写错 role 时质检不会报"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_S} §1.4 / §1.6 版式元素与 role 的绑定 / §8 "
                                   f"元素写错 role 被静默丢弃"]),
    ),
    dict(
        report_type="multi", stage="R3", kind="visual",
        result="FAIL", confidence=CONFIDENCE, language="zh",
        tags=["字号过小", "文字溢出"],
        page_roles=["compare", "result"],
        applicable_when="中文 deck 单页内容偏多、渲染后出现贴边或字号被压到下限时",
        pitfalls=[
            "靠缩字硬塞：一页三百字，字号一路降到地板",
            "导语段写长了，顶掉列表的空间（正文预算把导语算在内）",
            "以为渲染器会自动排版",
        ],
        attempts=[
            dict(method="把字号从规划值一路降到下限硬塞进一页", result="fail",
                 note="同时撞上 font_too_small 与 content_touches_edge 两条机械规则"),
            dict(method="先删到只保留支撑本页主张的内容，删不动就拆页", result="success",
                 note="字号回到规划值，两条违规一起消失"),
        ],
        final_recipe="一页放不下时先删字、再拆页，不要缩字号：渲染器只做估算级自适应，"
                     "到下限仍放不下也照样输出，溢出由机械质检报出来而不是被静默压扁；"
                     "正文预算包含导语段（列表字数之和 + 导语字数），导语写长了一样挤掉列表空间；"
                     "列表超过 6 条通常意味着分类没做",
        positive_lessons=["字号变小的信号是'内容太多'，不是'字号该调'"],
        negative_lessons=["不要把渲染器的容忍额（字号下限再减 4pt）当成可用排版空间"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_QA} BUDGET / char_budget / font_too_small / content_touches_edge",
                                   f"{_S} §3 第 1/3 条 / §8 靠缩字硬塞"]),
    ),
    dict(
        report_type="survey", stage="R3", kind="visual",
        result="FAIL", confidence=CONFIDENCE, language="zh",
        tags=["字体回退", "字体缺失"],
        page_roles=["cover"],
        applicable_when="换 theme.font_zh / font_en，或这份 deck 要在另一台机器上渲染时",
        pitfalls=[
            "换了目标机器上没装的字体，渲染端静默回退、版式明显跳变",
            "中文显示成方框就去'手动加字体'，其实成因是中文字体未装",
            "只写 latin 字体名，中文走渲染端默认字体",
        ],
        attempts=[
            dict(method="为了好看把 font_zh 换成某个设计字体", result="fail",
                 note="目标机器没装，报 high font_missing，字形与行宽全变"),
            dict(method="换字体前先确认目标机器已装；默认用系统自带的中文/西文字体", result="success",
                 note="渲染结果与规划一致，不会临场跳版"),
        ],
        final_recipe="theme 里的中西文字体必须是**渲染机器上真实安装**的字体（默认用系统自带的那对）；"
                     "换字体前先确认已装，未装即报 high font_missing 且渲染端不报错、只静默回退；"
                     "中文字形由东亚字形属性承载，脚本已同时写 latin / 东亚 / 复杂文种三处，"
                     "方框问题的唯一成因就是中文字体未装——改字体名，不要手动加字体",
        negative_lessons=["字体是渲染环境事实，不是审美选择——换机器渲染前先核一遍"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_S} §4.2 / §8 字体回退·中文乱码", f"{_PPTX} THEMES / _set_font",
                                   f"{_QA} font_available / font_missing"]),
    ),

    # ══ R5 评分与返修 ═════════════════════════════════════════════════════
    dict(
        report_type="single", stage="R5", kind="review",
        result="FAIL", confidence=CONFIDENCE,
        tags=["自评通胀"],
        page_roles=[],
        applicable_when="起评分者之前，尤其执笔者本人已深度参与改稿、看不见自己的默认假设时",
        pitfalls=[
            "生成者给自己打分，各维度普遍高分而问题清单全是 low",
            "评分者拿到改稿过程与取舍理由，会自动替 PPT 补上它其实没写出来的前提",
            "评分者被允许读经验库，等于把生成者的先验注进判据",
        ],
        attempts=[
            dict(method="同一条对话里'我再审一遍'", result="fail",
                 note="自评通胀，分数不可信，也无法与产物指纹绑定"),
            dict(method="起独立子会话评分：只给渲染图、渲染指纹与 dpi、论文原文与抽取结果、"
                        "rubric 与定盘信息，不给对话历史与自评、不给经验库工具、不给产物写权限",
                 result="success", note="评分者只对产物负责，独立评分成立"),
        ],
        final_recipe="评分者必须是独立子会话，且有明确的给/不给清单：给渲染图、渲染指纹与 dpi、"
                     "论文原文与抽取/证据文件、rubric 与定盘信息；不给生成过程的对话历史与取舍理由、"
                     "不给生成者自评、不给经验库工具（读经验库等于把生成者先验注进评分者）、"
                     "不给任何产物写权限；评分结论里的评分者会话 id 必须不同于生成者会话 id",
        positive_lessons=["同一模型族也能显著改变结论分布，因为它看不到执笔者的默认假设"],
        negative_lessons=["不要让评分者读经验库，那会破坏独立评分的成立条件"],
        tools_used=["subagent"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_R} §0.1 / §0.2 / §0.3 指纹纪律", f"{_GATE} 评分者身份判据",
                                   f"{_EXP} 评分者不许读经验库"]),
    ),
    dict(
        report_type="multi", stage="R5", kind="review",
        result="FAIL", confidence=CONFIDENCE,
        tags=["扣分无依据"],
        page_roles=[],
        applicable_when="给评审问题定严重度、判断交付闸门能不能放行时",
        pitfalls=[
            "把 high 降级成 medium 来绕闸门",
            "严重度按'感觉有多严重'定",
            "逐页扣分项只写扣了几分，不写具体观察",
        ],
        attempts=[
            dict(method="把不服气但确实致命的问题标成 medium", result="fail",
                 note="闸门只拦 high，降级只是把问题推给汇报现场"),
            dict(method="按'不改会不会让结论站不住、会不会在现场被问倒'定级；"
                        "降级必须同时改写问题描述并写明理由", result="success",
                 note="high 一律返修或明确记录不改的理由，问题不会静默消失"),
        ],
        final_recipe="严重度判据是「不改会不会结论站不住 / 学术诚信问题 / 公开场合会被直接质疑」，"
                     "不是感觉；high 必须了结——要么已改，要么明确记录为什么不改并写清理由；"
                     "逐页扣分项要配具体观察（含页号与实测值），只扣分不写具体项的评价没有返修价值",
        negative_lessons=["不要用降级绕过闸门——降级不等于问题消失，只是把它推给现场"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_R} §3.2 严重度锚点 / §1 per_slide / §5 降级绕过",
                                   f"{_GATE} deliveryAllowed 未了结 high"]),
    ),
    dict(
        report_type="multi", stage="R5", kind="review",
        result="FAIL", confidence=CONFIDENCE,
        tags=["分数不单调", "返修改坏"],
        page_roles=[],
        applicable_when="返修过程中出现'改 A 坏 B'、本轮分数低于上一轮时",
        pitfalls=[
            "默认交付末轮那一版，哪怕它分数更低",
            "只还原 plan 再重渲染，评分记录里的 pptx 指纹对不上",
            "每轮评分后不留档，最高分版本再也复现不出来",
        ],
        attempts=[
            dict(method="为了压单页字数而拆页，结果把叙事打散，末轮分数反而掉了", result="fail",
                 note="直接交付末轮等于交了一份更差的 PPT"),
            dict(method="每轮评分后把 plan 留档为 slide-plan.round-N.json，交付时整套还原"
                        "（plan + pptx + preview + render-manifest + score）", result="success",
                 note="取回最高分版本，且指纹链自洽"),
        ],
        final_recipe="交付取分数最高的那一版，不是末轮那版；取回必须**整套还原**"
                     "（slide-plan + deck.pptx + preview/ + render-manifest + score），"
                     "因为 pptx 字节哈希与渲染时刻绑定——只还原 plan 再重渲染，评分记录里的指纹就对不上；"
                     "每轮评分后留档 plan 并记下该轮指纹，回滚原因写进返修记账",
        positive_lessons=["分数不单调是返修常态，落盘留档是唯一能取回好版本的办法"],
        negative_lessons=["没留档就如实说'最高分版本已不可复现，交付的是当前版本'，不要伪造一份评分"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_R} §4.2 分数不单调", f"{_S} §7 渲染与指纹"]),
    ),
    dict(
        report_type="single", stage="R5", kind="process",
        result="FAIL", confidence=CONFIDENCE,
        tags=["无效返修", "轮数超限"],
        page_roles=[],
        applicable_when="返修已进行两轮以上、分数提升明显趋缓时",
        pitfalls=[
            "无界循环，每轮都在烧预算而分数不动",
            "连续两轮问题清单一样、plan 没有实质变化还继续跑",
            "只改评审文件的措辞就算返修",
        ],
        attempts=[
            dict(method="一轮轮继续修，不设停止条件", result="fail",
                 note="轮次与分数都不收敛，预算耗尽仍拿不到可交付版本"),
            dict(method="设停止条件：总分达标且无未了结 high，或轮数达上限，或连续两轮提升过小",
                 result="success", note="触顶时带已知缺口交付，并显式列出未闭合项"),
        ],
        final_recipe="返修停止条件三选一：总分达阈值且无未了结 high；轮数达上限（默认 3 轮）；"
                     "连续两轮提升小于 3 分（继续跑只是烧预算）。触顶不要无界循环——"
                     "带已知缺口交付，把未闭合项单列一节并在给用户的最终说明里显式列出；"
                     "本轮必须实际改动 plan 或产物，只改评审文件措辞不算返修",
        positive_lessons=["带着已知缺口交付比'再跑一轮'更诚实也更省钱"],
        negative_lessons=["只改评审文件措辞不算返修——闸门看的是产物"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_R} §4.1 停止条件 / §5 空转返修", f"{_GATE} maxRounds 3",
                                   f"{_GATE} 未了结 high 时不许收尾"]),
    ),

    # ══ R4 生成 · 流程与工具链 ════════════════════════════════════════════
    dict(
        report_type="multi", stage="R4", kind="process",
        result="FAIL", confidence=CONFIDENCE,
        tags=["产物未落盘", "未渲染即评分"],
        page_roles=[],
        applicable_when="判断汇报流程能否进入下一阶段、以及能否起评分者时",
        pitfalls=[
            "用'我已经写完 plan 了'这类口头声明代替产物落盘",
            "机械 high 没清零就起评分者，白烧一轮评分",
            "用跳过渲染产生的产物直接进入评分",
        ],
        attempts=[
            dict(method="按对话里的完成声明推进阶段", result="fail",
                 note="声明与产物脱节，后面的评分与交付全部返工"),
            dict(method="只按盘上产物判断阶段完成：plan 存在且过了机械关、pptx 由脚本渲染、"
                        "预览图与渲染清单齐全，才起评分者", result="success",
                 note="每一轮评分的依据都能追到盘上的产物"),
        ],
        final_recipe="阶段闸门只看盘上产物，不看任何口头声明；每轮返修先跑机械质检把 high 清零，"
                     "再起评分者——让评分者去看一份有 high 违规的产物是纯浪费；"
                     "R4 的产物必须由脚本渲染产出，手写 pptx / 预览图 / 质检报告 / 渲染清单"
                     "都会被闸门拦下（手写 pptx 等于绕开 plan，整套设计随之失效）",
        positive_lessons=["阶段完成的定义是'产物在盘上'，不是'我说我做完了'"],
        negative_lessons=["不要用完成声明推进阶段，也不要用跳过渲染的产物进入评分"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_GATE} 阶段判据 / 手写机器产物拦截",
                                   f"{_R} §4 第 1 步：先过机械关", f"{_S} §5 脚本调用与产物"]),
    ),
    dict(
        report_type="survey", stage="R2", kind="process",
        result="FAIL", confidence=CONFIDENCE,
        tags=["页数超限", "超时"],
        page_roles=[],
        applicable_when="汇报时长已定、正在规划页数与每页内容量时",
        pitfalls=[
            "页数先按材料多少定，最后才发现讲不完",
            "时长改了却不动页数，只把讲稿拉长",
            "每页信息量雷同，结果页与背景页一样厚",
        ],
        attempts=[
            dict(method="按材料多少排页，讲的时候加快语速", result="fail",
                 note="每页不足 0.35 分钟，实际就是念不完，机械质检也报 pacing_fast"),
            dict(method="先按时长算出页数区间，再按页角色分配时间预算，讲稿长度按时间预算反推",
                 result="success", note="页数、时间预算与讲稿长度三者自洽"),
        ],
        final_recipe="页数必须落在「时长 / 1.6 ≤ 页数 ≤ 时长 / 0.35」区间内，基准按 1 页/分钟；"
                     "分钟数一变先改页数、再改每页内容量；逐页口播秒数之和约为"
                     " 时长 × 60 × 0.9（留 10% 缓冲给提问与自然损耗）；"
                     "讲稿长度按该页口播秒数反推（每 10 秒约 40–50 字），"
                     "超出页时间预算的讲稿就是超时",
        positive_lessons=["超时的解法是先减页，不是加快语速或拉长讲稿填时间"],
        negative_lessons=["页数超限时不要动汇报时长——时长是用户的输入，不是可以调的变量"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_N} §4.1 / §4.2 / §4.3", f"{_QA} pacing_fast / pacing_slow"]),
    ),
    dict(
        report_type="seminar", stage="R0", kind="process",
        result="FAIL", confidence=CONFIDENCE,
        tags=["漏检索"],
        page_roles=[],
        applicable_when="R0 定盘时，尤其用户只说了'讲几篇文献'而没说场合、时长与受众时",
        pitfalls=[
            "先动手排页序，讲完才发现场合不对（组会 vs 开题）",
            "汇报类型与语言/时长没有落盘，后面全靠对话记忆",
            "R0 没有检索经验库，重蹈同一类坑",
        ],
        attempts=[
            dict(method="从论文内容直接开始排页", result="fail",
                 note="类型走错，整份页序都要重排，返工代价最大"),
            dict(method="R0 先确认并落盘汇报类型 / 语言 / 时长 / 受众，再检索一次经验库"
                        "（叙事骨架与页数取舍）", result="success",
                 note="页序模板与评分权重都有前提，后续阶段不必返工"),
        ],
        final_recipe="R0 就把汇报类型（单篇/多篇/组会/开题/综述）、语言、时长与受众确认并落盘——"
                     "五类汇报的页序模板、强制页与评分权重都不同，走错类型整份页序都要重排；"
                     "定盘后检索一次经验库（叙事骨架与页数取舍）；R3 页策划前再检索一次"
                     "（版式与视觉）；R4 生成阶段不要检索——会诱导把经验写进页面正文",
        negative_lessons=["不要用对话记忆代替落盘：闸门只看产物，不看口头声明"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_N} §0 五类汇报先路由 / §9 经验库接口",
                                   f"{_GATE} 阶段判据 R0", f"{_EXP} §何时查（三个检索点）"]),
    ),
    dict(
        report_type="multi", stage="R6", kind="process",
        result="FAIL", confidence=CONFIDENCE,
        tags=["漏沉淀"],
        page_roles=[],
        applicable_when="汇报收尾（每轮评分返修后与交付前）准备沉淀经验时",
        pitfalls=[
            "只沉淀成功经验，失败的那两轮记不住",
            "靠回忆写经验，不跑候选草稿脚本",
            "参考过历史经验却不记参考了哪条、也不回采纳结果",
        ],
        attempts=[
            dict(method="交付完凭回忆写几条经验", result="fail",
                 note="最值钱的失败线索（连改两轮上不去分）全丢了"),
            dict(method="从结构化产物机械提取候选草稿（逐页扣分项、'不改'条目、轮次分数、"
                        "阶段耗时），再逐条过迁移判据", result="success",
                 note="成功/失败/部分成功都沉淀，来源可审计"),
        ],
        final_recipe="沉淀点在每轮评分返修后与交付前，两处都要做；成功、失败、部分成功**都要沉淀**——"
                     "失败经验（这个叙事结构连改两轮都上不去分）价值最高；原料用结构化产物"
                     "（逐页扣分项、'不改'条目、轮次分数、阶段耗时），不靠回忆；"
                     "记录参考过哪几条历史经验并回报采纳结果；只沉淀「怎么讲」的方法与坑，"
                     "不沉淀论文的研究结论与数值",
        positive_lessons=["库的因果链是'制作动作 → 评分后果'，所以最有价值的写法是'我做了 X，评分因此掉了'"],
        negative_lessons=["不要只记成功经验——失败那条才是最值钱的"],
        tools_used=["report_experience_candidates.py"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_EXP} §何时存 / 置信度锚点 / 红线 2",
                                   f"{_R} §6 经验回流", f"{_S} §5 候选草稿脚本"]),
    ),
    dict(
        report_type="single", stage="R4", kind="pipeline",
        result="FAIL", confidence=CONFIDENCE,
        tags=["manifest 指纹不符"],
        page_roles=[],
        applicable_when="生成与返修期间，任何想改动页面的时刻",
        pitfalls=[
            "渲染后在 PowerPoint 里手工挪两下再保存",
            "改完 pptx 不重渲染，评分依据与交付物脱钩",
            "用旧的 pptx 配新的 plan 跑质检",
        ],
        attempts=[
            dict(method="渲染后在 PowerPoint 里手工微调交付的 pptx", result="fail",
                 note="pptx 字节哈希变了，渲染清单与评分记录的指纹全部对不上，本轮评分作废"),
            dict(method="一切改动回到 deck plan，再依次重跑渲染与质检脚本", result="success",
                 note="plan → pptx → 预览图 → 渲染清单 → 评分 整条链自洽"),
        ],
        final_recipe="deck plan 是唯一真相：页面文字、图表引用、讲稿备注全部来自它，要改页面就改 plan "
                     "再重跑渲染脚本；不要直接改 pptx——质检记录的是渲染时刻的 pptx 哈希，"
                     "改完不重渲染指纹就对不上，本轮评分立即作废；正确顺序是"
                     " 改 plan → 重跑渲染 → 重跑质检 → 重新评分；"
                     "同一份 plan 在相隔两秒以上的两次渲染会得到不同字节（内容相同、哈希不同），"
                     "所以回滚必须整套还原",
        negative_lessons=["回滚到最高分那版必须整套还原（plan/pptx/预览/清单/评分），只还原 plan 没用"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_S} §0 plan 是唯一真相 / §7 渲染与指纹",
                                   f"{_PPTX} 设计原则", f"{_QA} 为什么要指纹"]),
    ),
    dict(
        report_type="multi", stage="R4", kind="pipeline",
        result="FAIL", confidence=CONFIDENCE,
        tags=["COM 渲染失败", "未渲染即评分"],
        page_roles=[],
        applicable_when="质检报渲染失败时（缺 PowerPoint、渲染库不可用、导出文件为空、pptx 被占用）",
        pitfalls=[
            "用跳过渲染的参数继续往下走",
            "把渲染失败当成'某个检查项没过'去改 plan",
            "渲染完立刻重渲染，撞上 PowerPoint 进程还没退干净的文件占用",
        ],
        attempts=[
            dict(method="渲染报错后跳过渲染继续评分", result="fail",
                 note="报 high render_skipped，闸门拒绝放行——没渲染就评分等于凭空打分"),
            dict(method="修渲染环境（装 PowerPoint、装渲染库、确认预览目录可写、确认没有别的进程占用 pptx）"
                        "后重跑", result="success", note="渲染成功才继续，页面实际观感与缺图都能被看到"),
        ],
        final_recipe="渲染失败的正确动作是修环境，不是绕开渲染；跳过渲染的参数只用于排障，"
                     "它会产生 high 违规并让闸门拒绝放行；渲染走桌面套件原生导出，"
                     "不可用时脚本不假装成功，而是把'未渲染'升级成 high；"
                     "导出后要等一个短窗口让桌面套件释放文件句柄，否则紧接着重渲染会撞上占用",
        positive_lessons=["渲染是评分的物理前提——评分者看到的必须是页面实际长什么样"],
        negative_lessons=["不要用'没渲染就评分'换时间：评分者看不到页面就没有版式维度"],
        tools_used=["PowerPoint COM"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_QA} render_powerpoint / render_skipped / render_failed / "
                                   f"render_count_mismatch", f"{_S} §5 / §6.1 / §8 COM 渲染失败"]),
    ),
    dict(
        report_type="proposal", stage="R6", kind="pipeline",
        result="FAIL", confidence=CONFIDENCE,
        tags=["产物未落盘"],
        page_roles=[],
        applicable_when="生成交付说明与整理交付目录时",
        pitfalls=[
            "手写交付说明或讲稿文件——闸门会拦",
            "把经验 id 写进页面正文或讲稿",
            "交付说明的字段缺失，评分信息在交付文档里显示成占位符",
        ],
        attempts=[
            dict(method="按记忆手写一份交付说明", result="fail",
                 note="手写机器产物会被闸门拒绝，且与评分记录的字段容易不一致"),
            dict(method="用脚本生成交付说明，字段机械读取评分记录；经验 id 只留在定盘记录与"
                        "返修记账的『参考经验』字段", result="success",
                 note="交付物与评分记录一致，经验也没有渗进对论文的陈述"),
        ],
        final_recipe="交付物一律由脚本产出（pptx 与讲稿、预览图、质检报告、渲染清单、交付说明），"
                     "手写会被闸门拦下；交付说明机械读取评分记录，字段缺失会显示成占位符，"
                     "所以先把评审文件写全再交付；经验 id 只允许出现在定盘记录与返修记账的"
                     "『参考经验』字段，不许进页面正文、讲稿与交付说明",
        positive_lessons=["交付说明由脚本从评审文件生成，比手写更省事也更不容易自相矛盾"],
        negative_lessons=["经验只能改变流程与检查表，不能改变对论文的陈述"],
        provenance=dict(report_project=None, seed=True, note=_SEED_NOTE,
                        artifacts=[f"{_S} §5 脚本调用与产物", f"{_N} §9 纪律 2（经验不得进交付物）",
                                   f"{_EXP} 红线 5", f"{_GATE} 手写机器产物拦截"]),
    ),
]


# ---------------------------------------------------------------------------
# 构建与落盘
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _distribution(recs: list[dict], key: str) -> str:
    tally: dict[str, int] = {}
    for r in recs:
        v = str(r.get(key) or "?")
        tally[v] = tally.get(v, 0) + 1
    return " ".join(f"{k}={v}" for k, v in sorted(tally.items(), key=lambda kv: (-kv[1], kv[0])))


def build_records() -> list[dict]:
    """把 SEEDS 变成可入库的记录：uuid + 时间戳 + 指纹。

    - **用 adapter 的 `new_record()` 做校验与归一化**：report_type / stage / kind 的枚举、
      `applicable_when` 非空、page_roles 归一化全部走运行期同一份规则，不在本脚本里复述。
    - **指纹调 adapter 的 `feature_hash()`**：绝不自己再实现一遍。
    - 种子之间指纹重复即丢弃（打印「指纹重复，跳过」），不让两条同指纹种子互相强化。
    """
    adapter = ms.store.a
    out: list[dict] = []
    seen: dict[str, str] = {}
    for seed in SEEDS:
        rec = adapter.new_record(seed)
        rec["id"] = uuid.uuid4().hex
        rec["created_at"] = rec["updated_at"] = _now()
        rec["feature_hash"] = adapter.feature_hash(rec)
        dup = seen.get(rec["feature_hash"])
        if dup:
            print(f"  ⚠️ 指纹重复，跳过：{rec['report_type']} / {rec['tags']} / "
                  f"{rec['kind']} / {rec['stage']}（与 {dup} 同指纹）")
            continue
        seen[rec["feature_hash"]] = f"{rec['report_type']}/{rec['stage']}/{rec['kind']}"
        out.append(rec)
    return out


def _adopt_existing_ids(recs: list[dict], prev: dict) -> int:
    """同指纹已有条目时复用它的 id，让重跑走"同 id 原地更新"而不是「强化合并」。

    走合并的话 `merge_duplicate()` 每次把 `confidence = max(旧,新) + 0.5`，
    种子连跑两次就变成 3.5——那读起来像"跨汇报复现过"，是把库做烂的假象。
    复用 id 则重跑完全不改变语义，也不产生被合并的归档残条。
    """
    by_hash: dict[str, dict] = {}
    for r in prev.values():
        if r.get("archived") or r.get("merged_into"):
            continue
        by_hash.setdefault(str(r.get("feature_hash") or ""), r)
    reused = 0
    for rec in recs:
        old = by_hash.get(rec["feature_hash"])
        if old and old.get("id"):
            rec["id"] = old["id"]
            reused += 1
    return reused


def _required_qdrant() -> int:
    """校验 Qdrant 可用；不可用即明确报错并给出配置方式（不静默降级）。"""
    url, _ = ms.qdrant_endpoint()
    if not url:
        print("错误：解析不到 Qdrant 端点，无法写入向量库。", file=sys.stderr)
        print("配置方式（任选其一）：", file=sys.stderr)
        print("  1) 设环境变量 REPORT_MEMORY_QDRANT_URL=http://<host>:6333"
              "（有密钥再加 REPORT_MEMORY_QDRANT_API_KEY=<key>）；", file=sys.stderr)
        print("  2) 在 DBX 里登记一个 qdrant 连接（程序会自动读取；连接不唯一时用"
              " REPORT_MEMORY_QDRANT_CONN=<连接名> 指定）。", file=sys.stderr)
        print("只想写本地、明确放弃向量检索时，加 --local-only。", file=sys.stderr)
        return 1
    if ms.qdrant_client() is None:
        print(f"错误：Qdrant 端点已解析（{url}）但连接不可用：{ms.qdrant_error()}", file=sys.stderr)
        print("请检查网络与服务是否可达、密钥是否正确；或加 --local-only 只写本地。", file=sys.stderr)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="seed_report_experience",
        description="把文献汇报 PPT 的可迁移方法论作为技能种子写入 report_experience 库")
    parser.add_argument("--dry-run", action="store_true",
                        help="只打印将写入多少条与按 report_type/kind/stage 的分布，不落盘、不连 Qdrant")
    parser.add_argument("--local-only", action="store_true",
                        help="显式只写本地 MD + registry.json，不做向量检索（会响亮说明）")
    args = parser.parse_args(argv)

    recs = build_records()
    print(f"构建 {len(recs)} 条种子记录（confidence 统一 {CONFIDENCE}，"
          f"入库门槛严格大于 {CONFIDENCE_THRESHOLD}）")
    sys.stdout.flush()

    if args.dry_run:
        print("[dry-run] 不落盘、不连 Qdrant")
        print(f"  按 report_type：{_distribution(recs, 'report_type')}")
        print(f"  按 kind：{_distribution(recs, 'kind')}")
        print(f"  按 stage：{_distribution(recs, 'stage')}")
        print(f"  按 result：{_distribution(recs, 'result')}")
        print(f"  覆盖页角色：{' '.join(sorted({r for rec in recs for r in rec['page_roles']}))}")
        print("  逐条：")
        for i, rec in enumerate(recs, start=1):
            print(f"    {i:2d}. {rec['report_type']:8s} {rec['stage']} {rec['kind']:9s} "
                  f"{'/'.join(rec['tags']) or '-'}")
        return 0

    local_only = args.local_only
    if local_only:
        print("⚠️ --local-only：本次只写本地 MD + registry.json，**不写 Qdrant**，"
              "向量检索（report_experience_search）不可用，只能按结构化条件走本地检索。")
    elif _required_qdrant() != 0:
        return 1

    data_dir = ms.store.data_dir()
    if not DATA_DIR.is_dir():
        print(f"提示：{DATA_DIR} 尚不存在（事实源实际写在 {data_dir}）")

    # ── 1) 本地事实源：MD + registry.json（复用 adapter 的 write_md 与 store 的 save_registry）──
    prev = ms.store.load_registry()
    reused = _adopt_existing_ids(recs, prev)
    if reused:
        print(f"同指纹已存在 {reused} 条：复用其 id，本次为原地更新（不新建条目）")

    local_md: dict[str, Path] = {}
    reg = dict(prev)
    for rec in recs:
        local_md[rec["id"]] = ms.store.write_md(rec)
        reg[rec["id"]] = rec
    ms.store.save_registry(reg)
    print(f"本地已写入 {len(recs)} 条 MD + registry.json -> {data_dir}")

    # ── 2) 向量库：复用 store.save()（内部：写 MD → 写 registry → 建集合 → upsert）──
    if local_only:
        reg = ms.store.load_registry()
        for rec in recs:
            if rec["id"] in reg:
                reg[rec["id"]]["qdrant_pending"] = True
        ms.store.save_registry(reg)
        print(f"{len(recs)} 条已标记 qdrant_pending：本次没有向量写入。"
              f"配好 Qdrant 后跑 `memory_store.py sync` 可补同步。")
    else:
        reinforced = fresh = failed = pending = 0
        for rec in recs:
            res = ms.store.save(rec)
            if not res.get("saved"):
                failed += 1
                print(f"  ⚠️ 未入库：{rec['report_type']}/{rec['stage']}/{rec['kind']} — "
                      f"{res.get('message')}")
                continue
            if res.get("reinforced_existing"):
                reinforced += 1
            if res.get("qdrant_synced"):
                fresh += 1
            else:
                pending += 1
        print(f"已提交 {len(recs)} 条到 {COLLECTION}：向量同步 {fresh} 条，"
              f"待同步 {pending} 条，未入库 {failed} 条")
        if reinforced:
            print(f"强化了 {reinforced} 条（同指纹走强化合并）")

    # ── 3) 本地事实源与 registry 对齐，清掉被取代的旧 MD ────────────────────
    # store.save() 会用当前时间重建 created_at，因此 md_path 可能与第 1 步（以及上一轮运行）
    # 写下的路径不同；那些文件已不被 registry 引用，留着会污染事实源目录。
    reg = ms.store.load_registry()
    for rec in recs:
        final = reg.get(rec["id"])
        if final:
            ms.store.write_md(final)
    ms.store.save_registry(reg)

    referenced = {Path(r["md_path"]) for r in reg.values() if r.get("md_path")}
    stale: list[Path] = []
    for rec in recs:
        for cand in (local_md.get(rec["id"]),
                     (prev.get(rec["id"]) or {}).get("md_path")):
            if not cand:
                continue
            p = Path(cand)
            if p not in referenced and p.is_file():
                stale.append(p)
    for p in set(stale):
        p.unlink()
        try:
            p.parent.rmdir()
        except OSError:
            pass
    if stale:
        print(f"已清理 {len(set(stale))} 个被取代的旧 MD 文件")

    # ── 4) readiness.json（带 seeded_at；必须最后写，store.save 内部会覆盖它）──
    ready = ms.readiness()
    ready["seeded_at"] = _now()
    ready["seeded_count"] = len(recs)
    ready["seed_of_collection"] = COLLECTION
    ready["note"] = ("seeded_at 为种子写入时刻；这些条目的 provenance.seed=True、"
                     "confidence=3.0（锚点：与公开的演示设计规范一致），不是 earned 经验。")
    rp = ms.store.readiness_path()
    tmp = rp.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(ready, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(rp)
    print(f"已写入 readiness.json（seeded_at={ready['seeded_at']}）")

    client = ms.qdrant_client()
    if client is not None:
        try:
            print(f"集合 {COLLECTION} 当前点数：{client.count(COLLECTION, exact=True).count}")
        except Exception as e:  # noqa: BLE001
            print(f"（集合点数读取失败：{e}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
