import { afterEach, expect, test } from "vite-plus/test";
import { cleanup, render } from "vitest-browser-react";
import { createToastManager, Toaster } from "./toast";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";

import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "./popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "./sheet";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle, DrawerTrigger } from "./drawer";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "./combobox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

afterEach(cleanup);

test("a notification arriving inside a dialog paints above its backdrop and can be dismissed", async () => {
  const toastManager = createToastManager();
  const screen = await render(
    <Dialog>
      <DialogTrigger>Open settings</DialogTrigger>
      <DialogContent>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Manage your account.</DialogDescription>
        <Toaster toastManager={toastManager}>
          <button
            type="button"
            onClick={() => toastManager.add({ title: "Save failed", priority: "high", timeout: 0 })}
          >
            Show failure
          </button>
        </Toaster>
      </DialogContent>
    </Dialog>,
  );
  await screen.getByRole("button", { name: "Open settings" }).click();
  await screen.getByRole("button", { name: "Show failure" }).click();
  const close = screen.getByRole("button", { name: "Close toast" });
  await expect.element(close).toBeVisible();
  await expect
    .poll(() => {
      const button = close.element();
      const bounds = button.getBoundingClientRect();
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
      return button.contains(
        document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2),
      );
    })
    .toBe(true);
  await close.click();
  await expect.element(close).not.toBeInTheDocument();
  await expect.element(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
});

