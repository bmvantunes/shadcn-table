import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vite-plus/test";

import { ButtonGroup } from "./button-group";
import { Carousel } from "./carousel";
import { ChartStyle } from "./chart";
import { EmptyDescription } from "./empty";
import { Item, ItemGroup } from "./item";
import { PaginationEllipsis } from "./pagination";
import { Slider } from "./slider";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

describe("reviewed component regressions", () => {
  test("renders a scalar Slider with exactly one thumb", () => {
    const markup = renderToStaticMarkup(<Slider aria-label="Volume" defaultValue={25} />);

    expect(markup.match(/data-slot="slider-thumb"/gu)).toHaveLength(1);
  });

  test("forwards vertical Tabs orientation to Base UI", () => {
    const markup = renderToStaticMarkup(
      <Tabs orientation="vertical" defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    expect(markup).toContain('data-orientation="vertical"');
  });

  test("does not claim list semantics for generic Item composition", () => {
    const items = renderToStaticMarkup(
      <ItemGroup>
        <Item>Entry</Item>
      </ItemGroup>,
    );

    expect(items).not.toContain('role="list"');
    expect(items).not.toContain('role="listitem"');
    expect(renderToStaticMarkup(<EmptyDescription>No results</EmptyDescription>)).toMatch(/^<p/u);
  });

  test("exposes the pagination ellipsis label to assistive technology", () => {
    const markup = renderToStaticMarkup(<PaginationEllipsis />);

    expect(markup).toContain("More pages");
    expect(markup).not.toMatch(/^<span aria-hidden=/u);
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/u);
  });

  test("publishes the default Button Group orientation", () => {
    expect(renderToStaticMarkup(<ButtonGroup />)).toContain('data-orientation="horizontal"');
  });

  test("renders a named, focusable Carousel region by default", () => {
    const markup = renderToStaticMarkup(<Carousel />);

    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Carousel"');
    expect(markup).toContain('tabindex="0"');
  });

  test("quotes and escapes Chart Style attribute selectors", () => {
    const rawTextBreakout = "</style><script>throw new Error('injected')</script>";
    const markup = renderToStaticMarkup(
      <ChartStyle
        id={`orders"]${rawTextBreakout}`}
        config={{ [rawTextBreakout]: { color: rawTextBreakout } }}
      />,
    );

    expect(markup).toContain('[data-chart="orders\\\"]\\3c ');
    expect(markup).not.toContain("<script>");
    expect(markup.match(/<\/style>/gu)).toHaveLength(1);
    expect(markup).toContain("\\3c /style>");
  });
});
