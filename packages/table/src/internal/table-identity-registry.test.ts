import { describe, expect, it, vi } from "vitest";

import { compileColumns } from "./compile-columns";
import { registerBrunoTableIdentity } from "./table-identity-registry";

const columns = compileColumns([
  {
    columnId: "COL_ID_NAME",
    field: "name",
    headerName: "Name",
    valueType: "text",
  },
]);

describe("BrunoTable Table Identity registry", () => {
  it("diagnoses only incompatible concurrent schema reuse and unregisters idempotently", () => {
    const report = vi.fn();
    const disposeFirst = registerBrunoTableIdentity("TABLE_ID_SHARED", columns, report);
    const disposeCompatible = registerBrunoTableIdentity("TABLE_ID_SHARED", columns, report);
    expect(report).not.toHaveBeenCalled();

    const incompatibleColumns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "number",
      },
    ]);
    const disposeIncompatible = registerBrunoTableIdentity(
      "TABLE_ID_SHARED",
      incompatibleColumns,
      report,
    );
    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining('simultaneous use of tableId "TABLE_ID_SHARED"'),
    );

    disposeIncompatible();
    disposeCompatible();
    disposeFirst();
    disposeFirst();

    const disposeAfterUnmount = registerBrunoTableIdentity(
      "TABLE_ID_SHARED",
      incompatibleColumns,
      report,
    );
    expect(report).toHaveBeenCalledOnce();
    disposeAfterUnmount();
  });

  it("uses stable computed getter identity to diagnose incompatible computed schemas", () => {
    const report = vi.fn();
    const double = ({ row }: { readonly row: { readonly score: number } }) => row.score * 2;
    const firstColumns = compileColumns([
      {
        columnId: "COL_ID_COMPUTED",
        fields: ["score"],
        headerName: "Computed",
        valueGetter: double,
        valueType: "number",
      },
    ]);
    const compatibleColumns = compileColumns([
      {
        columnId: "COL_ID_COMPUTED",
        fields: ["score"],
        headerName: "Computed again",
        valueGetter: double,
        valueType: "number",
      },
    ]);
    const incompatibleColumns = compileColumns([
      {
        columnId: "COL_ID_COMPUTED",
        fields: ["score"],
        headerName: "Computed differently",
        valueGetter: ({ row }: { readonly row: { readonly score: number } }) => row.score * 3,
        valueType: "number",
      },
    ]);
    const disposeFirst = registerBrunoTableIdentity("TABLE_ID_COMPUTED", firstColumns, report);
    const disposeCompatible = registerBrunoTableIdentity(
      "TABLE_ID_COMPUTED",
      compatibleColumns,
      report,
    );
    expect(report).not.toHaveBeenCalled();
    const disposeIncompatible = registerBrunoTableIdentity(
      "TABLE_ID_COMPUTED",
      incompatibleColumns,
      report,
    );
    expect(report).toHaveBeenCalledOnce();

    disposeIncompatible();
    disposeCompatible();
    disposeFirst();
  });
});
