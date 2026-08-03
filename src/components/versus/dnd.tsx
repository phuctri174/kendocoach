"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Hand-rolled drag-and-drop, Pointer Events only (no library) — this covers
 * mouse, touch, and pen with one code path, which native HTML5 `draggable`
 * does not (no touch support). Shared by every drag-a-card-onto-a-target
 * interaction in versus mode: LineupBoard (player onto position) and
 * ItemBoard (item onto player).
 *
 * Hit-testing is `elementFromPoint` + `closest('[data-dnd-zone]')` on every
 * pointermove, which is why the floating drag preview is `pointer-events:
 * none` — otherwise it would shadow the real drop zones underneath it.
 */

interface DragPayload {
  id: string;
  label: string;
}

interface DndApi {
  dragging: (DragPayload & { x: number; y: number }) | null;
  hoverZoneId: string | null;
  beginDrag: (payload: DragPayload, x: number, y: number) => void;
}

const DndCtx = createContext<DndApi | null>(null);

function useDndCtx(): DndApi {
  const ctx = useContext(DndCtx);
  if (!ctx) throw new Error("DraggableCard/DropZone must be used inside a <DndBoard>");
  return ctx;
}

export function DndBoard({
  children,
  onDrop,
  disabled = false,
}: {
  children: ReactNode;
  /** Fired once, on pointer-up, only when the release lands over a drop zone. */
  onDrop: (draggedId: string, zoneId: string) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState<(DragPayload & { x: number; y: number }) | null>(null);
  const [hoverZoneId, setHoverZoneId] = useState<string | null>(null);
  const draggingRef = useRef<DragPayload | null>(null);
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  const zoneAt = (x: number, y: number) =>
    document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-dnd-zone]")?.dataset.dndZone ?? null;

  const beginDrag = useCallback(
    (payload: DragPayload, x: number, y: number) => {
      if (disabled) return;
      draggingRef.current = payload;
      setDragging({ ...payload, x, y });
      setHoverZoneId(zoneAt(x, y));

      const onMove = (e: PointerEvent) => {
        setDragging((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
        setHoverZoneId(zoneAt(e.clientX, e.clientY));
      };
      const onUp = (e: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        const zoneId = zoneAt(e.clientX, e.clientY);
        const dragged = draggingRef.current;
        draggingRef.current = null;
        setDragging(null);
        setHoverZoneId(null);
        if (dragged && zoneId) onDropRef.current(dragged.id, zoneId);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [disabled],
  );

  return (
    <DndCtx.Provider value={{ dragging, hoverZoneId, beginDrag }}>
      {children}
      {dragging && (
        <div
          className="hex-tab pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 bg-brass-300 px-3 py-2 text-xs text-forest-900 shadow-lg"
          style={{ left: dragging.x, top: dragging.y }}
        >
          {dragging.label}
        </div>
      )}
    </DndCtx.Provider>
  );
}

export function DraggableCard({
  id,
  label,
  disabled = false,
  className = "",
  children,
}: {
  id: string;
  label: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { dragging, beginDrag } = useDndCtx();
  const isDragging = dragging?.id === id;
  return (
    <div
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        beginDrag({ id, label }, e.clientX, e.clientY);
      }}
      className={`touch-none select-none ${isDragging ? "opacity-40" : ""} ${
        disabled ? "" : "cursor-grab active:cursor-grabbing"
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function DropZone({
  id,
  className = "",
  activeClassName = "",
  children,
}: {
  id: string;
  className?: string;
  activeClassName?: string;
  children: ReactNode;
}) {
  const { hoverZoneId, dragging } = useDndCtx();
  const isActive = !!dragging && hoverZoneId === id;
  return (
    <div data-dnd-zone={id} className={`${className} ${isActive ? activeClassName : ""}`}>
      {children}
    </div>
  );
}
