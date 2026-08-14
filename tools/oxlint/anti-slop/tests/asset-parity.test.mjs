import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { repositoryRoot } from "./harness.mjs";

const assetRoot = join(repositoryRoot, ".agents/skills/install-anti-slop/assets/anti-slop");
const activeRoot = join(repositoryRoot, "tools/oxlint/anti-slop");

const correctedRuleMarkers = {
  "rules/no-runtime-typeof.ts": ["runtimeTypeTags", "isBoundaryComparison"],
  "rules/no-reflect-get.ts": ["isGlobalProxy", "isDelegatingProxyGetTrap"],
  "rules/no-unknown-parameters.ts": ["typePredicateParameterName", 'name === "cause"'],
  "rules/no-unsafe-dictionary-type.ts": [
    "classifyUnsafeDictionaryValue",
    "concrete owner type",
    "anti-slop-dictionary-owner",
  ],
};

function relativeFiles(root, current = root) {
  const entries = readdirSync(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...relativeFiles(root, path));
    else if (entry.isFile()) files.push(path.slice(root.length + 1));
  }
  return files.sort((left, right) => left.localeCompare(right));
}

for (const [relativePath, markers] of Object.entries(correctedRuleMarkers)) {
  const assetPath = join(assetRoot, relativePath);
  const activePath = join(activeRoot, relativePath);
  assert.ok(existsSync(assetPath), `missing bundled asset ${relativePath}`);
  assert.ok(existsSync(activePath), `missing active rule ${relativePath}`);

  const assetSource = readFileSync(assetPath, "utf8");
  const activeSource = readFileSync(activePath, "utf8");
  for (const marker of markers) {
    assert.match(assetSource, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
    assert.match(activeSource, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  }
}

for (const relativePath of relativeFiles(assetRoot)) {
  const assetPath = join(assetRoot, relativePath);
  const activePath = join(activeRoot, relativePath);
  assert.ok(existsSync(activePath), `missing active implementation ${relativePath}`);
  assert.deepEqual(
    readFileSync(activePath),
    readFileSync(assetPath),
    `active implementation differs from bundled asset: ${relativePath}`,
  );
}

const assetFiles = relativeFiles(assetRoot);
const activeImplementationFiles = relativeFiles(activeRoot).filter(
  (relativePath) => !relativePath.startsWith("tests/"),
);
assert.deepEqual(
  activeImplementationFiles,
  assetFiles,
  "active and bundled implementation file lists must match in both directions",
);

assert.match(
  readFileSync(
    join(repositoryRoot, ".agents/skills/install-anti-slop/scripts/install.mjs"),
    "utf8",
  ),
  /cpSync\(source, target/u,
);

const temporaryRoot = mkdtempSync(join(tmpdir(), "anti-slop-asset-parity-"));
try {
  const destination = join(temporaryRoot, "installed");
  const result = spawnSync(
    process.execPath,
    [join(repositoryRoot, ".agents/skills/install-anti-slop/scripts/install.mjs"), destination],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  assert.deepEqual(relativeFiles(destination), assetFiles);
  for (const relativePath of assetFiles) {
    assert.deepEqual(
      readFileSync(join(destination, relativePath)),
      readFileSync(join(assetRoot, relativePath)),
      `installed asset differs from bundled asset: ${relativePath}`,
    );
  }
} finally {
  assert.ok(statSync(temporaryRoot).isDirectory());
  rmSync(temporaryRoot, { recursive: true, force: true });
}
