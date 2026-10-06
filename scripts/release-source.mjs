import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

// The base revision supplies Git history; only the snapshot digest identifies build input.
export async function captureReleaseSource(repository) {
  const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8" });
  const baseRevision = git("rev-parse", "HEAD").trim();
  const listed = git("ls-files", "--cached", "--others", "--exclude-standard", "-z");
  const files = [];
  for (const file of [...new Set(listed.split("\0").filter(Boolean))].sort()) {
    const path = join(repository, file);
    const info = await lstat(path).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (info === undefined || info.isDirectory()) continue;
    assert.ok(info.isFile(), `Release input must be an ordinary file: ${file}`);
    files.push({
      file,
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    });
  }
  return {
    baseRevision,
    sourceSnapshot: {
      kind: "working-tree",
      sha256: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
      fileList: "source-files.json",
    },
    files,
  };
}
