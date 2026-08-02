# Own pinned keyboard reveal geometry

BrunoTable owns keyboard destination resolution and minimal scroll-to-reveal geometry across pinned-start, virtualized-centre, and pinned-end columns. TanStack Table may provide private selection and movement primitives, but native `scrollIntoView` and TanStack example scrolling are not the BrunoTable interaction contract because they do not account reliably for both pinned insets and can jump several centre columns instead of revealing the next logical cell.

## Consequences

- Pinned-start, centre, and pinned-end columns form one Logical Column Order.
- One horizontal key command moves to exactly one adjacent navigable column.
- Pinned destinations never cause horizontal scrolling.
- Centre destinations scroll by the minimum delta required inside the unobscured centre viewport after both pinned widths are removed.
- Behavioural fixtures cover zero, one, and multiple consumer-defined columns in both pinned regions; no specific field or Column Identity is privileged.
