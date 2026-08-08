import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

const reactCompilerOptions = {
  compilationMode: "infer",
  target: "19",
} as const;

const reactCompiler = await babel({
  presets: [reactCompilerPreset(reactCompilerOptions)],
});

export default defineConfig({
  plugins: [react(), reactCompiler, tailwindcss()],
  optimizeDeps: {
    include: ["vite-plus/test/browser", "vitest-browser-react"],
  },
  test: {
    name: "browser",
    include: ["src/**/*.browser.test.tsx", "tests/**/*.browser.test.tsx"],
    setupFiles: ["./src/vitest.browser.setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
