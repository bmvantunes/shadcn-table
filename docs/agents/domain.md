# Domain docs

This repository uses one BrunoTable domain context across its packages.

## Before exploring

Read the domain material relevant to the work:

- `CONTEXT.md` for the canonical BrunoTable vocabulary
- `docs/adr/` for architectural decisions touching the area
- `docs/grid/` for the current product and engineering specification

If a referenced area has no ADR, proceed without proposing one merely to fill the directory. Create ADRs only when the domain-modeling rules say the decision merits one.

## File structure

```text
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   ├── agents/
│   └── grid/
└── packages/
```

The workspace is a monorepo for packaging and delivery, but its packages currently implement one BrunoTable product language. Do not create per-package `CONTEXT.md` files unless genuinely separate bounded contexts emerge.

## Use the glossary's vocabulary

Use terms exactly as defined in `CONTEXT.md` in issue titles, questions, prototypes, specifications, tests, and implementation plans. Do not replace a canonical term with a synonym listed under its `_Avoid_` guidance.

If a needed concept is absent, treat that as a domain-modeling question. Resolve the language with the user and update `CONTEXT.md` when the term crystallises.

## Flag conflicts

If proposed work contradicts an ADR or a settled grid document, surface the conflict explicitly. A Wayfinder ticket may reopen a decision only when new evidence, an undefined edge case, or a material trade-off justifies it.
