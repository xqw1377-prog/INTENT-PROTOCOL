# INTENT PROTOCOL — Product Overview

Status: **CURRENT PRODUCT NARRATIVE (R3, 2026-10-22).** R2 narrative =
Commander PASS. R3 applies **DIRECTION-R1** (full-project audit ruling,
docs/product/DIRECTION-R1.md): engineering declared SUFFICIENT FOR
VALIDATION (STOP list in force); OSS bounty demoted FIRST MARKET →
FIRST LAB; product repositioned as an **AI work acceptance layer**
hypothesis pending P1 interviews; the project's main question is now
"谁会为 Frozen Outcome 买单？". Change discipline: any change that
widens a standing boundary requires a Commander ruling first.

---

## 第一屏 — 用户为什么需要它（LAYER 1 · USER PROBLEM）

```text
Intent 让双方在开工前把"什么算完成"冻结。

完成以后，
机器只回答一个问题：

这部分结果，
按开工前的规则，
是不是已经赚到了？
```

**Freeze the rules before work. Prove the outcome after work.**

三个支柱：**规则可冻结 · 结果可复演 · 结论可独立验证。**

两边用户各自的痛点：

```text
WORKER      "我不想做完以后才发现，对方又换了一套标准。"
MAINTAINER  "我不想为一个看起来完成、但实际没满足标准的东西付钱。"
```

```text
PRODUCT FIRST PRINCIPLE（产品第一原则）
  Mechanical entitlement cannot be retroactively converted into
  discretionary entitlement.
  （机械判定的应得，不得事后转化为自由裁量的恩赐。）

BRAND 第二句（品牌层，不作第一句解释产品）
  You may reserve the right to reject.
  You may not reserve the right to disappear.
```

> 项目主问题（DIRECTION-R1 起）：**谁会为 Frozen Outcome 买单？**

## 市场入口与 ICP（DIRECTION-R1 裁定）

```text
OSS bounty   = FIRST LAB（保留为首个实验场）
             ≠ FIRST MARKET（不再默认为商业入口）
```

依据（round-2 招募空交集 = 产品证据，非运营问题）：有付费文化的
repo 大/复杂/server/网络绑定/pnpm-bun，不满足 R0 机器条件；技术
最干净的 repo 多为 hobby/非商业，维护者拒绝付费角色。

当前能力真正指向的假设（**待 P1 验证，不是主张**）：

```text
PRODUCT HYPOTHESIS = AI WORK ACCEPTANCE LAYER
  企业/团队把工作交给 AI、外包或 agent 执行时，
  "什么算完成"在开工前冻结、交付后独立复演、
  达标部分自动成为已完成。
```

P1 = 访谈 10 人（AI coding 团队 / 外包采购 / 技术负责人 / agent
builder / 按结果采购者），两问定案（痛 + 机制意愿）——工具包：
docs/product/ICP-INTERVIEW-KIT.md。竞争面（2026-10 核查）：TaskBounty
验证不授权付款、openbounty 仍是 mock-payment MVP、Taskuler 卖
escrow+沉默超时+仲裁；"再做赏金+结算"无差异，独特性锁定在
**Frozen Outcome**。

## LAYER 2 · PRODUCT — Frozen Outcome Contract

```text
PRODUCT       = Frozen Outcome Contract
USER PROMISE  = Rules before work. Proof after work.
                No moving the goalposts.
```

产品动作只有三步：

```text
开工前    冻结完成条件（哪条测试必须红→绿、哪些文件可改、补丁多大）
交付后    独立验证（另一台机器从冻结基线复演，机器下结论）
达到条件  明确什么已经 EARNED —— 并且 EARNED ≠ PAID（边界见 §6）
```

## LAYER 3 · PROTOCOL — 结论为什么可信（HOW，不是 WHAT）

这一层是产品实现，不是产品本体。用户买的是 §LAYER 1 的承诺；
以下只是承诺成立的工程原因。

```text
ENGINE         UE-0..UE-5 证据机器（双哈希冻结契约 · 干净房间 ·
               净禁沙箱执行 · 9 文件证明包 · 只追加账本）
               = PASS / FROZEN-R0
EXPERIMENT UI  Local Orchestrator（F1 冻结/预commit → F2 冻结任务视图
               → F3 单次补丁 → F4 双阶段验证 → F5 承认 + 已验证账本视图）
               = PASS / FROZEN-R0
TRUST          可携验证器 + 包外信任锚（证明包永远不能为自己背书；
               第三方可离线复演）
(HELD)         链上结算原语 — testnet 已证明、不属于当前实验产品、
               未获任何部署授权
```

全部为技术证据（机器可验证）；全部至今在本地/模拟环境达成。

## 诚实的计分板（不变）

