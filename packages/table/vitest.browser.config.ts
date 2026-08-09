import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

import { shadcnSourceAliases } from "../../config/shadcn-source-aliases.js";

const reactCompiler = await babel({
  presets: [reactCompilerPreset({ compilationMode: "infer", target: "19" })],
});

export default defineConfig({
  plugins: [react(), reactCompiler],
  resolve: { alias: shadcnSourceAliases },
  optimizeDeps: {
    include: ["vite-plus/test/browser", "vitest-browser-react"],
  },
  test: {
    name: "table-browser",
    include: ["src/**/*.browser.test.tsx"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
