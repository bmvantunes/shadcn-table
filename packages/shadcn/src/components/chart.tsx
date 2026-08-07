"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";
import type { TooltipValueType } from "recharts";

import { cn } from "#lib/utils";

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: "", dark: ".dark" } as const;

const INITIAL_DIMENSION = { width: 320, height: 200 } as const;
const CSS_COLOR_FUNCTIONS = new Set([
  "calc",
  "clamp",
  "color",
  "color-mix",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "light-dark",
  "max",
  "min",
  "oklab",
  "oklch",
  "rgb",
  "rgba",
  "var",
]);
const CSS_CUSTOM_PROPERTY_SUFFIX = /^[A-Za-z0-9_-]+$/u;
const CSS_HEX_COLOR = /^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{1}|[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{2})?)?$/u;
const CSS_NAMED_COLOR = /^[A-Za-z][A-Za-z0-9-]*$/u;
const CSS_COLOR_FUNCTION = /([A-Za-z][A-Za-z0-9-]*)\s*\(/gu;
const CSS_COLOR_CHARACTERS = /^[#%(),./+\-_*0-9A-Za-z \t]+$/u;
const DATA_OR_ARIA_ATTRIBUTE = /^(?:aria|data)-[A-Za-z0-9_.:-]+$/u;
const DOM_EVENT_PROP = /^on[A-Z][A-Za-z0-9]*$/u;
const SAFE_DIV_PROPS = new Set([
  "about",
  "accessKey",
  "autoCapitalize",
  "autoCorrect",
  "autoFocus",
  "autoSave",
  "contentEditable",
  "contextMenu",
  "datatype",
  "dir",
  "draggable",
  "enterKeyHint",
  "exportparts",
  "hidden",
  "id",
  "inlist",
  "inert",
  "inputMode",
  "is",
  "itemID",
  "itemProp",
  "itemRef",
  "itemScope",
  "itemType",
  "lang",
  "nonce",
  "part",
  "popover",
  "popoverTarget",
  "popoverTargetAction",
  "prefix",
  "property",
  "radioGroup",
  "ref",
  "rel",
  "resource",
  "results",
  "rev",
  "role",
  "security",
  "slot",
  "spellCheck",
  "style",
  "suppressContentEditableWarning",
  "suppressHydrationWarning",
  "tabIndex",
  "title",
  "translate",
  "typeof",
  "unselectable",
  "vocab",
]);
type TooltipNameType = number | string;
type ChartContentDomProps = Omit<
  React.ComponentProps<"div">,
  "children" | "dangerouslySetInnerHTML"
>;

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  )
>;

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }

  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  initialDimension = INITIAL_DIMENSION,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
  initialDimension?: {
    width: number;
    height: number;
  };
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(([, config]) => config.theme ?? config.color);

  if (!colorConfig.length) {
    return null;
  }

  const stylesheet = Object.entries(THEMES)
    .map(
      ([theme, prefix]) => `
${prefix} [data-chart="${escapeCssString(id)}"] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color = itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ?? itemConfig.color;
    return isSafeCssCustomPropertySuffix(key) && isSafeCssColor(color)
      ? `  --color-${key}: ${color.trim()};`
      : null;
  })
  .join("\n")}
}
`,
    )
    .join("\n");

  return <style dangerouslySetInnerHTML={{ __html: escapeStyleElementText(stylesheet) }} />;
};

