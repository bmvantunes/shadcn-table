import { afterEach, expect, test, vi } from "vite-plus/test";
import { page, userEvent } from "vitest/browser";
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server.browser";
import { cleanup, render } from "vitest-browser-react";

import {
  BrunoTableActiveFilters,
  BrunoTableClient,
  BrunoTableQuickFilter,
  BrunoTableToolbar,
} from "../../dist/index.mjs";

type Row = Readonly<{ id: string; name: string; score: number }>;
type FilterRow = Readonly<{ id: string; name: string; symbol: string }>;

const source = Object.freeze({
  rows: Object.freeze([{ id: "row", name: "Ada", score: 1_234.5 }]) satisfies readonly Row[],
  totalRows: 1,
  version: 1,
  status: "ready" as const,
});

const filterSource = Object.freeze({
  rows: Object.freeze([
    { id: "ada", name: "Ada", symbol: "AAPL" },
    { id: "grace", name: "Grace", symbol: "MSFT" },
  ]) satisfies readonly FilterRow[],
  totalRows: 2,
  version: 1,
  status: "ready" as const,
});

void BrunoTableActiveFilters;

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

test("applies emitted Quick Filter and column filter interactions", async () => {
  const columns = [
    {
      columnId: "COL_ID_EMITTED_FILTER_NAME",
      field: "name",
      headerName: "Name",
      valueType: "text",
    },
  ] as const;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_EMITTED_FILTERS"
      getRowId={(row: FilterRow) => row.id}
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_EMITTED_FILTER_NAME", direction: "asc" }]}
      quickFilterFields={["symbol"]}
      clientSource={filterSource}
    >
      <BrunoTableToolbar>
        <BrunoTableQuickFilter />
      </BrunoTableToolbar>
    </BrunoTableClient>,
  );

  await userEvent.fill(screen.getByRole("searchbox", { name: "Quick Filter" }), "msft");
  await expect
    .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
    .not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Active filters (1)" }));
  const review = screen.getByRole("dialog", { name: "Active filters" });
  await expect
    .element(review.getByRole("button", { name: 'Remove Quick Filter contains "msft"' }))
    .toBeInTheDocument();
  await userEvent.click(
    review.getByRole("button", { name: 'Remove Quick Filter contains "msft"' }),
  );
  await expect
    .element(screen.getByRole("button", { name: "Active filters (0)" }))
    .toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Filter Name" }));
  const dialog = screen.getByRole("dialog", { name: "Filter Name" });
  await expect.element(dialog).toBeInTheDocument();
  await userEvent.fill(dialog.getByRole("textbox", { name: "Filter value for Name" }), "Grace");
  await expect
    .element(screen.getByRole("gridcell", { name: "Grace", exact: true }))
    .toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await expect
    .element(screen.getByRole("grid", { name: "Data for TABLE_ID_EMITTED_FILTERS" }))
    .toHaveFocus();
});

test("reports incompatible Table Identity reuse from the emitted browser runtime", async () => {
  const restoreProcess = replaceBrowserProcess({ env: { NODE_ENV: "development" } });
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const firstColumns = [
    {
      columnId: "COL_ID_VALUE",
      field: "name",
      headerName: "Name",
      valueType: "text",
    },
  ] as const;
  const incompatibleColumns = [
    {
      columnId: "COL_ID_VALUE",
      field: "score",
      headerName: "Score",
      valueType: "number",
    },
  ] as const;
  try {
    const screen = await render(
      <>
        <BrunoTableClient
          tableId="TABLE_ID_EMITTED_CONFLICT"
          getRowId={(row: Row) => row.id}
          columns={firstColumns}
          initialOrderBy={[{ columnId: "COL_ID_VALUE", direction: "asc" }]}
          clientSource={source}
        />
        <BrunoTableClient
          tableId="TABLE_ID_EMITTED_CONFLICT"
          getRowId={(row: Row) => row.id}
          columns={incompatibleColumns}
          initialOrderBy={[{ columnId: "COL_ID_VALUE", direction: "asc" }]}
          clientSource={source}
        />
      </>,
    );

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('simultaneous use of tableId "TABLE_ID_EMITTED_CONFLICT"'),
    );
    expect(
      screen.getByRole("grid", { name: "Data for TABLE_ID_EMITTED_CONFLICT" }).all(),
    ).toHaveLength(2);
  } finally {
    restoreProcess();
  }
});

