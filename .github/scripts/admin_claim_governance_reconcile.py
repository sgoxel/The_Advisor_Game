#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
README = ROOT / "README.md"
WORKER = ROOT / ".github" / "WORKER_ROTATION.md"
ROADMAP = ROOT / "ROADMAP.json"
TODO = ROOT / "TODO.json"

POLICY_EPOCH = "admin-2026-09-01-claim-continuity-stale-3h"
POLICY_DATE = "2026-09-01"
TIMEOUT_HOURS = 3

README_WORKER_BLOCK = """Worker runs are work-conserving: starting from the applicable role, a Worker should continue through eligible work and roles rather than stopping after one task. **Before unrelated work, a persistent Worker must reconcile its own unfinished claim history and resume any open issue for which that same Worker still has a safe authorized action.** An executable owned issue outranks the rotation cursor, capacity expansion, a new issue, an easier issue, or a preferred role. A Worker may move to unrelated work only when every unfinished owned issue is in a genuine evidenced mandatory wait with no safe owner action remaining.

A mandatory wait must not become an indefinite lock. When the remaining action requires nonterminal external/CI evidence, an independent Worker, an unsatisfied hard prerequisite controlled elsewhere, or unavailable required Admin/external input, the owner records the blocker and resume trigger, clears exclusive ownership, and retains non-exclusive continuity responsibility. If correction work later becomes executable again, the responsible Worker resumes it ahead of unrelated work. Difficulty, size, investigation cost, or context pressure are not mandatory-wait reasons.

Ownership protection is **target-scoped and time-bounded**. A valid exclusive `WORK-CLAIM` protects only the named issue/task. Claiming issue A creates no ownership over issue B, related tasks, dependencies, a phase, a role, the cursor or the project. An exclusive claim becomes **stale and invalid after more than three hours without a qualifying action by that same Worker on that exact issue**. Claim creation starts the three-hour window. A qualifying action must show concrete target progress or a material target-state decision/evidence update; empty heartbeats, repeated status-only comments, unrelated work, or re-fetch-only activity do not refresh the window. Before treating a claim as a collision blocker or taking over a stale claim, Workers must inspect the exact issue history and timestamps. Stale invalidation removes collision protection but does not erase authorship, independence restrictions, audit history, or any non-exclusive responsibility to resume if the issue has not already been validly taken over/completed.

Multiple Workers may overlap in time on non-conflicting eligible targets. A Worker encountering an expired claim records the stale-claim evidence before takeover and then uses the normal exact-target claim/re-fetch safety check."""

STALE_SECTION = """## Three-hour stale exclusive-claim expiry

Exclusive claim protection has a sliding maximum inactivity window of **3 hours**.

### Clock and qualifying action

- The initial `WORK-CLAIM` comment starts the clock for that exact Worker + exact issue.
- The clock is refreshed only by a **qualifying action from the same Worker on the same issue**.
- A qualifying action must contain concrete target progress or a material target-state decision/evidence update, such as a target-linked commit/PR/handoff, implementation/design/test/review evidence, a revision decision/correction, or an exact continuation checkpoint that records newly completed work/evidence and the next safe action.
- Empty heartbeat/status comments (`still working`, `claim refresh`, etc.), repeated unchanged blocker text, re-fetch-only activity, activity on another issue, cursor/rotation comments, or unrelated commits do **not** refresh the clock.
- Mandatory external/independent waits must use the non-exclusive parking protocol above; they must not keep an exclusive claim alive merely by periodic comments.

### Expiry

If **more than 3 hours** have elapsed since the most recent qualifying same-Worker/same-issue action, the exclusive claim is automatically **STALE / INVALID** and has zero collision-blocking effect.

Before ignoring or taking over a claim as stale, the acting Worker must:

1. fetch the full exact-target issue history;
2. identify the original claim and the most recent qualifying action by that Worker on that issue;
3. verify from timestamps that more than 3 hours have elapsed;
4. confirm no later qualifying action renewed the claim;
5. record `STALE WORK-CLAIM INVALIDATED(worker=..., issue=..., claim_comment=..., last_qualifying_action=..., inactive_for=..., checked_at=...)` on the issue;
6. only then use the normal two-phase exact-target claim -> immediate re-fetch check before writing.

A stale claim does not need consent from the inactive Worker to expire. A later invocation of the original Worker must treat the stale claim as non-exclusive historical responsibility, inspect whether another Worker has validly taken over/completed the target, and reacquire normally only if the target is still available.

### Hard-limit continuation

A hard execution/context/tool cutoff may keep an executable exclusive claim only while the three-hour validity window remains satisfied. The Worker records an exact continuation checkpoint and must resume on its next invocation. If no qualifying same-target action occurs for more than three hours, that preserved claim still expires automatically and may be taken over safely using the stale-invalidation protocol.

### Classification and audit

Only **valid, non-stale exclusive claims** belong in collision/live-claim blocker classifications. Stale claims are invalidated first and then the target is reclassified from live state. Run/audit output should identify stale invalidations separately (`stale_claims_invalidated_this_run`, `stale_claim_issue_ids`) whenever any are found.

"""


