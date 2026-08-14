import assert from "node:assert/strict";

import { lintFixture, withFixtureDirectory, writeFixture } from "./harness.mjs";

withFixtureDirectory((directory) => {
  const fixturePath = writeFixture(
    directory,
    "safety-comment-boundaries.ts",
    `/* SAFETY: function documentation is not an assertion justification. */
export function nestedAssertion(): number {
  return 1 as number;
}
/* SAFETY: arrow function documentation is not an assertion justification. */
export const arrowAssertion = (): number => 1 as number;
export function directlyJustified(): number {
  // SAFETY: the literal has the declared numeric domain.
  return 1 as number;
}
`,
  );

  const diagnostics = lintFixture(fixturePath, {
    expectedCodes: [
      "anti-slop(require-safety-comment-for-type-assertion)",
      "anti-slop(require-safety-comment-for-type-assertion)",
    ],
    expectedLocations: [3, 6],
  });
  assert.equal(diagnostics.length, 2);
});
