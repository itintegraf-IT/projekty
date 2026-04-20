"use client";

import { Fragment, type RefObject } from "react";
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { resolveDayIntervals } from "@/lib/scheduleValidation";
import { utcToPragueDateStr } from "@/lib/dateUtils";
import { DAY_SLOT_COUNT } from "@/lib/timeSlots";
import { fmtHHMM } from "@/lib/shifts";
import type { ShiftType } from "@/lib/shifts";

type ShiftEdge = "start" | "end";

export type ShiftEdgePreview = {
  machine: string;
  date: Date;
  shift: ShiftType;
  edge: ShiftEdge;
  previewMin: number;
};

export type ShiftEdgeDragState = {
  type: "shift-edge-resize";
  machine: string;
  date: Date;
  shift: ShiftType;
  edge: ShiftEdge;
  origMin: number;
  startClientY: number;
  startScrollTop: number;
  jointDrag: boolean;
};

export type ShiftEdgeHandlesProps = {
  machine: string;
  day: { date: Date; dateStr: string; y: number };
  slotHeight: number;
  machineWeekShifts: MachineWeekShiftsRow[];
  preview: ShiftEdgePreview | null;
  // Parent (TimelineGrid) drží RefObject<DragInternalState|null> — širší union.
  // Komponenta do něj zapisuje ShiftEdgeDragState (assignable do širšího typu).
  dragStateRef: RefObject<unknown>;
  dragDidMoveRef: RefObject<boolean>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onReset: (machine: string, ownerDate: Date, shift: ShiftType, edge: ShiftEdge) => void;
};

const HANDLE_STYLE = {
  position: "absolute" as const,
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 36,
  height: 10,
  borderRadius: 5,
  cursor: "ns-resize" as const,
  zIndex: 30,
  boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
  border: "1px solid rgba(0,0,0,0.4)",
};

const SHIFT_COLOR: Record<ShiftType, string> = {
  MORNING: "rgba(251,191,36,0.9)",
  AFTERNOON: "rgba(56,189,248,0.9)",
  NIGHT: "rgba(139,92,246,0.9)",
};

const SHIFT_LABEL: Record<ShiftType, string> = {
  MORNING: "Ranní",
  AFTERNOON: "Odpolední",
  NIGHT: "Noční",
};

export function ShiftEdgeHandles(props: ShiftEdgeHandlesProps) {
  const { machine, day, slotHeight, machineWeekShifts, preview, dragStateRef, dragDidMoveRef, scrollRef, onReset } = props;

  const intervals = resolveDayIntervals(machine, day.dateStr, machineWeekShifts);
  if (intervals.length === 0) return null;

  const activeSlots = new Set<number>();
  for (const iv of intervals) {
    const s = Math.round(iv.startMin / 30);
    const e = Math.round(iv.endMin / 30);
    for (let i = s; i < e; i++) activeSlots.add(i);
  }
  const isSlotBlocked = (slot: number): boolean => {
    if (slot < 0 || slot >= DAY_SLOT_COUNT) return false;
    return !activeSlots.has(slot);
  };

  type HandleInterval = {
    shift: ShiftType; startMin: number; endMin: number;
    emitStart: boolean; emitEnd: boolean;
    ownerDate: Date; ownerDateStr: string;
  };
  const handleIntervals: HandleInterval[] = intervals.map((iv) => {
    if (iv.source === "prev-tail") {
      const prev = new Date(day.date.getTime() - 24 * 60 * 60 * 1000);
      return {
        shift: iv.shift, startMin: iv.startMin, endMin: iv.endMin,
        emitStart: false, emitEnd: true,
        ownerDate: prev, ownerDateStr: utcToPragueDateStr(prev),
      };
    }
    return {
      shift: iv.shift, startMin: iv.startMin, endMin: iv.endMin,
      emitStart: true, emitEnd: iv.shift !== "NIGHT",
      ownerDate: day.date, ownerDateStr: day.dateStr,
    };
  });

  const handles: React.ReactNode[] = [];
  for (const hi of handleIntervals) {
    const shift = hi.shift;
    const sameOwner = preview && preview.machine === machine &&
      preview.shift === shift && utcToPragueDateStr(preview.date) === hi.ownerDateStr;
    const draggingStart = sameOwner && preview!.edge === "start";
    const draggingEnd = sameOwner && preview!.edge === "end";
    const effStartMin = draggingStart ? preview!.previewMin : hi.startMin;
    const effEndMin = draggingEnd ? preview!.previewMin : hi.endMin;
    const effStartSlot = Math.round(effStartMin / 30);
    const effEndSlot = Math.round(effEndMin / 30);
    const emitStart = hi.emitStart && (draggingStart || effStartSlot === 0 || isSlotBlocked(effStartSlot - 1));
    const emitEnd = hi.emitEnd && (draggingEnd || effEndSlot >= DAY_SLOT_COUNT || isSlotBlocked(effEndSlot));
    const startY = day.y + (effStartMin / 30) * slotHeight;
    const endY = day.y + (effEndMin / 30) * slotHeight;
    const color = SHIFT_COLOR[shift];
    const label = SHIFT_LABEL[shift];

    if (emitStart) {
      handles.push(
        <div
          key={`shift-${machine}-${day.dateStr}-${shift}-start-from-${hi.ownerDateStr}`}
          title={`${label} start — táhni pro úpravu, pravý klik = reset`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            (dragStateRef as { current: ShiftEdgeDragState | null }).current = {
              type: "shift-edge-resize", machine, date: hi.ownerDate, shift, edge: "start",
              origMin: hi.startMin, startClientY: e.clientY,
              startScrollTop: scrollRef.current?.scrollTop ?? 0, jointDrag: e.shiftKey,
            };
            (dragDidMoveRef as { current: boolean }).current = false;
          }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onReset(machine, hi.ownerDate, shift, "start"); }}
          style={{ ...HANDLE_STYLE, top: startY, background: color }}
        />,
      );
    }
    if (emitEnd) {
      handles.push(
        <div
          key={`shift-${machine}-${day.dateStr}-${shift}-end-from-${hi.ownerDateStr}`}
          title={`${label} konec — táhni pro úpravu, pravý klik = reset`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            (dragStateRef as { current: ShiftEdgeDragState | null }).current = {
              type: "shift-edge-resize", machine, date: hi.ownerDate, shift, edge: "end",
              origMin: hi.endMin, startClientY: e.clientY,
              startScrollTop: scrollRef.current?.scrollTop ?? 0, jointDrag: e.shiftKey,
            };
            (dragDidMoveRef as { current: boolean }).current = false;
          }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onReset(machine, hi.ownerDate, shift, "end"); }}
          style={{ ...HANDLE_STYLE, top: endY, background: color }}
        />,
      );
    }
    if (sameOwner && ((draggingStart && emitStart) || (draggingEnd && emitEnd))) {
      const previewY = draggingStart ? startY : endY;
      handles.push(
        <div key={`shift-${machine}-${day.dateStr}-${shift}-preview-from-${hi.ownerDateStr}`}
          style={{
            position: "absolute", top: previewY - 10, left: "calc(50% + 22px)",
            padding: "2px 6px", borderRadius: 4, background: "rgba(0,0,0,0.85)",
            color: "#fff", fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums",
            pointerEvents: "none", zIndex: 31, whiteSpace: "nowrap",
            boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
          }}>
          {fmtHHMM(preview!.previewMin)}
        </div>,
      );
    }
  }
  return <Fragment>{handles}</Fragment>;
}
