import assert from "node:assert/strict";

import { lintFixture, withFixtureDirectory, writeFixture } from "./harness.mjs";

withFixtureDirectory((directory) => {
  const fixturePath = writeFixture(
    directory,
    "unknown-boundary.ts",
    `export function isText(input: unknown): input is string {
  return typeof input === "string";
}
export function ownedBoundary(this: void, input: unknown): string {
  return String(input);
}
export function ordinaryFunction(input: unknown): string {
  return String(input);
}
type DecodeResult<T> = { readonly _tag: "Success"; readonly value: T };
export function parseBoundary(input: unknown): DecodeResult<string> {
  return { _tag: "Success", value: String(input) };
}
export function parseWithContext(input: unknown, context: unknown): DecodeResult<string> {
  void context;
  return { _tag: "Success", value: String(input) };
}
`,
  );

  const diagnostics = lintFixture(fixturePath, {
    expectedCodes: [
      "anti-slop(no-unknown-parameters)",
      "anti-slop(no-unknown-parameters)",
      "anti-slop(no-unknown-parameters)",
      "anti-slop(no-unknown-parameters)",
    ],
    expectedLocations: [4, 7, 14, 14],
  });
  assert.equal(diagnostics.length, 4);
});
