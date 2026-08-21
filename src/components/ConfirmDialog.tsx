"use client";

import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Z_OVERLAY } from "@/lib/zLayers";

// Sdílený potvrzovací modál. Nahrazuje ručně kopírované backdrop+karta shelly
// (audit #3/#34/#48/#64). Barvy přes tokeny, z-index z kanonické škály
// (Z_OVERLAY.modal), zavření přes Esc i klik mimo, fokus na potvrzovací tlačítko.
// Tlačítka jsou sdílené ui/Button. Extra doménový obsah (např. důvod zamítnutí
// rezervace) se předává jako `children` mezi zprávu a tlačítka.

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** true = destruktivní akce (červené potvrzení). */
  danger?: boolean;
  width?: number;
  /** false, když si fokus po otevření bere vlastní obsah (input v children). */
  autoFocusConfirm?: boolean;
  /**
   * true = fokus po otevření dostane „Zrušit" (destruktivní/kaskádová akce, Enter
   * má padnout na bezpečnou volbu). ZÁMĚRNĚ samostatný prop, NE odvozený od
   * `!autoFocusConfirm` — `autoFocusConfirm={false}` dnes používají i dialogy,
   * jejichž `children` má VLASTNÍ `autoFocus` prvek (input na důvod zamítnutí u
   * mazání rezervace, tlačítko „Jen tento blok" u překlopení rozdělené rezervace).
   * Odvození by jim to přebilo — `children` se renderuje PŘED tlačítky, takže by
   * poslední namountovaný `autoFocus` (Zrušit) vyhrál nad jejich vlastním. Kdo
   * chce fokus na Zrušit, musí si o něj řeknout EXPLICITNĚ (dnes jen kaskádový
   * dialog v `PlannerPage.tsx`). Default `false` = beze změny pro všechny ostatní.
   */
  autoFocusCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Potvrdit",
  cancelLabel = "Zrušit",
  danger = false,
  width = 300,
  autoFocusConfirm = true,
  autoFocusCancel = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  // Esc zavírá dialog. Listener žije jen po dobu otevření.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: Z_OVERLAY.modal,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(4px)",
      }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--popover)", borderRadius: 16, padding: "24px 28px",
          width, border: "1px solid var(--border)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05) inset",
        }}
      >
        <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", textAlign: "center", marginBottom: 6 }}>
          {title}
        </p>
        {message != null && (
          <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", marginBottom: children ? 14 : 20 }}>
            {message}
          </p>
        )}
        {children}
        <div style={{ display: "flex", gap: 10 }}>
          <Button
            variant={danger ? "destructive" : "default"}
            size="sm"
            className="flex-1 text-xs h-9"
            autoFocus={autoFocusConfirm}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs h-9 border-slate-600 text-slate-300"
            autoFocus={autoFocusCancel}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
