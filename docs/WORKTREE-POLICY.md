# Intent Protocol Worktree Isolation Policy

Status: COMMANDER RULE / EFFECTIVE IMMEDIATELY

## Rule

Builder A (implementation) and Builder B (independent verification) MUST operate from separate Git worktrees or separate clean clones.

A shared mutable checkout is forbidden for concurrent Builder work.

## Required properties

- each Builder has its own filesystem working tree;
- each Builder stays on its assigned branch;
- no Builder may `checkout`, `switch`, `reset`, or rebase the other Builder's worktree;
- gate evidence MUST bind to pushed immutable commit SHAs, never to a live shared worktree;
- Builder B captures SUT bytes from the Git object database for the exact target SHA;
- local worktree state is never accepted as G1 evidence.

## Reason

The shared-checkout workflow already caused cross-Builder branch switching and apparent file disappearance during P0-S0. This creates provenance ambiguity and can invalidate independent verification.

## Gate implication

Violation during a gate run invalidates that run's evidence. The run must be repeated from isolated worktrees/clones against the same immutable target SHA.
