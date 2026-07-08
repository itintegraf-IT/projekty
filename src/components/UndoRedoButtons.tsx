"use client";

type Props = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Skrýt pro role bez edit práv (parita s undo = mění data). */
  canEdit: boolean;
};

const baseStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  color: "var(--text-muted)",
  cursor: "pointer",
  transition: "all 120ms ease-out",
  padding: 0,
};

const disabledStyle: React.CSSProperties = {
  opacity: 0.4,
  cursor: "not-allowed",
};

export function UndoRedoButtons({ canUndo, canRedo, onUndo, onRedo, canEdit }: Props) {
  if (!canEdit) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }} role="group" aria-label="Historie změn">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Zpět (Ctrl+Z)"
        aria-label="Zpět"
        style={{ ...baseStyle, ...(canUndo ? null : disabledStyle) }}
      >↶</button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Vpřed (Ctrl+Y)"
        aria-label="Vpřed"
        style={{ ...baseStyle, ...(canRedo ? null : disabledStyle) }}
      >↷</button>
    </div>
  );
}
