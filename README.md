# BrunoTable

A high-performance, strongly typed React data-grid workspace.

## Packages

- [`@bruno/table`](./packages/table) contains the emerging BrunoTable data-grid package.
- [`@bruno/shadcn`](./packages/shadcn) contains Base UI-powered shadcn components shared by BrunoTable and consumer applications.

## Development

```bash
vp install
vp check
vp test
vp run -r build
```

## Review workflow

Changes converge through three independent local reviews—standards and architecture, specification and domain correctness, and verification and regression safety. Blocking findings are always fixed; accepted actionable non-blocking findings from local agents and remote reviewers are also fixed, while disputed non-blocking findings are documented with their rationale. All three reviews restart before a branch is published. After publication, required GitHub checks and, at minimum, completed GitHub Codex and CodeRabbit reviews must be clean; missing, pending, or skipped reviews are incomplete, and any resulting change goes through the complete local loop again.

See [`docs/agents/code-review.md`](./docs/agents/code-review.md) for the authoritative workflow.