```text
REAL PAYER                                 = 0
REAL TASK                                  = 0
REAL EXTERNAL WORKER                      = 0
PAYER PRE-COMMIT TO TIER-1 ENTITLEMENT    = NO-EVIDENCE
PAYER ACCEPTS PROOF AS SUFFICIENT POST-HOC= NO-EVIDENCE
WILLINGNESS TO REPEAT-FUND                = NO-EVIDENCE
PRODUCT-MARKET FIT / DEMAND / VIABILITY   = UNPROVEN
```

证据纪律（保留）：**技术证据（VERIFIED）与用户证据（OBSERVED）永远
分开记录，绝不互相冒充。**

## 实验阶梯（N2 修正）——三级实验，各答各的问题

赞助制（AMENDMENT-1）事实上已把原"商业验证"拆成了两半；这里正式
命名，防止把一次赞助实验的成功解释过头。

```text
EXPERIMENT-001 = MECHANISM ACCEPTANCE（当前 · 赞助制）
  Question:
    Will a real maintainer freeze the rules before seeing the solution,
    and honor the mechanically proven result afterward?
  能验证：
    A. maintainer 愿不愿意事前冻结客观完成标准
    B. maintainer 愿不愿意接受"机器已证明完成"
    C. worker 是否愿意在冻结规则下工作
  不能验证：
    D. maintainer 愿不愿意掏钱
    E. 有真实预算时是否愿意让 entitlement 约束自己
    F. 是否愿意重复购买

EXPERIMENT-002 = ECONOMIC ACCEPTANCE（未开始）
  Question: Will a real payer put real money behind the same rule
  structure?

EXPERIMENT-003 = REPEATABILITY（未开始）
  Question: Will the same payer fund another one?

阶梯纪律：
  任何一级的结论不得被引用为更高一级的结论。
  EXPERIMENT-001 成功 ≠ 商业模式成立 —— 最多证明：
  "规则冻结 + 独立证明"这个机制，有人愿意接受。
  赞助运行的结论一律带 (SPONSORED-RELATIONSHIP) 标注。
```

现场状态：EXPERIMENT-001 招募第三轮（赞助条款），2026-10-22 二次
接触已发，**UNANSWERED**。一次实验，即使成功，也不是 PMF 证据。

## 楔子（冻结于 PRODUCT-THESIS-R0，此处只引用）

首笔真实交易刻意收窄：仓库所有者 + 一个可回归验证的 bug + 外部
worker；几乎全部落在 Tier-1；第四问（什么已经不可撤销）与反消失
比较学（Upwork/Fiverr 的沉默后果是商业已证原语）见冻结论题卡。
Tier-1 聚焦不变，不做"大协议"。

## 与白皮书的关系（V0.1，2026-09-17）

白皮书与技术架构 V0.1 = **长期 Intent Infrastructure 愿景层**——
Intent Contract、执行层、一等公民体系、结算基础设施。叙事地位：
**HISTORICAL VISION，广度未验证。** 其中没有任何内容被证伪；产品
是刻意收窄（PT-5R 首卡纪律）。映射：Proof 支柱 → 已实现为证据链；
Settlement → testnet 原语已证明、被持有；其余 → 未来工作，且以尚
不存在的用户证据为门。**产品主张只引用本文档及其下冻结层，不引用
愿景层。**

## 文档地图

```text
docs/product/OVERVIEW.md                  ← 你在这里；当前叙事（R2）
docs/product/PRODUCT-THESIS-R0.md         冻结论题卡（楔子、分层、首实验设计）
docs/product/FRONTEND-R1-SPEC.md          冻结产品规格（F1–F5、D1–D9、验收契约）
docs/product/FRONTEND-R1.md
docs/experiments/EXPERIMENT-001.md        章程 + 冻结信任锚（MECHANISM ACCEPTANCE）
docs/experiments/EXPERIMENT-001-OPS.md    操作手册 / 首联模板 / 筛查清单
docs/experiments/EXPERIMENT-001-CANDIDATES.md  招募日志（活）
docs/AMENDMENTS.md                        受治变更（含 AMENDMENT-1 赞助裁定）
docs/USER-EVIDENCE-R0.md                  UE 机器门记录
docs/GOVERNANCE-LEDGER.md                 治理台账（2026-10-25 自 README 原样移出）
README.md                                 评委入口（hackathon 包装；产品叙事仍以本文为准）
docs/*.docx (Whitepaper / Tech Arch V0.1) 历史愿景层
```

## 常设边界（不变）

PRE-MONEY / 象征金额 · 单人认领 · 仅 Tier-1 · 无自动放款 · 实验不
需链写入 · MAINNET DENIED · REAL FUNDS DENIED · TOKEN NOT-IN-SCOPE ·
协议扩张 / 统一 CLI / 实验以外 UI / 付款 / 并发认领 / Tier-2 引擎 =
HOLD。下一阶段的问题只有一个：**真实的人为什么愿意使用这套规则。**
