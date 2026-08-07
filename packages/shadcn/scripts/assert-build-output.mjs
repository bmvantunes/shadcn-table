import { readdir, readFile } from "node:fs/promises";

const [buttonOutput, compilerOutput, packageJsonSource, componentFiles] = await Promise.all([
  readFile(new URL("../dist/button.mjs", import.meta.url), "utf8"),
  readFile(new URL("../dist/internal/compiler-smoke.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readdir(new URL("../src/components", import.meta.url)),
]);

if (!buttonOutput.includes("react/compiler-runtime")) {
  throw new Error("React Compiler did not transform Button.");
}

if (!compilerOutput.includes("react/compiler-runtime")) {
  throw new Error("React Compiler did not transform the inference-mode smoke fixture.");
}

const packageJson = JSON.parse(packageJsonSource);
const componentNames = componentFiles
  .filter((fileName) => fileName.endsWith(".tsx") && !fileName.endsWith(".test.tsx"))
  .map((fileName) => fileName.replace(/\.tsx$/, ""))
  .sort();

await Promise.all(
  componentNames.map(async (componentName) => {
    const exportName = `./${componentName}`;
    const componentExport = packageJson.exports[exportName];

    if (!componentExport) {
      throw new Error(`The @bruno/shadcn/${componentName} export is missing.`);
    }

    if (
      componentExport.types !== `./dist/${componentName}.d.mts` ||
      componentExport.import !== `./dist/${componentName}.mjs` ||
      componentExport.default !== `./dist/${componentName}.mjs`
    ) {
      throw new Error(`The @bruno/shadcn/${componentName} export is invalid.`);
    }

    await Promise.all([
      readFile(new URL(`../dist/${componentName}.d.mts`, import.meta.url)),
      readFile(new URL(`../dist/${componentName}.mjs`, import.meta.url)),
    ]);
  }),
);

if (Object.keys(packageJson.exports).some((exportName) => exportName.includes("compiler-smoke"))) {
  throw new Error("The private React Compiler smoke fixture was exported publicly.");
}

const publicComponentExports = Object.keys(packageJson.exports)
  .filter((exportName) => exportName !== "./package.json" && exportName !== "./styles.css")
  .map((exportName) => exportName.replace(/^\.\//, ""))
  .sort();

if (publicComponentExports.join("\n") !== componentNames.join("\n")) {
  throw new Error("The public component exports do not match the source component inventory.");
}

const publicModules = await Promise.all(
  componentNames.map((componentName) => import(`@bruno/shadcn/${componentName}`)),
);

for (const [index, publicModule] of publicModules.entries()) {
  if (Object.keys(publicModule).length === 0) {
    throw new Error(`The @bruno/shadcn/${componentNames[index]} runtime export is empty.`);
  }
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
