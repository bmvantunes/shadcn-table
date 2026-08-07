// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test } from "vite-plus/test";

import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "./drawer";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "./navigation-menu";
import { Sidebar, SidebarProvider } from "./sidebar";
import { createToastManager, Toaster } from "./toast";

afterEach(cleanup);

describe("current-head overlay regressions", () => {
  test("bridges every Navigation Menu popup side and uses a valid exit easing utility", async () => {
    render(
      <NavigationMenu value="docs">
        <NavigationMenuList>
          <NavigationMenuItem value="docs">
            <NavigationMenuTrigger>Docs</NavigationMenuTrigger>
            <NavigationMenuContent>
              <NavigationMenuLink href="/docs">Documentation</NavigationMenuLink>
            </NavigationMenuContent>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-slot="navigation-menu-content"]')).not.toBeNull();
    });

    const positioner = Array.from(
      document.querySelectorAll<HTMLElement>('[role="presentation"]'),
    ).find((element) => element.className.includes("before:absolute"));
    expect(positioner).toBeDefined();

    const positionerClasses = positioner?.className ?? "";
    expect(positionerClasses).toContain("before:content-['']");
    for (const side of ["bottom", "inline-end", "inline-start", "left", "right", "top"]) {
      expect(positionerClasses).toContain(`data-[side=${side}]:before:`);
    }

    expect(positioner?.innerHTML).toContain("data-ending-style:ease-[ease]");
    expect(positioner?.innerHTML).not.toContain("easing-[ease]");
  });

  test("styles every Base UI Dropdown Menu highlight seam from data-highlighted", async () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuItem>Item</DropdownMenuItem>
            <DropdownMenuCheckboxItem checked>Checkbox item</DropdownMenuCheckboxItem>
            <DropdownMenuRadioGroup value="radio">
              <DropdownMenuRadioItem value="radio">Radio item</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuGroup>
                  <DropdownMenuItem>Nested item</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();
    });

    for (const slot of [
      "dropdown-menu-item",
      "dropdown-menu-checkbox-item",
      "dropdown-menu-radio-item",
      "dropdown-menu-sub-trigger",
    ]) {
      const element = document.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
      expect(element?.className).toContain("data-highlighted:bg-accent");
      expect(element?.className).toContain("data-highlighted:text-accent-foreground");
    }
  });

  test("keeps long Drawer content vertically and touch scrollable", async () => {
    render(
      <Drawer open>
        <DrawerContent>
          <DrawerTitle>Order details</DrawerTitle>
          <DrawerDescription>Long order content</DrawerDescription>
        </DrawerContent>
      </Drawer>,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
    });

    const contentClasses =
      document.querySelector<HTMLElement>('[data-slot="drawer-content"]')?.className ?? "";
    expect(contentClasses).toContain("overflow-y-auto");
    expect(contentClasses).toContain("touch-pan-y");
    expect(contentClasses).not.toContain("overflow-hidden");
  });

  test("forwards Sidebar direction to desktop and non-collapsible roots", () => {
    const markup = renderToStaticMarkup(
      <SidebarProvider>
        <Sidebar dir="rtl" collapsible="none" />
        <Sidebar dir="rtl" />
      </SidebarProvider>,
    );

    expect(markup.match(/data-slot="sidebar"/gu)).toHaveLength(2);
    expect(markup.match(/dir="rtl"/gu)).toHaveLength(2);
  });

  test("keeps a persistent Toast Close control accessible while collapsed", async () => {
    const toastManager = createToastManager();
    render(<Toaster toastManager={toastManager} />);

    act(() => {
      toastManager.add({ title: "Save failed", description: "Try again later.", timeout: 0 });
    });

    await waitFor(() => {
      expect(document.querySelector('[data-slot="toast-close"]')).not.toBeNull();
    });

    const close = document.querySelector<HTMLElement>('[data-slot="toast-close"]');
    expect(close?.getAttribute("aria-label")).toBe("Close toast");
    expect(close?.getAttribute("aria-hidden")).toBe("false");
  });
});
