import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "vite-plus";

import { reactCompilerOptions } from "../../config/react-compiler-options.mjs";

const reactWithCompiler = () =>
  react({
    compiler: reactCompilerOptions,
    exclude: [/\/node_modules\//, /\.d\.[cm]?tsx?$/],
  });

const config: UserConfig = defineConfig({
  plugins: [reactWithCompiler(), tailwindcss()],
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: [
            "src/**/*.test.ts",
            "src/**/*.test.tsx",
            "tests/**/*.test.ts",
            "tests/**/*.test.tsx",
          ],
          exclude: ["src/**/*.browser.test.tsx", "tests/**/*.browser.test.tsx"],
        },
      },
      "./vitest.browser.config.ts",
    ],
  },
  pack: {
    entry: {
      "*": ["src/components/*.tsx", "!src/components/*.test.tsx"],
      "internal/compiler-smoke": "src/compiler-smoke.tsx",
    },
    dts: {
      tsgo: true,
    },
    exports: {
      exclude: ["internal/**"],
      customExports(packageExports) {
        const publicExports = Object.fromEntries(
          Object.entries(packageExports)
            .filter(([exportName]) => exportName !== ".")
            .map(([exportName, target]) => {
              if (typeof target !== "string" || !target.endsWith(".mjs")) {
                return [exportName, target];
              }

              return [
                exportName,
                {
                  types: target.replace(/\.mjs$/, ".d.mts"),
                  import: target,
                  default: target,
                },
              ];
            }),
        );

        return {
          ...publicExports,
          "./styles.css": "./src/styles/globals.css",
        };
      },
    },
    plugins: [...reactWithCompiler()],
  },
  lint: {
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
