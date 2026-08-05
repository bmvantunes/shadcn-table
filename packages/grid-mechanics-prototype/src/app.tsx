import * as React from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ColumnsIcon,
  GaugeIcon,
  KeyboardIcon,
  PushPinIcon,
} from "@phosphor-icons/react";
import { Badge } from "@bruno/shadcn/badge";
import { Button } from "@bruno/shadcn/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bruno/shadcn/card";
import { Kbd, KbdGroup } from "@bruno/shadcn/kbd";

import { MechanicsGrid } from "./mechanics-grid";

const VARIANTS = ["A", "B", "C"] as const;
type Variant = (typeof VARIANTS)[number];

function readVariant(): Variant {
  const candidate = new URLSearchParams(window.location.search).get("variant");
  return VARIANTS.includes(candidate as Variant) ? (candidate as Variant) : "A";
}

function isGridKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("[role='grid']") ||
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
}

export function App() {
  const [variant, setVariantState] = React.useState<Variant>(readVariant);

  const setVariant = React.useCallback((next: Variant) => {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(null, "", url);
    setVariantState(next);
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isGridKeyboardTarget(event.target)) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const index = VARIANTS.indexOf(variant);
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const next = VARIANTS[(index + offset + VARIANTS.length) % VARIANTS.length];
      if (next) setVariant(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setVariant, variant]);

  return (
    <main className={`prototype prototype--${variant.toLowerCase()}`}>
      {variant === "A" ? <TradingSurface /> : null}
      {variant === "B" ? <CommandRailSurface /> : null}
      {variant === "C" ? <InspectorSurface /> : null}
      {import.meta.env.DEV ? <VariantSwitcher variant={variant} onChange={setVariant} /> : null}
    </main>
  );
}

function TradingSurface() {
  return (
    <div className="surface surface--trading">
      <header className="trading-header">
        <div>
          <div className="eyebrow">BrunoTable mechanics lab</div>
          <h1>Dense market surface</h1>
        </div>
        <div className="header-badges">
          <Badge variant="outline">v9 stable</Badge>
          <Badge variant="secondary">5,000 × 150</Badge>
          <Badge>React Compiler</Badge>
        </div>
      </header>
      <div className="instruction-strip">
        <KeyboardIcon data-icon="inline-start" />
        Focus the grid and hold an arrow key. Pinned start and end columns remain in one logical
        path.
        <KbdGroup>
          <Kbd>←</Kbd>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          <Kbd>→</Kbd>
        </KbdGroup>
      </div>
      <MechanicsGrid densityLabel="Dense / 28 px" />
    </div>
  );
}

function CommandRailSurface() {
  return (
    <div className="surface surface--command">
      <aside className="command-rail">
        <div>
          <div className="eyebrow">Mechanics lab</div>
          <h1>Navigation command rail</h1>
          <p>Instrumentation stays outside the cell render path.</p>
        </div>
        <div className="rail-facts">
          <Fact icon={<PushPinIcon />} label="Pinning" value="2 start · 1 end" />
          <Fact icon={<ColumnsIcon />} label="Logical order" value="150 columns" />
          <Fact icon={<GaugeIcon />} label="Frame target" value="8.33 ms" />
        </div>
        <div className="rail-note">
          A native scroller owns geometry. The Base UI scroll area can provide chrome later, but not
          a second scroll authority.
        </div>
      </aside>
      <div className="command-grid">
        <div className="command-grid-heading">
          <span>Active execution grid</span>
          <Badge variant="outline">Exact reveal</Badge>
        </div>
        <MechanicsGrid densityLabel="Operational / 28 px" showRail />
      </div>
    </div>
  );
}

function InspectorSurface() {
  return (
    <div className="surface surface--inspector">
      <header className="inspector-header">
        <div>
          <div className="eyebrow">BrunoTable mechanics lab</div>
          <h1>Virtualization inspector</h1>
          <p>
            One bounded render window across a five-thousand by one-hundred-and-fifty data plane.
          </p>
        </div>
        <Badge variant="secondary">Prototype C</Badge>
      </header>
      <div className="inspector-cards">
        <MetricCard
          title="Row window"
          value="~40–60"
          description="Fixed-height rows plus twelve-row overscan."
        />
        <MetricCard
          title="Column window"
          value="~8–14"
          description="Center-only virtual window plus pinned columns."
        />
        <MetricCard
          title="Keyboard reveal"
          value="Minimal"
          description="Geometry delta, never nearest-index guessing."
        />
      </div>
      <MechanicsGrid densityLabel="Inspector / 28 px" />
    </div>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="fact">
      <span className="fact-icon" data-icon="inline-start">
        {icon}
      </span>
      <span>
        <small>{label}</small>
        {value}
      </span>
    </div>
  );
}

function MetricCard({
  description,
  title,
  value,
}: {
  readonly description: string;
  readonly title: string;
  readonly value: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
      <CardContent>{description}</CardContent>
    </Card>
  );
}

function VariantSwitcher({
  onChange,
  variant,
}: {
  readonly onChange: (variant: Variant) => void;
  readonly variant: Variant;
}) {
  const index = VARIANTS.indexOf(variant);
  const previous = VARIANTS[(index - 1 + VARIANTS.length) % VARIANTS.length] ?? "A";
  const next = VARIANTS[(index + 1) % VARIANTS.length] ?? "A";

  return (
    <div className="variant-switcher" aria-label="Prototype variants">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Show variant ${previous}`}
        onClick={() => onChange(previous)}
      >
        <ArrowLeftIcon />
      </Button>
      <span>Variant {variant} of C</span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Show variant ${next}`}
        onClick={() => onChange(next)}
      >
        <ArrowRightIcon />
      </Button>
    </div>
  );
}
