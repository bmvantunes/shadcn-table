import { defineConfig, type UserConfig } from "vite-plus";

const config: UserConfig = defineConfig({
  test: {
    projects: [
      {
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
    ignorePatterns: [".agents/**", ".repos/**"],
    options: {
      typeAware: true,
      typeCheck: true,
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
