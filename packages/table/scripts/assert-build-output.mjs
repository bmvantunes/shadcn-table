import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { transformSync } from "oxc-transform-react";
import { parseAstAsync } from "vite";

import { assertReactCompilerStrictness } from "../../../config/react-compiler-options.mjs";

assertReactCompilerStrictness(transformSync);

class UninspectableWildcardExportError extends Error {}

async function readDeclarationClosure(entryUrl) {
  const sources = new Map();

  async function visit(sourceUrl) {
    const sourcePath = fileURLToPath(sourceUrl);
    if (sources.has(sourcePath)) return;
    const source = await readFile(sourceUrl, "utf8");
    sources.set(sourcePath, source);
    const localImports = source.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/gu);
    for (const match of localImports) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const runtimeUrl = new URL(specifier, sourceUrl);
      const declarationUrl = new URL(
        runtimeUrl.href.endsWith(".mjs")
          ? runtimeUrl.href.replace(/\.mjs$/u, ".d.mts")
          : runtimeUrl.href.endsWith(".js")
            ? runtimeUrl.href.replace(/\.js$/u, ".d.ts")
            : runtimeUrl.href,
      );
      if (existsSync(declarationUrl)) await visit(declarationUrl);
    }
  }

  await visit(entryUrl);
  return Object.freeze({
    entry: sources.get(fileURLToPath(entryUrl)) ?? "",
    declarations: [...sources.values()].join("\n"),
  });
}

