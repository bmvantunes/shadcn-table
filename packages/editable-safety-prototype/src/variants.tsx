import { Badge } from "@bruno/shadcn/badge";
import { Button } from "@bruno/shadcn/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bruno/shadcn/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bruno/shadcn/tabs";
import {
  ArrowCounterClockwiseIcon,
  FloppyDiskIcon,
  ListChecksIcon,
  ShieldWarningIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";

import { formatCellValue } from "./data";
import type { EditableSafetyDemo } from "./demo-model";
import { CellStateLegend, TradingGrid } from "./grid";
import { ModeToggle } from "./controls";

function SaveButtons({ demo }: { readonly demo: EditableSafetyDemo }) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        disabled={demo.changes.length === 0 || demo.batchSaving}
        onClick={() => demo.setResetOpen(true)}
      >
        <ArrowCounterClockwiseIcon /> Reset
      </Button>
      <Button
        disabled={demo.changes.length === 0 || demo.batchSaving}
        onClick={() => demo.setConflictOpen(true)}
      >
        <FloppyDiskIcon /> Save {demo.changes.length} changes
      </Button>
    </div>
  );
}

function ConflictButton({
  demo,
  className,
}: {
  readonly demo: EditableSafetyDemo;
  readonly className?: string;
}) {
  return (
    <Button
      className={className}
      variant="ghost"
      onClick={() => demo.setConflictOpen(true)}
      disabled={demo.conflicts.length === 0}
    >
      <ShieldWarningIcon className="text-destructive" />
      <span>{demo.conflicts.length} conflicts</span>
    </Button>
  );
}

export function VariantA({ demo }: { readonly demo: EditableSafetyDemo }) {
  return (
    <section className="space-y-3" aria-labelledby="variant-a-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Badge variant="outline">Variant A</Badge>
          <h2 id="variant-a-title" className="mt-1 text-2xl font-semibold tracking-tight">
            Footer safety rail
          </h2>
          <p className="text-sm text-muted-foreground">
            The grid keeps every horizontal pixel. Safety appears only where edits need it.
          </p>
        </div>
        <ModeToggle demo={demo} />
      </div>
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="border-b p-3">
          <CellStateLegend />
        </div>
        <TradingGrid demo={demo} />
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 p-3">
          <ConflictButton demo={demo} />
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {demo.changes.length} unsaved cell changes
            </span>
            <SaveButtons demo={demo} />
          </div>
        </footer>
      </div>
    </section>
  );
}

export function VariantB({ demo }: { readonly demo: EditableSafetyDemo }) {
  return (
    <section aria-labelledby="variant-b-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Badge variant="outline">Variant B</Badge>
          <h2 id="variant-b-title" className="mt-1 text-2xl font-semibold tracking-tight">
            Side ledger
          </h2>
          <p className="text-sm text-muted-foreground">
            Every pending decision remains visible beside the trading surface.
          </p>
        </div>
        <ModeToggle demo={demo} />
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <TradingGrid demo={demo} />
          <CellStateLegend />
        </div>
        <Card className="h-fit xl:sticky xl:top-3">
          <CardHeader>
            <CardTitle>Safety ledger</CardTitle>
            <CardDescription>Live sparse state for this edit session.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Metric value={demo.changes.length} label="Changes" />
              <Metric
                value={demo.conflicts.length}
                label="Conflicts"
                destructive={demo.conflicts.length > 0}
              />
              <Metric value={demo.pendingCells.size} label="Calls" />
            </div>
            <div className="space-y-2">
              {demo.changes.slice(0, 4).map((change) => (
                <div
                  key={`${change.rowId}:${change.field}`}
                  className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm"
                >
                  <span>
                    <strong>{change.symbol}</strong>
                    <br />
                    <small className="text-muted-foreground">{change.columnTitle}</small>
                  </span>
                  <span className="text-right tabular-nums">
                    <small className="block text-muted-foreground line-through">
                      {formatCellValue(change.baseValue)}
                    </small>
                    {formatCellValue(change.value)}
                  </span>
                </div>
              ))}
            </div>
            <ConflictButton demo={demo} className="w-full justify-start" />
            <SaveButtons demo={demo} />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function Metric({
  value,
  label,
  destructive = false,
}: {
  readonly value: number;
  readonly label: string;
  readonly destructive?: boolean;
}) {
  return (
    <div
      className={
        destructive
          ? "rounded-lg bg-destructive/10 p-2 text-destructive"
          : "rounded-lg bg-muted p-2"
      }
    >
      <strong className="block text-lg tabular-nums">{value}</strong>
      <span className="text-[0.65rem] uppercase tracking-wide">{label}</span>
    </div>
  );
}

export function VariantC({ demo }: { readonly demo: EditableSafetyDemo }) {
  return (
    <section className="space-y-3" aria-labelledby="variant-c-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Badge variant="outline">Variant C</Badge>
          <h2 id="variant-c-title" className="mt-1 text-2xl font-semibold tracking-tight">
            Bottom inspector
          </h2>
          <p className="text-sm text-muted-foreground">
            A docked workbench keeps detailed state in context without a permanent side rail.
          </p>
        </div>
        <ModeToggle demo={demo} />
      </div>
      <TradingGrid demo={demo} />
      <Tabs defaultValue="changes" className="rounded-xl border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="changes">
              <ListChecksIcon /> Changes <Badge variant="secondary">{demo.changes.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="conflicts">
              <ShieldWarningIcon /> Conflicts{" "}
              <Badge variant={demo.conflicts.length > 0 ? "destructive" : "secondary"}>
                {demo.conflicts.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="operations">
              <SpinnerGapIcon /> Operations{" "}
              <Badge variant="secondary">{demo.pendingCells.size}</Badge>
            </TabsTrigger>
          </TabsList>
          <SaveButtons demo={demo} />
        </div>
        <TabsContent value="changes" className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {demo.changes.map((change) => (
            <div
              key={`${change.rowId}:${change.field}`}
              className="flex items-center justify-between rounded-lg border p-3 text-sm"
            >
              <span>
                <strong>{change.symbol}</strong>
                <br />
                <small className="text-muted-foreground">{change.columnTitle}</small>
              </span>
              <span className="text-right tabular-nums">
                <small className="block text-muted-foreground">
                  was {formatCellValue(change.baseValue)}
                </small>
                {formatCellValue(change.value)}
              </span>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="conflicts" className="mt-3">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-left"
            onClick={() => demo.setConflictOpen(true)}
          >
            <span>
              <strong>{demo.conflicts.length} conflicts need a decision</strong>
              <small className="block text-muted-foreground">
                Open the guided review before saving.
              </small>
            </span>
            <ShieldWarningIcon className="size-5 text-destructive" />
          </button>
        </TabsContent>
        <TabsContent value="operations" className="mt-3 text-sm text-muted-foreground">
          {demo.batchSaving
            ? "One atomic batch is in flight; editing is locked."
            : demo.pendingCells.size > 0
              ? `${demo.pendingCells.size} independent cell operations are in flight.`
              : "No save operations are currently running."}
        </TabsContent>
      </Tabs>
      <CellStateLegend />
    </section>
  );
}
