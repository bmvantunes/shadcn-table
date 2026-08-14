import assert from "node:assert/strict";

import { lintFixture, withFixtureDirectory, writeFixture } from "./harness.mjs";

withFixtureDirectory((directory) => {
  const fixturePath = writeFixture(
    directory,
    "reflect-get.ts",
    `const target = { value: 1 };
const ordinary = Reflect.get(target, "value");
const proxy = new Proxy(target, {
  get(proxyTarget, property, receiver) {
    return Reflect.get(proxyTarget, property, receiver);
  },
});
void ordinary;
void proxy;
`,
  );

  const diagnostics = lintFixture(fixturePath, {
    expectedCodes: ["anti-slop(no-reflect-get)"],
    expectedLocations: [2],
  });
  assert.equal(diagnostics.length, 1);
});
