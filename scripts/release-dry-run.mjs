import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isolatedProcessEnvironment } from "../config/isolated-process-environment.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = await mkdtemp(join(tmpdir(), "bruno-release-dry-run-"));
await mkdir(join(output, "logs"));
process.stdout.write(`Release evidence: ${output}\n`);
let commandNumber = 0;

function run(command, args, cwd, label) {
  const logName = `${String(++commandNumber).padStart(3, "0")}-${label}.log`;
  process.stdout.write(`${label}\n`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: isolatedProcessEnvironment(cwd),
  });
  return writeFile(
    join(output, "logs", logName),
    `${command} ${args.join(" ")}\nexit=${result.status} signal=${result.signal}\n${result.stdout ?? ""}${result.stderr ?? ""}`,
  ).then(() => {
    if (result.status !== 0)
      throw new Error(`${label} failed; see ${join(output, "logs", logName)}`);
    return result.stdout;
  });
}

const listed = await run(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  repository,
  "source-files",
);
const files = [...new Set(listed.split("\0").filter(Boolean))].sort();
const sourceHashes = [];
for (const file of files) {
  const path = join(repository, file);
  const info = await lstat(path).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (info === undefined || info.isDirectory()) continue;
  assert.ok(info.isFile(), `Release input must be an ordinary file: ${file}`);
  const content = await readFile(path);
  sourceHashes.push({ file, sha256: createHash("sha256").update(content).digest("hex") });
}
await writeFile(join(output, "source-files.json"), `${JSON.stringify(sourceHashes, null, 2)}\n`);
const head = (await run("git", ["rev-parse", "HEAD"], repository, "source-head")).trim();
const origin = (
  await run("git", ["remote", "get-url", "origin"], repository, "source-origin")
).trim();

async function snapshot(name) {
  const directory = join(output, name);
  await run(
    "git",
    ["clone", "--local", "--no-hardlinks", "--no-checkout", repository, directory],
    repository,
    `${name}-clone`,
  );
  await run("git", ["reset", "--mixed", head], directory, `${name}-index`);
  await run("git", ["remote", "set-url", "origin", origin], directory, `${name}-origin`);
  for (const { file, sha256 } of sourceHashes) {
    const destination = join(directory, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(repository, file), destination);
    assert.equal(
      createHash("sha256")
        .update(await readFile(destination))
        .digest("hex"),
      sha256,
      `Source changed during release snapshot: ${file}`,
    );
  }
  await run("vp", ["install", "--frozen-lockfile"], directory, `${name}-clean-install`);
  await run(
    "node",
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { realpathSync } from 'node:fs';
    import { fileURLToPath } from 'node:url';
    const root = realpathSync(process.cwd());
    const resolved = Object.fromEntries(['vite-plus', 'vite-plus/test', 'typescript'].map(name => [name, realpathSync(fileURLToPath(import.meta.resolve(name)))]));
    for (const path of Object.values(resolved)) assert.ok(path.startsWith(root + '/node_modules/'), 'Foreign toolchain: ' + path);
    console.log(JSON.stringify({ node: process.version, executable: process.execPath, root, resolved }, null, 2));
  `,
    ],
    directory,
    `${name}-toolchain-isolation`,
  );
  return directory;
}

async function build(directory, name) {
  await run("vp", ["run", "@bruno/shadcn#build"], directory, `${name}-shadcn-build`);
  await run("vp", ["run", "@bruno/table#build"], directory, `${name}-table-build`);
}

async function pack(directory, name) {
  const destination = join(output, name);
  await mkdir(destination);
  const packages = [];
  for (const packageName of ["shadcn", "table"]) {
    const packed = JSON.parse(
      await run(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", destination],
        join(directory, "packages", packageName),
        `${name}-${packageName}`,
      ),
    )[0];
    const bytes = await readFile(join(destination, packed.filename));
    packages.push({
      name: packed.name,
      version: packed.version,
      filename: packed.filename,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      integrity: packed.integrity,
      files: packed.files,
    });
  }
  return packages;
}

try {
  const first = await snapshot("first");
  await build(first, "first");
  const firstPackages = await pack(first, "artifacts");
  const second = await snapshot("second");
  await build(second, "second");
  const secondPackages = await pack(second, "repeat-artifacts");
  assert.deepEqual(
    secondPackages,
    firstPackages,
    "Independent clean builds must produce byte-identical tarballs and file lists",
  );
  const manifest = {
    schemaVersion: 1,
    sourceHead: head,
    sourceFilesSha256: createHash("sha256").update(JSON.stringify(sourceHashes)).digest("hex"),
    packages: firstPackages,
  };
  await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    "Independent clean-build tarballs are byte-identical. Validation is pending.\n",
  );
  await run("vp", ["check"], first, "format-lint-types");
  await run("vp", ["test", "--project", "node", "--run"], first, "all-node-tests");
  await run("vp", ["run", "@bruno/shadcn#check:build"], first, "shadcn-package");
  await run("vp", ["run", "test:browser"], first, "all-browser-tests");
  await run("vp", ["run", "@bruno/table#prepublishOnly"], first, "complete-table-release-gates");
  await writeFile(
    join(output, "VALIDATED.txt"),
    "All required local release checks passed. Registry publication was not performed.\n",
  );
  process.stdout.write(`Non-publishing dry run passed. Artifacts and evidence: ${output}\n`);
} catch (error) {
  await writeFile(join(output, "FAILURE.txt"), `${String(error)}\n`);
  throw error;
}
