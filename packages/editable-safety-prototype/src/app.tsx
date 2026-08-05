// Three complete layouts share one safety model and are switchable through ?variant=A|B|C.
import { Toaster } from "@bruno/shadcn/toast";
import { useCallback, useState } from "react";

import { ScenarioControls } from "./controls";
import { useEditableSafetyDemo } from "./demo-model";
import { PrototypeSwitcher } from "./prototype-switcher";
import { ConflictReviewDialog, ResetChangesDialog, type PrototypeVariant } from "./reviews";
import { VariantA, VariantB, VariantC } from "./variants";

function readVariant(): PrototypeVariant {
  const value = new URLSearchParams(window.location.search).get("variant");
  return value === "B" || value === "C" ? value : "A";
}

export function App() {
  const [variant, setVariant] = useState(readVariant);
  const demo = useEditableSafetyDemo();

  const changeVariant = useCallback((next: PrototypeVariant) => {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState({}, "", url);
    setVariant(next);
  }, []);

  return (
    <Toaster>
      <main className="mx-auto min-h-screen max-w-[118rem] space-y-5 bg-background px-4 py-6 pb-24 text-foreground sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              BrunoTable interaction lab
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Editable trading grid safety
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Compare how changes, concurrent saves, validation, batch locks, live conflicts, and
              failures should feel before production architecture makes them cheap.
            </p>
          </div>
          <div className="rounded-lg border bg-card px-3 py-2 text-right shadow-sm">
            <span className="block text-xs text-muted-foreground">Active branch</span>
            <code className="text-xs">prototype/editable-safety-ui</code>
          </div>
        </header>
        <ScenarioControls demo={demo} />
        {variant === "A" ? (
          <VariantA demo={demo} />
        ) : variant === "B" ? (
          <VariantB demo={demo} />
        ) : (
          <VariantC demo={demo} />
        )}
      </main>
      <ConflictReviewDialog demo={demo} variant={variant} />
      <ResetChangesDialog demo={demo} />
      <PrototypeSwitcher variant={variant} onChange={changeVariant} />
    </Toaster>
  );
}
