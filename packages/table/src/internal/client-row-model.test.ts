import { describe, expect, it, vi } from "vitest";

import { compileColumns } from "./compile-columns";
import { filterClientRows } from "./client-row-model";

describe("Client row model", () => {
  it("uses locale-independent case normalization", () => {
    const columns = compileColumns([
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
    ]);
    const localeLowerCase = vi
      .spyOn(String.prototype, "toLocaleLowerCase")
      .mockImplementation(() => {
        throw new Error("locale-sensitive normalization must not run");
      });

    expect(
      filterClientRows([{ id: "first", name: "I" }], columns, [
        { columnId: "COL_ID_NAME", type: "equals", filter: "i" },
      ]),
    ).toEqual([{ id: "first", name: "I" }]);
    expect(localeLowerCase).not.toHaveBeenCalled();

    localeLowerCase.mockRestore();
  });
});
