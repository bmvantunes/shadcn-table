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
const unrelated = new Proxy(target, {
  get(proxyTarget, property, receiver) {
    return Reflect.get(target, property, receiver);
  },
});
function shadowedProxy(Proxy: typeof globalThis.Proxy) {
  return new Proxy(target, {
    get(proxyTarget, property, receiver) {
      return Reflect.get(proxyTarget, property, receiver);
    },
  });
}
void ordinary;
void proxy;
void unrelated;
void shadowedProxy;
`,
  );

  const diagnostics = lintFixture(fixturePath, {
    expectedCodes: [
      "anti-slop(no-reflect-get)",
      "anti-slop(no-reflect-get)",
      "anti-slop(no-reflect-get)",
    ],
    expectedLocations: [2, 10, 16],
  });
  assert.equal(diagnostics.length, 3);
});
