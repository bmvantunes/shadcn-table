import { readFile } from "node:fs/promises";

class UninspectableWildcardExportError extends Error {}

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

const exportedNames = collectDeclarationExportNames(declarations);

if (exportedNames.length === 0) {
  throw new Error("The @bruno/table declaration entry has no public exports.");
}

if (exportedNames.some((name) => !name?.startsWith("BrunoTable"))) {
  throw new Error("Every @bruno/table-owned public export must start with BrunoTable.");
}

const parserSmokeExports = collectDeclarationExportNames(`
export declare function BrunoTableDirect(): void;
export interface BrunoTableInterface {}
export type BrunoTableAlias = string;
export { BrunoTableInternal as BrunoTableRenamed, type BrunoTableNamedType };
export * as BrunoTableNamespace from "./namespace.js";
export type * as BrunoTableTypeNamespace from "./type-namespace.js";
`);

if (
  JSON.stringify(parserSmokeExports.toSorted((left, right) => left.localeCompare(right))) !==
  JSON.stringify(
    [
      "BrunoTableDirect",
      "BrunoTableInterface",
      "BrunoTableAlias",
      "BrunoTableRenamed",
      "BrunoTableNamedType",
      "BrunoTableNamespace",
      "BrunoTableTypeNamespace",
    ].toSorted((left, right) => left.localeCompare(right)),
  )
) {
  throw new Error("The declaration export validator failed its direct-export smoke check.");
}

try {
  collectDeclarationExportNames('export * from "./uninspectable.js";');
  throw new Error("The declaration export validator accepted an uninspectable wildcard export.");
} catch (error) {
  if (!(error instanceof UninspectableWildcardExportError)) {
    throw error;
  }
}

const packageJson = JSON.parse(packageJsonSource);
const expectedRootExport = {
  types: "./dist/index.d.mts",
  import: "./dist/index.mjs",
  default: "./dist/index.mjs",
};

if (!hasExactStringRecord(packageJson.exports["."], expectedRootExport)) {
  throw new Error("The @bruno/table root export is invalid.");
}

if (
  !hasExactStringRecord(
    {
      default: "./dist/index.mjs",
      types: "./dist/index.d.mts",
      import: "./dist/index.mjs",
    },
    expectedRootExport,
  ) ||
  hasExactStringRecord(
    { ...expectedRootExport, browser: "./dist/index.mjs" },
    expectedRootExport,
  ) ||
  hasExactStringRecord({ ...expectedRootExport, import: "./dist/other.mjs" }, expectedRootExport)
) {
  throw new Error("The root-export validator failed its exact order-independent smoke check.");
}

if (Object.keys(packageJson.exports).some((exportName) => exportName.includes("internal"))) {
  throw new Error("A private @bruno/table module was exported publicly.");
}

if (hasInternalExportTarget(packageJson.exports)) {
  throw new Error("A public @bruno/table export points at a private dist/internal module.");
}

if (
  !hasInternalExportTarget({
    "./aliased-private-module": {
      import: "./dist/internal/private.mjs",
    },
  })
) {
  throw new Error("The private export-target validator failed its nested-condition smoke check.");
}

if (JSON.stringify(packageJson.files) !== JSON.stringify(["dist"])) {
  throw new Error("The @bruno/table package must publish its complete dist directory.");
}

if (packageJson.dependencies?.["@tanstack/react-table"] !== "9.0.0") {
  throw new Error(
    "The private TanStack Table engine is not pinned to the audited stable v9.0.0 version.",
  );
}

const publicModule = await import("@bruno/table");
const actualRuntimeExports = Object.keys(publicModule).toSorted((left, right) =>
  left.localeCompare(right),
);
const expectedRuntimeExports = [
  "BrunoTableBigIntColumn",
  "BrunoTableBooleanColumn",
  "BrunoTableComputedColumn",
  "BrunoTableNumberColumn",
  "BrunoTableSelectColumn",
  "BrunoTableTextColumn",
].toSorted((left, right) => left.localeCompare(right));

if (JSON.stringify(actualRuntimeExports) !== JSON.stringify(expectedRuntimeExports)) {
  throw new Error("The @bruno/table runtime exports do not match the strict column surface.");
}

function collectDeclarationExportNames(source) {
  if (/^\s*export\s+(?:type\s+)?\*\s+from\b/gmu.test(source)) {
    throw new UninspectableWildcardExportError(
      "The declaration entry contains a wildcard export whose names cannot be validated.",
    );
  }

  const names = [];

  for (const [, exportList] of source.matchAll(/^\s*export\s+(?:type\s+)?\{([^}]*)\}/gmu)) {
    for (const exportedName of exportList.split(",")) {
      const name = exportedName
        .trim()
        .replace(/^type\s+/u, "")
        .split(/\s+as\s+/u)
        .at(-1);

      if (name) {
        names.push(name);
      }
    }
  }

  for (const [, name] of source.matchAll(
    /^\s*export\s+(?:type\s+)?\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\b/gmu,
  )) {
    names.push(name);
  }

  for (const [, name] of source.matchAll(
    /^\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|enum|function|interface|namespace|type|const|let|var)\s+([A-Za-z_$][\w$]*)/gmu,
  )) {
    names.push(name);
  }

  if (/^\s*export\s+default\b/gmu.test(source)) {
    names.push("default");
  }

  return [...new Set(names)];
}

function hasInternalExportTarget(value) {
  if (typeof value === "string") {
    return /^\.\/dist\/internal(?:\/|$)/u.test(value);
  }

  if (Array.isArray(value)) {
    return value.some(hasInternalExportTarget);
  }

  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(hasInternalExportTarget);
  }

  return false;
}

function hasExactStringRecord(actual, expected) {
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    return false;
  }

  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);

  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(actual, key) && actual[key] === expected[key])
  );
}
