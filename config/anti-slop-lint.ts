/// <reference types="node" />

import { fileURLToPath } from "node:url";
import type { OxlintConfig } from "vite-plus/lint";

type OxlintJavaScriptPlugin = Exclude<NonNullable<OxlintConfig["jsPlugins"]>[number], string>;

export const antiSlopJavaScriptPlugin = {
  name: "anti-slop",
  specifier: fileURLToPath(new URL("../tools/oxlint/anti-slop/index.ts", import.meta.url)),
} satisfies OxlintJavaScriptPlugin;

export const antiSlopRules = {
  "anti-slop/no-chained-type-assertions": "error",
  "anti-slop/no-conditional-empty-object-spread": "error",
  "anti-slop/no-known-value-widening": "error",
  "anti-slop/no-module-mocking": "error",
  "anti-slop/no-object-parameters": "error",
  "anti-slop/no-reflect-apply": "error",
  "anti-slop/no-reflect-get": "error",
  "anti-slop/no-runtime-typeof": "error",
  "anti-slop/no-shape-in-symbol-names": "error",
  "anti-slop/no-unknown-parameters": "error",
  "anti-slop/no-unknown-returns": "error",
  "anti-slop/no-unknown-type-aliases": "error",
  "anti-slop/no-unsafe-dictionary-type": "error",
  "anti-slop/no-widen-then-assert": "error",
  "anti-slop/require-safety-comment-for-type-assertion": "error",
} satisfies NonNullable<OxlintConfig["rules"]>;
