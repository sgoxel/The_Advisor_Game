# Worker Rotation Control

This file documents the ChatGPT Worker rotation protocol only. It is not product scope, phase planning, release authority, or a replacement for README/ROADMAP/TODO/issues.

## Worker identities

Five independent scheduled Workers exist:

- Worker #1
- Worker #2
- Worker #3
- Worker #4
- Worker #5

All five use the same Worker profile. Each scheduled run obtains exactly one rotating role from the control issue referenced by the active Worker prompt.

## Role cycle

`Planner -> Coder -> Designer -> Tester -> Reviewer -> Planner`

The role advances when a Worker claims it, not when the Worker finishes. This allows the next scheduled Worker to take the next role even if the preceding Worker is still running.

## Independence

A Worker must never independently approve its own implementation, design, revision, or fix from an earlier role/run. If the selected Tester or Reviewer role would evaluate work created by the same Worker identity, it must skip that target and select another eligible target, or report no eligible independent target.

## Reviewer purpose

Reviewer is a process-improvement and maintenance role. It inspects the end-to-end development process, GitHub state, CI/Actions, automation behavior, bottlenecks, recurring defects, stale claims, performance/reliability problems, and avoidable friction. It may implement a scoped bug fix or infrastructure/process improvement when supported by an issue and evidence, but any code/design change still requires later independent Tester verification. Reviewer never phase- or release-approves its own changes.

## Rotation state

The canonical rotation cursor is the latest valid `WORKER ROTATION STATE:` JSON comment on the dedicated GitHub control issue. Workers append state comments; they do not rewrite history.
