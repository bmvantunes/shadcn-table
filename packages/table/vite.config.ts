import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "vite-plus";

const reactCompilerOptions = {
  compilationMode: "infer",
  target: "19",
} as const;

const reactCompilerForVite = await babel({
  presets: [reactCompilerPreset(reactCompilerOptions)],
});

const reactCompilerForLibrary = await babel({
  plugins: [["babel-plugin-react-compiler", reactCompilerOptions]],
});

const config: UserConfig = defineConfig({
  plugins: [react(), reactCompilerForVite],
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  pack: {
    entry: {
      index: "src/index.ts",
      "internal/compiler-smoke": "src/internal/compiler-smoke.tsx",
    },
    dts: {
      tsgo: true,
    },
    exports: {
      exclude: ["internal/**"],
      customExports(packageExports) {
        const rootExport = packageExports["."];

        if (typeof rootExport !== "string" || !rootExport.endsWith(".mjs")) {
          throw new TypeError("Expected vp pack to generate the @bruno/table root export.");
        }

        return {
          ".": {
            types: rootExport.replace(/\.mjs$/, ".d.mts"),
            import: rootExport,
            default: rootExport,
          },
          "./package.json": "./package.json",
        };
      },
    },
    plugins: [reactCompilerForLibrary],
  },
  lint: {
    ignorePatterns: ["tests/emitted-consumer/**"],
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
