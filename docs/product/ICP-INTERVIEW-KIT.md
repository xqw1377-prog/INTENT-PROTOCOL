# ICP Interview Kit (P1 — DIRECTION-R1)

Status: **READY — 0/10 interviews conducted.** Purpose: re-validate the
ideal customer profile before (and parallel to) EXPERIMENT-001. This is
user-evidence gathering, NOT selling. Interviews are conducted by the
Commander (their network/channels); this kit is the script + recording
discipline. Results are recorded per the evidence classes — verbatim
answers only, "no pain" is also data.

## Who to interview (target 10, mix across personas)

```text
1. AI coding 团队负责人（内部 platform/infra/dev-ex 团队）
2. 软件外包/采购负责人（按结果采购开发服务的人）
3. 技术团队负责人 / 工程总监
4. AI agent builder（做交付型 agent 产品的人）
5. 开源维护者中同时经营商业产品的（跨界视角）
```

Qualifiers: they commission or accept work they did not personally
execute. Disqualifiers: pure protocol/crypto investors (wrong question).

## The two questions (verbatim — do not improve them mid-run)

```text
Q1（痛）:
  你有没有遇到 AI/外包说任务完成，但验收标准事后扯皮？

Q2（机制意愿）:
  如果开工前把可机器判断的部分锁死，
  你愿不愿意让这部分自动成为已完成？
```

Follow-up ladder ONLY if Q1 is a yes: 让对方讲最近一次具体案例
（什么时候 / 什么任务 / 事后标准怎么变的 / 损失是什么）。If Q1 is
no: record "no pain" and stop — do not pitch.

## Rules of engagement

- 不先讲 Intent。不提区块链、协议、证明架构。与招募纪律同源。
- Q2 之前不展示任何产品/文档/截图。
- 对方的原话当场记录（或录音后逐字誊录），不转述、不概括。
- "没遇到这个问题" = 有效数据，不是失败。
- 每次访谈一条记录，追加式（不修改历史记录）。

## Recording template (one file per interview, append-only)

```text
docs/product/icp/ICP-NNN.md
  date / channel / persona / role (declared, no doxxing beyond consent)
  Q1_ANSWER_VERBATIM:   "…"
  CASE (if any):        when / task / how the bar moved / cost
  Q2_ANSWER_VERBATIM:   "…"
  classification: PAIN-CONFIRMED | NO-PAIN | PAIN-BUT-MECH-REFUSED
  note: nothing else. No product evaluation, no scoring.
```

## What this converts (P1 evidence lines)

```text
ICP INTERVIEWS          = 0 → 10
PAIN-CONFIRMED          = ? (how many of 10 hit post-hoc bar-moving)
MECHANISM-WILLING       = ? (how many accept "locked = done")
```

These lines feed the DIRECTION-R1 question — 谁会为 Frozen Outcome
买单 — and gate EXP-002 targeting: P2 payer candidates come FIRST from
PAIN-CONFIRMED ∧ MECHANISM-WILLING interviewees.
