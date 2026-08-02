# `@bruno/shadcn`

Base UI-powered shadcn components for BrunoTable and other React applications. The package follows the `b1D0ekG8` design preset: Mira, neutral colors, Inter Variable, and Phosphor icons.

Components use direct package subpaths so consumers load only what they import:

```tsx
import { Button } from "@bruno/shadcn/button";
import "@bruno/shadcn/styles.css";

export function SaveButton() {
  return <Button variant="outline">Save</Button>;
}
```

Import `styles.css` once from the consuming Vite application. The stylesheet includes the theme, font, and Tailwind source registration for the package's compiled components.

Configure the consuming application with Tailwind CSS v4 and the official Vite plugin:

```ts
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
});
```

For TanStack Start, load the stylesheet from the root route in the same way as the official monorepo template:

```tsx
import { createRootRoute } from "@tanstack/react-router";

import appCss from "@bruno/shadcn/styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    links: [{ rel: "stylesheet", href: appCss }],
  }),
});
```

## Adding components

Run the official CLI against this workspace:

```bash
pnpm dlx shadcn@latest add dialog -c packages/shadcn
```

Then add a direct package export and pack entry for the new component. Preserve the generated Base UI source and canonical shadcn export names.
