---
name: code-review
description: Review changes since a fixed point through three independent axes—Standards and architecture, Specification and domain correctness, and Verification and regression safety. Use when the user asks to review a branch, pull request, or work-in-progress diff; asks to review since a commit, branch, tag, or merge base; or asks to run the local pre-push convergence gate, fix review findings, or prepare changes for publication.
---

# Convergent Code Review

Review one pinned diff through three independent axes. When the user authorizes fixes or publication, repeat complete rounds until every axis reports zero blockers. When the user asks only for a review, report findings without modifying files.

Read `docs/agents/code-review.md` before starting. Use its finding contract and publication rules.

## 1. Pin the review target

Resolve the fixed point supplied by the user. If none is supplied, use the target branch of the current pull request; otherwise use the repository's default branch and state that assumption.

Resolve one immutable merge base:

```bash
git merge-base <fixed-point> HEAD
```

Capture all of the following for every reviewer:

- The resolved merge-base SHA.
- `git diff <merge-base>` so committed, staged, and unstaged changes are included.
- `git status --short` and the contents of relevant untracked files, because Git diff omits them.
- `git log <merge-base>..HEAD --oneline`.

Fail early if the fixed point does not resolve or the complete target is empty. Keep the same merge base for every reviewer and every later round unless the target branch itself changes.

## 2. Resolve requirements and standards

Find the originating specification in this order:

1. GitHub issue or PR references in commit messages or branch metadata.
2. A source explicitly supplied by the user.
3. A matching PRD, ADR, or specification under `docs/`.
4. The relevant settled domain material in `CONTEXT.md` and `docs/grid/`.

If no originating specification exists, say so. Do not invent one; review settled repository requirements that still apply.

Standards sources always include `AGENTS.md`, `docs/agents/`, relevant package documentation, and any task-relevant local skills. Load conditional skills only when the diff touches their concern.

## 3. Run three independent reviewers

Spawn three read-only sub-agents in parallel. Give each the same review target, commit list, status, and requirement sources. Do not show a reviewer another reviewer's findings.

Every reviewer must use this output contract:

- `BLOCKING: <count>`
- `NON-BLOCKING: <count>`
- For each finding: severity, file and line, concrete evidence, violated rule or requirement, impact, and smallest credible fix.
- Explicit zero counts when clean.
- No findings unrelated to the reviewed diff.

### Standards and architecture reviewer

Check documented repository rules, architecture, ownership, module depth, public/private seams, React Compiler constraints, and performance rules. Look for duplicated policy, type erasure, unnecessary abstraction, hot-path React state, and divergence from approved technology boundaries. Treat stylistic preferences as non-blocking unless the repository explicitly requires them.

### Specification and domain reviewer

Check the originating issue or PRD, `CONTEXT.md`, relevant ADRs, and relevant `docs/grid/` decisions. Report missing or partial requirements, incorrect behavior, scope creep, terminology drift, and contradictions with settled decisions. Quote or cite the requirement behind every finding.

### Verification and regression reviewer

Check whether the validation evidence and tests prove the changed behavior. Inspect behavioral tests, public TypeScript inference and rejection tests, package exports, accessibility, React Compiler behavior, performance instrumentation, and relevant failure or concurrency paths. Do not repeat direct formatter, lint, or compiler diagnostics; report missing or misleading evidence and untested risks.

## 4. Aggregate without masking axes

Report the three results separately under:

- `## Standards and architecture`
- `## Specification and domain`
- `## Verification and regression safety`

Preserve each reviewer's severities. Deduplicate only exact duplicates and note which axes independently found them. End with blocking and non-blocking totals for each axis.

## 5. Converge when authorized

If the user requested only a review, stop after the report.

If the user authorized fixes or publication:

1. Fix every blocking finding. Also fix accepted actionable non-blocking findings from local agents or other remote reviewers; disputed non-blocking findings require a recorded rationale rather than silent omission.
2. Run affected focused validation, then the repository-required checks.
3. Start a fresh round with all three reviewers against the updated complete target.
4. Repeat until one complete round reports zero blockers on all axes and validation is green.
5. Commit and push only after that clean round.
6. Wait for required GitHub checks and, at minimum, completed GitHub Codex and CodeRabbit reviews. Codex and CodeRabbit are explicit repository minimums even when no checked-in integration configuration exists; trigger them through supported pull-request integrations or commands. A missing, pending, skipped, or unavailable required review is incomplete work and blocks publication; do not treat the absence of feedback as approval. Also wait for any other reviewer configured as required by the repository.
7. If remote feedback causes any change, fix the findings locally, rerun validation, and restart the complete three-reviewer loop before pushing. Blocking findings cannot be waived; record the rationale for disputed non-blocking findings.
8. Merge only when local review, required checks, and required GitHub reviews are clean.

An earlier clean report is stale as soon as the reviewed files change.
