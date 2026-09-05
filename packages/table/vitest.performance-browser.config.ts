import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

import { reactCompilerOptions } from "../../config/react-compiler-options.mjs";
import { shadcnSourceAliases } from "../../config/shadcn-source-aliases.js";
import { BRUNO_TABLE_CAPABLE_HARDWARE_PROFILE } from "./src/internal/benchmark-profile";

export default defineConfig({
  define: {
    __BRUNO_TABLE_DEVELOPMENT__: "false",
    __BRUNO_TABLE_TEST_DIAGNOSTICS__: "true",
  },
  plugins: [
    react({
      compiler: reactCompilerOptions,
      exclude: [/\/node_modules\//, /\.d\.[cm]?tsx?$/],
    }),
    tailwindcss(),
  ],
  resolve: { alias: shadcnSourceAliases, dedupe: ["react", "react-dom"] },
  optimizeDeps: {
    include: [
      "@bruno/shadcn/direction",
      "@bruno/shadcn/switch",
      "@effect/atom-react",
      "@phosphor-icons/react",
      "@tanstack/react-hotkeys",
      "@tanstack/react-pacer",
      "@tanstack/react-table",
      "@tanstack/store",
      "effect",
      "effect-view-server/config",
      "effect-view-server/react",
      "effect-view-server/react/testing",
      "effect-view-server/source-adapter",
      "react",
      "react-dom/client",
      "react-dom/server",
      "vite-plus/test/browser",
      "vitest-browser-react",
      "xstate",
    ],
  },
  test: {
    name: "table-performance-browser",
    fileParallelism: false,
    include: [
      "src/**/*.performance.browser.test.tsx",
      "src/drag-fill-performance.browser.test.tsx",
    ],
    setupFiles: ["./src/vitest.browser.setup.ts", "./src/vitest.performance-browser.setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [
        {
          browser: BRUNO_TABLE_CAPABLE_HARDWARE_PROFILE.requiredBrowserEngine,
          viewport: { height: 900, width: 1440 },
        },
      ],
    },
  },
});
