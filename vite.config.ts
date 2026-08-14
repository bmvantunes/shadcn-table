import { defineConfig, type UserConfig } from "vite-plus";

import { shadcnSourceAliases } from "./config/shadcn-source-aliases.js";

const config: UserConfig = defineConfig({
  define: {
    __BRUNO_TABLE_DEVELOPMENT__: "true",
    __BRUNO_TABLE_TEST_DIAGNOSTICS__: "true",
  },
  resolve: { alias: shadcnSourceAliases },
  test: {
    projects: [
      {
        define: {
          __BRUNO_TABLE_DEVELOPMENT__: "true",
          __BRUNO_TABLE_TEST_DIAGNOSTICS__: "true",
        },
        resolve: { alias: shadcnSourceAliases },
        test: {
          name: "node",
          environment: "node",
          include: [
            "src/**/*.test.ts",
            "tests/**/*.test.ts",
            "packages/**/*.test.ts",
            "packages/**/*.test.tsx",
          ],
          exclude: [
            "packages/**/*.browser.test.tsx",
            "packages/table/src/internal/virtual-viewport.test.ts",
          ],
        },
      },
      "./packages/shadcn/vitest.browser.config.ts",
      "./packages/table/vitest.browser.config.ts",
    ],
  },
  staged: {
    "*": "env NODE_OPTIONS=--experimental-strip-types vp check --fix",
  },
  pack: {
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  lint: {
    ignorePatterns: [".agents/**", ".repos/**"],
    jsPlugins: [
      {
        name: "anti-slop",
        specifier: "./tools/oxlint/anti-slop/index.ts",
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
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
    },
    overrides: [
      {
        files: ["packages/shadcn/**/*.{ts,tsx}", "packages/table/**/*.{ts,tsx}"],
        plugins: ["typescript", "react"],
        rules: {
          "react/react-compiler": "error",
        },
      },
    ],
  },
  fmt: {
    ignorePatterns: [".agents/**", ".repos/**"],
  },
});

export default config;
