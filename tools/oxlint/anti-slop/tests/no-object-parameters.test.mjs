import assert from "node:assert/strict";

import { lintFixture, withFixtureDirectory, writeFixture } from "./harness.mjs";

withFixtureDirectory((directory) => {
  const fixturePath = writeFixture(
    directory,
    "object-parameters.ts",
    `export function broad(value: object): void { void value; }
export function runtimeValue(value: object | string | number | null): void { void value; }
export function precise(value: { readonly id: string }): void { void value; }
`,
  );

  const diagnostics = lintFixture(fixturePath, {
    expectedCodes: ["anti-slop(no-object-parameters)", "anti-slop(no-object-parameters)"],
    expectedLocations: [1, 2],
  });
  assert.equal(diagnostics.length, 2);
});
