import type { ReactNode } from "react";

/**
 * A hexagonal panel with a visible edge. Clipped elements can't take a CSS
 * border, so the frame is an outer clipped div in the accent colour with the
 * body inset by a pixel or two on top of it.
 */
export function HexPanel({
  children,
  className = "",
  frameClassName = "bg-brass-600/45",
  bodyClassName = "bg-forest-800",
  inset = 2,
  cut = 22,
}: {
  children: ReactNode;
  className?: string;
  frameClassName?: string;
  bodyClassName?: string;
  inset?: number;
  cut?: number;
}) {
  return (
    <div
      className={`hex-card ${frameClassName} ${className}`}
      style={{ "--hex-cut": `${cut}px` } as React.CSSProperties}
    >
      <div
        className={`hex-card h-full w-full ${bodyClassName}`}
        style={
          {
            "--hex-cut": `${cut - inset}px`,
            margin: inset,
            width: `calc(100% - ${inset * 2}px)`,
            height: `calc(100% - ${inset * 2}px)`,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

/** Small pointy-top hexagon badge, for step markers and position slots. */
export function HexBadge({
  children,
  state = "idle",
  className = "",
}: {
  children: ReactNode;
  state?: "idle" | "active" | "done";
  className?: string;
}) {
  const frame =
    state === "active"
      ? "bg-brass-400"
      : state === "done"
        ? "bg-brass-600/70"
        : "bg-forest-500/50";
  const body =
    state === "active"
      ? "bg-forest-700 text-brass-200"
      : state === "done"
        ? "bg-forest-800 text-brass-300"
        : "bg-forest-900 text-bone-faint";

  return (
    <div className={`hex-tall ${frame} ${className}`}>
      <div
        className={`hex-tall flex h-full w-full items-center justify-center ${body}`}
        style={{ margin: 2, width: "calc(100% - 4px)", height: "calc(100% - 4px)" }}
      >
        {children}
      </div>
    </div>
  );
}
