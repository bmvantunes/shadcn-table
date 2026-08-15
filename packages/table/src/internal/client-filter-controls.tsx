import { Button } from "@bruno/shadcn/button";
import { Input } from "@bruno/shadcn/input";
import { useDebouncer } from "@tanstack/react-pacer";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import type { ReactElement, ReactNode } from "react";

import { BrunoTableColumnFilter } from "./client-filter";
import type { BrunoTableColumnFilterRendererProps } from "./bruno-table-view";
import type { BrunoTableRuntimeView } from "./grid-runtime";
import { recordBrunoTableClientQuickFilterRender } from "./render-instrumentation";

const BrunoTableClientFilterRuntimeContext = createContext<BrunoTableRuntimeView | undefined>(
  undefined,
);

export type BrunoTableClientFilterProviderProps = {
  readonly runtime: BrunoTableRuntimeView;
  readonly children: ReactNode;
};

export function BrunoTableClientFilterProvider({
  runtime,
  children,
}: BrunoTableClientFilterProviderProps): ReactElement {
  return (
    <BrunoTableClientFilterRuntimeContext.Provider value={runtime}>
      {children}
    </BrunoTableClientFilterRuntimeContext.Provider>
  );
}

export const renderBrunoTableClientColumnFilter = (
  props: BrunoTableColumnFilterRendererProps,
): ReactElement => <BrunoTableColumnFilter {...props} />;

export function BrunoTableQuickFilter(): ReactElement | null {
  const runtime = useContext(BrunoTableClientFilterRuntimeContext);
  if (runtime === undefined) {
    throw new Error("BrunoTableQuickFilter must be rendered inside BrunoTableClient.");
  }
  return <BrunoTableQuickFilterConnected runtime={runtime} />;
}

const BrunoTableQuickFilterConnected = memo(function BrunoTableQuickFilterConnected({
  runtime,
}: {
  readonly runtime: BrunoTableRuntimeView;
}): ReactElement | null {
  if (__BRUNO_TABLE_TEST_DIAGNOSTICS__) recordBrunoTableClientQuickFilterRender();
  const fields = runtime.getQuickFilterFieldsSnapshot();
  const committed = useSyncExternalStore(
    runtime.subscribeQuickFilter,
    runtime.getQuickFilterSnapshot,
    runtime.getQuickFilterSnapshot,
  );
  if (fields.length === 0) {
    if (__BRUNO_TABLE_DEVELOPMENT__) {
      throw new TypeError(
        "BrunoTableQuickFilter requires BrunoTableClient quickFilterFields to be configured.",
      );
    }
    return null;
  }
  return <BrunoTableQuickFilterInput key={committed} initialValue={committed} runtime={runtime} />;
});

const BrunoTableQuickFilterInput = memo(function BrunoTableQuickFilterInput({
  initialValue,
  runtime,
}: {
  readonly initialValue: string;
  readonly runtime: BrunoTableRuntimeView;
}): ReactElement {
  const [draft, setDraft] = useState(initialValue);
  const publish = useCallback(
    (text: string): void => {
      runtime.dispatchGridCommand({ type: "quick-filter.replace", text });
    },
    [runtime],
  );
  const debouncer = useDebouncer(publish, { wait: 150 });
  useEffect(() => () => debouncer.cancel(), [debouncer]);
  return (
    <div className="flex min-w-56 items-center gap-1">
      <Input
        aria-label="Quick Filter"
        placeholder="Quick Filter"
        type="search"
        value={draft}
        onChange={(event) => {
          const text = event.currentTarget.value;
          setDraft(text);
          debouncer.maybeExecute(text);
        }}
      />
      {draft.length === 0 ? null : (
        <Button
          aria-label="Clear Quick Filter"
          size="icon-xs"
          type="button"
          variant="ghost"
          onClick={() => {
            debouncer.cancel();
            setDraft("");
            publish("");
          }}
        >
          ×
        </Button>
      )}
    </div>
  );
});
