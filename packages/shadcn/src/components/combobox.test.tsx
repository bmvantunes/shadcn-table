import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vite-plus/test";

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxInput,
  ComboboxTrigger,
} from "./combobox";

describe("Combobox", () => {
  test("names its default icon-only controls and keeps generated ids unique", () => {
    const markup = renderToStaticMarkup(
      <Combobox items={["Alpha"]} defaultValue="Alpha">
        <ComboboxInput aria-label="Search values" showClear />
      </Combobox>,
    );

    expect(markup).toContain('aria-label="Open options"');
    expect(markup).toContain('aria-label="Clear selection"');

    const ids = [...markup.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("uses visible trigger content as its accessible name", () => {
    const markup = renderToStaticMarkup(
      <Combobox items={["Alpha"]}>
        <ComboboxTrigger>Choose status</ComboboxTrigger>
      </Combobox>,
    );

    expect(markup).toContain("Choose status");
    expect(markup).not.toContain('aria-label="Open options"');
  });

  test("gives multiple chip removal controls distinguishable names", () => {
    const markup = renderToStaticMarkup(
      <Combobox items={["Alpha", "Beta"]} defaultValue={["Alpha", "Beta"]} multiple>
        <ComboboxChips>
          <ComboboxChip>Alpha</ComboboxChip>
          <ComboboxChip>Beta</ComboboxChip>
          <ComboboxChipsInput aria-label="Add value" />
        </ComboboxChips>
      </Combobox>,
    );

    expect(markup).toContain('aria-label="Remove Alpha"');
    expect(markup).toContain('aria-label="Remove Beta"');
  });
});
