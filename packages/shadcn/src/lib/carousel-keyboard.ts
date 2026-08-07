export type CarouselKeyboardAction = "previous" | "next";

export function getCarouselKeyboardAction(
  orientation: "horizontal" | "vertical",
  key: string,
  isFocusOwner: boolean,
  defaultPrevented: boolean,
): CarouselKeyboardAction | undefined {
  if (!isFocusOwner || defaultPrevented) {
    return undefined;
  }

  if (
    (orientation === "horizontal" && key === "ArrowLeft") ||
    (orientation === "vertical" && key === "ArrowUp")
  ) {
    return "previous";
  }

  if (
    (orientation === "horizontal" && key === "ArrowRight") ||
    (orientation === "vertical" && key === "ArrowDown")
  ) {
    return "next";
  }

  return undefined;
}