test("reports incompatible Table Identity reuse without a process environment", async () => {
  const restoreProcess = replaceBrowserProcess(undefined);
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const firstColumns = [
    {
      columnId: "COL_ID_VALUE_WITHOUT_PROCESS",
      field: "name",
      headerName: "Name",
      valueType: "text",
    },
  ] as const;
  const incompatibleColumns = [
    {
      columnId: "COL_ID_VALUE_WITHOUT_PROCESS",
      field: "score",
      headerName: "Score",
      valueType: "number",
    },
  ] as const;

  try {
    const screen = await render(
      <>
        <BrunoTableClient
          tableId="TABLE_ID_EMITTED_NO_PROCESS"
          getRowId={(row: Row) => row.id}
          columns={firstColumns}
          initialOrderBy={[{ columnId: "COL_ID_VALUE_WITHOUT_PROCESS", direction: "asc" }]}
          clientSource={source}
        />
        <BrunoTableClient
          tableId="TABLE_ID_EMITTED_NO_PROCESS"
          getRowId={(row: Row) => row.id}
          columns={incompatibleColumns}
          initialOrderBy={[{ columnId: "COL_ID_VALUE_WITHOUT_PROCESS", direction: "asc" }]}
          clientSource={source}
        />
      </>,
    );

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('simultaneous use of tableId "TABLE_ID_EMITTED_NO_PROCESS"'),
    );
    expect(
      screen.getByRole("grid", { name: "Data for TABLE_ID_EMITTED_NO_PROCESS" }).all(),
    ).toHaveLength(2);
  } finally {
    restoreProcess();
  }
});

test("keeps emitted identity diagnostics disabled in production", async () => {
  const restoreProcess = replaceBrowserProcess({ env: { NODE_ENV: "production" } });
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const firstColumns = [
    {
      columnId: "COL_ID_VALUE_IN_PRODUCTION",
      field: "name",
      headerName: "Name",
      valueType: "text",
    },
  ] as const;
  const incompatibleColumns = [
    {
      columnId: "COL_ID_VALUE_IN_PRODUCTION",
      field: "score",
      headerName: "Score",
      valueType: "number",
    },
  ] as const;

  try {
    const screen = await render(
      <>
        <BrunoTableClient
          tableId="TABLE_ID_EMITTED_PRODUCTION"
          getRowId={(row: Row) => row.id}
          columns={firstColumns}
          initialOrderBy={[{ columnId: "COL_ID_VALUE_IN_PRODUCTION", direction: "asc" }]}
          clientSource={source}
        />
        <BrunoTableClient
          tableId="TABLE_ID_EMITTED_PRODUCTION"
          getRowId={(row: Row) => row.id}
          columns={incompatibleColumns}
          initialOrderBy={[{ columnId: "COL_ID_VALUE_IN_PRODUCTION", direction: "asc" }]}
          clientSource={source}
        />
      </>,
    );

    expect(
      screen.getByRole("grid", { name: "Data for TABLE_ID_EMITTED_PRODUCTION" }).all(),
    ).toHaveLength(2);
    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    restoreProcess();
  }
});

test("hydrates emitted custom controls after removing their inert server boundary", async () => {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const activate = vi.fn();
  const recoverableErrors: unknown[] = [];
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const columns = [
    {
      columnId: "COL_ID_ACTION",
      field: "name",
      headerName: "Action",
      valueType: "text",
      cellRenderer: ({ value }: { readonly value: string }) => (
        <button type="button" onClick={() => activate(value)}>
          Hydrate {value}
        </button>
      ),
    },
    {
      columnId: "COL_ID_SCORE",
      field: "score",
      headerName: "Score",
      valueType: "number",
      format: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    },
  ] as const;
  const element = (
    <BrunoTableClient
      tableId="TABLE_ID_EMITTED_HYDRATION"
      getRowId={(row: Row) => row.id}
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_ACTION", direction: "asc" }]}
      clientSource={source}
    />
  );
  const serverMarkup = renderToString(element);
  expect(serverMarkup).toContain('inert=""');
  expect(serverMarkup).toContain("1,234.50");
  const container = document.createElement("div");
  const beforeHydration = document.createElement("button");
  beforeHydration.textContent = "Before hydration";
  const hydrationHost = document.createElement("div");
  hydrationHost.innerHTML = serverMarkup;
  const afterHydration = document.createElement("button");
  afterHydration.textContent = "After hydration";
  container.append(beforeHydration, hydrationHost, afterHydration);
  document.body.append(container);
  const before = page.getByRole("button", { name: "Before hydration" });
  const sortPanel = page.getByRole("button", { name: "Sort rows, 1 active" });
  const grid = page.getByRole("grid", { name: "Data for TABLE_ID_EMITTED_HYDRATION" });
  const after = page.getByRole("button", { name: "After hydration" });
  before.element().focus();
  await userEvent.keyboard("{Tab}");
  expect(document.activeElement).toBe(sortPanel.element());
  await userEvent.keyboard("{Tab}");
  expect(document.activeElement).toBe(grid.element());
  await userEvent.keyboard("{Tab}");
  expect(document.activeElement).toBe(after.element());
  const mutations: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.attributeName === "tabindex" && record.target instanceof HTMLButtonElement) {
        mutations.push("tabindex");
      }
      if (record.attributeName === "inert") mutations.push("inert");
    }
  });
  observer.observe(hydrationHost, {
    attributes: true,
    attributeFilter: ["inert", "tabindex"],
    subtree: true,
  });
  let root: Root | undefined;

  try {
    await act(async () => {
      root = hydrateRoot(hydrationHost, element, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
      await Promise.resolve();
    });
    const action = page.getByRole("button", { name: "Hydrate Ada" });
    await vi.waitFor(() => {
      expect(action.element().tabIndex).toBe(-1);
      expect(action.element().closest("[inert]")).toBeNull();
      expect(mutations).toContain("tabindex");
      expect(mutations).toContain("inert");
    });
    expect(mutations.indexOf("tabindex")).toBeLessThan(mutations.indexOf("inert"));
    expect(recoverableErrors).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    await action.click();
    expect(activate).toHaveBeenCalledWith("Ada");
  } finally {
    observer.disconnect();
    await act(async () => root?.unmount());
    container.remove();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});