const ChartTooltip = RechartsPrimitive.Tooltip;

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
  ...props
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
  ChartContentDomProps & {
    hideLabel?: boolean;
    hideIndicator?: boolean;
    indicator?: "line" | "dot" | "dashed";
    nameKey?: string;
    labelKey?: string;
  } & Omit<
    RechartsPrimitive.DefaultTooltipContentProps<TooltipValueType, TooltipNameType>,
    "accessibilityLayer"
  >) {
  const { config } = useChart();

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) {
      return null;
    }

    const [item] = payload;
    const key = getPayloadKey(labelKey ?? item?.dataKey ?? item?.name);
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value = !labelKey
      ? typeof label === "string"
        ? (config[label]?.label ?? label)
        : (label ?? itemConfig?.label)
      : (itemConfig?.label ?? label);

    if (labelFormatter) {
      return (
        <div className={cn("font-medium", labelClassName)}>{labelFormatter(value, payload)}</div>
      );
    }

    if (value === undefined || value === null || value === false || value === "") {
      return null;
    }

    return <div className={cn("font-medium", labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !payload?.length) {
    return null;
  }

  const nestLabel = payload.length === 1 && indicator !== "dot";

  return (
    <div
      {...getSafeDivProps(props, true)}
      className={cn(
        "grid min-w-32 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs/relaxed shadow-xl",
        className,
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.type !== "none")
          .map((item, index) => {
            const key = getPayloadKey(nameKey ?? item.name ?? item.dataKey);
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor = color ?? item.payload?.fill ?? item.color;

            return (
              <div
                key={index}
                className={cn(
                  "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
                  indicator === "dot" && "items-center",
                )}
              >
                {formatter && item.value !== undefined ? (
                  formatter(item.value, item.name, item, index, payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn(
                            "shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)",
                            {
                              "h-2.5 w-2.5": indicator === "dot",
                              "w-1": indicator === "line",
                              "w-0 border-[1.5px] border-dashed bg-transparent":
                                indicator === "dashed",
                              "my-0.5": nestLabel && indicator === "dashed",
                            },
                          )}
                          style={
                            {
                              "--color-bg": indicatorColor,
                              "--color-border": indicatorColor,
                            } as React.CSSProperties
                          }
                        />
                      )
                    )}
                    <div
                      className={cn(
                        "flex flex-1 justify-between leading-none",
                        nestLabel ? "items-end" : "items-center",
                      )}
                    >
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-muted-foreground">
                          {itemConfig?.label ?? item.name}
                        </span>
                      </div>
                      {item.value != null && (
                        <span className="font-mono font-medium text-foreground tabular-nums">
                          {typeof item.value === "number"
                            ? item.value.toLocaleString()
                            : String(item.value)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

const ChartLegend = RechartsPrimitive.Legend;

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = "bottom",
  nameKey,
  ...props
}: ChartContentDomProps & {
  hideIcon?: boolean;
  nameKey?: string;
} & RechartsPrimitive.DefaultLegendContentProps) {
  const { config } = useChart();

  if (!payload?.length) {
    return null;
  }

  return (
    <div
      {...getSafeDivProps(props, false)}
      className={cn(
        "flex items-center justify-center gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        className,
      )}
    >
      {payload
        .filter((item) => item.type !== "none")
        .map((item, index) => {
          const key = getPayloadKey(nameKey ?? item.dataKey);
          const itemConfig = getPayloadConfigFromPayload(config, item, key);

          return (
            <div
              key={index}
              className={cn(
                "flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground",
              )}
            >
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: item.color,
                  }}
                />
              )}
              {itemConfig?.label ?? item.value}
            </div>
          );
        })}
    </div>
  );
}

function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const payloadPayload =
    "payload" in payload && typeof payload.payload === "object" && payload.payload !== null
      ? payload.payload
      : undefined;

  let configLabelKey: string = key;

  if (key in payload && typeof payload[key as keyof typeof payload] === "string") {
    configLabelKey = payload[key as keyof typeof payload] as string;
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
  ) {
    configLabelKey = payloadPayload[key as keyof typeof payloadPayload] as string;
  }

  return configLabelKey in config ? config[configLabelKey] : config[key];
}

function getPayloadKey(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "value";
}

function escapeCssString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\a ")
    .replaceAll("\r", "\\d ")
    .replaceAll("\f", "\\c ");
}

function escapeStyleElementText(value: string): string {
  return value.replaceAll("<", "\\3c ");
}

function isSafeCssCustomPropertySuffix(value: string): boolean {
  return CSS_CUSTOM_PROPERTY_SUFFIX.test(value);
}

function isSafeCssColor(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  const color = value.trim();

  if (!color || color.length > 512) {
    return false;
  }

  if (CSS_HEX_COLOR.test(color) || CSS_NAMED_COLOR.test(color)) {
    return true;
  }

  if (
    !CSS_COLOR_CHARACTERS.test(color) ||
    color.includes("/*") ||
    color.includes("*/") ||
    !hasBalancedParentheses(color)
  ) {
    return false;
  }

  const functions = color.matchAll(CSS_COLOR_FUNCTION);
  let functionCount = 0;

  for (const match of functions) {
    functionCount += 1;
    if (!CSS_COLOR_FUNCTIONS.has(match[1]?.toLowerCase() ?? "")) {
      return false;
    }
  }

  return functionCount > 0;
}

function hasBalancedParentheses(value: string): boolean {
  let depth = 0;

  for (const character of value) {
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }

  return depth === 0;
}

function getSafeDivProps(props: object, allowDomEvents: boolean): ChartContentDomProps {
  const safeProps: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    // Recharts Legend `on*` callbacks receive (entry, index, event), so they
    // cannot be attached to the root div as ordinary one-argument DOM events.
    if (
      SAFE_DIV_PROPS.has(key) ||
      DATA_OR_ARIA_ATTRIBUTE.test(key) ||
      (allowDomEvents && DOM_EVENT_PROP.test(key))
    ) {
      safeProps[key] = value;
    }
  }

  return safeProps as ChartContentDomProps;
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
};
