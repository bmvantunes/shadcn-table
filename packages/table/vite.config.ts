import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "vite-plus";

import { reactCompilerOptions } from "../../config/react-compiler-options.mjs";
import { BrunoTableProductionDefines } from "./config/production-defines.js";

const reactWithCompiler = () =>
  react({
    compiler: reactCompilerOptions,
    exclude: [/\/node_modules\//, /\.d\.[cm]?tsx?$/],
  });

const config: UserConfig = defineConfig({
  define: {
    __BRUNO_TABLE_DEVELOPMENT__: "true",
    __BRUNO_TABLE_TEST_DIAGNOSTICS__: "true",
  },
  plugins: [reactWithCompiler()],
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
    deps: {
      onlyBundle: ["effect-view-server"],
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
    plugins: [BrunoTableProductionDefines(), ...reactWithCompiler()],
  },
  lint: {
    ignorePatterns: ["tests/emitted-consumer/**"],
    plugins: ["typescript", "react"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "react/react-compiler": ["error", { reportAllBailouts: true }],
    },
  },
});

export default config;
