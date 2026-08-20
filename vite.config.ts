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
          exclude: ["packages/**/*.browser.test.tsx"],
        },
      },
      "./packages/shadcn/vitest.browser.config.ts",
      "./packages/table/vitest.browser.config.ts",
    ],
  },
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  lint: {
    ignorePatterns: [
      ".agents/**",
      ".repos/**",
      "packages/table/tests/emitted-consumer/**",
      "packages/table/tests/emitted-effect-consumer/**",
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ["packages/shadcn/**/*.{ts,tsx}", "packages/table/**/*.{ts,tsx}"],
        plugins: ["typescript", "react"],
        rules: {
          "react/react-compiler": ["error", { reportAllBailouts: true }],
        },
      },
    ],
  },
  fmt: {
    ignorePatterns: [".agents/**", ".repos/**"],
  },
});

export default config;
