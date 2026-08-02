import { defineConfig, type UserConfig } from "vite-plus";

const config: UserConfig = defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
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
    ignorePatterns: [".repos/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: [".repos/**"],
  },
});

export default config;