const [
  rootDeclarationSet,
  effectDeclarationSet,
  rootRuntime,
  effectRuntime,
  compilerOutput,
  packageJsonSource,
] = await Promise.all([
  readDeclarationClosure(new URL("../dist/index.d.mts", import.meta.url)),
  readDeclarationClosure(new URL("../dist/effect.d.mts", import.meta.url)),
  readFile(new URL("../dist/index.mjs", import.meta.url), "utf8"),
  readFile(new URL("../dist/effect.mjs", import.meta.url), "utf8"),
  readFile(new URL("../dist/internal/compiler-smoke.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

const declarations = rootDeclarationSet.declarations;
const effectDeclarations = effectDeclarationSet.declarations;
const testDiagnosticSentinels = [
  "BRUNO_TABLE_COMMIT_PROBE_DIAGNOSTIC_V1",
  "BRUNO_TABLE_GESTURE_TIMING_DIAGNOSTIC_V1",
  "BRUNO_TABLE_TEST_LISTENER_DIAGNOSTIC_V1",
];

if (!compilerOutput.includes("react/compiler-runtime")) {
  throw new Error("React Compiler did not transform the @bruno/table smoke fixture.");
}

const rootRuntimeAst = await parseAstAsync(rootRuntime);
const layoutEffectBinding = findImportedBinding(rootRuntimeAst, "react", "useLayoutEffect");
const layoutEffectCallbacks =
  layoutEffectBinding === undefined
    ? []
    : collectEffectCallbacks(rootRuntimeAst, layoutEffectBinding);

if (
  testDiagnosticSentinels.some(
    (sentinel) => rootRuntime.includes(sentinel) || effectRuntime.includes(sentinel),
  ) ||
  /__BRUNO_TABLE_TEST_DIAGNOSTICS__/u.test(rootRuntime) ||
  /\b(?:has|install|record)BrunoTable(?:Client(?:ColumnGesture|RowOrderPlanning|CellRender|RowRender|ViewRender|GridSurfaceRender|ColumnResizeFrame|ColumnReorderFrame|ColumnPreviewStyleWrite|HeaderRender|QuickFilterRender|ColumnFilterTriggerRender|ColumnFilterRender|QueryTransition)|GridCommand|ColumnCommandSubscription|ColumnFilterSubscription|Toolbar(?:Subscription|Lifetime))/u.test(
    `${rootRuntime}\n${effectRuntime}`,
  ) ||
  /installTableScopedListener/u.test(rootRuntime) ||
  /performance\.now/u.test(rootRuntime)
) {
  throw new Error(
    "The production package contains test-only commit probes, listeners, or gesture timing diagnostics.",
  );
}

if (
  !layoutEffectCallbacks.some((callback) => syntaxTreeContains(callback, isRowAcceptanceCall)) ||
  !layoutEffectCallbacks.some(
    (callback) =>
      syntaxTreeContains(callback, isMutationObserverConstruction) &&
      syntaxTreeContains(callback, isMutationObserverObserveCall) &&
      syntaxTreeContains(callback, isInertBoundaryRemovalCall),
  )
) {
  throw new Error(
    "The production package lost required commit-phase row reconciliation or DOM ownership effects.",
  );
}

if (/\bany\b/u.test(declarations)) {
  throw new Error("The @bruno/table public declarations contain an any type.");
}

if (/tanstack/iu.test(declarations)) {
  throw new Error("A TanStack implementation type leaked into the @bruno/table declarations.");
}

if (
  /BrunoTable(?:ToolbarController|ToolbarState|ToolbarRowStore|ToolbarCellStore)/u.test(
    declarations,
  )
) {
  throw new Error("The toolbar public declarations expose broad or row/cell-owned infrastructure.");
}

if (
  !/registerBrunoTableIdentity/u.test(rootRuntime) ||
  !/simultaneous use of tableId/u.test(rootRuntime) ||
  !/NODE_ENV/u.test(rootRuntime) ||
  !/globalThis\.process\?\.env\?\.NODE_ENV/u.test(rootRuntime) ||
  /(?<!\.)\bprocess\.env/u.test(rootRuntime) ||
  /__BRUNO_TABLE_DEVELOPMENT__/u.test(rootRuntime)
) {
  throw new Error(
    "The package does not preserve browser-safe consumer-time development diagnostics.",
  );
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

const exportedNames = collectDeclarationExportNames(rootDeclarationSet.entry);

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
  "BrunoTableActiveFilterCount",
  "BrunoTableActiveSortCount",
  "BrunoTableBigIntColumn",
  "BrunoTableBooleanColumn",
  "BrunoTableClient",
  "BrunoTableComputedColumn",
  "BrunoTableFilterControl",
  "BrunoTableLoadedRowCount",
  "BrunoTableNumberColumn",
  "BrunoTableQuickFilter",
  "BrunoTableResultRowCount",
  "BrunoTableSelectColumn",
  "BrunoTableTextColumn",
  "BrunoTableToolbar",
  "BrunoTableToolbarSpacer",
].toSorted((left, right) => left.localeCompare(right));

if (JSON.stringify(actualRuntimeExports) !== JSON.stringify(expectedRuntimeExports)) {
  throw new Error("The @bruno/table runtime exports do not match the strict public surface.");
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

const effectExportedNames = collectDeclarationExportNames(effectDeclarationSet.entry);
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

function findImportedBinding(ast, source, importedName) {
  for (const statement of ast.body) {
    if (statement.type !== "ImportDeclaration" || statement.source.value !== source) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ImportSpecifier") continue;
      const imported =
        specifier.imported.type === "Identifier"
          ? specifier.imported.name
          : specifier.imported.value;
      if (imported === importedName) return specifier.local.name;
    }
  }
  return undefined;
}

function collectEffectCallbacks(ast, layoutEffectBinding) {
  const callbacks = [];
  walkSyntaxTree(ast, (node, ancestors) => {
    if (
      node.type !== "CallExpression" ||
      node.callee.type !== "Identifier" ||
      node.callee.name !== layoutEffectBinding
    ) {
      return;
    }
    const callback = node.arguments[0];
    if (isFunctionNode(callback)) {
      callbacks.push(callback);
      return;
    }
    if (callback?.type !== "Identifier") return;
    const owner = ancestors.findLast((ancestor) => isFunctionNode(ancestor)) ?? ast;
    callbacks.push(...findAssignedFunctions(owner, callback.name));
  });
  return callbacks;
}

function findAssignedFunctions(owner, bindingName) {
  const functions = [];
  walkOwnerScope(owner.type === "Program" ? owner : owner.body, (node) => {
    if (
      node.type === "AssignmentExpression" &&
      node.operator === "=" &&
      node.left.type === "Identifier" &&
      node.left.name === bindingName &&
      isFunctionNode(node.right)
    ) {
      functions.push(node.right);
    }
    if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      node.id.name === bindingName &&
      isFunctionNode(node.init)
    ) {
      functions.push(node.init);
    }
  });
  return functions;
}

function walkOwnerScope(node, visit) {
  visit(node);
  for (const child of syntaxChildren(node)) {
    if (isFunctionNode(child)) continue;
    walkOwnerScope(child, visit);
  }
}

function syntaxTreeContains(node, predicate) {
  let matched = false;
  walkSyntaxTree(node, (candidate) => {
    if (predicate(candidate)) matched = true;
  });
  return matched;
}

function walkSyntaxTree(node, visit, ancestors = []) {
  if (node === null || typeof node !== "object" || typeof node.type !== "string") return;
  visit(node, ancestors);
  const nextAncestors = [...ancestors, node];
  for (const child of syntaxChildren(node)) walkSyntaxTree(child, visit, nextAncestors);
}

function syntaxChildren(node) {
  const children = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child !== null && typeof child === "object" && typeof child.type === "string") {
          children.push(child);
        }
      }
    } else if (value !== null && typeof value === "object" && typeof value.type === "string") {
      children.push(value);
    }
  }
  return children;
}

function isFunctionNode(node) {
  return (
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionExpression" ||
    node?.type === "FunctionDeclaration"
  );
}

function memberPropertyName(member) {
  if (member.property.type === "Identifier" && !member.computed) return member.property.name;
  if (member.property.type === "Literal" && typeof member.property.value === "string") {
    return member.property.value;
  }
  return undefined;
}

function isRowAcceptanceCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    memberPropertyName(node.callee) === "acceptRows"
  );
}

function isMutationObserverConstruction(node) {
  return (
    node.type === "NewExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "MutationObserver"
  );
}

function isMutationObserverObserveCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    memberPropertyName(node.callee) === "observe"
  );
}

function isInertBoundaryRemovalCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    memberPropertyName(node.callee) === "removeAttribute" &&
    node.arguments[0]?.type === "Literal" &&
    node.arguments[0].value === "inert"
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
      `import { BrunoTableClient, BrunoTableQuickFilter, BrunoTableTextColumn, BrunoTableToolbar } from "@bruno/table";
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
const quickFilterFields = ["symbol"] as const;
const rendered = (
  <BrunoTableClient
    tableId="TABLE_ID_PACKED"
    columns={columns}
    initialOrderBy={[{ columnId: "COL_ID_SYMBOL", direction: "asc" }]}
    getRowId={(row) => row.symbol}
    quickFilterFields={quickFilterFields}
    clientSource={source}
  >
    <BrunoTableToolbar>
      <BrunoTableQuickFilter />
    </BrunoTableToolbar>
  </BrunoTableClient>
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
    await writeFile(
      join(consumerRoot, "style-entry.ts"),
      'import "./bruno-table.css";\nimport { BrunoTableClient } from "@bruno/table";\nconsole.log(BrunoTableClient);\n',
    );
    await writeFile(
      join(consumerRoot, "bruno-table.css"),
      '@import "@bruno/shadcn/styles.css";\n@source "./node_modules/@bruno/table/dist";\n',
    );
    await writeFile(
      join(consumerRoot, "vite.config.ts"),
      'import tailwindcss from "@tailwindcss/vite";\nimport { defineConfig } from "vite";\nexport default defineConfig(({ mode }) => ({ plugins: [tailwindcss()], define: { "process.env.NODE_ENV": JSON.stringify(mode === "diagnostics" ? "development" : "production") } }));\n',
    );
    await writeFile(
      join(consumerRoot, "index.html"),
      '<!doctype html><html><body><script type="module" src="/style-entry.ts"></script></body></html>\n',
    );

    await assertInstalledGraphExcludesEffect(consumerRoot);
    runTypeScriptConsumer(consumerRoot, "Effect-free @bruno/table root consumer");
    runCommand(process.execPath, ["runtime.mjs"], consumerRoot, "Effect-free root runtime");
    runCommand("pnpm", ["exec", "vp", "build"], consumerRoot, "Styled packed Vite consumer");
    const assetRoot = join(consumerRoot, "dist", "assets");
    await assertBundledIdentityDiagnostics(assetRoot, false);
    const cssAssets = (await readdir(assetRoot)).filter((fileName) => fileName.endsWith(".css"));
    if (cssAssets.length === 0) {
      throw new Error("The styled packed Vite consumer emitted no CSS asset.");
    }
    const css = await Promise.all(
      cssAssets.map((fileName) => readFile(join(assetRoot, fileName), "utf8")),
    );
    if (!css.some((asset) => asset.includes("data-bruno-table"))) {
      throw new Error("The styled packed Vite consumer omitted BrunoTable utility styles.");
    }
    runCommand(
      "pnpm",
      ["exec", "vp", "build", "--mode", "diagnostics", "--outDir", "dist-diagnostics"],
      consumerRoot,
      "Development-diagnostic packed Vite consumer",
      { NODE_ENV: "development" },
    );
    await assertBundledIdentityDiagnostics(join(consumerRoot, "dist-diagnostics", "assets"), true);
  } finally {
    await rm(consumerRoot, { recursive: true, force: true });
  }
}

async function assertBundledIdentityDiagnostics(assetRoot, expected) {
  const javascriptAssets = (await readdir(assetRoot)).filter((fileName) =>
    fileName.endsWith(".js"),
  );
  const javascript = (
    await Promise.all(
      javascriptAssets.map((fileName) => readFile(join(assetRoot, fileName), "utf8")),
    )
  ).join("\n");
  const present = javascript.includes("simultaneous use of tableId");
  if (present !== expected) {
    throw new Error(
      expected
        ? "The development packed consumer removed Table Identity diagnostics."
        : "The production packed consumer retained Table Identity diagnostics.",
    );
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
        ...(includeEffect
          ? {}
          : {
              "@tailwindcss/vite": "4.3.3",
              tailwindcss: "4.3.3",
              vite: "npm:@voidzero-dev/vite-plus-core@0.2.7",
              "vite-plus": "0.2.7",
            }),
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

function runCommand(command, parameters, cwd, label, extraEnvironment = {}) {
  const result = spawnSync(command, parameters, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "true", ...extraEnvironment },
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
}
