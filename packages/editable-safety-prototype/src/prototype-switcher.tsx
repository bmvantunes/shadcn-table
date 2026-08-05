import { Button } from "@bruno/shadcn/button";
import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";
import { useEffect } from "react";

import type { PrototypeVariant } from "./reviews";

const variants = ["A", "B", "C"] as const;

export function PrototypeSwitcher({
  variant,
  onChange,
}: {
  readonly variant: PrototypeVariant;
  readonly onChange: (variant: PrototypeVariant) => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const current = variants.indexOf(variant);
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const next = variants[(current + offset + variants.length) % variants.length];
      if (next !== undefined) onChange(next);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onChange, variant]);

  if (import.meta.env.PROD) return null;
  const current = variants.indexOf(variant);
  return (
    <nav
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-foreground px-2 py-1.5 text-background shadow-xl"
      aria-label="Prototype variants"
    >
      <Button
        aria-label="Previous variant"
        size="icon-sm"
        variant="ghost"
        className="text-background hover:bg-background/15 hover:text-background"
        onClick={() => onChange(variants[(current + variants.length - 1) % variants.length] ?? "A")}
      >
        <ArrowLeftIcon />
      </Button>
      <span className="min-w-36 text-center text-xs font-medium">
        Variant {variant} · {current + 1} of 3
      </span>
      <Button
        aria-label="Next variant"
        size="icon-sm"
        variant="ghost"
        className="text-background hover:bg-background/15 hover:text-background"
        onClick={() => onChange(variants[(current + 1) % variants.length] ?? "A")}
      >
        <ArrowRightIcon />
      </Button>
    </nav>
  );
}
