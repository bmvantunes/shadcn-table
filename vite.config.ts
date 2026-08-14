import { defineConfig, type UserConfig } from "vite-plus";

import { antiSlopJavaScriptPlugin, antiSlopRules } from "./config/anti-slop-lint.js";
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
    jsPlugins: [antiSlopJavaScriptPlugin],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      ...antiSlopRules,
    },
    overrides: [
      {
        files: ["packages/shadcn/**/*.{ts,tsx}", "packages/table/**/*.{ts,tsx}"],
        plugins: ["typescript", "react"],
        rules: {
          ...antiSlopRules,
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
