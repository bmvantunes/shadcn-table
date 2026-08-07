// @vitest-environment jsdom

import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalendarDay } from "react-day-picker";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("reviewed component interactions", () => {
  test("gives the Carousel region a named focus owner and handles only its own arrows", () => {
    render(
      <Carousel>
        <button type="button">Nested control</button>
      </Carousel>,
    );

    const carousel = screen.getByRole("region", { name: "Carousel" });
    const nestedControl = screen.getByRole("button", { name: "Nested control" });

    expect(carousel).toHaveProperty("tabIndex", 0);
    fireEvent.keyDown(carousel, { key: "ArrowRight" });
    expect(carouselApi.scrollNext).toHaveBeenCalledOnce();

    fireEvent.keyDown(nestedControl, { key: "ArrowRight" });
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

    render(<AlertDialogHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });

  test("moves DOM focus to a Calendar day when it becomes focused", async () => {
    const date = new Date(2026, 7, 7);
    const day = new CalendarDay(date, date);

    const { rerender } = render(<CalendarDayButton day={day} modifiers={{}} />);
    const dayButton = screen.getByRole("button");
    expect(dayButton).not.toBe(document.activeElement);

    rerender(<CalendarDayButton day={day} modifiers={{ focused: true }} />);

    await waitFor(() => {
      expect(dayButton).toBe(document.activeElement);
    });
  });

  test.each([
    ["input", <InputGroupInput key="input" aria-label="Price" />],
    ["textarea", <InputGroupTextarea key="textarea" aria-label="Notes" />],
  ])("focuses the %s control when an Input Group addon is clicked", (_name, control) => {
    render(
      <InputGroup>
        <InputGroupAddon>Prefix</InputGroupAddon>
        {control}
      </InputGroup>,
    );

    fireEvent.click(screen.getByText("Prefix"));
    expect(screen.getByRole("textbox")).toBe(document.activeElement);
  });

  test("honours a consumer-cancelled Input Group addon click", () => {
    render(
      <InputGroup>
        <InputGroupAddon onClick={(event) => event.preventDefault()}>Prefix</InputGroupAddon>
        <InputGroupInput aria-label="Price" />
      </InputGroup>,
    );

    fireEvent.click(screen.getByText("Prefix"));
    expect(screen.getByRole("textbox")).not.toBe(document.activeElement);
  });
});
