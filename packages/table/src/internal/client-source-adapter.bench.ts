import { afterAll, bench, describe, expect, vi } from "vitest";

import { compileColumns } from "./compile-columns";
import {
  BrunoTableClientRowPipelineAdapter,
  type BrunoTableClientReconciliationEvent,
  installBrunoTableClientReconciliationListener,
} from "./client-source-adapter";

type Row = Readonly<{ id: string; name: string }>;

const rowCount = 1_000_000;
const changedIndex = Math.floor(rowCount / 2);
const baseRows = Array.from({ length: rowCount }, (_unused, index) => ({
  id: `row-${String(index)}`,
  name: `Name ${String(index)}`,
})) satisfies readonly Row[];
const replacementRows = baseRows.with(changedIndex, {
  id: `row-${String(changedIndex)}`,
  name: "Changed",
});
const columns = compileColumns([
  {
    columnId: "COL_ID_NAME",
    field: "name",
    headerName: "Name",
    valueType: "text",
  },
]);
const getRowId = vi.fn((row: Row) => row.id);
const source = (rows: readonly Row[], version: number) => ({
  rows,
  totalRows: rows.length,
  version,
  status: "ready" as const,
});
const adapter = new BrunoTableClientRowPipelineAdapter(
  source(baseRows, 1),
  getRowId,
  columns,
  undefined,
  [{ columnId: "COL_ID_NAME", direction: "asc" }],
);
let publishReplacement = false;
let version = 1;
let lastEvent: BrunoTableClientReconciliationEvent | undefined;
const restoreInstrumentation = installBrunoTableClientReconciliationListener((event) => {
  lastEvent = event;
});

describe("BrunoTable Client Source reconciliation", () => {
  bench(
    "constructs one million resident rows",
    () => {
      const initial = new BrunoTableClientRowPipelineAdapter(
        source(baseRows, 1),
        (row: Row) => row.id,
        columns,
        undefined,
        [{ columnId: "COL_ID_NAME", direction: "asc" }],
      );
      if (initial.getPublication().rowSpace?.loadedRows !== rowCount) {
        throw new Error("BrunoTable benchmark did not construct the complete resident row space.");
      }
    },
    { iterations: 1, time: 0, warmupIterations: 0, warmupTime: 0 },
  );

  bench(
    "admits one million resident rows after loading",
    () => {
      const initial = new BrunoTableClientRowPipelineAdapter(
        {
          rows: baseRows,
          totalRows: rowCount,
          version: 1,
          status: "loading",
        },
        (row: Row) => row.id,
        columns,
        undefined,
        [{ columnId: "COL_ID_NAME", direction: "asc" }],
      );
      const publication = initial.publish(source(baseRows, 2));
      if (publication.rowSpace?.loadedRows !== rowCount) {
        throw new Error("BrunoTable benchmark did not admit the first complete live row space.");
      }
    },
    { iterations: 1, time: 0, warmupIterations: 0, warmupTime: 0 },
  );

  bench("patches one replacement among one million resident rows", () => {
    publishReplacement = !publishReplacement;
    version += 1;
    getRowId.mockClear();
    adapter.publish(source(publishReplacement ? replacementRows : baseRows, version));
  });

  afterAll(() => {
    restoreInstrumentation();
    expect(getRowId).toHaveBeenCalledOnce();
    expect(lastEvent).toEqual({
      residentRows: rowCount,
      changedRows: 1,
      resolvedRowIds: 1,
      identityPatches: 1,
      rebuiltSourceSequence: false,
      rebuiltIdentityIndex: false,
    });
  });
});
