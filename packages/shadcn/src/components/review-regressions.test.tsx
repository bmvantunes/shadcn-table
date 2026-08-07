import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vite-plus/test";

import { ButtonGroup } from "./button-group";
import { Carousel } from "./carousel";
import { ChartContainer, ChartStyle, ChartTooltipContent } from "./chart";
import { EmptyDescription } from "./empty";
import { Item, ItemGroup } from "./item";
import { PaginationEllipsis, PaginationLink } from "./pagination";
import {
  SidebarGroupAction,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarProvider,
} from "./sidebar";
import { Menubar } from "./menubar";
import { Slider } from "./slider";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

describe("reviewed component regressions", () => {
  test("renders a scalar Slider with exactly one named thumb", () => {
    const markup = renderToStaticMarkup(<Slider aria-label="Volume" defaultValue={25} />);

    expect(markup.match(/data-slot="slider-thumb"/gu)).toHaveLength(1);
    expect(markup).toMatch(/<input[^>]*aria-label="Volume"/u);
  });

  test("renders stable, distinct names for range Slider thumbs during SSR", () => {
    const markup = renderToStaticMarkup(
      <Slider aria-label="Price range" defaultValue={[25, 75]} />,
    );

    expect(markup.match(/data-slot="slider-thumb"/gu)).toHaveLength(2);
    expect(markup).toMatch(/<input[^>]*aria-label="Price range 1"/u);
    expect(markup).toMatch(/<input[^>]*aria-label="Price range 2"/u);
  });

  test("preserves consumer-provided Slider label relationships", () => {
    const markup = renderToStaticMarkup(
      <>
        <span id="volume-label">Volume</span>
        <Slider aria-labelledby="volume-label" defaultValue={25} />
      </>,
    );

    expect(markup).toMatch(/<input[^>]*aria-labelledby="volume-label"/u);
    expect(markup).not.toContain('aria-label="Value"');
  });

  test("prefers a visible Slider label relationship over an aria-label fallback", () => {
    const markup = renderToStaticMarkup(
      <>
        <span id="visible-volume-label">Visible volume</span>
        <Slider
          aria-label="Fallback volume"
          aria-labelledby="visible-volume-label"
          defaultValue={25}
        />
      </>,
    );

    expect(markup).toMatch(/<input[^>]*aria-labelledby="visible-volume-label"/u);
    expect(markup).not.toMatch(/<input[^>]*aria-label="Fallback volume"/u);
  });

  test("renders vertical Menubar semantics with a vertical layout", () => {
    const markup = renderToStaticMarkup(<Menubar orientation="vertical" />);

    expect(markup).toContain('aria-orientation="vertical"');
    expect(markup).toContain('data-orientation="vertical"');
    expect(markup).toContain("data-[orientation=vertical]:flex-col");
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

  test("renders pagination links as native anchors", () => {
    const markup = renderToStaticMarkup(
      <PaginationLink href="/orders?page=2" isActive>
        2
      </PaginationLink>,
    );

    expect(markup).toMatch(/^<a /u);
    expect(markup).toContain('href="/orders?page=2"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).not.toContain('role="button"');
  });

  test("keeps default Sidebar action seams from submitting forms", () => {
    const markup = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarGroupAction>Group action</SidebarGroupAction>
        <SidebarMenuButton>Menu button</SidebarMenuButton>
        <SidebarMenuAction>Menu action</SidebarMenuAction>
      </SidebarProvider>,
    );

    expect(markup.match(/type="button"/gu)).toHaveLength(3);
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

  test("preserves numeric chart labels for rendering and label formatting", () => {
    const payload = [{ dataKey: "amount", graphicalItemId: "amount", value: 5 }];
    const labelFormatter = vi.fn((value) => `Axis ${String(value)}`);
    const plainMarkup = renderToStaticMarkup(
      <ChartContainer config={{ amount: { label: "Amount" } }}>
        <ChartTooltipContent active label={0} payload={payload} />
      </ChartContainer>,
    );
    const markup = renderToStaticMarkup(
      <ChartContainer config={{ amount: { label: "Amount" } }}>
        <ChartTooltipContent active label={0} labelFormatter={labelFormatter} payload={payload} />
      </ChartContainer>,
    );

    expect(plainMarkup).toContain('<div class="font-medium">0</div>');
    expect(markup).toContain("Axis 0");
    expect(labelFormatter).toHaveBeenCalledWith(0, payload);
  });

  test("runs chart tooltip formatters when a value has no name", () => {
    const payload = [{ dataKey: "amount", graphicalItemId: "amount", value: 5 }];
    const formatter = vi.fn(() => "Formatted without a name");
    const markup = renderToStaticMarkup(
      <ChartContainer config={{ amount: { label: "Amount" } }}>
        <ChartTooltipContent active formatter={formatter} payload={payload} />
      </ChartContainer>,
    );

    expect(markup).toContain("Formatted without a name");
    expect(formatter).toHaveBeenCalledWith(5, undefined, payload[0], 0, payload);
  });
});
