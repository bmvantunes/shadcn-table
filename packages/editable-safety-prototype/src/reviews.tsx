import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@bruno/shadcn/alert-dialog";
import { Badge } from "@bruno/shadcn/badge";
import { Button } from "@bruno/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bruno/shadcn/dialog";
import { Spinner } from "@bruno/shadcn/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@bruno/shadcn/table";
import { ToggleGroup, ToggleGroupItem } from "@bruno/shadcn/toggle-group";
import { ArrowsLeftRightIcon, ShieldWarningIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { formatCellValue, type BrunoTableConflict } from "./data";
import type { EditableSafetyDemo } from "./demo-model";

export type PrototypeVariant = "A" | "B" | "C";

function DecisionToggle({
  conflict,
  demo,
}: {
  readonly conflict: BrunoTableConflict;
  readonly demo: EditableSafetyDemo;
}) {
  const selected = demo.resolutions[conflict.rowId];
  return (
    <ToggleGroup
      aria-label={`Resolution for ${conflict.symbol} ${conflict.columnTitle}`}
      variant="outline"
      size="sm"
      spacing={0}
      value={selected === undefined ? [] : [selected]}
      onValueChange={(value) => {
        const decision = value[0];
        if (decision === "mine" || decision === "theirs")
          demo.resolveConflict(conflict.rowId, decision);
      }}
    >
      <ToggleGroupItem value="mine">Mine</ToggleGroupItem>
      <ToggleGroupItem value="theirs">Theirs</ToggleGroupItem>
    </ToggleGroup>
  );
}

function ConflictTable({ demo }: { readonly demo: EditableSafetyDemo }) {
  return (
    <div className="overflow-auto rounded-lg border">
      <Table className="min-w-[860px]">
        <TableHeader>
          <TableRow>
            <TableHead>Row</TableHead>
            <TableHead>Column</TableHead>
            <TableHead className="text-right">Base</TableHead>
            <TableHead className="text-right">Server now</TableHead>
            <TableHead className="text-right">Yours</TableHead>
            <TableHead className="sticky right-0 bg-background">Decision</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {demo.conflicts.map((conflict) => (
            <TableRow key={conflict.rowId}>
              <TableCell>
                <span className="font-semibold">{conflict.symbol}</span>
                <br />
                <span className="font-mono text-xs text-muted-foreground">{conflict.rowId}</span>
              </TableCell>
              <TableCell>{conflict.columnTitle}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatCellValue(conflict.baseValue)}
              </TableCell>
              <TableCell className="bg-destructive/5 text-right font-semibold tabular-nums text-destructive">
                {formatCellValue(conflict.serverValue)}
              </TableCell>
              <TableCell className="bg-muted/60 text-right font-semibold tabular-nums">
                {formatCellValue(conflict.value)}
              </TableCell>
              <TableCell className="sticky right-0 bg-background">
                <DecisionToggle conflict={conflict} demo={demo} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ConflictCards({ demo }: { readonly demo: EditableSafetyDemo }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {demo.conflicts.map((conflict) => (
        <article key={conflict.rowId} className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">
                {conflict.symbol} · {conflict.columnTitle}
              </h3>
              <p className="font-mono text-xs text-muted-foreground">{conflict.rowId}</p>
            </div>
            <Badge variant="destructive">Conflict</Badge>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <span className="text-xs text-muted-foreground">Server now</span>
              <strong className="mt-1 block text-lg tabular-nums">
                {formatCellValue(conflict.serverValue)}
              </strong>
            </div>
            <ArrowsLeftRightIcon className="mt-5 size-4 text-muted-foreground" />
            <div className="rounded-lg border bg-muted/50 p-3">
              <span className="text-xs text-muted-foreground">Your edit</span>
              <strong className="mt-1 block text-lg tabular-nums">
                {formatCellValue(conflict.value)}
              </strong>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              Started at {formatCellValue(conflict.baseValue)}
            </span>
            <DecisionToggle conflict={conflict} demo={demo} />
          </div>
        </article>
      ))}
    </div>
  );
}

function GuidedConflictReview({ demo }: { readonly demo: EditableSafetyDemo }) {
  const [index, setIndex] = useState(0);
  const conflict = demo.conflicts[Math.min(index, demo.conflicts.length - 1)];
  if (conflict === undefined) return null;
  return (
    <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
      <nav className="flex gap-2 overflow-auto md:flex-col" aria-label="Conflicts">
        {demo.conflicts.map((candidate, candidateIndex) => (
          <Button
            key={candidate.rowId}
            variant={candidateIndex === index ? "secondary" : "ghost"}
            className="justify-between"
            onClick={() => setIndex(candidateIndex)}
          >
            {candidate.symbol}
            <Badge
              variant={demo.resolutions[candidate.rowId] === undefined ? "destructive" : "outline"}
            >
              {candidateIndex + 1}
            </Badge>
          </Button>
        ))}
      </nav>
      <article className="rounded-xl border bg-card p-5">
        <Badge variant="destructive">
          Conflict {index + 1} of {demo.conflicts.length}
        </Badge>
        <h3 className="mt-3 text-xl font-semibold">
          {conflict.symbol} · {conflict.columnTitle}
        </h3>
        <p className="font-mono text-xs text-muted-foreground">{conflict.rowId}</p>
        <div className="my-5 grid gap-3 sm:grid-cols-3">
          <ValueTile label="Started from" value={conflict.baseValue} />
          <ValueTile label="Server now" value={conflict.serverValue} destructive />
          <ValueTile label="Your edit" value={conflict.value} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium">Which value should be saved?</span>
          <DecisionToggle conflict={conflict} demo={demo} />
        </div>
      </article>
    </div>
  );
}

function ValueTile({
  label,
  value,
  destructive = false,
}: {
  readonly label: string;
  readonly value: bigint | number | string;
  readonly destructive?: boolean;
}) {
  return (
    <div
      className={
        destructive
          ? "rounded-lg border border-destructive/30 bg-destructive/5 p-3"
          : "rounded-lg border bg-muted/40 p-3"
      }
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className="mt-1 block text-lg tabular-nums">{formatCellValue(value)}</strong>
    </div>
  );
}

export function ConflictReviewDialog({
  demo,
  variant,
}: {
  readonly demo: EditableSafetyDemo;
  readonly variant: PrototypeVariant;
}) {
  return (
    <Dialog open={demo.conflictOpen} onOpenChange={demo.setConflictOpen}>
      <DialogContent
        className="max-h-[88vh] overflow-auto sm:max-w-5xl"
        showCloseButton={!demo.conflictSaving}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldWarningIcon className="size-4 text-destructive" />
            Resolve live-data conflicts
          </DialogTitle>
          <DialogDescription>
            The server changed these cells after your edit. Choose Mine or Theirs for every row. A
            failed save keeps this review open and preserves every decision.
          </DialogDescription>
        </DialogHeader>
        {variant === "A" ? (
          <ConflictTable demo={demo} />
        ) : variant === "B" ? (
          <ConflictCards demo={demo} />
        ) : (
          <GuidedConflictReview demo={demo} />
        )}
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {demo.unresolvedCount === 0
              ? "All conflicts resolved"
              : `${demo.unresolvedCount} decisions remaining`}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={demo.conflictSaving}
              onClick={() => demo.setConflictOpen(false)}
            >
              Keep editing
            </Button>
            <Button
              disabled={demo.unresolvedCount > 0 || demo.conflictSaving}
              onClick={demo.saveConflictResolutions}
            >
              {demo.conflictSaving ? <Spinner /> : null} Save {demo.changes.length} changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ResetChangesDialog({ demo }: { readonly demo: EditableSafetyDemo }) {
  return (
    <AlertDialog open={demo.resetOpen} onOpenChange={demo.setResetOpen}>
      <AlertDialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <TrashIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Reset all unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            These are the values that will be discarded. This does not delete rows or change the
            server.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cell</TableHead>
                <TableHead className="text-right">Started from</TableHead>
                <TableHead className="text-right">Your value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {demo.changes.map((change) => (
                <TableRow key={`${change.rowId}:${change.field}`}>
                  <TableCell>
                    <strong>{change.symbol}</strong>
                    <br />
                    <span className="text-xs text-muted-foreground">{change.columnTitle}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCellValue(change.baseValue)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatCellValue(change.value)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={demo.resetAllChanges}>
            Reset all changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
