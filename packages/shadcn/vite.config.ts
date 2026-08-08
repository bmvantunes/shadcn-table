import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
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
  plugins: [react(), reactCompilerForVite, tailwindcss()],
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
    plugins: [reactCompilerForLibrary],
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
