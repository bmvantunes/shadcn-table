import { readFile } from "node:fs/promises";

const [buttonOutput, compilerOutput, packageJsonSource] = await Promise.all([
  readFile(new URL("../dist/button.mjs", import.meta.url), "utf8"),
  readFile(new URL("../dist/compiler-smoke.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

if (!buttonOutput.includes("react/compiler-runtime")) {
  throw new Error("React Compiler did not transform Button.");
}

if (!compilerOutput.includes("react/compiler-runtime")) {
  throw new Error("React Compiler did not transform the inference-mode smoke fixture.");
}

const packageJson = JSON.parse(packageJsonSource);

if (!("./button" in packageJson.exports)) {
  throw new Error("The @bruno/shadcn/button export is missing.");
}

if ("./compiler-smoke" in packageJson.exports) {
  throw new Error("The private React Compiler smoke fixture was exported publicly.");
}

if (packageJson.exports["./styles.css"] !== "./src/styles/globals.css") {
  throw new Error("The @bruno/shadcn/styles.css export is missing.");
}

const publicModule = await import("@bruno/shadcn/button");

if (
  typeof publicModule.Button !== "function" ||
  typeof publicModule.buttonVariants !== "function"
) {
  throw new Error("The @bruno/shadcn/button runtime export is invalid.");
}

const stylesheetUrl = import.meta.resolve("@bruno/shadcn/styles.css");

if (!stylesheetUrl.endsWith("/src/styles/globals.css")) {
  throw new Error("The @bruno/shadcn/styles.css runtime export is invalid.");
}
