import { BigDecimal } from "effect";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  compileWhere,
  isStatusSelected,
  toggleStatus,
  type FilterModel,
  type StatusSetIntent,
} from "./filter-model";
import { SparseViewportStore, type SparseSnapshot, type SparseWindow } from "./sparse-store";
import {
  ORDER_STATUSES,
  useLiveQuery,
  useLiveQueryViewport,
  type Order,
  type OrderRegion,
  type OrderStatus,
} from "./view-server";

const WINDOW_SIZE = 20;

type SortDirection = "asc" | "desc";
type RawRow = Pick<
  Order,
  "desk" | "id" | "price" | "quantity" | "region" | "revision" | "status" | "symbol"
>;

interface GroupedRow {
  readonly distinctDesks: bigint;
  readonly maxPrice: number;
  readonly region: OrderRegion;
  readonly rowCount: bigint;
  readonly status?: OrderStatus;
  readonly totalPrice: BigDecimal.BigDecimal;
}

interface ViewportPanelProps {
  readonly filters: FilterModel;
  readonly firstRow: number;
  readonly onFirstRowChange: (firstRow: number) => void;
  readonly sortDirection: SortDirection;
}

interface ActiveGeneration {
  readonly release: () => void;
  readonly setWindow: (window: SparseWindow) => void;
  readonly token: number;
  window: SparseWindow;
}

function makeWindow(firstRow: number): SparseWindow {
  return { firstRow, lastRow: firstRow + WINDOW_SIZE - 1 };
}

