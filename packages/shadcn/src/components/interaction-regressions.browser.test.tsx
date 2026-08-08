import * as React from "react";
import { CalendarDay } from "react-day-picker";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { cleanup, render } from "vitest-browser-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./alert-dialog";
import { CalendarDayButton } from "./calendar";
import { Carousel } from "./carousel";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupTextarea } from "./input-group";

const carouselApi = vi.hoisted(() => ({
  canScrollNext: vi.fn(() => true),
  canScrollPrev: vi.fn(() => true),
  off: vi.fn(),
  on: vi.fn(),
  scrollNext: vi.fn(),
  scrollPrev: vi.fn(),
}));

vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), carouselApi],
}));

afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
});

describe("reviewed component interactions", () => {
  test("gives the Carousel region a named focus owner and handles only its own arrows", async () => {
    const screen = await render(
      <Carousel>
        <button type="button">Nested control</button>
      </Carousel>,
    );

    const carousel = screen.getByRole("region", { name: "Carousel" });
    const nestedControl = screen.getByRole("button", { name: "Nested control" });

    await expect.element(carousel).toHaveAttribute("tabindex", "0");
    await carousel.click();
    await userEvent.keyboard("{ArrowRight}");
    expect(carouselApi.scrollNext).toHaveBeenCalledOnce();

    await nestedControl.click();
    await userEvent.keyboard("{ArrowRight}");
    expect(carouselApi.scrollNext).toHaveBeenCalledOnce();
  });

  test("closes an Alert Dialog when its action is activated", async () => {
    function AlertDialogHarness() {
      const [open, setOpen] = React.useState(true);

      return (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent>
            <AlertDialogTitle>Confirm order</AlertDialogTitle>
            <AlertDialogDescription>Submit the order?</AlertDialogDescription>
            <AlertDialogAction>Submit</AlertDialogAction>
          </AlertDialogContent>
        </AlertDialog>
      );
    }

    const screen = await render(<AlertDialogHarness />);
    await screen.getByRole("button", { name: "Submit" }).click();

    await expect.element(screen.getByRole("alertdialog")).not.toBeInTheDocument();
  });

  test("moves DOM focus to a Calendar day when it becomes focused", async () => {
    const date = new Date(2026, 7, 7);
    const day = new CalendarDay(date, date);

    const screen = await render(<CalendarDayButton day={day} modifiers={{}} />);
    const dayButton = screen.getByRole("button");
    await expect.element(dayButton).not.toHaveFocus();

    await screen.rerender(<CalendarDayButton day={day} modifiers={{ focused: true }} />);

    await expect.element(dayButton).toHaveFocus();
  });

  test.each([
    ["input", <InputGroupInput key="input" aria-label="Price" />],
    ["textarea", <InputGroupTextarea key="textarea" aria-label="Notes" />],
  ])("focuses the %s control when an Input Group addon is clicked", async (_name, control) => {
    const screen = await render(
      <InputGroup>
        <InputGroupAddon aria-label="Prefix">Prefix</InputGroupAddon>
        {control}
      </InputGroup>,
    );

    await screen.getByRole("group", { name: "Prefix" }).click();
    await expect.element(screen.getByRole("textbox")).toHaveFocus();
  });

  test("honours a consumer-cancelled Input Group addon click", async () => {
    const screen = await render(
      <InputGroup>
        <InputGroupAddon aria-label="Prefix" onClick={(event) => event.preventDefault()}>
          Prefix
        </InputGroupAddon>
        <InputGroupInput aria-label="Price" />
      </InputGroup>,
    );

    await screen.getByRole("group", { name: "Prefix" }).click();
    await expect.element(screen.getByRole("textbox")).not.toHaveFocus();
  });
});
