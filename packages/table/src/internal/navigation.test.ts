import { describe, expect, it } from "vitest";

import { compileColumns } from "./compile-columns";
import { BrunoTableNavigationRuntime } from "./navigation";

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

  it("falls back to the active row's previous display position when its identity disappears", () => {
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
    navigation.move(2, 0);

    navigation.setShape(["first", "second", "replacement"], columns);

    expect(navigation.getSnapshot()).toMatchObject({
      region: "body",
      rowIndex: 2,
      rowId: "replacement",
      columnId: "COL_ID_NAME",
    });
  });

  it("moves through the coherent header/body space and preserves row identity across reorder", () => {
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
        pinned: "start",
        valueType: "number",
      },
    ]);
    const navigation = new BrunoTableNavigationRuntime();
    navigation.setShape(["first", "second"], columns);
    expect(navigation.getSnapshot()?.columnId).toBe("COL_ID_SCORE");

    navigation.move(-1, 0);
    expect(navigation.getSnapshot()).toMatchObject({ region: "header", columnId: "COL_ID_SCORE" });
    navigation.move(0, 1);
    expect(navigation.getSnapshot()).toMatchObject({ region: "header", columnId: "COL_ID_NAME" });
    navigation.move(1, 0);
    navigation.move(1, 0);
    navigation.move(1, 0);
    expect(navigation.getSnapshot()).toMatchObject({
      region: "body",
      rowIndex: 1,
      rowId: "second",
      columnId: "COL_ID_NAME",
    });

    navigation.setShape(["second", "first"], columns);
    expect(navigation.getSnapshot()).toMatchObject({ rowIndex: 0, rowId: "second" });
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
    navigation.move(0, 1);
    expect(navigation.getSnapshot()).toMatchObject({
      region: "header",
      columnId: "COL_ID_SCORE",
    });

    navigation.setShape(["first"], columns);
    navigation.move(1, 0);
    navigation.clearForQuery();
    navigation.setShape(["first"], columns);
    expect(navigation.getSnapshot()).toBeUndefined();
  });
});
