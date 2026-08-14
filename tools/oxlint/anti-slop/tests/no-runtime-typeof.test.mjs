import assert from "node:assert/strict";

import { lintFixture, withFixtureDirectory, writeFixture } from "./harness.mjs";

withFixtureDirectory((directory) => {
  const guardedPath = writeFixture(
    directory,
    "guarded.ts",
    `export function decodeText(this: void, value: string | number): string | undefined {
  if (typeof value !== "string") return undefined;
  return value;
}
`,
  );
  lintFixture(guardedPath);

  const renderGuardPath = writeFixture(
    directory,
    "render-guard.ts",
    `export function renderGuard(value: string | number): string {
  return typeof value === "string" ? value : String(value);
}
`,
  );
  lintFixture(renderGuardPath);

  const extractedPath = writeFixture(
    directory,
    "extracted.ts",
    `export function valueKind(value: string | number): string {
  return typeof value;
}
`,
  );
  lintFixture(extractedPath, {
    expectedCodes: ["anti-slop(no-runtime-typeof)"],
    expectedLocations: [2],
  });

  const ordinaryGuardPath = writeFixture(
    directory,
    "ordinary-guard.ts",
    `export function ordinaryGuard(value: string | number): string {
  if (typeof value === "string") return value;
  return typeof value;
}
`,
  );
  lintFixture(ordinaryGuardPath, {
    expectedCodes: ["anti-slop(no-runtime-typeof)"],
    expectedLocations: [3],
  });

  const invalidTagPath = writeFixture(
    directory,
    "invalid-tag.ts",
    `const invalidTag: string = "record";
export function invalidTagValue(value: string | number): string {
  return typeof value === invalidTag ? "record" : "other";
}
`,
  );
  lintFixture(invalidTagPath, {
    expectedCodes: ["anti-slop(no-runtime-typeof)"],
    expectedLocations: [3],
  });

  const boundaryContractPath = writeFixture(
    directory,
    "boundary-contract.ts",
    `export function boundaryDecoder(this: void, input: unknown): string {
  return typeof input === "string" ? input : "";
}
export function ordinaryFunction(input: unknown): string {
  return String(input);
}
`,
  );
  const diagnostics = lintFixture(boundaryContractPath, {
    expectedCodes: ["anti-slop(no-unknown-parameters)", "anti-slop(no-unknown-parameters)"],
    expectedLocations: [1, 4],
  });
  assert.equal(diagnostics.length, 2);
});
