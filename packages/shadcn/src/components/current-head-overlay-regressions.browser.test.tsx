import { afterEach, describe, expect, test } from "vite-plus/test";
import { cleanup, render } from "vitest-browser-react";

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
import { createToastManager, Toaster } from "./toast";

afterEach(cleanup);

describe("current-head overlay regressions", () => {
  test("bridges every Navigation Menu popup side and uses a valid exit easing utility", async () => {
    const screen = await render(
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

    const documentationLink = screen.getByRole("link", { name: "Documentation" });
    await expect.element(documentationLink).toBeInTheDocument();

    const positioner = documentationLink.element().closest<HTMLElement>('[role="presentation"]');
    expect(positioner).not.toBeNull();

    const positionerClasses = positioner?.className ?? "";
    expect(positionerClasses).toContain("before:content-['']");
    for (const side of ["bottom", "inline-end", "inline-start", "left", "right", "top"]) {
      expect(positionerClasses).toContain(`data-[side=${side}]:before:`);
    }

    expect(positioner?.innerHTML).toContain("data-ending-style:ease-[ease]");
    expect(positioner?.innerHTML).not.toContain("easing-[ease]");
  });

  test("styles every Base UI Dropdown Menu highlight seam from data-highlighted", async () => {
    const screen = await render(
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

    const items = [
      screen.getByRole("menuitem", { name: "Item" }),
      screen.getByRole("menuitemcheckbox", { name: "Checkbox item" }),
      screen.getByRole("menuitemradio", { name: "Radio item" }),
      screen.getByRole("menuitem", { name: "More" }),
    ];

    for (const item of items) {
      await expect.element(item).toHaveClass(/data-highlighted:bg-accent/u);
      await expect.element(item).toHaveClass(/data-highlighted:text-accent-foreground/u);
    }
  });

  test("keeps long Drawer content vertically and touch scrollable", async () => {
    const screen = await render(
      <Drawer open>
        <DrawerContent>
          <DrawerTitle>Order details</DrawerTitle>
          <DrawerDescription>Long order content</DrawerDescription>
        </DrawerContent>
      </Drawer>,
    );

    const dialog = screen.getByRole("dialog", { name: "Order details" });
    await expect.element(dialog).toBeInTheDocument();

    const content = dialog.element().querySelector<HTMLElement>('[data-slot="drawer-content"]');
    expect(content).not.toBeNull();
    expect(content?.className).toContain("overflow-y-auto");
    expect(content?.className).toContain("touch-pan-y");
    expect(content?.className).not.toContain("overflow-hidden");
  });

  test("keeps a persistent Toast Close control accessible while collapsed", async () => {
    const toastManager = createToastManager();

    function ToastHarness() {
      return (
        <>
          <button
            type="button"
            onClick={() =>
              toastManager.add({
                title: "Save failed",
                description: "Try again later.",
                timeout: 0,
              })
            }
          >
            Show failure
          </button>
          <Toaster toastManager={toastManager} />
        </>
      );
    }

    const screen = await render(<ToastHarness />);
    await screen.getByRole("button", { name: "Show failure" }).click();

    const close = screen.getByRole("button", { name: "Close toast" });
    await expect.element(close).toBeInTheDocument();
    await expect.element(close).toHaveAttribute("aria-hidden", "false");
  });
});