def replace_once(text: str, pattern: str, replacement: str, *, flags: int = 0, label: str) -> str:
    new, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label} replacement, got {count}")
    return new


def apply_readme() -> None:
    text = README.read_text(encoding="utf-8")
    pattern = (
        r"Worker runs are work-conserving:.*?"
        r"Multiple Workers may overlap in time on non-conflicting eligible targets\."
    )
    text = replace_once(text, pattern, README_WORKER_BLOCK, flags=re.S, label="README Worker governance block")
    README.write_text(text, encoding="utf-8")


def apply_worker_protocol() -> None:
    text = WORKER.read_text(encoding="utf-8")

    text = text.replace(
        "- every exact-target live `WORK-CLAIM` issued by that same Worker and not subsequently cleared or closed;",
        "- every exact-target `WORK-CLAIM` issued by that same Worker, whether it is still valid under the three-hour stale rule, and whether it was subsequently cleared or closed;",
    )
    text = text.replace(
        "- an earlier live conflicting **exclusive** `WORK-CLAIM` exists on that exact target;",
        "- an earlier valid, non-stale conflicting **exclusive** `WORK-CLAIM` exists on that exact target;",
    )
    text = text.replace(
        "has no earlier live conflicting exclusive exact-target claim",
        "has no earlier valid non-stale conflicting exclusive exact-target claim",
    )
    text = text.replace(
        "abandon the claim if an earlier conflicting exclusive claim exists.",
        "abandon the claim if an earlier valid non-stale conflicting exclusive claim exists. If an apparent earlier claim is older than three hours, apply the stale-invalidation protocol before deciding collision state.",
    )

    if "## Three-hour stale exclusive-claim expiry" not in text:
        marker = "## Maximum work-conserving execution\n"
        if marker not in text:
            raise RuntimeError("WORKER_ROTATION maximum-execution marker not found")
        text = text.replace(marker, STALE_SECTION + marker, 1)

    old_priority = "6. After every material state change, and before every new unrelated claim, re-check own waiting responsibilities. If a resume trigger has become true, return to that older owned issue at the next atomic checkpoint before claiming further work."
    if old_priority in text and "own stale claim" not in text:
        text = text.replace(
            old_priority,
            old_priority
            + "\n7. If an own historical claim has expired under the three-hour rule, it is no longer exclusive. Before resuming it, inspect whether another Worker validly took over or completed the issue; reacquire normally only when the target remains available.",
            1,
        )

    # Make stale invalidation an explicit eligibility-changing event.
    text = text.replace(
        "Useful work or any eligibility-changing event resets the empty-pass stop gate.",
        "Useful work or any eligibility-changing event, including stale-claim invalidation, resets the empty-pass stop gate.",
    )

    WORKER.write_text(text, encoding="utf-8")


def claim_policy_object() -> dict:
    return {
        "policy_date": POLICY_DATE,
        "governance_issue": 97,
        "exclusive_claim_timeout_hours": TIMEOUT_HOURS,
        "own_claim_resume_priority": "Before unrelated work, a Worker resumes its own open issue when that issue has a safe authorized owner action.",
        "new_unrelated_claim_condition": "Allowed only when every unfinished own responsibility has no safe owner action and is in an evidenced mandatory wait, or when no unfinished own responsibility exists.",
        "mandatory_wait": "Record blocker/evidence/resume trigger, clear exclusivity, retain non-exclusive responsibility, and do unrelated work without blocking the required independent/external action.",
        "stale_rule": "An exclusive WORK-CLAIM is automatically invalid after more than 3 hours since the same Worker's last qualifying action on the exact issue.",
        "qualifying_action": "Concrete same-target progress or a material same-target decision/evidence update; heartbeat/status-only, unchanged blocker, re-fetch-only, unrelated issue activity and unrelated commits do not refresh.",
        "takeover": "Fetch full exact-target history, prove >3h inactivity since last qualifying action, record STALE WORK-CLAIM INVALIDATED, then use normal claim/re-fetch collision safety.",
        "stale_effect": "Expiry removes collision protection only; it does not erase authorship, independence restrictions, audit history or historical responsibility.",
    }


