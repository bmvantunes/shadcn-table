import { BrunoTableClient, BrunoTableComputedColumn } from "@bruno/table";

import type { BrunoTableColumns } from "@bruno/table";

type Row = {
  readonly id: string;
  readonly name: string;
  readonly score: number;
  readonly revision: bigint;
};

const columns = [
  {
    columnId: "COL_ID_NAME",
    field: "name",
    headerName: "Name",
    valueType: "text",
    isEditable: true,
  },
  BrunoTableComputedColumn({
    columnId: "COL_ID_DOUBLE_SCORE",
    fields: ["score"],
    headerName: "Double score",
    valueType: "number",
    valueGetter: ({ row }) => row.score * 2,
  }),
] satisfies BrunoTableColumns<Row>;

const nonsortableColumns = [
  {
    columnId: "COL_ID_NAME",
    field: "name",
    headerName: "Name",
    valueType: "text",
    enableSorting: false,
  },
  {
    columnId: "COL_ID_SCORE",
    field: "score",
    headerName: "Score",
    valueType: "number",
  },
] satisfies BrunoTableColumns<Row>;

const sortFreeColumns = [
  {
    columnId: "COL_ID_NAME",
    field: "name",
    headerName: "Name",
    valueType: "text",
    enableSorting: false,
  },
] satisfies BrunoTableColumns<Row>;

const clientSource = {
  rows: [] as readonly Row[],
  totalRows: 0,
  version: 1,
  status: "ready" as const,
};

const whitespaceIdentityColumns = [
  {
    columnId: "COL_ID_DISPLAY NAME",
    field: "name",
    headerName: "Display name",
    valueType: "text",
  },
] satisfies BrunoTableColumns<Row>;

const invalidWhitespaceIdentityClient = (
  <BrunoTableClient
    tableId="TABLE_ID_EMITTED_JSX_INVALID_WHITESPACE_IDENTITY"
    getRowId={(row) => row.id}
    // @ts-expect-error Emitted Client declarations validate raw identities after tuple inference.
    columns={whitespaceIdentityColumns}
    initialOrderBy={[{ columnId: "COL_ID_DISPLAY NAME", direction: "asc" }]}
    clientSource={clientSource}
  />
);
void invalidWhitespaceIdentityClient;

const validClient = (
  <BrunoTableClient
    tableId="TABLE_ID_EMITTED_JSX_VALID"
    getRowId={(row) => row.id}
    columns={columns}
    initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
    clientSource={clientSource}
  />
);
void validClient;

const missingOrder = (
  // @ts-expect-error Emitted JSX Client usage requires initialOrderBy.
  <BrunoTableClient
    tableId="TABLE_ID_EMITTED_JSX_MISSING_ORDER"
    getRowId={(row) => row.id}
    columns={columns}
    clientSource={clientSource}
  />
);
void missingOrder;

const emptyOrder = (
  <BrunoTableClient
    tableId="TABLE_ID_EMITTED_JSX_EMPTY_ORDER"
    getRowId={(row) => row.id}
    columns={columns}
    // @ts-expect-error Emitted JSX Client usage rejects an empty initialOrderBy.
    initialOrderBy={[]}
    clientSource={clientSource}
  />
);
void emptyOrder;

const unknownOrder = (
  <BrunoTableClient
    tableId="TABLE_ID_EMITTED_JSX_UNKNOWN_ORDER"
    getRowId={(row) => row.id}
    columns={columns}
    initialOrderBy={[
      // @ts-expect-error Emitted JSX preserves the exact sortable Column Identity union.
      { columnId: "COL_ID_UNKNOWN", direction: "asc" },
    ]}
    clientSource={clientSource}
  />
);
void unknownOrder;

const misspelledOrder = (
  <BrunoTableClient
    tableId="TABLE_ID_EMITTED_JSX_MISSPELLED_ORDER"
    getRowId={(row) => row.id}
    columns={columns}
    initialOrderBy={[
      // @ts-expect-error Emitted JSX rejects misspelled Column Identities.
      { columnId: "COL_ID_NAEM", direction: "asc" },
    ]}
    clientSource={clientSource}
  />
);
void misspelledOrder;

const computedOrder = (
  <BrunoTableClient
    tableId="TABLE_ID_EMITTED_JSX_COMPUTED_ORDER"
    getRowId={(row) => row.id}
    columns={columns}
    initialOrderBy={[
      // @ts-expect-error Emitted computed columns have no automatic Client sort mapping.
      { columnId: "COL_ID_DOUBLE_SCORE", direction: "asc" },
    ]}
    clientSource={clientSource}
  />
);
void computedOrder;

const nonsortableOrder = (
  <BrunoTableClient
    tableId="TABLE_ID_EMITTED_JSX_NONSORTABLE_ORDER"
    getRowId={(row) => row.id}
    columns={nonsortableColumns}
    initialOrderBy={[
      // @ts-expect-error Emitted explicitly nonsortable columns are absent from ordering inference.
      { columnId: "COL_ID_NAME", direction: "asc" },
    ]}
    clientSource={clientSource}
  />
);
void nonsortableOrder;

const sortFreeClient = (
  <BrunoTableClient
    tableId="TABLE_ID_EMITTED_JSX_SORT_FREE"
    getRowId={(row) => row.id}
    columns={sortFreeColumns}
    // @ts-expect-error The emitted first live Client rejects sort-free definitions.
    initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
    clientSource={clientSource}
  />
);
void sortFreeClient;

const readOnlyWithEditOperations = (
  <BrunoTableClient
    tableId="TABLE_ID_EMITTED_JSX_READ_ONLY"
    getRowId={(row) => row.id}
    columns={columns}
    initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
    clientSource={clientSource}
    editable={false}
    // @ts-expect-error Read-only emitted JSX Client usage rejects getRowVersion.
    getRowVersion={(row: Row) => row.revision}
    // @ts-expect-error Read-only emitted JSX Client usage rejects onSaveEdits.
    onSaveEdits={() => Promise.resolve()}
  />
);
void readOnlyWithEditOperations;
