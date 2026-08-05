import { useDebouncedCallback } from "@tanstack/react-pacer";
import { useState } from "react";

import { initialFilterModel, type FilterModel, type StatusSetIntent } from "./filter-model";
import { GroupedViewportPanel, RawViewportPanel, StatusFacet } from "./viewport-panel";
import { ORDER_REGIONS, publishLiveOrder, type OrderRegion } from "./view-server";

type ViewMode = "grouped" | "raw";
type SortDirection = "asc" | "desc";

interface DebouncedTextInputProps {
  readonly label: string;
  readonly placeholder: string;
  readonly type?: "number" | "search" | "text";
  readonly onCommit: (value: string) => void;
}

function DebouncedTextInput({
  label,
  onCommit,
  placeholder,
  type = "text",
}: DebouncedTextInputProps) {
  const [value, setValue] = useState("");
  const commit = useDebouncedCallback(onCommit, { wait: 150 });

  return (
    <label className="control-field">
      <span>{label}</span>
      <input
        inputMode={type === "number" ? "decimal" : undefined}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setValue(next);
          commit(next);
        }}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
}

function SelectionSummary({ intent }: { readonly intent: StatusSetIntent }) {
  if (intent.mode === "all-except") {
    return intent.excluded.length === 0 ? "All" : `All except ${intent.excluded.join(", ")}`;
  }
  return intent.included.length === 0 ? "None" : intent.included.join(", ");
}

export function App() {
  const [filters, setFilters] = useState<FilterModel>(initialFilterModel);
  const [firstRow, setFirstRow] = useState(0);
  const [groupDepth, setGroupDepth] = useState<1 | 2>(2);
  const [isFacetOpen, setFacetOpen] = useState(false);
  const [lastPublished, setLastPublished] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("raw");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const changeFilters = (update: (current: FilterModel) => FilterModel) => {
    setFilters(update);
    setFirstRow(0);
  };

  return (
    <main className="prototype-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">BrunoTable architecture lab · prototype 04</p>
          <h1>Live viewport contract</h1>
          <p className="hero-copy">
            One sparse server window, semantic generations, authoritative row keys, live filters,
            and grouped aggregates—using the published View Server package in the browser.
          </p>
        </div>
        <div className="mode-switch" aria-label="Result shape">
          <button
            aria-pressed={mode === "raw"}
            className={mode === "raw" ? "active" : undefined}
            onClick={() => {
              setMode("raw");
              setFirstRow(0);
            }}
            type="button"
          >
            Raw rows
          </button>
          <button
            aria-pressed={mode === "grouped"}
            className={mode === "grouped" ? "active" : undefined}
            onClick={() => {
              setMode("grouped");
              setFirstRow(0);
            }}
            type="button"
          >
            Grouped live
          </button>
        </div>
      </header>

      <section className="control-deck" aria-label="Live query controls">
        <DebouncedTextInput
          label="Quick filter"
          onCommit={(quickFilter) => changeFilters((current) => ({ ...current, quickFilter }))}
          placeholder="Symbol or desk…"
          type="search"
        />
        <DebouncedTextInput
          label="Symbol contains"
          onCommit={(symbolContains) =>
            changeFilters((current) => ({ ...current, symbolContains }))
          }
          placeholder="e.g. AA"
          type="search"
        />
        <DebouncedTextInput
          label="Minimum price"
          onCommit={(value) =>
            changeFilters((current) => ({
              ...current,
              minimumPrice: value.trim() === "" ? null : Number(value),
            }))
          }
          placeholder="No minimum"
          type="number"
        />
        <label className="control-field">
          <span>External filter · region</span>
          <select
            onChange={(event) => {
              const externalRegion = event.currentTarget.value as "all" | OrderRegion;
              changeFilters((current) => ({ ...current, externalRegion }));
            }}
            value={filters.externalRegion}
          >
            <option value="all">All regions</option>
            {ORDER_REGIONS.map((region) => (
              <option key={region} value={region}>
                {region.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <div className="control-field facet-control">
          <span>Status set · live counts</span>
          <button
            aria-expanded={isFacetOpen}
            className="field-button"
            onClick={() => setFacetOpen((open) => !open)}
            type="button"
          >
            <SelectionSummary intent={filters.status} />
            <span aria-hidden="true">⌄</span>
          </button>
          {isFacetOpen ? (
            <StatusFacet
              filters={filters}
              onChange={(status) => changeFilters((current) => ({ ...current, status }))}
              onClose={() => setFacetOpen(false)}
            />
          ) : null}
        </div>
        <label className="control-field">
          <span>{mode === "raw" ? "Price order" : "Group count order"}</span>
          <select
            onChange={(event) => {
              setSortDirection(event.currentTarget.value as SortDirection);
              setFirstRow(0);
            }}
            value={sortDirection}
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>
        {mode === "grouped" ? (
          <label className="control-field">
            <span>Group fields</span>
            <select
              onChange={(event) => {
                setGroupDepth(Number(event.currentTarget.value) === 1 ? 1 : 2);
                setFirstRow(0);
              }}
              value={groupDepth}
            >
              <option value={1}>Region</option>
              <option value={2}>Region → status</option>
            </select>
          </label>
        ) : null}
        <div className="control-field">
          <span>Live data</span>
          <button
            className="publish-button"
            onClick={() => {
              void publishLiveOrder().then((row) => setLastPublished(row.id));
            }}
            type="button"
          >
            Publish high-price order
          </button>
        </div>
      </section>

      {lastPublished === null ? null : (
        <p className="published-note" role="status">
          Published <strong>{lastPublished}</strong>; active subscriptions update without a refresh.
        </p>
      )}

      {mode === "raw" ? (
        <RawViewportPanel
          filters={filters}
          firstRow={firstRow}
          onFirstRowChange={setFirstRow}
          sortDirection={sortDirection}
        />
      ) : (
        <GroupedViewportPanel
          filters={filters}
          firstRow={firstRow}
          groupDepth={groupDepth}
          onFirstRowChange={setFirstRow}
          sortDirection={sortDirection}
        />
      )}
    </main>
  );
}
