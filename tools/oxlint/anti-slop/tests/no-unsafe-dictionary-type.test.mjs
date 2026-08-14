import assert from "node:assert/strict";

import { lintFixture, withFixtureDirectory, writeFixture } from "./harness.mjs";

withFixtureDirectory((directory) => {
  const fixturePath = writeFixture(
    directory,
    "dictionary-contract.ts",
    `/** @anti-slop-dictionary-owner */
interface OwnedBoundaryRecord {
  readonly [key: string]: unknown;
}
interface BoundaryRecord {
  readonly [key: string]: unknown;
}
interface NestedBoundary {
  readonly values: Record<string, unknown>;
}

export const ownedBoundary: OwnedBoundaryRecord = { value: 1 };
export const namedBoundary: BoundaryRecord = { value: 1 };
export const nestedBoundary: NestedBoundary = { values: { value: 1 } };
export const anonymousBoundary: Record<string, unknown> = {};
`,
  );

  const diagnostics = lintFixture(fixturePath, {
    expectedCodes: [
      "anti-slop(no-unsafe-dictionary-type)",
      "anti-slop(no-unsafe-dictionary-type)",
      "anti-slop(no-unsafe-dictionary-type)",
    ],
  });
  assert.equal(diagnostics.length, 3);
});
