/// <reference types="node" />

import { fileURLToPath } from "node:url";

const shadcnRoot = fileURLToPath(new URL("../packages/shadcn/src/components/", import.meta.url));

export const shadcnSourceAliases = Object.freeze(
  Object.fromEntries(
    ["alert", "button", "empty", "native-select", "popover", "skeleton", "spinner", "table"].map(
      (name) => [`@bruno/shadcn/${name}`, `${shadcnRoot}${name}.tsx`],
    ),
  ),
);
