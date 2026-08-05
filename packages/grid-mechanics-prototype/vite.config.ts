import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "vite-plus";

const reactCompilerOptions = {
  compilationMode: "infer",
  target: "19",
} as const;

const reactCompiler = await babel({
  presets: [reactCompilerPreset(reactCompilerOptions)],
});

const config: UserConfig = defineConfig({
  plugins: [react(), reactCompiler, tailwindcss()],
  test: {
    include: ["src/**/*.test.ts"],
  },
  lint: {
    plugins: ["typescript", "react"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "react/react-compiler": "error",
    },
  },
});

export default config;