def apply_json_policy(path: Path, *, todo: bool) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    data["planning_epoch"] = POLICY_EPOCH
    data["worker_claim_policy"] = claim_policy_object()

    recon = data.setdefault("readme_reconciliation", {})
    recon["governance_issue"] = 97
    recon["admin_claim_continuity_policy_issue"] = 97
    recon["admin_claim_continuity_policy_date"] = POLICY_DATE
    recon["admin_claim_timeout_hours"] = TIMEOUT_HOURS

    if todo:
        data["authority_note"] = (
            "Current README authority includes the Admin-authorized 2026-09-01 Worker claim-continuity policy: "
            "Workers resume executable own claims before unrelated work; mandatory waits clear exclusivity while retaining responsibility; "
            "and exclusive claims expire after >3 hours without a qualifying same-Worker/same-issue action. "
            "R04 remains the single active phase; product scope, task ordering/dependencies, verified work and release prerequisites are unchanged by this governance reconciliation."
        )
        data["live_state_note"] = (
            "Workers are concurrent. Exact issue history is the volatile ownership source. Only valid non-stale exclusive claims block collisions; "
            "a claim older than 3 hours since the same Worker's last qualifying same-target action is invalid after documented stale verification. "
            "Mandatory-wait responsibility is non-exclusive. TODO owns active phase ordering/dependencies and must be re-fetched after material changes."
        )
    else:
        data["planning_basis"] = (
            "R03 remains completed and R04 remains the single active phase. Admin-authorized README governance reconciliation on 2026-09-01 "
            "adds Worker own-claim resume priority, non-exclusive mandatory-wait parking, and automatic expiry of exclusive claims after more than "
            "3 hours without a qualifying same-Worker/same-issue action. This changes execution ownership mechanics only; no product phase, scope, "
            "dependency, acceptance criterion, verified work, capacity target, or release prerequisite is changed."
        )

    cap = data.setdefault("planner_capacity_policy", {})
    cap["immediately_executable_definition"] = (
        "Open current/earlier work whose real dependencies are satisfied and an authorized role can act on now; it has no valid non-stale "
        "conflicting exclusive target WORK-CLAIM, no role-blocking unresolved revision, and no required external wait before that role's next safe action. "
        "Stale >3h claims are invalidated before classification; non-exclusive mandatory-wait responsibility is not a collision blocker."
    )

    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def link_reconciliation_commit(commit: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise RuntimeError(f"Invalid governance commit SHA: {commit!r}")
    for path in (ROADMAP, TODO):
        data = json.loads(path.read_text(encoding="utf-8"))
        recon = data.setdefault("readme_reconciliation", {})
        recon["readme_commit"] = commit
        recon["admin_claim_governance_commit"] = commit
        path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def validate() -> None:
    json.loads(ROADMAP.read_text(encoding="utf-8"))
    json.loads(TODO.read_text(encoding="utf-8"))
    readme = README.read_text(encoding="utf-8")
    worker = WORKER.read_text(encoding="utf-8")
    required_readme = [
        "three hours without a qualifying action",
        "resume any open issue",
        "mandatory wait",
    ]
    required_worker = [
        "## Three-hour stale exclusive-claim expiry",
        "STALE WORK-CLAIM INVALIDATED",
        "Only **valid, non-stale exclusive claims**",
    ]
    for needle in required_readme:
        if needle not in readme:
            raise RuntimeError(f"README validation missing: {needle}")
    for needle in required_worker:
        if needle not in worker:
            raise RuntimeError(f"WORKER_ROTATION validation missing: {needle}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("apply", "link", "validate"))
    parser.add_argument("--commit")
    args = parser.parse_args()

    if args.mode == "apply":
        apply_readme()
        apply_worker_protocol()
        apply_json_policy(ROADMAP, todo=False)
        apply_json_policy(TODO, todo=True)
        validate()
    elif args.mode == "link":
        if not args.commit:
            raise SystemExit("--commit is required for link mode")
        link_reconciliation_commit(args.commit)
        validate()
    else:
        validate()


if __name__ == "__main__":
    main()
