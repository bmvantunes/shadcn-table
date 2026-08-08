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
});
