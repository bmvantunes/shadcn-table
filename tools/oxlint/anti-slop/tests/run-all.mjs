import { readdirSync } from "node:fs";
import { join } from "node:path";

const testsDirectory = new URL(".", import.meta.url).pathname;
const testFiles = readdirSync(testsDirectory)
  .filter((fileName) => fileName.endsWith(".test.mjs"))
  .sort();

for (const fileName of testFiles) {
  await import(join(testsDirectory, fileName));
}

console.log(`anti-slop focused tests passed: ${testFiles.length} files`);
