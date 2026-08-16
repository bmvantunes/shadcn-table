import { describe, expect, it } from "vitest";

import { compileColumns } from "./compile-columns";
import { BrunoTableNavigationRuntime, type BrunoTableNavigationCommand } from "./navigation";

describe("BrunoTableNavigationRuntime", () => {
  it("publishes frozen active-cell snapshots and supports projection reset", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const navigation = new BrunoTableNavigationRuntime();

    navigation.setShape(["first"], columns);

    expect(navigation.getSnapshot()).toMatchObject({
      region: "body",
      rowIndex: 0,
      rowId: "first",
      columnId: "COL_ID_NAME",
    });
    expect(Object.isFrozen(navigation.getSnapshot())).toBe(true);

    navigation.reset();
    expect(navigation.getSnapshot()).toBeUndefined();
  });

  it("falls back to the clamped display position when its raw row identity disappears", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const navigation = new BrunoTableNavigationRuntime();
    navigation.setShape(["first", "second", "third"], columns);
    navigation.move("down");
    navigation.move("down");

    navigation.setShape(["first", "second", "replacement"], columns);

    expect(navigation.getSnapshot()).toMatchObject({
      region: "body",
      rowIndex: 2,
      rowId: "replacement",
      columnId: "COL_ID_NAME",
    });
  });

  it("reconciles a surviving active row across a query projection", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const navigation = new BrunoTableNavigationRuntime();
    navigation.setShape(["first", "second", "third"], columns);
    navigation.move("down");
    navigation.move("down");

    navigation.reconcileForQuery(["first", "third"], columns);

    expect(navigation.getSnapshot()).toMatchObject({
      region: "body",
      rowIndex: 1,
      rowId: "third",
      columnId: "COL_ID_NAME",
    });
  });

  it("resets committed-query body position while preserving a header origin", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const navigation = new BrunoTableNavigationRuntime();
    navigation.setShape(["first", "second", "third"], columns);
    navigation.move("down");
    navigation.move("down");

    navigation.resetForCommittedQuery(["first", "third"], columns);
    expect(navigation.getSnapshot()).toMatchObject({
      region: "body",
      rowIndex: 0,
      rowId: "first",
      columnId: "COL_ID_NAME",
    });

    navigation.activateHeader("COL_ID_NAME");
    navigation.resetForCommittedQuery(["third"], columns);
    expect(navigation.getSnapshot()).toMatchObject({
      region: "header",
      rowIndex: 0,
      columnId: "COL_ID_NAME",
    });
  });

  it("resets a body query to row zero and its first visible column", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
    ]);
    const navigation = new BrunoTableNavigationRuntime();
    navigation.setShape(["first", "second"], columns);
    navigation.move("right");
    navigation.move("down");

    navigation.resetForCommittedQuery(["replacement"], columns);

    expect(navigation.getSnapshot()).toMatchObject({
      region: "body",
      rowIndex: 0,
      rowId: "replacement",
      columnId: "COL_ID_NAME",
    });
  });

  it("falls back to the prior display position when a query projection removes its identity", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const navigation = new BrunoTableNavigationRuntime();
    navigation.setShape(["first", "second"], columns);
    navigation.move("down");

    navigation.reconcileForQuery(["first"], columns);

    expect(navigation.getSnapshot()).toMatchObject({
      region: "body",
      rowIndex: 0,
      rowId: "first",
      columnId: "COL_ID_NAME",
    });
  });

  it("moves through the coherent header/body space and preserves row identity across reorder", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        pinned: "start",
        valueType: "number",
      },
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const navigation = new BrunoTableNavigationRuntime();
    navigation.setShape(["first", "second"], columns);
    expect(navigation.getSnapshot()?.columnId).toBe("COL_ID_SCORE");

    navigation.move("up");
    expect(navigation.getSnapshot()).toMatchObject({ region: "header", columnId: "COL_ID_SCORE" });
    navigation.move("right");
    expect(navigation.getSnapshot()).toMatchObject({ region: "header", columnId: "COL_ID_NAME" });
    navigation.move("down");
    navigation.move("down");
    navigation.move("down");
    expect(navigation.getSnapshot()).toMatchObject({
      region: "body",
      rowIndex: 1,
      rowId: "second",
      columnId: "COL_ID_NAME",
    });

    navigation.setShape(["second", "first"], columns);
    expect(navigation.getSnapshot()).toMatchObject({ rowIndex: 0, rowId: "second" });
  });

  it("preserves the active column identity across reorder and chooses its old position when hidden", () => {
    const firstColumns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
      {
        columnId: "COL_ID_STATUS",
        field: "status",
        headerName: "Status",
        valueType: "text",
      },
    ]);
    const reorderedColumns = [firstColumns[2]!, firstColumns[0]!, firstColumns[1]!];
    const navigation = new BrunoTableNavigationRuntime();
    navigation.setShape(["first"], firstColumns);
    navigation.move("right");

    navigation.setShape(["first"], reorderedColumns);
    expect(navigation.getSnapshot()).toMatchObject({ columnId: "COL_ID_SCORE" });

    const hiddenActiveColumns = [firstColumns[2]!, firstColumns[0]!];
    navigation.setShape(["first"], hiddenActiveColumns);
    expect(navigation.getSnapshot()).toMatchObject({ columnId: "COL_ID_NAME" });
  });

  it("keeps empty-result headers reachable while query-cleared body focus stays empty", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
    ]);
    const navigation = new BrunoTableNavigationRuntime();
    navigation.setShape([], columns);
    expect(navigation.getSnapshot()).toBeUndefined();

    navigation.activateForFocus();
    expect(navigation.getSnapshot()).toMatchObject({
      region: "header",
      columnId: "COL_ID_NAME",
    });
    const activated = navigation.getSnapshot();
    navigation.activateForFocus();
    navigation.activateHeader("COL_ID_MISSING");
    expect(navigation.getSnapshot()).toBe(activated);
    navigation.move("right");
    expect(navigation.getSnapshot()).toMatchObject({
      region: "header",
      columnId: "COL_ID_SCORE",
    });

    navigation.setShape(["first"], columns);
    navigation.move("down");
    navigation.setShape([], columns);
    expect(navigation.getSnapshot()).toBeUndefined();
    navigation.setShape(["replacement"], columns);
    expect(navigation.getSnapshot()).toBeUndefined();
    navigation.activateForFocus();
    expect(navigation.getSnapshot()).toMatchObject({
      region: "body",
      rowId: "replacement",
    });
    navigation.movePage(-10);
    expect(navigation.getSnapshot()).toMatchObject({ region: "body", rowId: "replacement" });

    navigation.clearForQuery();
    navigation.setShape(["first"], columns);
    expect(navigation.getSnapshot()).toBeUndefined();
  });

  it("keeps unloaded logical positions out of row identity and navigation", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const navigation = new BrunoTableNavigationRuntime();

    navigation.setShape([undefined, "second", undefined, "fourth"], columns);
    expect(navigation.getSnapshot()).toMatchObject({ region: "body", rowIndex: 0 });
    expect(navigation.getSnapshot()?.rowId).toBeUndefined();

    navigation.move("down");
    expect(navigation.getSnapshot()).toMatchObject({ rowIndex: 1, rowId: "second" });

    navigation.move("down");
    expect(navigation.getSnapshot()).toMatchObject({ region: "body", rowIndex: 2 });
    expect(navigation.getSnapshot()?.rowId).toBeUndefined();

    navigation.move("down");
    expect(navigation.getSnapshot()).toMatchObject({ rowIndex: 3, rowId: "fourth" });

    navigation.move("up");
    navigation.move("up");
    navigation.move("up");
    navigation.move("up");
    expect(navigation.getSnapshot()).toMatchObject({ region: "header" });
  });

  it("supports row, column, grid, and header page boundaries", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
      },
    ]);
    const navigation = new BrunoTableNavigationRuntime();
    navigation.setShape(["first", "second", "third"], columns);

    navigation.moveToRowEdge("end");
    expect(navigation.getSnapshot()).toMatchObject({
      region: "body",
      rowId: "first",
      columnId: "COL_ID_SCORE",
    });
    navigation.moveToColumnEdge("end");
    expect(navigation.getSnapshot()).toMatchObject({ rowId: "third", columnId: "COL_ID_SCORE" });
    navigation.moveToGridEdge("start");
    expect(navigation.getSnapshot()).toMatchObject({
      region: "header",
      columnId: "COL_ID_NAME",
    });
    navigation.movePage(2);
    expect(navigation.getSnapshot()).toMatchObject({
      region: "body",
      rowId: "second",
      columnId: "COL_ID_NAME",
    });
    navigation.moveToGridEdge("end");
    expect(navigation.getSnapshot()).toMatchObject({ rowId: "third", columnId: "COL_ID_SCORE" });
    navigation.moveToColumnEdge("start");
    expect(navigation.getSnapshot()).toMatchObject({
      region: "header",
      columnId: "COL_ID_SCORE",
    });
  });

  it("resolves every keyboard command through one deterministic logical model", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_START",
        field: "name",
        headerName: "Start",
        pinned: "start",
        valueType: "text",
      },
      {
        columnId: "COL_ID_CENTER",
        field: "name",
        headerName: "Center",
        valueType: "text",
      },
      {
        columnId: "COL_ID_END",
        field: "name",
        headerName: "End",
        pinned: "end",
        valueType: "text",
      },
    ]);
    const navigation = new BrunoTableNavigationRuntime();
    navigation.setShape(["first", "second", "third", "fourth"], columns);

    const commands: readonly BrunoTableNavigationCommand[] = [
      { type: "step", direction: "right" },
      { type: "step", direction: "right" },
      { type: "row-edge", edge: "start" },
      { type: "page", rowDelta: 2 },
      { type: "column-edge", edge: "end" },
      { type: "grid-edge", edge: "start" },
    ];
    const destinations = commands.map((command) => {
      expect(navigation.navigate(command)).toBe(true);
      return navigation.getSnapshot();
    });

    expect(destinations).toEqual([
      expect.objectContaining({ rowId: "first", columnId: "COL_ID_CENTER" }),
      expect.objectContaining({ rowId: "first", columnId: "COL_ID_END" }),
      expect.objectContaining({ rowId: "first", columnId: "COL_ID_START" }),
      expect.objectContaining({ rowId: "third", columnId: "COL_ID_START" }),
      expect.objectContaining({ rowId: "fourth", columnId: "COL_ID_START" }),
      expect.objectContaining({ region: "header", columnId: "COL_ID_START" }),
    ]);
  });

  it("preserves every held-key move while reporting clamped repeats as no-ops", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const navigation = new BrunoTableNavigationRuntime();
    const notifications: string[] = [];
    navigation.subscribe(() => {
      const active = navigation.getSnapshot();
      notifications.push(`${active?.region}:${String(active?.rowIndex)}`);
    });
    navigation.setShape(
      Array.from({ length: 64 }, (_, index) => `row-${String(index)}`),
      columns,
    );
    notifications.length = 0;

    const moves = Array.from({ length: 80 }, () =>
      navigation.navigate({ type: "step", direction: "down" }),
    );

    expect(moves.filter(Boolean)).toHaveLength(63);
    expect(moves.slice(63)).toEqual(Array.from({ length: 17 }, () => false));
    expect(navigation.getSnapshot()).toMatchObject({ rowIndex: 63, rowId: "row-63" });
    expect(notifications).toHaveLength(63);
  });
});
