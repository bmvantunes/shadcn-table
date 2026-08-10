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

const brunoTableDevelopmentDefine = {
  name: "bruno-table-development-define",
  transform(code: string, id: string) {
    if (!id.endsWith("/src/bruno-table-client.tsx")) return;
    return code.replaceAll(
      "__BRUNO_TABLE_DEVELOPMENT__",
      'globalThis.process?.env?.NODE_ENV !== "production"',
    );
  },
};

const config: UserConfig = defineConfig({
  define: { __BRUNO_TABLE_DEVELOPMENT__: "true" },
  plugins: [react(), reactCompilerForVite],
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  pack: {
    entry: {
      index: "src/index.ts",
      effect: "src/effect.ts",
      "internal/compiler-smoke": "src/internal/compiler-smoke.tsx",
    },
    dts: {
      tsgo: true,
    },
    exports: {
      exclude: ["internal/**"],
      customExports(packageExports) {
        const rootExport = packageExports["."];
        const effectExport = packageExports["./effect"];

        if (typeof rootExport !== "string" || !rootExport.endsWith(".mjs")) {
          throw new TypeError("Expected vp pack to generate the @bruno/table root export.");
        }
        if (typeof effectExport !== "string" || !effectExport.endsWith(".mjs")) {
          throw new TypeError("Expected vp pack to generate the @bruno/table/effect export.");
        }

        return {
          ".": {
            types: rootExport.replace(/\.mjs$/, ".d.mts"),
            import: rootExport,
            default: rootExport,
          },
          "./effect": {
            types: effectExport.replace(/\.mjs$/, ".d.mts"),
            import: effectExport,
            default: effectExport,
          },
          "./package.json": "./package.json",
        };
      },
    },
    plugins: [reactCompilerForLibrary, brunoTableDevelopmentDefine],
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
