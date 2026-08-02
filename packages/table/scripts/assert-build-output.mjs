import { readFile } from "node:fs/promises";

const [declarations, compilerOutput, packageJsonSource] = await Promise.all([
  readFile(new URL("../dist/index.d.mts", import.meta.url), "utf8"),
  readFile(new URL("../dist/internal/compiler-smoke.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

if (!compilerOutput.includes("react/compiler-runtime")) {
  throw new Error("React Compiler did not transform the @bruno/table smoke fixture.");
}

if (/\bany\b/u.test(declarations)) {
  throw new Error("The @bruno/table public declarations contain an any type.");
}

if (/tanstack/iu.test(declarations)) {
  throw new Error("A TanStack implementation type leaked into the @bruno/table declarations.");
}

const exportedNames = [...declarations.matchAll(/\bexport(?:\s+type)?\s*\{([^}]*)\}/gu)].flatMap(
  ([, names]) =>
    names.split(",").map((name) =>
      name
        .trim()
        .split(/\s+as\s+/u)
        .at(-1),
    ),
);

if (exportedNames.length === 0) {
  throw new Error("The @bruno/table declaration entry has no public exports.");
}

if (exportedNames.some((name) => !name?.startsWith("BrunoTable"))) {
  throw new Error("Every @bruno/table-owned public export must start with BrunoTable.");
}

const packageJson = JSON.parse(packageJsonSource);
const expectedRootExport = {
  types: "./dist/index.d.mts",
  import: "./dist/index.mjs",
  default: "./dist/index.mjs",
};

if (JSON.stringify(packageJson.exports["."]) !== JSON.stringify(expectedRootExport)) {
  throw new Error("The @bruno/table root export is invalid.");
}

if (Object.keys(packageJson.exports).some((exportName) => exportName.includes("internal"))) {
  throw new Error("A private @bruno/table module was exported publicly.");
}

if (packageJson.dependencies?.["@tanstack/react-table"] !== "9.0.0-beta.71") {
  throw new Error(
    "The private TanStack Table engine is not pinned to the audited beta.71 version.",
  );
}

const publicModule = await import("@bruno/table");

if (Object.keys(publicModule).length !== 0) {
  throw new Error("The type-contract slice unexpectedly exposed a public runtime symbol.");
}
