# Own shared UI primitives in `@bruno/shadcn`

BrunoTable consumes generic UI primitives from a separate `@bruno/shadcn` package rather than embedding them in the grid package. The package tracks current shadcn source with Base UI primitives, Tailwind CSS v4, and canonical component names. Its visual baseline is the shadcn `b1D0ekG8` preset: Mira, neutral colors, Inter Variable, and Phosphor icons. Consumers import direct subpaths such as `@bruno/shadcn/button`; the package intentionally has no root barrel export.

## Consequences

- BrunoTable-specific exports keep the `BrunoTable...` prefix, while `@bruno/shadcn` preserves canonical names such as `Button`.
- Components, theme tokens, and the shadcn CLI configuration live together in one publishable workspace.
- Direct subpaths keep imports statically analyzable and avoid loading unrelated components.
- Applications import `@bruno/shadcn/styles.css` once and process it with Tailwind CSS v4 through the official Vite plugin.
- New components are added with the shadcn CLI, reviewed as source, and explicitly added to the package export map and build entries.
