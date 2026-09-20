import { afterEach, expect, test } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { cleanup, render } from "vitest-browser-react";

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxValue,
} from "./combobox";

afterEach(cleanup);

function DeskBadge() {
  return <span>London desk</span>;
}

function NamedDeskBadge({ name }: { name: string }) {
  return <span>{name} desk</span>;
}

test("distinguishes removal controls for multiple opaque chips", async () => {
  const screen = await render(
    <Combobox items={["London", "Paris"]} defaultValue={["London", "Paris"]} multiple>
      <ComboboxChips>
        <ComboboxValue>
          {(selected: string[]) =>
            selected.map((value) => (
              <ComboboxChip key={value}>
                <NamedDeskBadge name={value} />
              </ComboboxChip>
            ))
          }
        </ComboboxValue>
        <ComboboxChipsInput aria-label="Add desk" />
      </ComboboxChips>
    </Combobox>,
  );
  const london = screen.getByRole("button", { name: "Remove item London desk", exact: true });
  const paris = screen.getByRole("button", { name: "Remove item Paris desk", exact: true });
  await expect.element(london).toBeInTheDocument();
  await expect.element(paris).toBeInTheDocument();
  london.element().focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(london).not.toBeInTheDocument();
  await expect.element(paris).toBeInTheDocument();
  await expect.element(screen.getByRole("combobox", { name: "Add desk" })).toHaveFocus();
});

test("renders opaque chip content and removes it through its accessible button", async () => {
  const screen = await render(
    <Combobox items={["London"]} defaultValue={["London"]} multiple>
      <ComboboxChips>
        <ComboboxValue>
          {(selected: string[]) =>
            selected.map((value) => (
              <ComboboxChip key={value}>
                <DeskBadge />
              </ComboboxChip>
            ))
          }
        </ComboboxValue>
        <ComboboxChipsInput aria-label="Add desk" />
      </ComboboxChips>
    </Combobox>,
  );

  const remove = screen.getByRole("button", { name: "Remove item London desk", exact: true });
  await expect.element(remove).toBeInTheDocument();
  remove.element().focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(remove).not.toBeInTheDocument();
  await expect.element(screen.getByRole("combobox", { name: "Add desk" })).toHaveFocus();
});

test.each([
  { content: "London", label: "Remove London" },
  { content: 0, label: "Remove 0" },
  { content: null, label: "Remove item" },
  { content: <span role="img" aria-label="London desk" />, label: "Remove item London desk" },
  {
    content: (
      <>
        <span>London</span> desk
      </>
    ),
    label: "Remove London desk",
  },
  {
    content: (
      <>
        <DeskBadge />
      </>
    ),
    label: "Remove item London desk",
  },
  { content: <DeskBadge />, value: "LDN", label: "Remove LDN" },
  { content: <DeskBadge />, removeLabel: "  Remove London desk  ", label: "Remove London desk" },
  { content: <DeskBadge />, value: "LDN", removeLabel: "Remove London", label: "Remove London" },
  { content: <DeskBadge />, removeLabel: "  ", label: "Remove item London desk" },
])("preserves accessible chip removal for $label", async ({ content, label, ...labels }) => {
  const screen = await render(
    <Combobox items={["London", "Paris"]} defaultValue={["London", "Paris"]} multiple>
      <ComboboxChips>
        <ComboboxValue>
          {(selected: string[]) =>
            selected.map((value) => (
              <ComboboxChip key={value} {...(value === "London" ? labels : {})}>
                {value === "London" ? content : "Paris"}
              </ComboboxChip>
            ))
          }
        </ComboboxValue>
        <ComboboxChipsInput aria-label="Add desk" />
      </ComboboxChips>
    </Combobox>,
  );
  const remove = screen.getByRole("button", { name: label, exact: true });
  await expect.element(remove).toBeInTheDocument();
  await userEvent.click(remove);
  await expect.element(remove).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Remove Paris", exact: true }))
    .toBeInTheDocument();
  await expect.element(screen.getByRole("combobox", { name: "Add desk" })).toHaveFocus();
});
