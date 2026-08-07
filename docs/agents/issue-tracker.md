# Issue tracker: GitHub

Issues, specifications, and Wayfinder maps for this repository live in `bmvantunes/shadcn-table` on GitHub Issues.

Use the connected GitHub app for supported semantic issue operations. Use the `gh` CLI from this repository for GitHub capabilities the app does not expose, especially native sub-issue and issue-dependency relationships.

## Conventions

- **Create an issue**: use the GitHub app's issue creation operation, or `gh issue create --title "..." --body-file <path>` when a local body file already exists.
- **Read an issue**: use the GitHub app's issue fetch or search operation. Use `gh issue view <number> --comments` when CLI-only metadata is required.
- **List issues**: use the GitHub app's issue search operation with repository, state, and label filters.
- **Comment on an issue**: use `gh issue comment <number> --body "..."`; use the GitHub app to read comments.
- **Apply or remove labels**: use the GitHub app's issue-label operations.
- **Close or reopen**: use the GitHub app's issue update operation.
- **Assign**: use the GitHub app's assignee operation.

Infer the repository from this file as `bmvantunes/shadcn-table`; do not publish Wayfinder artifacts to another repository merely because a different clone or browser tab is active.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and pull requests. Resolve ambiguous references before mutating them.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `bmvantunes/shadcn-table`.

## When a skill says "fetch the relevant ticket"

Read the named GitHub issue and its comments.

## Wayfinding operations

Wayfinder uses one GitHub issue as the map and native child issues as decision tickets.

- **Map**: create one issue labelled `wayfinder:map`. Its body contains Destination, Notes, Decisions so far, Not yet specified, and Out of scope.
- **Child ticket**: create an issue with exactly one `wayfinder:<type>` label: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`. Link it to the map through GitHub's native sub-issue relationship.
- **Sub-issue fallback**: if native sub-issues are unavailable, add the child to a task list in the map and begin the child body with `Part of <map link>`.
- **Blocking**: use GitHub's native issue dependency relationship. The blocker is the decision that must close first. Use a `Blocked by: <ticket links>` body line only when native dependencies are unavailable.
- **Frontier query**: list the map's open children in map order, then exclude tickets with open blockers or any assignee. The first remaining ticket is the frontier.
- **Claim**: assign the ticket to the developer driving the session before reading beyond the question or doing any ticket work.
- **Resolve**: add one resolution comment, close the ticket, then append a one-line gist and named link to the map's Decisions-so-far section.

For CLI-only native relationships, use the current GitHub API documented for sub-issues and dependencies. Resolve database IDs explicitly before adding a dependency; never substitute an issue number or GraphQL node ID where a numeric database ID is required.
