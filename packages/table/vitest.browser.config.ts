import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

import { shadcnSourceAliases } from "../../config/shadcn-source-aliases.js";

const reactCompiler = await babel({
  presets: [reactCompilerPreset({ compilationMode: "infer", target: "19" })],
});

export default defineConfig({
  define: {
    __BRUNO_TABLE_DEVELOPMENT__: "true",
    __BRUNO_TABLE_TEST_DIAGNOSTICS__: "true",
  },
  plugins: [react(), reactCompiler, tailwindcss()],
  resolve: { alias: shadcnSourceAliases, dedupe: ["react", "react-dom"] },
  optimizeDeps: {
    include: [
      "@bruno/shadcn/direction",
      "react",
      "react-dom/client",
      "react-dom/server",
      "vite-plus/test/browser",
      "vitest-browser-react",
    ],
  },
  test: {
    name: "table-browser",
    include: ["src/**/*.browser.test.tsx", "src/internal/virtual-viewport.test.ts"],
    setupFiles: ["./src/vitest.browser.setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
