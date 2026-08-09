import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: {
    include: [
      "react",
      "react/jsx-runtime",
      "react-dom/client",
      "react-dom/server.browser",
      "vite-plus/test/browser",
      "vitest-browser-react",
    ],
  },
  test: {
    name: "table-emitted-browser",
    include: ["tests/emitted-browser/**/*.browser.test.tsx"],
    setupFiles: ["./src/vitest.browser.setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
