import { afterAll, bench, describe } from "vite-plus/test";

import {
  captureBrunoTableDragFillGesture,
  projectBrunoTableDragFillPreview,
} from "./drag-fill-planner";

const referenceFrameBudgetMs = 8.33;
const logicalIdentities = 100_000;
const projectionsPerFrameBatch = 10_000;
const identities = Object.freeze(
  Array.from({ length: logicalIdentities }, (_unused, index) => `ROW_ID_${String(index)}`),
);
const indexById = new Map(identities.map((identity, index) => [identity, index] as const));
const gesture = captureBrunoTableDragFillGesture({
  axis: "vertical",
  identities,
  indexById,
  sourceCanonicalTexts: ["alpha", "beta", "gamma"],
  sourceFirstIdentity: identities[50_000]!,
  sourceLastIdentity: identities[50_002]!,
});
if (gesture === undefined) throw new Error("Expected a valid benchmark Drag Fill gesture.");

const projectionBatchDurationsMs: number[] = [];
let projectedEndpoints = 0;

describe("BrunoTable Drag Fill planner benchmark (8.33 ms/120 Hz reference)", () => {
  afterAll(() => {
    const projectionBatchP99Ms = percentile99(projectionBatchDurationsMs);
    process.stdout.write(
      `${JSON.stringify({
        benchmark: "BrunoTable Drag Fill O(1) endpoint projection",
        logicalIdentities,
        projectionsPerFrameBatch,
        projectedEndpoints,
        projectionBatchP99Ms,
        referenceFrameBudgetMs,
      })}\n`,
    );
    if (projectedEndpoints !== projectionBatchDurationsMs.length * projectionsPerFrameBatch) {
      throw new Error("Drag Fill frame projection missed an endpoint.");
    }
    if (projectionBatchP99Ms > referenceFrameBudgetMs) {
      throw new Error("Drag Fill endpoint projection exceeded the 120 Hz reference frame budget.");
    }
  });

  bench(
    "projects 10,000 endpoints over 100,000 identities without materializing a span",
    () => {
      const startedAt = performance.now();
      for (let index = 0; index < projectionsPerFrameBatch; index += 1) {
        const targetIdentity = identities[index % 2 === 0 ? 99_999 : 0]!;
        const preview = projectBrunoTableDragFillPreview({ gesture, targetIdentity });
        if (preview === undefined) throw new Error("Expected one compact Drag Fill preview.");
        projectedEndpoints += 1;
      }
      projectionBatchDurationsMs.push(performance.now() - startedAt);
    },
    { iterations: 100, time: 0, warmupIterations: 10, warmupTime: 0 },
  );
});

function percentile99(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.99) - 1)] ?? 0;
}
