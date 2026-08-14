import assert from "node:assert/strict";

import { lintFixture, withFixtureDirectory, writeFixture } from "./harness.mjs";

withFixtureDirectory((directory) => {
  const fixturePath = writeFixture(
    directory,
    "unknown-type-aliases.ts",
    `type UnknownMember = unknown;
/* oxlint-disable-next-line typescript/no-redundant-type-constituents */
export type UnionUnknown = string | UnknownMember;
export type ReferencedUnion = UnionUnknown;
export type Parsed = string | number;
`,
  );

  const diagnostics = lintFixture(fixturePath, {
    expectedCodes: [
      "anti-slop(no-unknown-type-aliases)",
      "anti-slop(no-unknown-type-aliases)",
      "anti-slop(no-unknown-type-aliases)",
    ],
    expectedLocations: [1, 3, 4],
  });
  assert.equal(diagnostics.length, 3);
});
