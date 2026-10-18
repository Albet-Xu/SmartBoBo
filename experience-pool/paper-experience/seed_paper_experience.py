# -*- coding: utf-8 -*-
"""paper_experience 种子数据导入脚本（一次性 / 可重跑）。

背景
----
`docs/研究模式调研/03-论文写作模式设计思路（经验沉淀层）.md` 设计了「论文写作经验库」，
目标集合 `paper_experience`（512 维 / COSINE / 嵌入模型 BAAI/bge-small-zh-v1.5）。
但该设计稿明确写着「代码尚未实现」，且仓库里**没有任何真实论文项目产物**
（零 review.json / results.tsv / cleaning-log.md），因此不存在「earned」经验。

本脚本的作用是**用技能里已有的可迁移方法论做种子**，让库先可用起来。

诚实标注（重要）
----------------
- `confidence = 3.0`：对应设计稿 §5.3 的锚点「与**方法论文献**一致」，
  **不是**「跨项目复现过」（那需要 ≥3.5 且 `confirmed_projects > 0`）。
- `confirmed_projects = 0`：这些经验在本仓库里**从未在真实论文项目中复现过**。
- `provenance.seed = True` 且 `paper_project = None`：明确标记为「技能种子」，
  便于日后审计时与真实沉淀区分开。
- **没有伪造任何项目名、产物路径或数值**。

内容边界
--------
只收录**换一个数据集、换一个课题之后仍然成立**的方法论与流程规范（设计稿 §5.2 的迁移判据），
不含任何具体研究结论、数值或用户数据（设计稿 §8.1 红线 1/2/6）。

用法
----
    PAPER_MEMORY_QDRANT_URL=http://47.102.138.180:6333 \
    PAPER_MEMORY_QDRANT_API_KEY=<key> \
    .venv/Scripts/python.exe bobo-data/paper-experience/seed_paper_experience.py
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "dsh" / ".agents" / "skills" / "reverse-experience"))

DATA_DIR = ROOT / "bobo-data" / "paper-experience"
COLLECTION = "paper_experience"
DEFAULT_EMBED_DIM = 512
CONFIDENCE_THRESHOLD = 2.0

# ---------------------------------------------------------------------------
# 种子条目
# ---------------------------------------------------------------------------

S = "dsh/apps/cli/config/agent-presets"
SEEDS: list[dict] = [
    # ── 计量与因果推断 ──────────────────────────────────────────────────
    dict(
        scope="econometrics/did",
        method_tags=["DiD", "交错处理", "负权重", "事件研究"],
        stage="S3", kind="method", result="FAIL", confidence=3.0,
        applicable_when="处理时点交错（不同单位在不同时间受处理），且存在已处理单位充当后期处理组的对照时",
        pitfalls=["用 TWFE 处理交错时点却不查负权重", "只画事件研究图就下结论，不与稳健估计量对照"],
        attempts=[
            dict(method="TWFE 双向固定效应直接估计", result="fail",
                 note="负权重导致系数符号与事件研究图方向矛盾"),
            dict(method="改用对负权重稳健的估计量复核", result="success",
                 note="与事件研究图方向一致，结论可站住"),
        ],
        final_recipe="先跑事件研究图看动态效应，再用对负权重稳健的估计量复核；两者不一致时必须先解释清楚再写结论",
        positive_lessons=["交错处理先做负权重诊断，再决定估计量"],
        negative_lessons=["不要默认 TWFE 在交错处理下可用"],
        tools_used=["statsmodels", "matplotlib"],
        source=f"{S}/empirical/skills/paper-empirical/SKILL.md §3 评审维度·识别策略",
    ),
    dict(
        scope="econometrics/did",
        method_tags=["DiD", "平行趋势", "处理批次"],
        stage="S3", kind="method", result="PARTIAL_SUCCESS", confidence=3.0,
        applicable_when="做平行趋势检验，且处理在多个批次先后发生时",
        pitfalls=["平行趋势检验只在全样本做，未分处理批次"],
        attempts=[
            dict(method="全样本做一次平行趋势", result="fail",
                 note="掩盖了批次间异质性趋势；后期处理组被污染"),
            dict(method="按处理批次分组重做平行趋势", result="success",
                 note="暴露出全样本口径下看不到的趋势差异"),
        ],
        final_recipe="平行趋势按处理批次分组检验，并在文中说明分组口径",
        positive_lessons=["识别诊断要按处理批次拆开看，聚合口径会掩盖问题"],
        negative_lessons=["不要用全样本平行趋势图代替分批检验"],
        tools_used=["statsmodels", "matplotlib"],
        source=f"{S}/empirical/skills/paper-review/SKILL.md（实证版）§1 机械检查",
    ),
    dict(
        scope="econometrics/inference",
        method_tags=["聚类标准误", "聚类层级"],
        stage="S3", kind="method", result="FAIL", confidence=3.0,
        applicable_when="标准误的聚类层级与处理实际发生的层级可能不一致时",
        pitfalls=["聚类标准误的聚类层级与处理发生的层级不一致"],
        attempts=[
            dict(method="按企业层聚类", result="fail",
                 note="处理实际发生在行业层，企业层聚类低估了组间相关性"),
            dict(method="改到行业层聚类，并补一版企业层作为稳健性", result="success",
                 note="主结果与稳健性一并呈现，审稿无可指摘"),
        ],
        final_recipe="聚类层级对齐处理发生的层级；同时补一版原层级作为稳健性检验",
        positive_lessons=["聚类层级是识别策略的一部分，不是技术细节"],
        negative_lessons=["不要默认按最低聚合单位聚类"],
        tools_used=["statsmodels"],
        source=f"{S}/empirical/skills/paper-review/SKILL.md（实证版）§0 示例",
    ),
    dict(
        scope="econometrics/rdd",
        method_tags=["RDD", "断点操纵"],
        stage="S3", kind="method", result="FAIL", confidence=3.0,
        applicable_when="使用断点回归，且驱动变量存在被人为操纵的可能性时",
        pitfalls=["断点不查操纵（density / 协变量连续性检验）"],
        attempts=[
            dict(method="只看断点两侧结果跳变", result="fail",
                 note="驱动变量在断点附近堆积，RDD 前提不成立"),
            dict(method="补断点操纵检验与协变量连续性检验", result="success",
                 note="确认或排除操纵，结论前提可辩护"),
        ],
        final_recipe="RDD 必做断点操纵检验；发现堆积要如实报告并在局限里说明",
        negative_lessons=["不要把 RDD 当成'只要断点两侧有跳变就行'"],
        tools_used=["statsmodels", "matplotlib"],
        source=f"{S}/empirical/skills/paper-empirical/SKILL.md §3 评审维度·识别策略",
    ),
    dict(
        scope="econometrics/robustness",
        method_tags=["事前分析计划", "p-hacking"],
        stage="S0", kind="method", result="FAIL", confidence=3.0,
        applicable_when="任何假设检验型研究，在拿到数据之前与之后都需要区分检验性质时",
        pitfalls=["p-hacking / HARKing", "事后新增的检验不声明，与事前计划混在一起报"],
        attempts=[
            dict(method="跑完数据再挑显著的检验写进论文", result="fail",
                 note="典型 HARKing，审稿人一问事前计划就露"),
            dict(method="事前分析计划在拿到数据前定死；事后新增一律标注'探索性'", result="success",
                 note="检验性质可追溯，结论强度与证据匹配"),
        ],
        final_recipe="事前分析计划在拿到数据前定死；事后新增的检验一律标注为「探索性」并与事前计划分列",
        positive_lessons=["把'事前'与'事后'在文中显式分开，比隐藏它更安全"],
        negative_lessons=["不要在见过结果之后调整检验清单还当它是事前计划"],
        source=f"{S}/empirical/skills/paper-empirical/SKILL.md §5 常见失败模式",
    ),

    # ── 数据质量与口径 ─────────────────────────────────────────────────
    dict(
        scope="empirical/data-quality",
        method_tags=["口径一致性", "缺失机制"],
        stage="S2", kind="data", result="FAIL", confidence=3.0,
        applicable_when="同一变量跨年份或跨来源口径可能发生变化时",
        pitfalls=["同一变量跨年份口径不同却直接混用", "缺失非随机却不处理"],
        attempts=[
            dict(method="把各年份数据直接纵向合并", result="fail",
                 note="口径断点前后的数值不可比，趋势是假的"),
            dict(method="口径变更加一行 cleaning-log；断点年份不合并", result="success",
                 note="可比性有据可查，审稿可复核"),
        ],
        final_recipe="每个变量的口径变更加一行 cleaning-log.md；口径不一致的年份不合并；缺失机制（MCAR/MAR/MNAR）要有判断、处理规则与敏感性分析",
        positive_lessons=["口径断点是数据工作的第一等公民，要单独留痕"],
        negative_lessons=["不要为了样本量把口径不一致的年份硬并在一起"],
        source=f"{S}/empirical/skills/paper-empirical/SKILL.md §4.2 / §5",
    ),

    # ── 实验类 ────────────────────────────────────────────────────────
    dict(
        scope="experiment/evaluation",
        method_tags=["多种子", "均值±标准差", "显著性检验"],
        stage="S3", kind="method", result="FAIL", confidence=3.0,
        applicable_when="任何需要报告数值结果的实验（ML / 算法 / 系统 / 仿真 / A-B）",
        pitfalls=["单次运行当结论", "无标准差", "不做显著性检验", "只报最好的一次"],
        attempts=[
            dict(method="跑一次就写进结果表", result="fail",
                 note="随机性无法排除，差异可能纯属噪声"),
            dict(method="每个配置 ≥3 个随机种子，报均值 ± 标准差并做显著性检验", result="success",
                 note="结论有统计支撑，可复现"),
        ],
        final_recipe="每个配置 ≥3 个随机种子，报均值 ± 标准差；关键结论做显著性检验；均值与标准差一律从台账算，不手写",
        positive_lessons=["重复次数与离散度是结果可信度的前提，不是可选项"],
        negative_lessons=["不要把单次结果当作方法优劣的证据"],
        tools_used=["numpy", "scipy"],
        source=f"{S}/experiment/skills/paper-experiment/SKILL.md §4 / §5",
    ),
    dict(
        scope="experiment/evaluation",
        method_tags=["FDR", "多重比较"],
        stage="S3", kind="method", result="FAIL", confidence=3.0,
        applicable_when="同时做多个配置、多个数据集或多个指标的比较时",
        pitfalls=["多重比较不做校正", "把表外的检验结果也写进论文"],
        attempts=[
            dict(method="对每个组合单独做检验", result="fail",
                 note="比较族整体假阳性率失控，'显著'不可信"),
            dict(method="对整个比较族做 FDR 校正，并维护实验级比较台账", result="success",
                 note="投稿前对全族整体重校正，表外检验不进正文"),
        ],
        final_recipe="多重比较做 FDR 校正；维护实验级比较台账，投稿前对全族整体重校正；表外检验不得写进论文",
        negative_lessons=["不要逐个比较单独检验就宣称显著"],
        tools_used=["scipy", "statsmodels"],
        source=f"{S}/experiment/skills/paper-experiment/SKILL.md §5",
    ),
    dict(
        scope="experiment/reproducibility",
        method_tags=["独立test set", "数据泄漏"],
        stage="S0", kind="method", result="FAIL", confidence=3.0,
        applicable_when="任何有留出集的机器学习 / 算法实验，尤其需要反复调参时",
        pitfalls=["用验证集反复挑配置后还报验证集成绩", "test set 在调参过程中被多次使用"],
        attempts=[
            dict(method="按验证集成绩反复挑配置", result="fail",
                 note="验证集被当成优化目标，报出的成绩是乐观偏差"),
            dict(method="调参只看验证集，test set 只在最后跑一次", result="success",
                 note="并如实说明 test set 跑了几次"),
        ],
        final_recipe="调参只用验证集；test set 只在最后跑一次，并在附录如实说明使用次数",
        positive_lessons=["划分方式与使用次数要写进预注册，事后不得改"],
        negative_lessons=["一旦某份数据用于调参，它就不再是 test set"],
        tools_used=["scikit-learn"],
        source=f"{S}/experiment/skills/paper-experiment/SKILL.md §5 / §6",
    ),
    dict(
        scope="experiment/reproducibility",
        method_tags=["数据泄漏", "预处理"],
        stage="S3", kind="method", result="FAIL", confidence=3.0,
        applicable_when="流程中任何预处理（标准化 / 缺失填补 / 特征选择 / 降维）会用到数据统计量时",
        pitfalls=["在全量数据上拟合标准化的均值方差", "特征选择用了全量标签"],
        attempts=[
            dict(method="先对全量数据标准化再划分", result="fail",
                 note="测试集统计量泄漏进训练过程，成绩虚高且不可复现"),
            dict(method="划分在任何预处理之前，拟合只在训练集", result="success",
                 note="复现成绩与报告一致"),
        ],
        final_recipe="划分在预处理之前；标准化 / 特征选择 / 填补只在训练集上拟合，再应用到验证与测试集",
        negative_lessons=["预处理顺序错了，后面所有成绩都不可信"],
        tools_used=["scikit-learn"],
        source=f"{S}/experiment/skills/paper-experiment/SKILL.md §5 规范·防数据泄漏",
    ),
    dict(
        scope="experiment/protocol",
        method_tags=["预算对齐", "消融"],
        stage="S0", kind="method", result="FAIL", confidence=3.0,
        applicable_when="做方法对比实验，且 baseline 与自研方法的调优投入可能不对等时",
        pitfalls=["baseline 用默认超参、自己的方法精调", "一次改三处还归因到某组件"],
        attempts=[
            dict(method="baseline 直接用默认超参", result="fail",
                 note="'提升'来自调参投入差而非方法本身"),
            dict(method="baseline 先调到合理水平，再在同等预算下比较", result="success",
                 note="比较公平，结论可辩护；消融保持单变量"),
        ],
        final_recipe="baseline 必须先调到合理水平，否则「提升」没有意义；消融必须单变量，一次只改一处",
        negative_lessons=["不要用未调优的 baseline 衬托自己的方法"],
        source=f"{S}/experiment/skills/paper-experiment/SKILL.md §2 / §4",
    ),

    # ── 建模类 ────────────────────────────────────────────────────────
    dict(
        scope="modeling/proof",
        method_tags=["存在性", "数值反例"],
        stage="S3", kind="method", result="FAIL", confidence=3.0,
        applicable_when="理论建模论文中每个命题都需要给出可复核的核验记录时",
        pitfalls=["只有'我推了一遍'不算核验", "推导错但看起来对（跳步 / 符号混用 / 凭空引入条件）"],
        attempts=[
            dict(method="只在纸上推导一遍", result="fail",
                 note="推导错但形式漂亮，肉眼审不出来"),
            dict(method="sympy 符号路 + numpy 参数网格数值路双路核验", result="success",
                 note="数值反例直接揭穿错误推导"),
        ],
        final_recipe="每个命题配一份核验记录（脚本 + 输出），符号路用 sympy 验证关系式，数值路用参数网格 / 极端值 / 边界情形找反例",
        positive_lessons=["数值路最能揭穿'推导错但看起来对'——本类型的头号风险"],
        negative_lessons=["不要用'推导显然'替代可复核的核验"],
        tools_used=["sympy", "numpy"],
        source=f"{S}/modeling/skills/paper-modeling/SKILL.md §4.2",
    ),
    dict(
        scope="modeling/assumptions",
        method_tags=["假设现实性", "可放松性"],
        stage="S0", kind="method", result="FAIL", confidence=3.0,
        applicable_when="模型假设较强、存在「假设即结论」风险时",
        pitfalls=["假设写成一堆不讨论的符号条件", "把强假设说成'温和'", "假设不现实且不自知"],
        attempts=[
            dict(method="把假设列成符号条件了事", result="fail",
                 note="审稿人一眼看出 A3 强到'假设即结论'"),
            dict(method="假设按 A1、A2… 编号并逐条讨论理由、现实性与可放松性", result="success",
                 note="假设强度自知，结论外推边界清楚"),
        ],
        final_recipe="假设按 A1、A2… 编号，逐条给出理由与现实性讨论，并说明放松后结论是否变化",
        negative_lessons=["不要用'温和假设'这类形容词掩盖强假设"],
        source=f"{S}/modeling/skills/paper-modeling/SKILL.md §2 / §3",
    ),
    dict(
        scope="modeling/numerical",
        method_tags=["参数扫描", "边界情形"],
        stage="S3", kind="method", result="FAIL", confidence=3.0,
        applicable_when="用数值算例支撑模型结论时",
        pitfalls=["只挑好看参数", "只报结论成立的区间，不报失效区域", "不报随机种子"],
        attempts=[
            dict(method="手选几组好看的参数展示结论", result="fail",
                 note="审稿人换一组参数就推翻"),
            dict(method="参数网格扫描 + 报告参数来源与失效区域", result="success",
                 note="结论的适用区间明确，可复核"),
        ],
        final_recipe="算例报告参数取值及其来源、随机种子，并明确给出失效区域；结果由脚本生成不手抄",
        negative_lessons=["只报告结论成立的参数区间等于隐藏反例"],
        tools_used=["numpy", "matplotlib"],
        source=f"{S}/modeling/skills/paper-modeling/SKILL.md §4.3 / §5",
    ),
    dict(
        scope="modeling/writing",
        method_tags=["编号一致性"],
        stage="S4", kind="method", result="FAIL", confidence=3.0,
        applicable_when="论文含编号的假设 / 命题 / 引理 / 推论，且证明分散在正文与附录时",
        pitfalls=["命题与证明编号对不上", "正文与附录符号不一致", "写作时临时新增编号或顺手改号"],
        attempts=[
            dict(method="写作过程中顺手调整编号", result="fail",
                 note="正文写 P3、附录写 P2，读者找不到证明"),
            dict(method="编号一经确定不再改；改号必须全局同步", result="success",
                 note="正文、附录、评审定位符全部引用同一编号"),
        ],
        final_recipe="假设 A1…、命题 P1…、引理 L1…、推论 C1… 一经确定不再改动；改号必须全局同步并更新评审定位符",
        negative_lessons=["编号漂移是建模稿最常见的低级硬伤，且会让前面所有工作失效"],
        source=f"{S}/modeling/skills/paper-modeling/SKILL.md §4.1 / §5",
    ),

    # ── 综述与质性 ────────────────────────────────────────────────────
    dict(
        scope="synthesis/prisma",
        method_tags=["PRISMA", "纳入排除", "检索式"],
        stage="S3", kind="method", result="FAIL", confidence=3.0,
        applicable_when="做系统综述（PRISMA）且结果里需要给出流程图与各阶段人数时",
        pitfalls=["PRISMA 数字对不上", "事后凑数字让流程图好看"],
        attempts=[
            dict(method="写结果时凭印象填各阶段人数", result="fail",
                 note="识别数 − 去重 − 排除 ≠ 纳入数，等于伪造筛选过程"),
            dict(method="各阶段人数由 search-log 与筛选留档机械生成", result="success",
                 note="计数自洽且可复核"),
        ],
        final_recipe="PRISMA 计数必须自洽：识别数 − 去重 − 排除 = 纳入数；各阶段都要留档，数字由检索日志与筛选记录生成，不手填",
        negative_lessons=["不要为了流程图好看回头调数字——那是伪造筛选过程"],
        source=f"{S}/review/skills/paper-synthesis/SKILL.md §5 / §6",
    ),
    dict(
        scope="synthesis/method",
        method_tags=["检索式", "纳入排除"],
        stage="S1", kind="method", result="FAIL", confidence=3.0,
        applicable_when="任何需要「可复现检索」的综述（系统综述，或需说明检索范围的叙述性综述）",
        pitfalls=["只写'检索了相关文献'", "检索式缺字段限定与检索日期", "纳入排除在结果阶段放宽"],
        attempts=[
            dict(method="事后补写一段检索说明", result="fail",
                 note="别人照做不出同一批结果，审稿直接质疑"),
            dict(method="协议先于检索：检索式含库、字段限定、布尔逻辑与日期，筛选逐条可判定", result="success",
                 note="协议变更留记录，受影响检索重跑"),
        ],
        final_recipe="协议先于检索；检索式必须可照做一遍（含检索库、字段限定、布尔逻辑、检索日期）；纳入排除标准逐条可判定，协议一经确定不再改",
        positive_lessons=["协议变更要留记录并重跑受影响的检索，而不是悄悄改标准"],
        negative_lessons=["不要用'相关''重要'这类无法操作的标准做纳入排除"],
        source=f"{S}/review/skills/paper-synthesis/SKILL.md §2",
    ),
    dict(
        scope="synthesis/evidence",
        method_tags=["论断绑证据", "引用真实性"],
        stage="S4", kind="method", result="FAIL", confidence=3.0,
        applicable_when="综述 / 质性写作中，任何带结论性的句子",
        pitfalls=["综述性陈述无出处", "引未读过的文献", "只凭摘要就当作已读全文引用"],
        attempts=[
            dict(method="凭记忆写综述性陈述与引用", result="fail",
                 note="抽不出对应记录，等于断言不是论证"),
            dict(method="每个论断绑一条 evidence 记录（真实 paperId + 原文片段）", result="success",
                 note="只凭摘要引用的显式标注'仅摘要，未读全文'"),
        ],
        final_recipe="每个论断绑一条 evidence.jsonl 记录（type: literature，含真实 paperId 与原文片段）；只凭摘要引用的必须在记录里写明「仅摘要，未读全文」",
        negative_lessons=["不要引未读过的文献，也不要凭记忆写引用键"],
        tools_used=["literature MCP"],
        source=f"{S}/review/skills/paper-synthesis/SKILL.md §5",
    ),
    dict(
        scope="synthesis/synthesis",
        method_tags=["异质性", "矛盾结论"],
        stage="S3", kind="method", result="FAIL", confidence=3.0,
        applicable_when="纳入研究之间结论不一致时",
        pitfalls=["逐篇摘要堆砌（'张三发现…李四发现…'）", "只报一致结论，矛盾只报一个方向"],
        attempts=[
            dict(method="按文献逐篇罗列结论", result="fail",
                 note="没有综合，且选择性引用只支持自己观点的方向"),
            dict(method="按主题组织，矛盾结论并列呈现", result="success",
                 note="写清在哪些条件下结论反转，信息量更大"),
        ],
        final_recipe="按主题/编码组织而非逐篇罗列；矛盾结论并列呈现，说明在哪些条件下结论反转",
        positive_lessons=["矛盾比一致更有信息量，不要择一而述"],
        negative_lessons=["不要为了叙事顺畅只报一致结论"],
        source=f"{S}/review/skills/paper-synthesis/SKILL.md §3 / §6",
    ),
    dict(
        scope="qualitative/reporting",
        method_tags=["匿名化", "质性措辞"],
        stage="S4", kind="method", result="FAIL", confidence=3.0,
        applicable_when="研究报告质性材料（访谈 / 案例）时",
        pitfalls=["用量化措辞写质性材料（'大多数受访者认为'，实际 3 人）", "访谈引文带可识别信息"],
        attempts=[
            dict(method="用'大多数''普遍认为'概括受访者观点", result="fail",
                 note="实际样本极小，量化措辞是虚假精度"),
            dict(method="报人数与引文，不换算成比例；材料读取后立即匿名化", result="success",
                 note="表述与样本规模匹配，且不留可识别信息"),
        ],
        final_recipe="质性材料报人数与引文，不换算成比例；材料读取后立即匿名化，引文不得带可识别信息",
        negative_lessons=["不要用量化措辞给少量访谈制造虚假精度"],
        source=f"{S}/review/skills/paper-synthesis/SKILL.md §5 / §6",
    ),
    dict(
        scope="qualitative/coding",
        method_tags=["编码本", "饱和度", "编码者间一致性"],
        stage="S3", kind="method", result="FAIL", confidence=3.0,
        applicable_when="质性研究做编码与主题提炼时",
        pitfalls=["写完正文再回填编码", "编码本事后补造"],
        attempts=[
            dict(method="先写结论再补编码本", result="fail",
                 note="编码沦为结论的装饰，无法复核"),
            dict(method="编码本随做随记，报告饱和度与编码者间一致性", result="success",
                 note="编码过程可审计"),
        ],
        final_recipe="编码本随做随记；报告饱和度判断与编码者间一致性；编码表由脚本生成，不手抄",
        negative_lessons=["编码本事后回填等于放弃了质性研究的可信度"],
        source=f"{S}/review/skills/paper-synthesis/SKILL.md §5",
    ),

    # ── 写作层（四模式共有纪律）──────────────────────────────────────
    dict(
        scope="empirical/writing",
        method_tags=["数字漂移", "可复现性"],
        stage="S4", kind="method", result="FAIL", confidence=3.0,
        applicable_when="正文里出现任何来自结果文件的数字、表格或引用键时",
        pitfalls=["手抄导致数字漂移", "从图里目测数字", "凭记忆写引用键", "结果表手工录入"],
        attempts=[
            dict(method="把结果文件里的数字手动敲进正文", result="fail",
                 note="数字漂移是实证论文最容易被抓的硬伤"),
            dict(method="数字 / 表格 / 引用键 / 图一律由脚本生成后贴入", result="success",
                 note="正文与结果文件天然一致"),
        ],
        final_recipe="凡是能由脚本生成的东西都不许经过手：正文数字取结果文件的键、表格与图由可重跑脚本生成、引用键取文献台账、references 段由脚本导出",
        positive_lessons=["手抄是数字漂移的唯一来源，堵住它比事后核对更省事"],
        negative_lessons=["不要为了让正文好看回头改结果文件——那是改数据"],
        source=f"{S}/empirical/skills/paper-writing/SKILL.md §0",
    ),
    dict(
        scope="empirical/writing",
        method_tags=["结论强度", "因果表述"],
        stage="S4", kind="method", result="FAIL", confidence=3.0,
        applicable_when="识别策略不足以支撑因果主张，或研究本身是描述性路线时",
        pitfalls=["把相关当因果", "结论强度超过证据强度", "描述性路线里使用因果动词"],
        attempts=[
            dict(method="按直觉写因果表述", result="fail",
                 note="识别策略撑不起，属 high 严重度问题"),
            dict(method="识别策略撑不起的表述降级为'相关/关联'", result="success",
                 note="结论强度与证据强度匹配"),
        ],
        final_recipe="识别策略撑不起的表述一律降级为「相关 / 关联」；描述性路线全程不用因果动词；结论强度不得超过证据强度",
        negative_lessons=["不要用绝对化措辞（完全 / 必然 / 首次）除非有证据支持"],
        source=f"{S}/empirical/skills/paper-writing/SKILL.md §3",
    ),
    dict(
        scope="empirical/writing",
        method_tags=["可复现性", "局限外推"],
        stage="S4", kind="method", result="FAIL", confidence=3.0,
        applicable_when="S4 逐节写作自查时（每节写完立刻做，不要全写完再查）",
        pitfalls=["僵尸图表（图存在但正文没提，或正文提了但图不存在）", "局限写成一句'本研究存在一定局限'", "结构失衡"],
        attempts=[
            dict(method="全文写完再统一检查", result="fail",
                 note="问题堆积，返工代价大"),
            dict(method="逐节跑写作反射循环七项自查", result="success",
                 note="引用键 / 数字可追溯 / 图表编号 / 必备要素 / 字数比例 / 论断有证据 / 局限写边界"),
        ],
        final_recipe="每节写完立刻自查七项：引用键全在台账、正文数字可追溯、图表编号一一对应、必备要素齐全、字数结构比例、论断有证据单元、局限写外推边界",
        positive_lessons=["先写有硬数据支撑的部分（研究设计→结果），写引言时才知道要承诺什么"],
        negative_lessons=["局限要写'结论在什么范围内成立'，不是写'有局限'"],
        source=f"{S}/empirical/skills/paper-writing/SKILL.md §2",
    ),
    dict(
        scope="experiment/writing",
        method_tags=["均值±标准差", "数字漂移"],
        stage="S4", kind="method", result="FAIL", confidence=3.0,
        applicable_when="实验论文写作阶段报告指标数字时",
        pitfalls=["只报最好的一次", "把三次结果手抄进正文", "自己算一遍均值标准差"],
        attempts=[
            dict(method="从多次运行里挑最好的一次写进结果表", result="fail",
                 note="本类型最常见的失守方式"),
            dict(method="均值 ± 标准差从台账算，结果表由脚本生成", result="success",
                 note="数字与台账天然一致"),
        ],
        final_recipe="指标数字一律来自实验台账（results.tsv，脚本追加）；均值 ± 标准差从台账算，不手写、不自己重算",
        negative_lessons=["不要挑最好的一次报告，也不要把图里目测的数字写进正文"],
        source=f"{S}/experiment/skills/paper-writing/SKILL.md §0",
    ),
    dict(
        scope="style/chinese",
        method_tags=["中文稿源规范"],
        stage="S4", kind="method", result="SUCCESS", confidence=2.5,
        applicable_when="撰写中文论文稿源时（引用标准按 GB/T 7714）",
        pitfalls=["零信息量引导语（众所周知 / 不言而喻）", "靠序号堆砌代替逻辑连接"],
        attempts=[
            dict(method="按英文论文习惯直译成中文稿", result="fail",
                 note="术语前后不一致、中英混排无空格，读起来不像中文论文"),
            dict(method="术语首现给中文全称 + 英文原文，其后统一用中文", result="success",
                 note="中英文之间、中文与数字之间留空格；段落用逻辑连接"),
        ],
        final_recipe="术语首次出现给中文全称并附英文原文，其后统一用中文；中英文之间、中文与数字之间留空格；用逻辑连接而非序号堆砌；不用零信息量引导语",
        negative_lessons=["不要用「众所周知」「不言而喻」这类零信息量的引导语"],
        source=f"{S}/empirical/skills/paper-writing/SKILL.md §3",
    ),
    dict(
        scope="style/english",
        method_tags=["英文稿源规范", "hedging"],
        stage="S4", kind="method", result="SUCCESS", confidence=2.5,
        applicable_when="撰写英文论文稿源时",
        pitfalls=["时态混乱", "第一人称复数与被动语态混用导致主体混乱", "hedging 强度与识别策略不匹配"],
        attempts=[
            dict(method="混用 suggests / indicates / demonstrates", result="fail",
                 note="结论强度被措辞悄悄放大，与识别策略不匹配"),
            dict(method="按证据强度选 hedging 词并保持时态一致", result="success",
                 note="方法与结果用过去时，普遍事实用现在时"),
        ],
        final_recipe="方法与结果用过去时，普遍成立的事实用现在时；hedging（suggests / indicates / demonstrates）强度不可混用且必须与识别策略匹配；避免第一人称复数与被动语态混用",
        source=f"{S}/empirical/skills/paper-writing/SKILL.md §3",
    ),

    # ── 评审层 ────────────────────────────────────────────────────────
    dict(
        scope="review/severity",
        method_tags=["严重度判定"],
        stage="S5", kind="review", result="FAIL", confidence=3.0,
        applicable_when="给评审问题判定严重度、决定是否必须返修时",
        pitfalls=["把 high 降级成 medium 来绕过闸门", "严重度靠'感觉有多严重'判定"],
        attempts=[
            dict(method="把不服气但确实致命的问题标成 medium", result="fail",
                 note="闸门只拦 high，降级看似省事，实际只是把问题推给投稿"),
            dict(method="按'不改会不会让结论站不住/会被拒'定级", result="success",
                 note="high 一律返修，不用总分掩盖"),
        ],
        final_recipe="严重度判据是「不改会不会让结论站不住 / 学术诚信问题 / 会被直接拒」，不是感觉；任何维度出现 high 都必须返修，不能靠总分掩盖；降级必须同时改写问题描述并写明理由",
        negative_lessons=["不要用降级绕过闸门——审稿人拦的就是 high"],
        source=f"{S}/empirical/skills/paper-review/SKILL.md §2",
    ),
    dict(
        scope="review/blind-review",
        method_tags=["盲审", "评审独立性"],
        stage="S5", kind="review", result="FAIL", confidence=3.0,
        applicable_when="做自评审时，尤其是执笔者已深度参与、看不见自己默认假设时",
        pitfalls=["审自己（审稿人读过执行过程，知道'本意是什么'）", "自评通胀（分数普遍 4–5 而 issues 全是 low）", "橡皮图章（每维 5 分、issues 为空）"],
        attempts=[
            dict(method="同一上下文里自己评自己", result="fail",
                 note="执笔者会自动补齐稿子里没写的前提，审稿人不会"),
            dict(method="起一个零上下文盲审：只给稿件与证据/结果文件路径，不给对话历史", result="success",
                 note="不给写权限，只出问题清单；并明确不读经验库"),
        ],
        final_recipe="S5 加一遍零上下文盲审：只给稿件与证据层/结果文件路径，不给对话历史，不给写权限，且审稿人不读经验库（否则等于把执行者先验注进审稿人）",
        positive_lessons=["同一模型族也能显著改变结论分布，因为它看不到执笔者的默认假设"],
        negative_lessons=["不要让评审者读经验库，那会破坏盲审的成立条件"],
        source=f"{S}/empirical/skills/paper-review/SKILL.md §1 / §4",
    ),
    dict(
        scope="process/loop",
        method_tags=["空转返修"],
        stage="S5", kind="process", result="FAIL", confidence=3.0,
        applicable_when="返修轮次接近上限，或连续两轮分数与 issues 集合没有实质变化时",
        pitfalls=["空转返修（连续两轮分数一样、issues 集合一样、稿件没实质变化）", "无界循环", "只改 review.json 的措辞不算返修"],
        attempts=[
            dict(method="一轮轮继续修，不设上限", result="fail",
                 note="无界循环，每轮都在烧预算而分数不动"),
            dict(method="设轮数上限（默认 3 轮），触顶后带已知缺口交付", result="success",
                 note="把未闭合项写进局限一节并在 verdict 显式列出"),
        ],
        final_recipe="返修停止条件：无 high 且 verdict=accept，或轮数达上限（默认 3 轮）；触顶后不要无界循环，带已知缺口交付并显式列出未闭合项",
        positive_lessons=["带着已知缺口交付比'再跑一轮'更诚实也更省钱"],
        negative_lessons=["本轮必须实际改动稿件或结果文件，只改评审文件措辞不算返修"],
        source=f"{S}/empirical/skills/paper-review/SKILL.md §3 / §4",
    ),
    dict(
        scope="process/gate",
        method_tags=["阶段闸门"],
        stage="S0", kind="process", result="FAIL", confidence=3.0,
        applicable_when="判断论文流程能否进入下一阶段时",
        pitfalls=["用'我已完成了 S1'这类口头声明代替产物落盘", "阶段未过就进入下一阶段"],
        attempts=[
            dict(method="按对话里的完成声明推进阶段", result="fail",
                 note="声明与产物脱节，后面全部返工"),
            dict(method="只看产物是否存在来判断阶段是否完成", result="success",
                 note="阶段闸门不通过就不进入下一阶段"),
        ],
        final_recipe="阶段闸门看的是产物是否存在，不是口头声明；不通过不许进入下一阶段。S4 只在结果文件就位后开始，S0–S3 不写正文",
        negative_lessons=["数据和分析还没跑完就动笔，写出来的东西一定要返工"],
        source=f"{S}/../plugins/paper-common.mjs 六阶段骨架",
    ),

    # ── 工具与图表（来自调研文档，迁移门槛更高）──────────────────────
    dict(
        scope="tooling/figures",
        method_tags=["图表规范", "可复现性"],
        stage="S4", kind="tooling", result="FAIL", confidence=2.5,
        applicable_when="用 matplotlib 生成论文图表时，尤其是从第三方仓库搬来的绘图脚本",
        pitfalls=[
            "第三方脚本设了 text.usetex=True 但本机无 LaTeX 工具链，matplotlib 渲染期直接报错",
            "脚本硬编码原作者机器的绝对路径",
            "只输出 PNG 没有矢量输出，投稿时分辨率不够",
            "emoji 在 serif 字体下渲染成方框",
        ],
        attempts=[
            dict(method="直接运行从 GitHub 搬来的绘图脚本", result="fail",
                 note="usetex / 绝对路径 / 字体缺失三处都会直接报错或静默出错"),
            dict(method="先过一遍兼容检查：usetex、路径、字体族、输出格式", result="success",
                 note="输出矢量格式并显式设中文字体与负号显示"),
        ],
        final_recipe="从外部搬来的 matplotlib 脚本必查：是否设了 usetex（无 LaTeX 工具链时必须关）、是否有硬编码绝对路径、是否只输出位图；中文字体与负号显示必须显式设置；输出优先矢量格式",
        positive_lessons=["图表规范要写成可执行的具体数值（尺寸用 mm、字号用 pt、配色用 hex），而不是形容词"],
        negative_lessons=["不要直接信任外部脚本的绘图默认值"],
        tools_used=["matplotlib"],
        source="docs/研究模式调研/02-开源学术科研技能项目调研与集成方案.md §5.2 / R5（第三方调研结论，非本项目 earned 经验）",
    ),
    dict(
        scope="tooling/figures",
        method_tags=["图表规范", "色盲安全"],
        stage="S4", kind="tooling", result="SUCCESS", confidence=2.5,
        applicable_when="确定论文图表的尺寸、字号与配色时",
        pitfalls=["放大看可读、按成稿宽度看不可读", "用纯红+纯绿或 jet/rainbow 色板", "图内文字印刷后小于 7 pt"],
        attempts=[
            dict(method="按屏幕显示效果调图表", result="fail",
                 note="成稿宽度下文字不可读"),
            dict(method="按成稿宽度检查可读性，并固定尺寸与字号下限", result="success",
                 note="单栏约 89 mm、双栏约 178–183 mm；图内文字印刷尺寸下限 7 pt"),
        ],
        final_recipe="在成稿实际宽度下检查可读性，而不是放大看；固定尺寸体系（单栏约 89 mm / 双栏约 178–183 mm）与字号下限（图内文字 ≥7 pt）；用色盲安全色板，禁用纯红+纯绿与 jet/rainbow；禁用饼图",
        negative_lessons=["不要用放大后的屏幕效果判断图表可读性"],
        tools_used=["matplotlib"],
        source="docs/研究模式调研/02-开源学术科研技能项目调研与集成方案.md §7.1（第三方调研结论）",
    ),
    dict(
        scope="tooling/citation",
        method_tags=["引用真实性", "引用核验"],
        stage="S6", kind="tooling", result="FAIL", confidence=3.0,
        applicable_when="生成或核验参考文献条目时，尤其是任何让模型参与生成引用的环节",
        pitfalls=[
            "AI 生成的引用约 40% 出错",
            "五种'看起来足够真'的幻觉形态：真作者+假标题 / 真题+错年份 / 真 arXiv ID+错发表处 / 真 DOI+不存在",
        ],
        attempts=[
            dict(method="让模型直接输出参考文献", result="fail",
                 note="混合幻觉极难肉眼识别，直接进正文就是学术诚信事故"),
            dict(method="五步核验：检索 → ≥2 来源交叉验证存在 → 程序化取 BibTeX → 验证被引论断确实出现在该文 → 入库", result="success",
                 note="任一步失败即标 CITATION NEEDED 占位并主动告知"),
        ],
        final_recipe="绝不凭记忆生成引用；引用必须走核验流程且成文前整体跑一遍核验；unverifiable（库里没有外部标识）与 missing（查不到）都不许进正文",
        negative_lessons=["不要因为引用'看起来很像真的'就放行"],
        tools_used=["literature MCP", "citation_verify"],
        source="docs/研究模式调研/02-...md §5.5/§5.8 + empirical 类型包 §1 引用核验",
    ),
]


# ---------------------------------------------------------------------------
# 构建与落盘
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _feature_hash(rec: dict) -> str:
    """设计稿 §4.2：sha256(scope | sorted(method_tags) | kind | stage)[:16]"""
    key = "|".join([
        rec.get("scope", ""),
        ",".join(sorted(rec.get("method_tags", []))),
        rec.get("kind", ""),
        rec.get("stage", ""),
    ])
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def _dir_key(scope: str) -> str:
    return scope.replace("/", "-").replace(".", "-") or "unknown"


def _semantic_text(rec: dict) -> str:
    """参与向量化的文本：聚合最能表达「何时适用 + 怎么避坑」的字段。"""
    parts = [
        rec.get("scope", ""),
        " ".join(rec.get("method_tags", [])),
        rec.get("kind", ""),
        rec.get("stage", ""),
        rec.get("applicable_when", ""),
        " ".join(rec.get("pitfalls", [])),
        rec.get("final_recipe", ""),
        " ".join(rec.get("positive_lessons", [])),
        " ".join(rec.get("negative_lessons", [])),
    ]
    return " ".join(x for x in parts if x)[:2000]


def _md_content(rec: dict) -> str:
    lines = [
        "# 论文写作经验（种子）",
        "",
        f"- ID: {rec['id']}",
        f"- scope: {rec['scope']}",
        f"- stage: {rec['stage']}    kind: {rec['kind']}",
        f"- 方法标签: {', '.join(rec['method_tags']) or '-'}",
        f"- 结果: {rec['result']}",
        f"- 置信度: {rec['confidence']}（入库门槛须严格大于 {CONFIDENCE_THRESHOLD}）",
        f"- 跨项目复现数 confirmed_projects: {rec['confirmed_projects']}",
        f"- 创建时间: {rec['created_at']}",
        f"- 来源: {rec['provenance']['artifacts'][0]}",
        "",
        "> ⚠️ 本条为**技能种子**（provenance.seed = true），不是真实论文项目 earned 经验。",
        "",
        "## 适用条件（applicable_when）",
        "",
        rec["applicable_when"],
        "",
        "## 踩到的坑",
        "",
    ]
    lines += [f"- {x}" for x in rec.get("pitfalls", [])] or ["- （无）"]
    lines += ["", "## 尝试过的方案", ""]
    if rec.get("attempts"):
        for a in rec["attempts"]:
            mark = "✅" if str(a.get("result", "")).lower() in ("success", "成功", "ok") else "❌"
            note = a.get("note", "")
            lines.append(f"- {mark} {a.get('method','')} → {a.get('result','')}" + (f"，{note}" if note else ""))
    else:
        lines.append("- （无）")
    lines += [
        "",
        "## 最终做法",
        "",
        rec.get("final_recipe", "") or "（无）",
        "",
        "## 经验总结（正向）",
    ]
    lines += [f"- {x}" for x in rec.get("positive_lessons", [])] or ["- （无）"]
    lines += ["", "## 教训总结（负向）"]
    lines += [f"- {x}" for x in rec.get("negative_lessons", [])] or ["- （无）"]
    if rec.get("tools_used"):
        lines += ["", f"## 涉及工具", "", ", ".join(rec["tools_used"])]
    return "\n".join(lines) + "\n"


def build_records() -> list[dict]:
    out, seen = [], {}
    for seed in SEEDS:
        rec = dict(seed)
        rec.setdefault("pitfalls", [])
        rec.setdefault("attempts", [])
        rec.setdefault("final_recipe", "")
        rec.setdefault("positive_lessons", [])
        rec.setdefault("negative_lessons", [])
        rec.setdefault("tools_used", [])
        rec.setdefault("used_experience_ids", [])
        rec["id"] = uuid.uuid4().hex
        rec["confirmed_projects"] = 0
        rec["created_at"] = _now()
        rec["updated_at"] = rec["created_at"]
        rec["used_count"] = 0
        rec["archived"] = False
        rec["qdrant_pending"] = False
        rec["qdrant_point_id"] = None
        rec["feature_hash"] = _feature_hash(rec)
        rec["provenance"] = {
            "paper_project": None,
            "artifacts": [rec.pop("source")],
            "seed": True,
            "note": "技能种子：非真实论文项目 earned 经验，confirmed_projects 恒为 0",
        }
        dup = seen.get(rec["feature_hash"])
        if dup:
            print(f"  ⚠️ 指纹重复，跳过：{rec['scope']} / {rec['method_tags']} (与 {dup} 相同)")
            continue
        seen[rec["feature_hash"]] = rec["scope"]
        out.append(rec)
    return out


def main() -> int:
    url = os.environ.get("PAPER_MEMORY_QDRANT_URL", "").strip()
    key = os.environ.get("PAPER_MEMORY_QDRANT_API_KEY", "").strip() or None
    if not url:
        print("错误：未设置 PAPER_MEMORY_QDRANT_URL", file=sys.stderr)
        return 1

    if not DATA_DIR.is_dir():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        print(f"已创建数据目录 {DATA_DIR}")

    recs = build_records()
    print(f"构建 {len(recs)} 条种子记录")

    # 1) 本地落盘：MD + registry.json（设计稿 §4.4：本地 MD 是事实源）
    reg = {}
    for rec in recs:
        d = DATA_DIR / _dir_key(rec["scope"])
        d.mkdir(parents=True, exist_ok=True)
        ts = rec["created_at"].replace(":", "-").replace("+00:00", "Z")
        p = d / f"{ts}-{rec['id'][:8]}.md"
        p.write_text(_md_content(rec), encoding="utf-8")
        rec["md_path"] = str(p)
        reg[rec["id"]] = rec
    tmp = DATA_DIR / "registry.json.tmp"
    tmp.write_text(json.dumps(reg, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(DATA_DIR / "registry.json")
    print(f"本地已写入 {len(reg)} 条 MD + registry.json -> {DATA_DIR}")

    # 2) 向量化 + 写入 Qdrant（复用 reverse 的嵌入器，保证模型与维度完全一致）
    import memory_store as ms
    from qdrant_client import QdrantClient, models

    embedder = ms._get_embedder()
    if embedder is None:
        print("错误：嵌入模型不可用（fastembed 未就绪）", file=sys.stderr)
        return 1

    c = QdrantClient(url=url, api_key=key, timeout=60)
    print("已连接 Qdrant：", url)
    if not c.collection_exists(COLLECTION):
        c.create_collection(
            COLLECTION,
            vectors_config=models.VectorParams(size=DEFAULT_EMBED_DIM,
                                               distance=models.Distance.COSINE),
        )
        print(f"已创建集合 {COLLECTION}")

    points = []
    for rec in recs:
        vec = next(embedder.embed([_semantic_text(rec)]))
        payload = {k: v for k, v in rec.items() if k != "md_path"}
        payload["md_path"] = rec["md_path"]
        points.append(models.PointStruct(id=rec["id"],
                                        vector=[float(x) for x in vec],
                                        payload=payload))
    c.upsert(COLLECTION, points=points)
    print(f"已写入 {len(points)} 个点到 {COLLECTION}")
    print("集合点数：", c.count(COLLECTION, exact=True).count)

    # 3) readiness.json（供日后闸门插件判据，语义与 reverse 一致）
    ready = {
        "ready": True,
        "qdrant_configured": True,
        "qdrant_reachable": True,
        "qdrant_url": url,
        "error": "",
        "readonly": False,
        "threshold": CONFIDENCE_THRESHOLD,
        "collection": COLLECTION,
        "seeded_at": _now(),
        "checked_at": _now(),
    }
    (DATA_DIR / "readiness.json").write_text(
        json.dumps(ready, ensure_ascii=False, indent=1), encoding="utf-8")
    print("已写入 readiness.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
