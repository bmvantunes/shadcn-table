import assert from "node:assert/strict";

import { lintFixture, withFixtureDirectory, writeFixture } from "./harness.mjs";

withFixtureDirectory((directory) => {
  const fixturePath = writeFixture(
    directory,
    "erased-value-boundary.ts",
    `type BrunoTableDecodeResult<TValue> =
  | { readonly _tag: "Success"; readonly value: TValue }
  | { readonly _tag: "Failure"; readonly message: string };
type ErasedValueType<TValue> = {
  readonly decodeRuntime: (input: unknown) => BrunoTableDecodeResult<TValue>;
  readonly decodePersisted: (input: unknown) => BrunoTableDecodeResult<TValue>;
};
type InvalidBoundary = {
  readonly validate: (input: unknown) => string;
  readonly leaked: (value: string) => unknown;
};
export type Fixture = ErasedValueType<string> | InvalidBoundary;
`,
  );

  const diagnostics = lintFixture(fixturePath, {
    expectedCodes: ["anti-slop(no-unknown-parameters)", "anti-slop(no-unknown-returns)"],
    expectedLocations: [9, 10],
  });
  assert.equal(diagnostics.length, 2);
});
