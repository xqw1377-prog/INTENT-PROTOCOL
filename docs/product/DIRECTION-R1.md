# DIRECTION-R1 — Full-Project Audit Ruling (Commander, 2026-10-22)

Status: **RATIFIED RULING — registered verbatim-intent by the operator.**
This is the governance record of the Commander's full-project audit.
Product truth lives in OVERVIEW.md; this document is the ruling OVERVIEW
implements.

## Verdict block (Commander's own)

```text
INTENT PROTOCOL / FULL PROJECT AUDIT

技术成立度        = A
协议严谨度        = A
证据纪律          = A
产品定义          = B+ → 正在变成 A-
前端实验能力      = A-
真实用户验证      = D
付费验证          = F / NO-EVIDENCE
市场入口选择      = C-
商业模式完成度    = D
项目总体方向      = PASS
继续扩技术        = HOLD
继续做真实实验    = MUST
```

> 没有走偏，但出现了比"走偏"更危险的问题：**技术完成度远远跑在
> 用户价值验证前面。** 最大风险不是做不出来，而是可能做出了一个
> 非常完整、严谨、甚至独特的机制，但还没证明真实的人足够痛、愿意
> 采用，更没证明有人愿意付钱。

核心叙事（R2）= **PASS**："把可客观验证的工作，事先冻结验收标准，
事后让结果而不是人情决定已经赚到什么。"

## STOP list (governance change — the most important of this ruling)

```text
NO MORE（除非真实用户实验暴露 blocker）:
  协议功能 / Solana 功能 / Mainnet / Token / Tier-2 / 并发 claim /
  Marketplace / 钱包 / 账户系统 / 复杂 UI / 新 proof primitive /
  新的"完整性"工程
```

Engineering = **SUFFICIENT FOR VALIDATION**. Any chain-side production
expansion with real payer = 0 is technical interest, not product
progress. Frontend: no further development unless an experiment
participant says they cannot use it.

## Repositioning — OSS bounty demoted from FIRST MARKET to FIRST LAB

Round 2's empty intersection is **PRODUCT EVIDENCE, not an ops problem**:

- repos with pay culture → large / complex / server-app / network-bound /
  pnpm-bun / integration-heavy — they fail the R0 machine's conditions;
- tech-clean repos (e.g. gcode-preview) → hobby / non-commercial —
  maintainers decline the payer role.

What the current capability actually validates is closer to:

> **AI 工作的可验证验收层（AI WORK ACCEPTANCE LAYER）** — not a new
> bounty site.

Promising ICP hypothesis (to be tested, not claimed): 企业软件团队 /
AI coding 团队 / 软件外包负责人 / AI agent builder / 按结果采购开发
服务的人 — "AI 说完成了，管理者为什么相信？acceptance 是否事前
确定？"

Competitive check (2026-10): TaskBounty's verification grants no
payment authority (creator selection retains discretion); openbounty is
a mock-payments MVP; Taskuler sells escrow + silence timeout +
arbitration. "我们也做赏金+结算"没有足够差异 — Intent's uniqueness
stays locked on **Frozen Outcome**, not marketplace.

## The three active lines (P0 / P1 / P2)

```text
P0  跑出 EXPERIMENT-001（1 real maintainer / 1 task / 1 external
    worker / 1 frozen agreement / 1 delivery / 1 replay / 1 real
    acknowledgment）。当前 #530 等回复；二次拒绝 → CLOSE gcode-preview，
    不做第三次联系。
P1  重新验证 ICP — 并行访谈 10 人（AI coding 团队、外包负责人、
    技术负责人、agent builder、按结果采购者）。问的不是"Intent 好不好"
    而是"你有没有遇到 AI/外包说完成、验收标准事后扯皮？"以及
    "开工前把可机器判断部分锁死，你愿不愿意让这部分自动成为已完成？"
    这比继续搜索 GitHub bounty 更重要。Kit: docs/product/
    ICP-INTERVIEW-KIT.md
P2  EXPERIMENT-002 (ECONOMIC ACCEPTANCE) — 找真实 payer，$20–$100
    即可；重要的是他自己的钱是否愿意接受 Frozen Outcome 的约束。
    这才是第一个商业信号。
```

## Project completion scorecard (Commander's own)

```text
核心协议逻辑 95% · 证据/验证机器 95% · Testnet settlement proof 90%
实验前端 90% · CI/工程治理 90% · 产品定义 80% · 用户问题验证 15%
Mechanism acceptance 0% real evidence · Economic acceptance 0%
Repeatability 0% · 商业模式 10% · PMF 0%

作为创业项目 ≈ 45% —— 不是代码没做完，而是最困难的后一半现在才
真正开始。
```

Correct sequencing (no pricing/take-rate/tokenomics/marketplace-fee/
subscription work until a payer exists): 机制接受 → 真实 payer →
第二次支付 → 才谈 pricing.

## Document discipline ruling

```text
OVERVIEW.md            = current product truth
README.md              = governance truth
Frozen historical docs = historical evidence
```

Do NOT rewrite old documents into "current state" (e.g. the
PRODUCT-THESIS-R0 "awaiting adjudication" header stays as history).
Governance weight grows if history is constantly rewritten.

2026-10-25 packaging note: the governance ledger text was moved
verbatim to docs/GOVERNANCE-LEDGER.md. README.md is the judge entry.
This note does not reopen the ruling.

## The new main question

> 从今天起，项目的主问题从"协议还有什么没做完？"
> 正式改为：**"谁会为 Frozen Outcome 买单？"**

这一步验证出来，Intent 才从一个优秀的协议工程项目，开始变成一个
公司。
