import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vite-plus/test";

import { ButtonGroup } from "./button-group";
import { Carousel } from "./carousel";
import { ChartContainer, ChartLegendContent, ChartStyle, ChartTooltipContent } from "./chart";
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

  test("preserves Sidebar menu semantics through tooltip composition", () => {
    const buttonMarkup = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarMenuButton tooltip="Open menu">Menu button</SidebarMenuButton>
      </SidebarProvider>,
    );
    const linkMarkup = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarMenuButton render={<a href="/orders" />} tooltip="Open orders">
          Orders
        </SidebarMenuButton>
      </SidebarProvider>,
    );

    expect(buttonMarkup).toMatch(/<button[^>]*type="button"/u);
    expect(linkMarkup).toMatch(/<a[^>]*href="\/orders"/u);
    expect(linkMarkup).not.toContain('type="button"');
    expect(linkMarkup).not.toContain('role="button"');
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

  test("drops chart colors and keys that cannot be safely embedded in CSS", () => {
    const markup = renderToStaticMarkup(
      <ChartStyle
        id="orders"
        config={{
          amount: { color: "oklch(0.7 0.1 40)" },
          commented: { color: "red/*" },
          injectedColor: { color: "red; } body { background: url(https://example.test)" },
          "injected;key": { color: "blue" },
          variable: { color: "var(--chart-variable)" },
        }}
      />,
    );

    expect(markup).toContain("--color-amount: oklch(0.7 0.1 40)");
    expect(markup).toContain("--color-variable: var(--chart-variable)");
    expect(markup).not.toContain("--color-commented");
    expect(markup).not.toContain("--color-injectedColor");
    expect(markup).not.toContain("injected;key");
    expect(markup).not.toContain("url(");
  });

  test("forwards safe tooltip DOM props without leaking Recharts props", () => {
    const payload = [{ dataKey: "amount", graphicalItemId: "amount", value: 5 }];
    const markup = renderToStaticMarkup(
      <ChartContainer config={{ amount: { label: "Amount" } }}>
        <ChartTooltipContent
          active
          aria-label="Order details"
          data-state="visible"
          id="orders-tooltip"
          payload={payload}
          separator="should-not-reach-the-dom"
          style={{ maxWidth: 240 }}
          tabIndex={0}
          title="Current order"
          wrapperClassName="recharts-wrapper-only"
        />
      </ChartContainer>,
    );

    expect(markup).toContain('id="orders-tooltip"');
    expect(markup).toContain('aria-label="Order details"');
    expect(markup).toContain('data-state="visible"');
    expect(markup).toContain('style="max-width:240px"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('title="Current order"');
    expect(markup).not.toContain("should-not-reach-the-dom");
    expect(markup).not.toContain("recharts-wrapper-only");
  });

  test("forwards safe legend DOM props without leaking Recharts props", () => {
    const markup = renderToStaticMarkup(
      <ChartContainer config={{ amount: { label: "Amount" } }}>
        <ChartLegendContent
          align="left"
          aria-label="Order legend"
          data-state="visible"
          iconSize={32}
          id="orders-legend"
          layout="vertical"
          payload={[{ color: "red", dataKey: "amount", value: "Amount" }]}
          style={{ maxWidth: 240 }}
          tabIndex={0}
          title="Series"
        />
      </ChartContainer>,
    );

    expect(markup).toContain('id="orders-legend"');
    expect(markup).toContain('aria-label="Order legend"');
    expect(markup).toContain('data-state="visible"');
    expect(markup).toContain('style="max-width:240px"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('title="Series"');
    expect(markup).not.toContain('align="left"');
    expect(markup).not.toContain('iconSize="32"');
    expect(markup).not.toContain('layout="vertical"');
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