test("runs emitted column management commands through the accessible menu", async () => {
  const columns = [
    {
      columnId: "COL_ID_EMITTED_NAME",
      field: "name",
      headerName: "Name",
      valueType: "text",
      width: 160,
    },
    {
      columnId: "COL_ID_EMITTED_SCORE",
      field: "score",
      headerName: "Score",
      valueType: "number",
      width: 96,
    },
  ] as const;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_EMITTED_COLUMN_MANAGEMENT"
      getRowId={(row: Row) => row.id}
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_EMITTED_NAME", direction: "asc" }]}
      clientSource={source}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Column menu for Name" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: "Pin to logical end" }));
  await vi.waitFor(() => {
    const header = screen
      .getByRole("grid")
      .element()
      .querySelector<HTMLElement>('th[data-bruno-column-id="COL_ID_EMITTED_NAME"]');
    expect(header).not.toBeNull();
    expect(header).toHaveAttribute("data-pinned-region", "end");
  });
});

test("runs emitted resize, reorder, visibility, and reset commands", async () => {
  const columns = [
    {
      columnId: "COL_ID_EMITTED_LAYOUT_NAME",
      field: "name",
      headerName: "Name",
      valueType: "text",
      width: 160,
    },
    {
      columnId: "COL_ID_EMITTED_LAYOUT_SCORE",
      field: "score",
      headerName: "Score",
      valueType: "number",
      width: 96,
    },
  ] as const;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_EMITTED_LAYOUT_COMMANDS"
      getRowId={(row: Row) => row.id}
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_EMITTED_LAYOUT_NAME", direction: "asc" }]}
      clientSource={source}
    />,
  );
  const grid = screen.getByRole("grid").element();
  const resize = screen.getByRole("separator", { name: "Resize Name" });
  resize.element().focus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(resize).toHaveAttribute("aria-valuenow", "170");
  resize.element().dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: 100,
      pointerId: 30,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, clientX: 130, pointerId: 30 }),
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
  window.dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, clientX: 130, pointerId: 30 }),
  );
  await expect.element(resize).toHaveAttribute("aria-valuenow", "200");

  await userEvent.click(screen.getByRole("button", { name: "Column menu for Name" }));
  await userEvent.hover(screen.getByRole("menuitem", { name: "Move" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Move toward logical end" }));
  await vi.waitFor(() =>
    expect(
      [...grid.querySelectorAll<HTMLElement>("th[data-bruno-column-id]")].map(
        (header) => header.dataset["brunoColumnId"],
      ),
    ).toEqual(["COL_ID_EMITTED_LAYOUT_SCORE", "COL_ID_EMITTED_LAYOUT_NAME"]),
  );

  await userEvent.click(screen.getByRole("button", { name: "Column menu for Name" }));
  await userEvent.hover(screen.getByRole("menuitem", { name: "Visibility" }));
  await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Score" }));
  await vi.waitFor(() => expect(grid).toHaveAttribute("aria-colcount", "1"));

  await userEvent.keyboard("{Escape}");
  const nameMenu = screen.getByRole("button", { name: "Column menu for Name" });
  await vi.waitFor(() => expect(document.activeElement).toBe(nameMenu.element()));
  await userEvent.click(nameMenu);
  await vi.waitFor(() => expect(nameMenu).toHaveAttribute("aria-expanded", "true"));
  await userEvent.hover(screen.getByRole("menuitem", { name: "Reset" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Reset complete layout" }));
  await vi.waitFor(() => expect(grid).toHaveAttribute("aria-colcount", "2"));
  await expect
    .element(screen.getByRole("separator", { name: "Resize Name" }))
    .toHaveAttribute("aria-valuenow", "160");
});

function replaceBrowserProcess(value: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
  Object.defineProperty(globalThis, "process", {
    configurable: true,
    value,
    writable: true,
  });
  return () => {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, "process");
    } else {
      Object.defineProperty(globalThis, "process", descriptor);
    }
  };
}
