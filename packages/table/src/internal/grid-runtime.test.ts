import { describe, expect, it, vi } from "vitest";

import { BrunoTableClientRuntime } from "./grid-runtime";

type Row = { readonly id: string; readonly name: string };

const source = (
  rows: readonly Row[],
  status: "loading" | "ready" | "stale" | "closed" | "error" = "ready",
  extra: Partial<{
    readonly totalRows: number;
    readonly message: string;
    readonly retry: { readonly run: () => void; readonly pending: boolean };
  }> = {},
) => ({
  rows,
  totalRows: extra.totalRows ?? rows.length,
  version: 1,
  status,
  ...(extra.message === undefined ? {} : { message: extra.message }),
  ...(extra.retry === undefined ? {} : { retry: extra.retry }),
});

describe("BrunoTableClientRuntime", () => {
  it("publishes immutable snapshots and isolates changed row subscribers", () => {
    const first = { id: "first", name: "Ada" } satisfies Row;
    const second = { id: "second", name: "Grace" } satisfies Row;
    const runtime = new BrunoTableClientRuntime(source([first, second]), (row) => row.id);
    const bodyListener = vi.fn();
    const chromeListener = vi.fn();
    const rowsListener = vi.fn();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    runtime.subscribeBody(bodyListener);
    runtime.subscribeChrome(chromeListener);
    runtime.subscribeRows(rowsListener);
    runtime.subscribeRow("first", firstListener);
    runtime.subscribeRow("second", secondListener);

    const nextSecond = { id: "second", name: "Grace Hopper" } satisfies Row;
    runtime.publish(source([first, nextSecond]));

    expect(bodyListener).not.toHaveBeenCalled();
    expect(chromeListener).not.toHaveBeenCalled();
    expect(rowsListener).toHaveBeenCalledOnce();
    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).toHaveBeenCalledOnce();
    expect(runtime.getBodySnapshot().kind).toBe("rows");
    expect(Object.isFrozen(runtime.getBodySnapshot())).toBe(true);
    expect(runtime.getView()).toBe(runtime.getView());
  });

  it("reuses row collections when a source publishes the same row references", () => {
    const rows = [{ id: "first", name: "Ada" }] satisfies readonly Row[];
    const runtime = new BrunoTableClientRuntime(source(rows), (row) => row.id);
    const bodyListener = vi.fn();
    runtime.subscribeBody(bodyListener);
    const firstSnapshot = runtime.getBodySnapshot();

    runtime.publish(source(Array.from(rows)));

    expect(bodyListener).not.toHaveBeenCalled();
    expect(runtime.getBodySnapshot()).toBe(firstSnapshot);
  });

  it("keeps unchanged row subscriptions quiet when the identity callback is recreated", () => {
    const first = { id: "first", name: "Ada" } satisfies Row;
    const second = { id: "second", name: "Grace" } satisfies Row;
    const runtime = new BrunoTableClientRuntime(source([first, second]), (row) => row.id);
    const bodyListener = vi.fn();
    const firstListener = vi.fn();
    runtime.subscribeBody(bodyListener);
    runtime.subscribeRow("first", firstListener);
    const firstSnapshot = runtime.getRowSnapshot("first");

    runtime.configure((row) => row.id);

    expect(bodyListener).not.toHaveBeenCalled();
    expect(firstListener).not.toHaveBeenCalled();
    expect(runtime.getRowSnapshot("first")).toBe(firstSnapshot);
  });

  it("rejects incomplete ready and stale source snapshots visibly", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const runtime = new BrunoTableClientRuntime(source([row]), (value) => value.id);

    runtime.publish(source([], "ready", { totalRows: 1 }));
    expect(runtime.getChromeSnapshot()).toMatchObject({ incomplete: true, receivedRows: 0 });
    expect(runtime.getBodySnapshot().kind).toBe("invalid");

    runtime.publish(source([], "stale", { totalRows: 1 }));
    expect(runtime.getChromeSnapshot()).toMatchObject({ incomplete: true });
    expect(runtime.getBodySnapshot().kind).toBe("invalid");
  });

  it("retains coherent rows for terminal lifecycle states and delegates only explicit retry", () => {
    const row = { id: "first", name: "Ada" } satisfies Row;
    const run = vi.fn();
    const retry = { run, pending: false };
    const runtime = new BrunoTableClientRuntime(source([row]), (value) => value.id);

    runtime.publish(source([row], "closed", { message: "socket ended", retry }));
    expect(runtime.getBodySnapshot().kind).toBe("rows");
    expect(runtime.getChromeSnapshot()).toMatchObject({
      status: "closed",
      hasCoherentRows: true,
    });
    runtime.retry();
    expect(run).toHaveBeenCalledOnce();

    retry.pending = true;
    runtime.retry();
    expect(run).toHaveBeenCalledTimes(2);

    runtime.publish(source([], "error", { totalRows: 1, retry: { run, pending: true } }));
    expect(runtime.getBodySnapshot().kind).toBe("rows");
    runtime.retry();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("uses a terminal Empty projection when no coherent rows exist", () => {
    const run = vi.fn();
    const runtime = new BrunoTableClientRuntime(
      source([], "error", { retry: { run, pending: false } }),
      (row: Row) => row.id,
    );

    expect(runtime.getBodySnapshot()).toMatchObject({
      kind: "empty",
      emptyTitle: "Live data error",
      destructive: true,
      retry: { pending: false },
    });
  });
});
