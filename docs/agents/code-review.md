# Code review convergence

BrunoTable uses review as a convergence loop, not a one-time report. A change is publishable only after one complete local round has zero blocking findings across three independent review axes and all required validation is green.

## Review target

Pin one merge base before starting a round. For a branch targeting `main`:

```bash
git fetch origin main
git merge-base origin/main HEAD
```

Review everything after that merge base, including committed, staged, unstaged, and untracked files. Capture the commit list and `git status --short` with the diff so every reviewer sees the same target. Do not silently change the base between reviewers in one round.

## The three axes

Run all three reviewers independently and in parallel. Reviewers must not see one another's findings before reporting.

### Standards and architecture

Check the diff against `AGENTS.md`, repository conventions, relevant skills, package boundaries, React Compiler constraints, and the documented performance architecture. Look for unnecessary seams, leaky abstractions, duplicated policy, hot-path React state, type erasure, and changes that contradict the intended ownership model.

### Specification and domain

Check the diff against the originating GitHub issue or PRD, `CONTEXT.md`, relevant ADRs, and relevant `docs/grid/` decisions. Report missing requirements, incorrect behavior, scope creep, terminology drift, and conflicts with settled decisions.

### Verification and regression safety

Check whether tests and validation prove the changed behavior. Inspect behavioral coverage, public TypeScript inference and rejection tests, package exports, accessibility, React Compiler behavior, performance instrumentation, and failure or concurrency paths relevant to the change. Do not duplicate formatting, lint, or type errors already reported directly by tooling; report missing or misleading evidence.

Use conditional expertise where the diff requires it. For example, load the Effect skill for Effect adapters, the Vitest skill for test infrastructure, the shadcn skill for shared UI, and the relevant TanStack Intent skill for table behavior. The three axes stay the same even when their supporting expertise changes.

DOM-dependent component behavior must run in Playwright-backed Vitest Browser Mode and use the
framework renderer plus role-based browser locators. Do not install or use JSDOM or React Testing
Library. Browser component tests do not use test IDs or non-role `getBy...`, `findBy...`, or
`queryBy...` queries. Pure logic, type, package-boundary, and server-rendering tests may stay in the
Node project.

## Finding contract

Every reviewer reports:

- `BLOCKING: <count>` and `NON-BLOCKING: <count>`.
- Each finding's severity, file and line, concrete evidence, violated rule or requirement, impact, and smallest credible fix.
- An explicit zero count when no findings exist.

A blocking finding is a correctness, contract, architecture, performance, security, accessibility, or regression problem that makes the change unsafe to publish. Preferences and speculative improvements are non-blocking. Reviewers should not report issues that cannot be tied to the reviewed diff.

## Local convergence loop

1. Run relevant focused tests, followed by `vp check` and `vp test`.
   When the diff contains DOM-facing behavior or Browser Mode infrastructure, also run
   `vp run test:browser`; the Node project intentionally does not collect `*.browser.test.tsx`.
2. Start the three reviewers from the same pinned review target.
3. Wait for all three reports.
4. Aggregate reports by axis without hiding disagreement or collapsing severity.
5. Fix every blocking finding and rerun affected validation.
6. Start a fresh round of all three reviewers. A clean verdict from an earlier diff never carries forward.
7. Repeat until one complete round reports zero blockers on every axis and required local checks pass.
8. Record unresolved non-blocking findings in the pull request when they materially affect future work.
9. Commit intentionally, push, and open or update the pull request.

If the user requested review only, stop after reporting the three axes. Do not modify files without authorization.

## GitHub convergence loop

1. Wait for required GitHub checks and GitHub Codex review. Also wait for any other reviewer configured as required by the repository.
2. Address every actionable blocking finding locally.
3. Rerun affected validation and the complete three-reviewer local loop.
4. Commit and push only after the new local round is clean.
5. Repeat until local review, required checks, and required GitHub reviews are all clean.
6. Merge only then, and verify that the pull request and linked issue reached their expected final state.

Do not merge while a required check or review is pending. Do not use an earlier local verdict after changing the diff.
