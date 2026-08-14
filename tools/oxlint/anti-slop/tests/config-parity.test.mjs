import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { lintFixture, repositoryRoot, withFixtureDirectory, writeFixture } from "./harness.mjs";

const ruleNames = [
  "no-chained-type-assertions",
  "no-conditional-empty-object-spread",
  "no-known-value-widening",
  "no-module-mocking",
  "no-object-parameters",
  "no-reflect-apply",
  "no-reflect-get",
  "no-runtime-typeof",
  "no-shape-in-symbol-names",
  "no-unknown-parameters",
  "no-unknown-returns",
  "no-unknown-type-aliases",
  "no-unsafe-dictionary-type",
  "no-widen-then-assert",
  "require-safety-comment-for-type-assertion",
];

const packageConfigs = [
  resolve(repositoryRoot, "packages/table"),
  resolve(repositoryRoot, "packages/shadcn"),
];

const rootConfigSource = readFileSync(resolve(repositoryRoot, "vite.config.ts"), "utf8");
const sharedConfigSource = readFileSync(
  resolve(repositoryRoot, "config/anti-slop-lint.ts"),
  "utf8",
);
assert.match(rootConfigSource, /antiSlopJavaScriptPlugin/u);
assert.match(rootConfigSource, /antiSlopRules/u);
for (const ruleName of ruleNames) {
  assert.match(
    sharedConfigSource,
    new RegExp(`['"]anti-slop/${ruleName}['"]\\s*:\\s*['"]error['"]`, "u"),
    `${repositoryRoot}/config/anti-slop-lint.ts must enable ${ruleName} at error severity`,
  );
}

for (const cwd of packageConfigs) {
  const configSource = readFileSync(resolve(cwd, "vite.config.ts"), "utf8");
  assert.match(configSource, /antiSlopJavaScriptPlugin/u, `${cwd} must use the shared plugin`);
  assert.match(configSource, /\.\.\.antiSlopRules/u, `${cwd} must use the shared rules`);
  assert.doesNotMatch(
    configSource,
    /anti-slop\/[a-z-]+/u,
    `${cwd} must not duplicate anti-slop rule definitions`,
  );
}

withFixtureDirectory((directory) => {
  const fixturePath = writeFixture(
    directory,
    "package-local-anti-slop.ts",
    `export function packageBoundary(value: object): void {
  void value;
}
`,
  );

  const rootDiagnostics = lintFixture(fixturePath, {
    cwd: repositoryRoot,
    expectedCodes: ["anti-slop(no-object-parameters)"],
  });
  assert.equal(rootDiagnostics.length, 1, repositoryRoot);
  for (const cwd of packageConfigs) {
    const diagnostics = lintFixture(fixturePath, {
      cwd,
      expectedCodes: ["anti-slop(no-object-parameters)"],
    });
    assert.equal(diagnostics.length, 1, cwd);
  }
});
