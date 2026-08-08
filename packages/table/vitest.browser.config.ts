import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

const reactCompiler = await babel({
  presets: [reactCompilerPreset({ compilationMode: "infer", target: "19" })],
});

const shadcnRoot = fileURLToPath(new URL("../shadcn/src/components/", import.meta.url));
const shadcnAliases = Object.fromEntries(
  ["alert", "button", "empty", "skeleton", "spinner", "table"].map((name) => [
    `@bruno/shadcn/${name}`,
    `${shadcnRoot}${name}.tsx`,
  ]),
);

export default defineConfig({
  plugins: [react(), reactCompiler],
  resolve: { alias: shadcnAliases },
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
