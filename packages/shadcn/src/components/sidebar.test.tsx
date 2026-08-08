import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vite-plus/test";

import { Sidebar, SidebarProvider } from "./sidebar";

describe("Sidebar server rendering", () => {
  test("forwards direction to desktop and non-collapsible roots", () => {
    const markup = renderToStaticMarkup(
      <SidebarProvider>
        <Sidebar dir="rtl" collapsible="none" />
        <Sidebar dir="rtl" />
      </SidebarProvider>,
    );

    expect(markup.match(/data-slot="sidebar"/gu)).toHaveLength(2);
    expect(markup.match(/dir="rtl"/gu)).toHaveLength(2);
  });
});
