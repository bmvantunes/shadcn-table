import { describe, expect, it, vi } from "vitest";

import { compileColumns } from "./compile-columns";
import { BrunoTableViewportRuntime } from "./virtual-viewport";

describe("BrunoTableViewportRuntime", () => {
  it("publishes detached layout changes once and keeps hot scroll coordinates private", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const viewport = new BrunoTableViewportRuntime();
    const listener = vi.fn();
    viewport.subscribe(listener);

    viewport.setLayout(2, columns);

    expect(listener).toHaveBeenCalledOnce();
    expect(viewport.getSnapshot().virtualWindow).toMatchObject({
      rowStart: 0,
      rowEnd: 2,
      totalHeight: 72,
    });
    expect(viewport.getSnapshot()).not.toHaveProperty("scrollTop");
    expect(viewport.getSnapshot()).not.toHaveProperty("scrollLeft");

    viewport.setLayout(2, columns);
    expect(listener).toHaveBeenCalledOnce();
  });
});
