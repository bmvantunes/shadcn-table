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

for (const cwd of [repositoryRoot, ...packageConfigs]) {
  const configSource = readFileSync(resolve(cwd, "vite.config.ts"), "utf8");
  for (const ruleName of ruleNames) {
    assert.match(
      configSource,
      new RegExp(`['"]anti-slop/${ruleName}['"]\\s*:\\s*['"]error['"]`, "u"),
      `${cwd} must enable ${ruleName} at error severity`,
    );
  }
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

  for (const cwd of packageConfigs) {
    const diagnostics = lintFixture(fixturePath, {
      cwd,
      expectedCodes: ["anti-slop(no-object-parameters)"],
    });
    assert.equal(diagnostics.length, 1, cwd);
  }
});
