import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

class UninspectableWildcardExportError extends Error {}

const [
  declarations,
  effectDeclarations,
  rootRuntime,
  effectRuntime,
  compilerOutput,
  packageJsonSource,
] = await Promise.all([
  readFile(new URL("../dist/index.d.mts", import.meta.url), "utf8"),
  readFile(new URL("../dist/effect.d.mts", import.meta.url), "utf8"),
  readFile(new URL("../dist/index.mjs", import.meta.url), "utf8"),
  readFile(new URL("../dist/effect.mjs", import.meta.url), "utf8"),
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

if (
  /\beffect(?:\/|["'])/u.test(declarations) ||
  /\beffect(?:\/|["'])/u.test(rootRuntime) ||
  /effect-view-server/u.test(declarations) ||
  /effect-view-server/u.test(rootRuntime)
) {
  throw new Error(
    "The @bruno/table root entry imports or declares the optional Effect/View Server integration.",
  );
}

if (/@effect-view-server/u.test(effectRuntime) || /@effect-view-server/u.test(effectDeclarations)) {
  throw new Error("The optional Effect entry leaks a private effect-view-server package path.");
}

if (/(?:from\s+|import\s*)["']effect-view-server(?:\/|["'])/u.test(effectRuntime)) {
  throw new Error("The optional Effect entry leaves effect-view-server as a consumer dependency.");
}

if (
  /(?:from\s+|import\s*)["']effect["']/u.test(effectRuntime) ||
  /(?:from\s+|import\s*)["']effect\/Schema["']/u.test(effectRuntime)
) {
  throw new Error("The optional Effect entry imports the broad Effect or Schema entrypoint.");
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
const expectedEffectExport = {
  types: "./dist/effect.d.mts",
  import: "./dist/effect.mjs",
  default: "./dist/effect.mjs",
};

if (!hasExactStringRecord(packageJson.exports["."], expectedRootExport)) {
  throw new Error("The @bruno/table root export is invalid.");
}

if (!hasExactStringRecord(packageJson.exports["./effect"], expectedEffectExport)) {
  throw new Error("The @bruno/table/effect export is invalid.");
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

await assertPackedConsumers();

if (packageJson.dependencies?.["@tanstack/react-table"] !== "9.0.0") {
  throw new Error(
    "The private TanStack Table engine is not pinned to the audited stable v9.0.0 version.",
  );
}

if (packageJson.devDependencies?.["effect-view-server"] !== "2.3.0") {
  throw new Error(
    "The optional Effect build is not pinned to the audited public value-semantics contract.",
  );
}

if (
  !hasExactStringRecord(packageJson.inlinedDependencies, {
    "effect-view-server": "2.3.0",
  })
) {
  throw new Error("The audited View Server value semantics are not explicitly inlined.");
}

const publicModule = await import("@bruno/table");
const actualRuntimeExports = Object.keys(publicModule).toSorted((left, right) =>
  left.localeCompare(right),
);
const expectedRuntimeExports = [
  "BrunoTableBigIntColumn",
  "BrunoTableBooleanColumn",
  "BrunoTableClient",
  "BrunoTableComputedColumn",
  "BrunoTableNumberColumn",
  "BrunoTableSelectColumn",
  "BrunoTableTextColumn",
  "BrunoTableToolbar",
].toSorted((left, right) => left.localeCompare(right));

if (JSON.stringify(actualRuntimeExports) !== JSON.stringify(expectedRuntimeExports)) {
  throw new Error("The @bruno/table runtime exports do not match the strict column surface.");
}

const effectModule = await import("@bruno/table/effect");
const actualEffectRuntimeExports = Object.keys(effectModule).toSorted((left, right) =>
  left.localeCompare(right),
);
const expectedEffectRuntimeExports = [
  "BrunoTableBigDecimalColumn",
  "BrunoTableBigDecimalValueType",
];

if (JSON.stringify(actualEffectRuntimeExports) !== JSON.stringify(expectedEffectRuntimeExports)) {
  throw new Error("The @bruno/table/effect runtime exports do not match the optional surface.");
}

const effectExportedNames = collectDeclarationExportNames(effectDeclarations);
if (
  JSON.stringify(effectExportedNames.toSorted((left, right) => left.localeCompare(right))) !==
  JSON.stringify(expectedEffectRuntimeExports.toSorted((left, right) => left.localeCompare(right)))
) {
  throw new Error("The @bruno/table/effect declaration exports do not match its runtime surface.");
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

async function assertPackedConsumers() {
  const packRoot = await mkdtemp(join(tmpdir(), "bruno-table-pack-"));
  try {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    runCommand("pnpm", ["pack", "--pack-destination", packRoot], packageRoot, "package tarball");
    const shadcnRoot = join(packageRoot, "../shadcn");
    runCommand(
      "pnpm",
      ["pack", "--pack-destination", packRoot],
      shadcnRoot,
      "shadcn package tarball",
    );
    const tarballNames = (await readdir(packRoot)).filter((fileName) => fileName.endsWith(".tgz"));
    if (tarballNames.length !== 2) {
      throw new Error(
        `pnpm pack produced ${tarballNames.length} tarballs; expected exactly two (${tarballNames.join(", ") || "none"}).`,
      );
    }
    const tableTarballName = tarballNames.find((fileName) => fileName.startsWith("bruno-table-"));
    const shadcnTarballName = tarballNames.find((fileName) => fileName.startsWith("bruno-shadcn-"));
    if (!tableTarballName || !shadcnTarballName) {
      throw new Error(
        `Packed tarballs did not contain the expected table and shadcn packages (${tarballNames.join(", ")}).`,
      );
    }
    const tarball = join(packRoot, tableTarballName);
    const shadcnTarball = join(packRoot, shadcnTarballName);

    await assertPackedRootConsumer(tarball, shadcnTarball);
    await assertPackedEffectConsumer(tarball, shadcnTarball);
  } finally {
    await rm(packRoot, { recursive: true, force: true });
  }
}

async function assertPackedRootConsumer(tarball, shadcnTarball) {
  const consumerRoot = await createPackedConsumer(
    "bruno-table-root-consumer-",
    tarball,
    shadcnTarball,
    false,
  );
  try {
    await writeFile(
      join(consumerRoot, "index.tsx"),
      `import { BrunoTableClient, BrunoTableTextColumn, BrunoTableToolbar } from "@bruno/table";
import type { BrunoTableColumns } from "@bruno/table";

type Row = { readonly symbol: string; readonly revision: bigint };
const columns = [
  BrunoTableTextColumn({
    columnId: "COL_ID_SYMBOL",
    field: "symbol",
    headerName: "Symbol",
    isEditable: true,
  }),
] satisfies BrunoTableColumns<Row>;
void columns;
const source = { rows: [] as readonly Row[], totalRows: 0, version: 1, status: "ready" as const };
const rendered = (
  <BrunoTableClient
    tableId="TABLE_ID_PACKED"
    columns={columns}
    initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
    getRowId={(row) => row.symbol}
    clientSource={source}
  />
);
void rendered;
const missingOrder = (
  // @ts-expect-error Packed JSX Client usage requires initialOrderBy.
  <BrunoTableClient
    tableId="TABLE_ID_PACKED_MISSING_ORDER"
    columns={columns}
    getRowId={(row) => row.symbol}
    clientSource={source}
  />
);
void missingOrder;
const emptyOrder = (
  <BrunoTableClient
    tableId="TABLE_ID_PACKED_EMPTY_ORDER"
    columns={columns}
    // @ts-expect-error Packed JSX Client usage rejects an empty initialOrderBy.
    initialOrderBy={[]}
    getRowId={(row) => row.symbol}
    clientSource={source}
  />
);
void emptyOrder;
const invalidOrder = (
  <BrunoTableClient
    tableId="TABLE_ID_PACKED_INVALID_ORDER"
    columns={columns}
    initialOrderBy={[
      // @ts-expect-error Packed JSX preserves exact sortable Column Identity inference.
      { columnId: "COL_ID_UNKNOWN", direction: "asc" },
    ]}
    getRowId={(row) => row.symbol}
    clientSource={source}
  />
);
void invalidOrder;
const readOnlyWithEditOperation = (
  <BrunoTableClient
    tableId="TABLE_ID_PACKED_READ_ONLY"
    columns={columns}
    initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
    getRowId={(row) => row.symbol}
    clientSource={source}
    editable={false}
    // @ts-expect-error Packed read-only JSX Client usage rejects getRowVersion.
    getRowVersion={(row: Row) => row.revision}
    // @ts-expect-error Packed read-only JSX Client usage rejects onSaveEdits.
    onSaveEdits={() => Promise.resolve()}
  />
);
void readOnlyWithEditOperation;
const toolbar = BrunoTableToolbar({ children: "Filters" });
void toolbar;
`,
    );
    await writeFile(join(consumerRoot, "runtime.mjs"), 'await import("@bruno/table");\n');

    await assertInstalledGraphExcludesEffect(consumerRoot);
    runTypeScriptConsumer(consumerRoot, "Effect-free @bruno/table root consumer");
    runCommand(process.execPath, ["runtime.mjs"], consumerRoot, "Effect-free root runtime");
  } finally {
    await rm(consumerRoot, { recursive: true, force: true });
  }
}

async function assertPackedEffectConsumer(tarball, shadcnTarball) {
  const consumerRoot = await createPackedConsumer(
    "bruno-table-effect-consumer-",
    tarball,
    shadcnTarball,
    true,
  );
  try {
    await writeFile(
      join(consumerRoot, "index.ts"),
      `import * as BigDecimal from "effect/BigDecimal";
import { BrunoTableBigDecimalColumn } from "@bruno/table/effect";
import type { BrunoTableColumns } from "@bruno/table";

type Row = { readonly price: BigDecimal.BigDecimal };
const columns = [
  BrunoTableBigDecimalColumn({
    columnId: "COL_ID_PRICE",
    field: "price",
    headerName: "Price",
    aggFunc: "sum",
    aggregateValueFormatter: ({ value }) => BigDecimal.format(value),
  }),
] satisfies BrunoTableColumns<Row>;
void columns;
`,
    );
    await writeFile(
      join(consumerRoot, "runtime.mjs"),
      `import assert from "node:assert/strict";
import * as BigDecimal from "effect/BigDecimal";
import { BrunoTableBigDecimalValueType } from "@bruno/table/effect";

const large = BigDecimal.fromStringUnsafe("-9007199254740993123456789.0000000000000000001");
assert.equal(
  BrunoTableBigDecimalValueType.formatCanonicalText(large),
  "-9.0071992547409931234567890000000000000000001e+24",
);
const fractional = BrunoTableBigDecimalValueType.parseCanonicalText("-0.000000000000000000125");
assert.equal(fractional._tag, "Success");
const onePointFive = BigDecimal.fromStringUnsafe("1.5");
const differentlyScaled = BigDecimal.make(1500n, 3);
assert.equal(BrunoTableBigDecimalValueType.equivalent(onePointFive, differentlyScaled), true);
assert.equal(BrunoTableBigDecimalValueType.compare(large, onePointFive), -1);
assert.equal(BrunoTableBigDecimalValueType.parseCanonicalText("not-a-decimal")._tag, "Failure");
assert.equal(BrunoTableBigDecimalValueType.decodeRuntime({ value: 15n, scale: 1 })._tag, "Failure");

const foreignPrototype = Object.create(null, {
  "~effect/BigDecimal": { value: "~effect/BigDecimal" },
});
const foreign = Object.create(foreignPrototype, {
  value: { value: 150n, enumerable: true },
  scale: { value: 2, enumerable: true },
});
const admitted = BrunoTableBigDecimalValueType.decodeRuntime(foreign);
assert.equal(admitted._tag, "Success");
if (admitted._tag === "Success") {
  assert.notEqual(admitted.value, foreign);
  assert.equal(Object.isFrozen(admitted.value), true);
  assert.equal(BigDecimal.format(admitted.value), "1.5");
}
`,
    );

    runTypeScriptConsumer(consumerRoot, "packed @bruno/table/effect consumer");
    runCommand(process.execPath, ["runtime.mjs"], consumerRoot, "packed BigDecimal runtime");
  } finally {
    await rm(consumerRoot, { recursive: true, force: true });
  }
}

async function createPackedConsumer(prefix, tarball, shadcnTarball, includeEffect) {
  const consumerRoot = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(
    join(consumerRoot, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        "@bruno/table": `file:${tarball}`,
        "@bruno/shadcn": `file:${shadcnTarball}`,
        "@types/react": "19.2.18",
        ...(includeEffect ? { effect: "4.0.0-beta.100" } : {}),
        react: "19.2.8",
        "react-dom": "19.2.8",
      },
    }),
  );
  await writeFile(
    join(consumerRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "esnext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        lib: ["esnext", "dom"],
        types: [],
        skipLibCheck: false,
      },
      include: ["index.ts", "index.tsx"],
    }),
  );
  runCommand(
    "pnpm",
    ["install", "--prefer-offline", "--ignore-scripts", "--no-frozen-lockfile"],
    consumerRoot,
    "packed consumer install",
  );
  return consumerRoot;
}

async function assertInstalledGraphExcludesEffect(consumerRoot) {
  if (
    existsSync(join(consumerRoot, "node_modules", "effect")) ||
    existsSync(join(consumerRoot, "node_modules", "effect-view-server"))
  ) {
    throw new Error("The clean root consumer unexpectedly installed Effect or View Server.");
  }

  const virtualStore = join(consumerRoot, "node_modules", ".pnpm");
  const entries = existsSync(virtualStore) ? await readdir(virtualStore) : [];
  if (entries.some((entry) => /^(?:@effect\+|effect@|effect-view-server@)/u.test(entry))) {
    throw new Error("The clean root consumer dependency graph contains Effect or View Server.");
  }
}

function runTypeScriptConsumer(consumerRoot, label) {
  const typescriptCli = fileURLToPath(
    new URL("../../../node_modules/typescript/bin/tsc", import.meta.url),
  );
  runCommand(process.execPath, [typescriptCli, "--project", "tsconfig.json"], consumerRoot, label);
}

function runCommand(command, parameters, cwd, label) {
  const result = spawnSync(command, parameters, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
}
