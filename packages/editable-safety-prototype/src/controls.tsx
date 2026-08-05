import { Badge } from "@bruno/shadcn/badge";
import { Button } from "@bruno/shadcn/button";
import { ToggleGroup, ToggleGroupItem } from "@bruno/shadcn/toggle-group";
import {
  ArrowCounterClockwiseIcon,
  BugIcon,
  FloppyDiskIcon,
  KeyboardIcon,
  LightningIcon,
} from "@phosphor-icons/react";

import type { EditableSafetyDemo } from "./demo-model";

export function ModeToggle({ demo }: { readonly demo: EditableSafetyDemo }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Edit mode</span>
      <ToggleGroup
        aria-label="Edit mode"
        variant="outline"
        size="sm"
        spacing={0}
        value={[demo.mode]}
        onValueChange={(value) => {
          const next = value[0];
          if (next === "immediate" || next === "batch") demo.setMode(next);
        }}
      >
        <ToggleGroupItem value="immediate" aria-label="Immediate mode">
          Immediate
        </ToggleGroupItem>
        <ToggleGroupItem value="batch" aria-label="Batch mode">
          Batch
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

export function ScenarioControls({ demo }: { readonly demo: EditableSafetyDemo }) {
  return (
    <section
      className="rounded-xl border border-dashed bg-muted/20 p-3"
      aria-label="Prototype scenarios"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Scenario console</div>
          <div className="text-xs text-muted-foreground">
            Exercise safety states without a backend.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{demo.changes.length} changes</Badge>
          <Badge variant={demo.conflicts.length > 0 ? "destructive" : "outline"}>
            {demo.conflicts.length} conflicts
          </Badge>
          <Badge variant="outline">{demo.pendingCells.size} pending calls</Badge>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={demo.startImmediateSaves}>
          <LightningIcon /> Start 3 immediate saves
        </Button>
        <Button size="sm" variant="outline" onClick={demo.startBatchLock}>
          <FloppyDiskIcon /> Start batch lock
        </Button>
        <Button size="sm" variant="outline" onClick={() => demo.setInvalidEditorOpen(true)}>
          <KeyboardIcon /> Open invalid BigInt editor
        </Button>
        <Button size="sm" variant="outline" onClick={() => demo.showFailure()}>
          <BugIcon /> Simulate HTTP 500
        </Button>
        <Button size="sm" variant="ghost" onClick={demo.resetScenario}>
          <ArrowCounterClockwiseIcon /> Reset scenario
        </Button>
      </div>
    </section>
  );
}
