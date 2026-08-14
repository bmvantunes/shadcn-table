import assert from "node:assert/strict";

import { lintFixture, repositoryRoot, withFixtureDirectory, writeFixture } from "./harness.mjs";

const cases = [
  {
    name: "no-chained-type-assertions",
    source: `export const chained = (1 as number) as number;
export const valid = 1 as const;
`,
    expectedCodes: [
      "anti-slop(no-chained-type-assertions)",
      "anti-slop(require-safety-comment-for-type-assertion)",
      "anti-slop(require-safety-comment-for-type-assertion)",
    ],
  },
  {
    name: "no-conditional-empty-object-spread",
    source: `const condition = Math.random() > 0.5;
export const conditional = { id: 1, ...(condition ? {} : { value: 1 }) };
export const explicit = { value: 1 };
`,
    expectedCodes: ["anti-slop(no-conditional-empty-object-spread)"],
  },
  {
    name: "no-known-value-widening",
    source: `export const widened: object = { value: 1 };
export const inferred = { value: 1 };
`,
    expectedCodes: ["anti-slop(no-known-value-widening)"],
  },
  {
    name: "no-module-mocking",
    source: `import { vi } from "vitest";
vi.mock("./dependency");
function realDependencyCall(): void {}
realDependencyCall();
`,
    expectedCodes: ["anti-slop(no-module-mocking)"],
  },
  {
    name: "no-object-parameters",
    source: `export function broad(value: object): void { void value; }
export function precise(value: { readonly id: string }): void { void value; }
`,
    expectedCodes: ["anti-slop(no-object-parameters)"],
  },
  {
    name: "no-reflect-apply",
    source: `const fn = (): undefined => undefined;
Reflect.apply(fn, undefined, []);
`,
    expectedCodes: ["anti-slop(no-reflect-apply)"],
  },
  {
    name: "no-reflect-get",
    source: `const target = { value: 1 };
Reflect.get(target, "value");
`,
    expectedCodes: ["anti-slop(no-reflect-get)"],
  },
  {
    name: "no-runtime-typeof",
    source: `export function rawTag(value: string | number): string {
  return typeof value;
}
export function validGuard(value: string | number): boolean {
    return typeof value === "string";
}
`,
    expectedCodes: ["anti-slop(no-runtime-typeof)"],
  },
  {
    name: "no-shape-in-symbol-names",
    source: `export const shapeValue = Symbol("value");
export const normalValue = Symbol("value");
`,
    expectedCodes: ["anti-slop(no-shape-in-symbol-names)"],
  },
  {
    name: "no-unknown-parameters",
    source: `export function unknownInput(input: unknown): string {
  return String(input);
}
export function knownInput(input: string): string {
  return input;
}
`,
    expectedCodes: ["anti-slop(no-unknown-parameters)"],
  },
  {
    name: "no-unknown-returns",
    source: `export function unknownOutput(): unknown {
  return undefined;
}
export function knownOutput(): string {
  return "value";
}
`,
    expectedCodes: ["anti-slop(no-unknown-returns)"],
  },
  {
    name: "no-unknown-type-aliases",
    source: `export type Hidden = unknown;
export type Parsed = string;
`,
    expectedCodes: ["anti-slop(no-unknown-type-aliases)"],
  },
  {
    name: "no-unsafe-dictionary-type",
    source: `export const dictionary: Record<string, unknown> = {};
interface NamedBoundary {
  readonly [key: string]: unknown;
}
export const boundary: NamedBoundary = {};
`,
    expectedCodes: ["anti-slop(no-unsafe-dictionary-type)", "anti-slop(no-unsafe-dictionary-type)"],
  },
  {
    name: "no-widen-then-assert",
    source: `// SAFETY: the fixture intentionally exercises a widened binding.
const widened: unknown = { value: 1 };
// SAFETY: the fixture intentionally exercises the narrowing assertion.
const narrowed = widened as { readonly value: number };
void narrowed;
`,
    expectedCodes: [
      "anti-slop(no-known-value-widening)",
      "anti-slop(no-known-value-widening)",
      "anti-slop(no-widen-then-assert)",
    ],
  },
  {
    name: "require-safety-comment-for-type-assertion",
    source: `export const missing = 1 as number;
export const allowed = 1 as const;
`,
    expectedCodes: ["anti-slop(require-safety-comment-for-type-assertion)"],
  },
];

withFixtureDirectory((directory) => {
  for (const testCase of cases) {
    const fixturePath = writeFixture(directory, `${testCase.name}.ts`, testCase.source);
    const diagnostics = lintFixture(fixturePath, {
      expectedCodes: testCase.expectedCodes,
    });
    assert.equal(diagnostics.length, testCase.expectedCodes.length, testCase.name);
  }
}, `${repositoryRoot}/packages/table`);
