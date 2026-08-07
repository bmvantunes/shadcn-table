export function getMenubarContentSide<TSide>(
  orientation: "horizontal" | "vertical",
  side: TSide | undefined,
): TSide | "bottom" | "inline-end" {
  return side ?? (orientation === "vertical" ? "inline-end" : "bottom");
}
