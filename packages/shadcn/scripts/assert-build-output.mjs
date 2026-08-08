import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const [buttonOutput, compilerOutput, packageJsonSource, componentFiles] = await Promise.all([
  readFile(new URL("../dist/button.mjs", import.meta.url), "utf8"),
  readFile(new URL("../dist/internal/compiler-smoke.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readdir(new URL("../src/components", import.meta.url)),
]);

if (!buttonOutput.includes("react/compiler-runtime")) {
  throw new Error("React Compiler did not transform Button.");
}

if (!compilerOutput.includes("react/compiler-runtime")) {
  throw new Error("React Compiler did not transform the inference-mode smoke fixture.");
}

const packageJson = JSON.parse(packageJsonSource);
const componentNames = componentFiles
  .filter((fileName) => fileName.endsWith(".tsx") && !fileName.endsWith(".test.tsx"))
  .map((fileName) => fileName.replace(/\.tsx$/, ""))
  .sort();

await Promise.all(
  componentNames.map(async (componentName) => {
    const exportName = `./${componentName}`;
    const componentExport = packageJson.exports[exportName];

    if (!componentExport) {
      throw new Error(`The @bruno/shadcn/${componentName} export is missing.`);
    }

    if (
      componentExport.types !== `./dist/${componentName}.d.mts` ||
      componentExport.import !== `./dist/${componentName}.mjs` ||
      componentExport.default !== `./dist/${componentName}.mjs`
    ) {
      throw new Error(`The @bruno/shadcn/${componentName} export is invalid.`);
    }

    await Promise.all([
      readFile(new URL(`../dist/${componentName}.d.mts`, import.meta.url)),
      readFile(new URL(`../dist/${componentName}.mjs`, import.meta.url)),
    ]);
  }),
);

if (Object.keys(packageJson.exports).some((exportName) => exportName.includes("compiler-smoke"))) {
  throw new Error("The private React Compiler smoke fixture was exported publicly.");
}

const publicComponentExports = Object.keys(packageJson.exports)
  .filter((exportName) => exportName !== "./package.json" && exportName !== "./styles.css")
  .map((exportName) => exportName.replace(/^\.\//, ""))
  .sort();

if (publicComponentExports.join("\n") !== componentNames.join("\n")) {
  throw new Error("The public component exports do not match the source component inventory.");
}

const publicModules = await Promise.all(
  componentNames.map((componentName) => import(`@bruno/shadcn/${componentName}`)),
);

for (const [index, publicModule] of publicModules.entries()) {
  if (Object.keys(publicModule).length === 0) {
    throw new Error(`The @bruno/shadcn/${componentNames[index]} runtime export is empty.`);
  }
}

if (packageJson.exports["./styles.css"] !== "./src/styles/globals.css") {
  throw new Error("The @bruno/shadcn/styles.css export is missing.");
}

const publicModule = await import("@bruno/shadcn/button");

if (
  typeof publicModule.Button !== "function" ||
  typeof publicModule.buttonVariants !== "function"
) {
  throw new Error("The @bruno/shadcn/button runtime export is invalid.");
}

const stylesheetUrl = import.meta.resolve("@bruno/shadcn/styles.css");

if (!stylesheetUrl.endsWith("/src/styles/globals.css")) {
  throw new Error("The @bruno/shadcn/styles.css runtime export is invalid.");
}

await assertPackedConsumer();

async function assertPackedConsumer() {
  const packRoot = await mkdtemp(join(tmpdir(), "bruno-shadcn-pack-"));
  try {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    runCommand("pnpm", ["pack", "--pack-destination", packRoot], packageRoot, "package tarball");
    const tarballNames = (await readdir(packRoot)).filter((fileName) => fileName.endsWith(".tgz"));
    if (tarballNames.length !== 1) {
      throw new Error(
        `pnpm pack produced ${tarballNames.length} tarballs; expected exactly one (${tarballNames.join(", ") || "none"}).`,
      );
    }

    const consumerRoot = await mkdtemp(join(tmpdir(), "bruno-shadcn-consumer-"));
    try {
      const tarball = join(packRoot, tarballNames[0]);
      await writeFile(
        join(consumerRoot, "package.json"),
        JSON.stringify({
          private: true,
          type: "module",
          dependencies: {
            "@bruno/shadcn": `file:${tarball}`,
            "@types/react": requiredDevDependency("@types/react"),
            "@types/react-dom": requiredDevDependency("@types/react-dom"),
            react: requiredDevDependency("react"),
            "react-dom": requiredDevDependency("react-dom"),
            typescript: requiredDevDependency("typescript"),
          },
        }),
      );
      await writeFile(
        join(consumerRoot, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            jsx: "react-jsx",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            noEmit: true,
            strict: true,
            skipLibCheck: true,
          },
          include: ["src"],
        }),
      );
      await mkdir(join(consumerRoot, "src"));
      await writeFile(join(consumerRoot, "src/styles.d.ts"), 'declare module "*.css";\n');
      await writeFile(
        join(consumerRoot, "src/index.tsx"),
        `import { Button } from "@bruno/shadcn/button";
import { Toaster, toast } from "@bruno/shadcn/toast";
import "@bruno/shadcn/styles.css";

export function CleanConsumer() {
  return (
    <>
      <Button onClick={() => toast.add({ title: "Saved", timeout: 0 })}>Save</Button>
      <Toaster />
    </>
  );
}
`,
      );
      await writeFile(
        join(consumerRoot, "runtime.mjs"),
        `const button = await import("@bruno/shadcn/button");
const toast = await import("@bruno/shadcn/toast");
if (typeof button.Button !== "function" || typeof toast.Toaster !== "function") {
  throw new Error("Packed direct-subpath exports are empty.");
}
`,
      );

      runCommand(
        "pnpm",
        ["install", "--prefer-offline", "--ignore-scripts", "--no-frozen-lockfile"],
        consumerRoot,
        "packed consumer install",
      );
      const typescriptCli = fileURLToPath(
        new URL("../../../node_modules/typescript/bin/tsc", import.meta.url),
      );
      runCommand(
        process.execPath,
        [typescriptCli, "--project", "tsconfig.json"],
        consumerRoot,
        "packed consumer types",
      );
      runCommand(process.execPath, ["runtime.mjs"], consumerRoot, "packed consumer runtime");
    } finally {
      await rm(consumerRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(packRoot, { recursive: true, force: true });
  }
}

function runCommand(command, parameters, cwd, label) {
  const result = spawnSync(command, parameters, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
  if (result.error || result.status !== 0 || result.signal !== null) {
    const commandLine = [command, ...parameters].join(" ");
    const failure =
      result.error?.message ??
      `exit status ${result.status ?? "unknown"}${result.signal ? ` (signal ${result.signal})` : ""}`;
    throw new Error(
      `${label} failed: ${commandLine}\n${failure}\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

function requiredDevDependency(name) {
  const version = packageJson.devDependencies?.[name];
  if (!version) {
    throw new Error(`The packed consumer requires ${name} in @bruno/shadcn devDependencies.`);
  }
  return version;
}