test("a confirmation paints above the dialog that opened it", async () => {
  const screen = await render(
    <Dialog>
      <DialogTrigger>Open settings</DialogTrigger>
      <DialogContent>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Manage your account.</DialogDescription>
        <AlertDialog>
          <AlertDialogTrigger>Delete account</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
            <AlertDialogCancel>Keep account</AlertDialogCancel>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>,
  );
  await screen.getByRole("button", { name: "Open settings" }).click();
  const dialog = screen.getByRole("dialog", { name: "Settings" }).element();
  await screen.getByRole("button", { name: "Delete account" }).click();
  const confirmation = screen.getByRole("alertdialog", { name: "Delete your account?" });
  await expect.element(confirmation).toBeVisible();
  await expect.poll(() => paintsAbove(confirmation.element(), dialog)).toBe(true);
  await screen.getByRole("button", { name: "Keep account" }).click();
  await expect.element(confirmation).not.toBeInTheDocument();
  await expect.element(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
});

test("a nested menu paints above its dialog and remains selectable", async () => {
  const screen = await render(
    <Dialog>
      <DialogTrigger>Open settings</DialogTrigger>
      <DialogContent>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Choose an action.</DialogDescription>
        <DropdownMenu>
          <DropdownMenuTrigger>Open actions</DropdownMenuTrigger>
          <DropdownMenuContent side="top">
            <DropdownMenuGroup>
              <DropdownMenuItem>Edit details</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </DialogContent>
    </Dialog>,
  );
  await screen.getByRole("button", { name: "Open settings" }).click();
  const dialog = screen.getByRole("dialog", { name: "Settings" }).element();
  await screen.getByRole("button", { name: "Open actions" }).click();
  const menu = screen.getByRole("menu");
  await expect.element(menu).toBeVisible();
  await expect.poll(() => paintsAbove(menu.element(), dialog)).toBe(true);
  await screen.getByRole("menuitem", { name: "Edit details" }).click();
  await expect.element(menu).not.toBeInTheDocument();
  await expect.element(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
});

test("Drawer paints above an overlapping sticky page header", async () => {
  const screen = await render(
    <>
      <header
        className="bg-background"
        style={{ position: "sticky", top: 0, zIndex: 50, height: 240 }}
      >
        Page header
      </header>
      <Drawer swipeDirection="right">
        <DrawerTrigger>Open details</DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>Details</DrawerTitle>
          <DrawerDescription>Edit your details.</DrawerDescription>
        </DrawerContent>
      </Drawer>
    </>,
  );
  const header = screen.getByRole("banner").element();
  await screen.getByRole("button", { name: "Open details" }).click();
  const popup = screen.getByRole("dialog", { name: "Details" });
  await expect.element(popup).toBeVisible();
  await expect.poll(() => paintsAbove(popup.element(), header)).toBe(true);
});

test("Sheet paints above an overlapping sticky page header", async () => {
  const screen = await render(
    <>
      <header
        className="bg-background"
        style={{ position: "sticky", top: 0, zIndex: 50, height: 240 }}
      >
        Page header
      </header>
      <Sheet>
        <SheetTrigger>Open details</SheetTrigger>
        <SheetContent>
          <SheetTitle>Details</SheetTitle>
          <SheetDescription>Edit your details.</SheetDescription>
        </SheetContent>
      </Sheet>
    </>,
  );
  const header = screen.getByRole("banner").element();
  await screen.getByRole("button", { name: "Open details" }).click();
  const popup = screen.getByRole("dialog", { name: "Details" });
  await expect.element(popup).toBeVisible();
  const headerBounds = header.getBoundingClientRect();
  await expect
    .poll(() => {
      const backdrop = document.elementFromPoint(headerBounds.left + 4, headerBounds.top + 4);
      expect(backdrop).not.toBeNull();
      return backdrop ? Number(getComputedStyle(backdrop).zIndex) : 0;
    })
    .toBeGreaterThan(50);
  await expect.poll(() => paintsAbove(popup.element(), header)).toBe(true);
});

test("Dialog paints above an overlapping sticky page header", async () => {
  const screen = await render(
    <>
      <header
        className="bg-background"
        style={{ position: "sticky", top: 0, zIndex: 50, height: "70vh" }}
      >
        Page header
      </header>
      <Dialog>
        <DialogTrigger>Open details</DialogTrigger>
        <DialogContent>
          <DialogTitle>Details</DialogTitle>
          <DialogDescription>Edit your details.</DialogDescription>
        </DialogContent>
      </Dialog>
    </>,
  );
  const header = screen.getByRole("banner").element();
  await screen.getByRole("button", { name: "Open details" }).click();
  const popup = screen.getByRole("dialog", { name: "Details" });
  await expect.element(popup).toBeVisible();
  const headerBounds = header.getBoundingClientRect();
  await expect
    .poll(() => {
      const backdrop = document.elementFromPoint(headerBounds.right - 4, headerBounds.top + 4);
      expect(backdrop).not.toBeNull();
      return backdrop ? Number(getComputedStyle(backdrop).zIndex) : 0;
    })
    .toBeGreaterThan(50);
  await expect.poll(() => paintsAbove(popup.element(), header)).toBe(true);
});

test("Combobox paints above an overlapping sticky page header", async () => {
  const screen = await render(
    <>
      <header
        className="bg-background"
        style={{ position: "sticky", top: 0, zIndex: 50, height: 240 }}
      >
        Page header
      </header>
      <Combobox items={["Apple"]}>
        <ComboboxInput aria-label="Choose fruit" />
        <ComboboxContent side="top">
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </>,
  );
  const header = screen.getByRole("banner").element();
  await screen.getByRole("button", { name: "Open options" }).click();
  const popup = screen.getByRole("listbox");
  await expect.element(popup).toBeVisible();
  await expect.poll(() => paintsAbove(popup.element(), header)).toBe(true);
});

test("Context Menu paints above an overlapping sticky page header", async () => {
  const screen = await render(
    <>
      <header
        className="bg-background"
        style={{ position: "sticky", top: 0, zIndex: 50, height: 240 }}
      >
        Page header
      </header>
      <ContextMenu>
        <ContextMenuTrigger render={<button type="button" />}>
          Open context actions
        </ContextMenuTrigger>
        <ContextMenuContent side="top">
          <ContextMenuGroup>
            <ContextMenuItem>Edit details</ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
    </>,
  );
  const header = screen.getByRole("banner").element();
  await screen.getByRole("button", { name: "Open context actions" }).click({ button: "right" });
  const popup = screen.getByRole("menu");
  await expect.element(popup).toBeVisible();
  await expect.poll(() => paintsAbove(popup.element(), header)).toBe(true);
});

test("Hover Card paints above an overlapping sticky page header", async () => {
  const screen = await render(
    <>
      <header
        className="bg-background"
        style={{ position: "sticky", top: 0, zIndex: 50, height: 240 }}
      >
        Page header
      </header>
      <HoverCard>
        <HoverCardTrigger href="#profile" delay={0}>
          Preview profile
        </HoverCardTrigger>
        <HoverCardContent side="top">
          <p>Profile details</p>
        </HoverCardContent>
      </HoverCard>
    </>,
  );
  await screen.getByRole("link", { name: "Preview profile" }).hover();
  const popup = screen.getByRole("paragraph");
  await expect.element(popup).toBeVisible();
  const header = screen.getByRole("banner").element();
  await expect.poll(() => paintsAbove(popup.element(), header)).toBe(true);
});

test("Tooltip paints above an overlapping sticky page header", async () => {
  const screen = await render(
    <>
      <header
        className="bg-background"
        style={{ position: "sticky", top: 0, zIndex: 50, height: 240 }}
      >
        Page header
      </header>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Show hint</TooltipTrigger>
          <TooltipContent side="top">
            <p>Helpful hint</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>,
  );
  await screen.getByRole("button", { name: "Show hint" }).hover();
  const popup = screen.getByRole("paragraph");
  await expect.element(popup).toBeVisible();
  const header = screen.getByRole("banner").element();
  await expect.poll(() => paintsAbove(popup.element(), header)).toBe(true);
});

test("Select paints above an overlapping sticky page header", async () => {
  const screen = await render(
    <>
      <header
        className="bg-background"
        style={{ position: "sticky", top: 0, zIndex: 50, height: 240 }}
      >
        Page header
      </header>
      <Select modal={false}>
        <SelectTrigger aria-label="Choose fruit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent side="top" alignItemWithTrigger={false}>
          <SelectGroup>
            <SelectItem value="apple">Apple</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </>,
  );
  await screen.getByRole("combobox", { name: "Choose fruit" }).click();
  const popup = screen.getByRole("listbox");
  await expect.element(popup).toBeVisible();
  const header = screen.getByRole("banner").element();
  await expect.poll(() => paintsAbove(popup.element(), header)).toBe(true);
});

test("Popover paints above an overlapping sticky page header", async () => {
  const screen = await render(
    <>
      <header
        className="bg-background"
        style={{ position: "sticky", top: 0, zIndex: 50, height: 240 }}
      >
        Page header
      </header>
      <Popover>
        <PopoverTrigger>Open details</PopoverTrigger>
        <PopoverContent side="top" align="start">
          <PopoverTitle>Details</PopoverTitle>
          <button type="button">Edit details</button>
        </PopoverContent>
      </Popover>
    </>,
  );

  await screen.getByRole("button", { name: "Open details" }).click();
  const popup = screen.getByRole("dialog", { name: "Details" });
  await expect.element(popup).toBeVisible();
  const header = screen.getByRole("banner").element();
  await expect.poll(() => paintsAbove(popup.element(), header)).toBe(true);
});

test("Dropdown Menu paints above an overlapping sticky page header", async () => {
  const screen = await render(
    <>
      <header
        className="bg-background"
        style={{ position: "sticky", top: 0, zIndex: 50, height: 240 }}
      >
        Page header
      </header>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger>Open actions</DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start">
          <DropdownMenuGroup>
            <DropdownMenuItem>Edit details</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>,
  );
  await screen.getByRole("button", { name: "Open actions" }).click();
  const popup = screen.getByRole("menu");
  await expect.element(popup).toBeVisible();
  const header = screen.getByRole("banner").element();
  await expect.poll(() => paintsAbove(popup.element(), header)).toBe(true);
});

function paintsAbove(surface: Element, underlay: Element): boolean {
  const bounds = surface.getBoundingClientRect();
  const underlayBounds = underlay.getBoundingClientRect();
  const left = Math.max(bounds.left, underlayBounds.left);
  const right = Math.min(bounds.right, underlayBounds.right);
  const top = Math.max(bounds.top, underlayBounds.top);
  const bottom = Math.min(bounds.bottom, underlayBounds.bottom);
  expect(right - left).toBeGreaterThan(0);
  expect(bottom - top).toBeGreaterThan(0);
  return surface.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
}
