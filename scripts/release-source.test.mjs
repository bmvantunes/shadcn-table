import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { captureReleaseSource } from "./release-source.mjs";

void test("release provenance distinguishes a base revision from the exact dirty snapshot", async () => {
  const repository = await mkdtemp(join(tmpdir(), "bruno-release-provenance-"));
  const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
  try {
    git("init", "--quiet");
    await writeFile(join(repository, "kept.txt"), "committed\n");
    await writeFile(join(repository, "deleted.txt"), "delete me\n");
    git("add", ".");
    git(
      "-c",
      "user.name=Release Test",
      "-c",
      "user.email=release@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "base",
    );
    const clean = await captureReleaseSource(repository);
    await writeFile(join(repository, "kept.txt"), "staged\n");
    git("add", "kept.txt");
    await writeFile(join(repository, "kept.txt"), "working tree\n");
    await writeFile(join(repository, "untracked.txt"), "new\n");
    await rm(join(repository, "deleted.txt"));
    const dirty = await captureReleaseSource(repository);
    assert.equal(dirty.baseRevision, git("rev-parse", "HEAD"));
    assert.equal(dirty.baseRevision, clean.baseRevision);
    assert.notEqual(dirty.sourceSnapshot.sha256, clean.sourceSnapshot.sha256);
    assert.equal(dirty.sourceSnapshot.kind, "working-tree");
    assert.deepEqual(
      dirty.files.map(({ file }) => file),
      ["kept.txt", "untracked.txt"],
    );
    assert.equal(await readFile(join(repository, "kept.txt"), "utf8"), "working tree\n");
    assert.deepEqual(await captureReleaseSource(repository), dirty);
    git("add", "-A");
    git(
      "-c",
      "user.name=Release Test",
      "-c",
      "user.email=release@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "same snapshot",
    );
    const committed = await captureReleaseSource(repository);
    assert.notEqual(committed.baseRevision, dirty.baseRevision);
    assert.deepEqual(committed.sourceSnapshot, dirty.sourceSnapshot);
    assert.deepEqual(committed.files, dirty.files);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});
