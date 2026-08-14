import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export const repositoryRoot = new URL("../../../../", import.meta.url).pathname;

export function withFixtureDirectory(callback, baseDirectory = repositoryRoot) {
  const directory = mkdtempSync(join(baseDirectory, ".anti-slop-fixtures-"));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function writeFixture(directory, name, source) {
  const filePath = join(directory, name);
  writeFileSync(filePath, source);
  return filePath;
}

export function lintFixture(
  filePath,
  { cwd = repositoryRoot, expectedCodes = [], expectedLocations = [] } = {},
) {
  const result = spawnSync("vp", ["lint", filePath, "--format", "json"], {
    cwd,
    encoding: "utf8",
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, null, "vp lint did not produce an exit status");

  const output = `${result.stdout}${result.stderr}`.trim();
  let report;
  try {
    report = JSON.parse(output);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    assert.fail(`vp lint did not return JSON: ${details}\n${output}`);
  }

  const diagnostics = report.diagnostics ?? [];
  const compareCodes = (left, right) => left.localeCompare(right);
  const actualCodes = diagnostics.map((diagnostic) => diagnostic.code).sort(compareCodes);
  const sortedExpectedCodes = [...expectedCodes].sort(compareCodes);
  assert.deepEqual(actualCodes, sortedExpectedCodes, `unexpected diagnostics for ${filePath}`);
  assert.equal(
    result.status === 0,
    expectedCodes.length === 0,
    `vp lint exit status did not match expected diagnostics for ${filePath}`,
  );

  if (expectedLocations.length > 0) {
    assert.deepEqual(
      diagnostics.map((diagnostic) => diagnostic.labels[0]?.span.line),
      expectedLocations,
      `unexpected diagnostic locations for ${filePath}`,
    );
  }

  return diagnostics;
}