function useStoreSnapshot<Row>(store: SparseViewportStore<Row>): SparseSnapshot<Row> {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function useWindowMovement(
  active: React.RefObject<ActiveGeneration | null>,
  firstRow: number,
  store: SparseViewportStore<unknown>,
): void {
  const window = useMemo(() => makeWindow(firstRow), [firstRow]);
  const windowRef = useRef(window);
  windowRef.current = window;

  useEffect(() => {
    const generation = active.current;
    if (generation === null) return;
    if (
      generation.window.firstRow === window.firstRow &&
      generation.window.lastRow === window.lastRow
    ) {
      return;
    }
    generation.window = window;
    store.setWindow(generation.token, window);
    generation.setWindow(window);
  }, [active, store, window]);
}

function Diagnostics({
  snapshot,
  source,
}: {
  readonly snapshot: SparseSnapshot<unknown>;
  readonly source: {
    readonly message?: string | undefined;
    readonly status: string;
    readonly totalRows: number;
    readonly version: number;
  };
}) {
  const metrics = [
    ["Status", source.status],
    ["Server version", source.version.toLocaleString()],
    ["Semantic generation", snapshot.generation.toLocaleString()],
    ["Window moves", snapshot.windowMoves.toLocaleString()],
    ["Row writes", snapshot.rowWrites.toLocaleString()],
    ["Stable row reuse", snapshot.reusedRows.toLocaleString()],
    ["Identity failures", snapshot.identityFailures.toLocaleString()],
  ] as const;

  return (
    <aside className="diagnostics" aria-label="Viewport diagnostics">
      {metrics.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
      {source.message === undefined ? null : <p>{source.message}</p>}
    </aside>
  );
}

function LogicalScroll({
  firstRow,
  onFirstRowChange,
  totalRows,
}: {
  readonly firstRow: number;
  readonly onFirstRowChange: (firstRow: number) => void;
  readonly totalRows: number;
}) {
  const maximum = Math.max(0, totalRows - WINDOW_SIZE);
  const safeFirstRow = Math.min(firstRow, maximum);

  useEffect(() => {
    if (safeFirstRow !== firstRow) onFirstRowChange(safeFirstRow);
  }, [firstRow, onFirstRowChange, safeFirstRow]);

  return (
    <div className="logical-scroll">
      <div>
        <span>Logical scroll row</span>
        <strong>
          {totalRows === 0
            ? "No rows"
            : `${safeFirstRow + 1}–${Math.min(totalRows, safeFirstRow + WINDOW_SIZE)}`}
        </strong>
      </div>
      <input
        aria-label="Logical scroll row"
        max={maximum}
        min={0}
        onChange={(event) => onFirstRowChange(Number(event.currentTarget.value))}
        step={1}
        type="range"
        value={safeFirstRow}
      />
      <input
        aria-label="Logical scroll row number"
        className="scroll-number"
        max={maximum}
        min={0}
        onChange={(event) => onFirstRowChange(Number(event.currentTarget.value))}
        step={1}
        type="number"
        value={safeFirstRow}
      />
      <small>
        This moves the server window within the same semantic generation. It is diagnostic UI, not
        pagination.
      </small>
    </div>
  );
}

function LoadingCells({ count }: { readonly count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <td key={index}>
      <span className="skeleton" />
    </td>
  ));
}

export function RawViewportPanel({
  filters,
  firstRow,
  onFirstRowChange,
  sortDirection,
}: ViewportPanelProps) {
  const source = useLiveQueryViewport("orders");
  const [store] = useState(() => new SparseViewportStore<RawRow>());
  const snapshot = useStoreSnapshot(store);
  const active = useRef<ActiveGeneration | null>(null);
  const windowRef = useRef(makeWindow(firstRow));
  windowRef.current = makeWindow(firstRow);
  const query = useMemo(
    () => ({
      select: [
        "id",
        "revision",
        "symbol",
        "desk",
        "status",
        "region",
        "price",
        "quantity",
      ] as const,
      where: compileWhere(filters),
      orderBy: [{ field: "price", direction: sortDirection }] as const,
    }),
    [filters, sortDirection],
  );

  useEffect(() => {
    const initialWindow = windowRef.current;
    const token = store.beginGeneration(initialWindow);
    const generation = source.viewport.replace({
      window: initialWindow,
      query,
      sink: {
        setRowCount: (count) => store.setRowCount(token, count),
        setRowData: (rows, rowKeys) => store.setRowData(token, rows, rowKeys),
      },
    });
    const installed: ActiveGeneration = { ...generation, token, window: initialWindow };
    active.current = installed;
    return () => {
      if (active.current === installed) active.current = null;
      generation.release();
    };
  }, [query, source.viewport, store]);

  useWindowMovement(active, firstRow, store);

  return (
    <section className="result-card">
      <div className="result-heading">
        <div>
          <p className="result-kicker">Readonly viewport · exact server projection</p>
          <h2>{snapshot.totalRows.toLocaleString()} matching rows</h2>
        </div>
        <span className="query-chip">select 8 fields</span>
      </div>
      <Diagnostics snapshot={snapshot} source={source} />
      <LogicalScroll
        firstRow={firstRow}
        onFirstRowChange={onFirstRowChange}
        totalRows={snapshot.totalRows}
      />
      <div className="table-frame">
        <table>
          <thead>
            <tr>
              <th>Index</th>
              <th>Authoritative row key</th>
              <th>Symbol</th>
              <th>Desk</th>
              <th>Status</th>
              <th>Region</th>
              <th className="numeric">Price</th>
              <th className="numeric">Quantity</th>
              <th className="numeric">Revision</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.slots.map((slot) => (
              <tr key={slot.rowKey ?? `loading-${slot.index}`}>
                <td className="muted numeric">{slot.index}</td>
                {slot.row === undefined ? (
                  <LoadingCells count={8} />
                ) : (
                  <>
                    <td className="row-key">{slot.rowKey}</td>
                    <td className="symbol">{slot.row.symbol}</td>
                    <td>{slot.row.desk}</td>
                    <td>
                      <span className={`status status-${slot.row.status}`}>{slot.row.status}</span>
                    </td>
                    <td>{slot.row.region.toUpperCase()}</td>
                    <td className="numeric">{slot.row.price.toFixed(2)}</td>
                    <td className="numeric">{slot.row.quantity.toLocaleString()}</td>
                    <td className="numeric">{slot.row.revision}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function GroupedViewportPanel({
  filters,
  firstRow,
  groupDepth,
  onFirstRowChange,
  sortDirection,
}: ViewportPanelProps & { readonly groupDepth: 1 | 2 }) {
  const source = useLiveQueryViewport("orders");
  const [store] = useState(() => new SparseViewportStore<GroupedRow>());
  const snapshot = useStoreSnapshot(store);
  const active = useRef<ActiveGeneration | null>(null);
  const windowRef = useRef(makeWindow(firstRow));
  windowRef.current = makeWindow(firstRow);
  const query = useMemo(
    () => ({
      groupBy: groupDepth === 1 ? (["region"] as const) : (["region", "status"] as const),
      aggregates: {
        rowCount: { aggFunc: "count" },
        totalPrice: { aggFunc: "sum", field: "price" },
        distinctDesks: { aggFunc: "countDistinct", field: "desk" },
        maxPrice: { aggFunc: "max", field: "price" },
      } as const,
      where: compileWhere(filters),
      orderBy: [{ aggregate: "rowCount", direction: sortDirection }] as const,
    }),
    [filters, groupDepth, sortDirection],
  );

  useEffect(() => {
    const initialWindow = windowRef.current;
    const token = store.beginGeneration(initialWindow);
    const generation = source.viewport.replace({
      window: initialWindow,
      query,
      sink: {
        setRowCount: (count) => store.setRowCount(token, count),
        setRowData: (rows, rowKeys) => store.setRowData(token, rows, rowKeys),
      },
    });
    const installed: ActiveGeneration = { ...generation, token, window: initialWindow };
    active.current = installed;
    return () => {
      if (active.current === installed) active.current = null;
      generation.release();
    };
  }, [query, source.viewport, store]);

  useWindowMovement(active, firstRow, store);

  return (
    <section className="result-card">
      <div className="result-heading">
        <div>
          <p className="result-kicker">Readonly viewport · server grouping</p>
          <h2>{snapshot.totalRows.toLocaleString()} live groups</h2>
        </div>
        <span className="query-chip">count is always present</span>
      </div>
      <Diagnostics snapshot={snapshot} source={source} />
      <LogicalScroll
        firstRow={firstRow}
        onFirstRowChange={onFirstRowChange}
        totalRows={snapshot.totalRows}
      />
      <div className="table-frame">
        <table>
          <thead>
            <tr>
              <th>Index</th>
              <th>Authoritative group key</th>
              <th>Region</th>
              {groupDepth === 2 ? <th>Status</th> : null}
              <th className="numeric">Rows</th>
              <th className="numeric">Distinct desks</th>
              <th className="numeric">Total price · BigDecimal</th>
              <th className="numeric">Max price</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.slots.map((slot) => (
              <tr key={slot.rowKey ?? `loading-${slot.index}`}>
                <td className="muted numeric">{slot.index}</td>
                {slot.row === undefined ? (
                  <LoadingCells count={groupDepth === 2 ? 7 : 6} />
                ) : (
                  <>
                    <td className="row-key">{slot.rowKey}</td>
                    <td>{slot.row.region.toUpperCase()}</td>
                    {groupDepth === 2 ? (
                      <td>
                        {slot.row.status === undefined ? (
                          "—"
                        ) : (
                          <span className={`status status-${slot.row.status}`}>
                            {slot.row.status}
                          </span>
                        )}
                      </td>
                    ) : null}
                    <td className="numeric">{slot.row.rowCount.toLocaleString()}</td>
                    <td className="numeric">{slot.row.distinctDesks.toLocaleString()}</td>
                    <td className="numeric">{BigDecimal.format(slot.row.totalPrice)}</td>
                    <td className="numeric">{slot.row.maxPrice.toFixed(2)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function StatusFacet({
  filters,
  onChange,
  onClose,
}: {
  readonly filters: FilterModel;
  readonly onChange: (intent: StatusSetIntent) => void;
  readonly onClose: () => void;
}) {
  const query = useMemo(
    () => ({
      groupBy: ["status"] as const,
      aggregates: { rowCount: { aggFunc: "count" } } as const,
      where: compileWhere(filters, { excludeStatus: true }),
      orderBy: [{ field: "status", direction: "asc" }] as const,
      limit: ORDER_STATUSES.length,
    }),
    [filters],
  );
  const result = useLiveQuery("orders", query);
  const counts = new Map(result.rows.map((row) => [row.status, row.rowCount]));

  return (
    <div className="facet-popover">
      <div className="facet-heading">
        <div>
          <strong>Status</strong>
          <small>{result.status} · self-filter excluded</small>
        </div>
        <button aria-label="Close status filter" onClick={onClose} type="button">
          ×
        </button>
      </div>
      <div className="facet-actions">
        <button onClick={() => onChange({ mode: "all-except", excluded: [] })} type="button">
          All
        </button>
        <button onClick={() => onChange({ mode: "only", included: [] })} type="button">
          None
        </button>
      </div>
      <div className="facet-options">
        {ORDER_STATUSES.map((status) => (
          <label key={status}>
            <input
              checked={isStatusSelected(filters.status, status)}
              onChange={() => onChange(toggleStatus(filters.status, status))}
              type="checkbox"
            />
            <span>{status}</span>
            <strong>{(counts.get(status) ?? 0n).toLocaleString()}</strong>
          </label>
        ))}
      </div>
      <p>Counts stay live while open. Closing this popover unmounts the subscription.</p>
    </div>
  );
}
