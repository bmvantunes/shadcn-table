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
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
  pack: {
    entry: {
      button: "src/components/button.tsx",
      "compiler-smoke": "src/compiler-smoke.tsx",
    },
    dts: {
      tsgo: true,
    },
    exports: {
      exclude: ["compiler-smoke"],
      customExports(packageExports) {
        delete packageExports["."];

        return {
          ...packageExports,
          "./button": {
            types: "./dist/button.d.mts",
            import: "./dist/button.mjs",
            default: "./dist/button.mjs",
          },
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
