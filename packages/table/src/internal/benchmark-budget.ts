export function assertBrunoTableBenchmarkBudget(
  name: string,
  samples: readonly number[],
  options: Readonly<{
    readonly measuredSampleCount: number;
    readonly warmupSampleCount: number;
    readonly budgetMs: number;
  }>,
): void {
  const requiredSampleCount = options.warmupSampleCount + options.measuredSampleCount;
  if (samples.length < requiredSampleCount) return;
  const measured = samples.slice(
    options.warmupSampleCount,
    options.warmupSampleCount + options.measuredSampleCount,
  );
  const sorted = [...measured].sort((left, right) => left - right);
  const p99Ms = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)] ?? 0;
  if (p99Ms > options.budgetMs) {
    throw new Error(`${name} exceeded the frame reference with p99 ${String(p99Ms)} ms.`);
  }
}
