import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const forbiddenPackages = [`js${"dom"}`, `@testing-library/${"react"}`] as const;
const forbiddenSourceFragments = [
  ...forbiddenPackages,
  `@vitest-${"environment"} js${"dom"}`,
] as const;
const ignoredDirectories = new Set([
  ".agents",
  ".codex",
  ".git",
  ".repos",
  "dist",
  "docs",
  "node_modules",
]);

async function findFiles(directory: string, predicate: (fileName: string) => boolean) {
  const matches: string[] = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await findFiles(absolutePath, predicate)));
    } else if (predicate(entry.name)) {
      matches.push(absolutePath);
    }
  }

  return matches;
}

describe("test environment policy", () => {
  test("does not declare DOM emulators or React Testing Library", async () => {
    const manifests = [
      path.join(workspaceRoot, "package.json"),
      ...(await findFiles(path.join(workspaceRoot, "packages"), (name) => name === "package.json")),
    ];

    const violations: string[] = [];
    for (const manifestPath of manifests) {
      // SAFETY: The repository manifest paths are known package.json files; malformed JSON fails at this boundary.
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
        string,
        Record<string, string> | undefined
      >;

      for (const section of ["dependencies", "devDependencies", "peerDependencies"] as const) {
        for (const packageName of forbiddenPackages) {
          if (manifest[section]?.[packageName] !== undefined) {
            violations.push(
              `${path.relative(workspaceRoot, manifestPath)}: ${section}.${packageName}`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("does not resolve forbidden packages in the lockfile", async () => {
    const lockfile = await readFile(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf8");
    const resolvedPackageKeys = forbiddenPackages.map((packageName) => {
      const escapedPackageName = packageName.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      return new RegExp(`^  ['"]?${escapedPackageName}@`, "mu");
    });

    expect(resolvedPackageKeys.filter((packageKey) => packageKey.test(lockfile))).toEqual([]);
  });

  test("does not import or opt into forbidden test environments", async () => {
    const sourceFiles = await findFiles(workspaceRoot, (name) =>
      /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/u.test(name),
    );
    const violations: string[] = [];

    for (const sourcePath of sourceFiles) {
      const source = await readFile(sourcePath, "utf8");
      for (const fragment of forbiddenSourceFragments) {
        if (source.includes(fragment)) {
          violations.push(`${path.relative(workspaceRoot, sourcePath)}: ${fragment}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("uses role-based queries in browser component tests", async () => {
    const browserTests = await findFiles(workspaceRoot, (name) =>
      /\.browser\.test\.[cm]?[jt]sx?$/u.test(name),
    );
    const nonRoleQuery = /\.(?:find|get|query)By(?!Role\b)[A-Z][A-Za-z]*\s*\(/gu;
    const violations: string[] = [];

    for (const sourcePath of browserTests) {
      const source = await readFile(sourcePath, "utf8");
      for (const match of source.matchAll(nonRoleQuery)) {
        violations.push(
          `${path.relative(workspaceRoot, sourcePath)}: ${match[0].trim().slice(1, -1)}`,
        );
      }
      if (source.includes("data-testid")) {
        violations.push(`${path.relative(workspaceRoot, sourcePath)}: data-testid`);
      }
    }

    expect(violations).toEqual([]);
  });
});
