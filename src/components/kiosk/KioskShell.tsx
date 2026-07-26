"use client";

import { useEffect, useState } from "react";

type View = "plan" | "data";

type Props = {
  machine: string | null;
  planUrl: string;
  logicaUrl: string | null;
  defaultView?: View;
};

export function KioskShell({ machine, planUrl, logicaUrl, defaultView = "data" }: Props) {
  const [view, setView] = useState<View>(logicaUrl ? defaultView : "plan");
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
      );
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  const tabBtn = (v: View, label: string) => {
    const active = view === v;
    return (
      <button
        role="tab"
        aria-selected={active}
        onClick={(e) => {
          if (e.button !== 0) return;
          setView(v);
        }}
        style={{
          appearance: "none",
          border: 0,
          font: "inherit",
          fontSize: 18,
          fontWeight: 600,
          padding: "14px 32px",
          borderRadius: 10,
          cursor: "pointer",
          color: active ? "var(--brand-contrast)" : "var(--text)",
          background: active ? "var(--brand)" : "transparent",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <header
        style={{
          flex: "0 0 auto",
          height: 68,
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "0 18px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <strong style={{ color: "var(--text)", fontSize: 15 }}>Integraf terminál</strong>
        <div
          role="tablist"
          aria-label="Přepínání aplikací"
          style={{ display: "inline-flex", gap: 6, background: "var(--surface-2)", padding: 4, borderRadius: 12 }}
        >
          {tabBtn("data", "Sběr dat")}
          {tabBtn("plan", "Plánování")}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16, color: "var(--text-muted)" }}>
          {machine && <span>Stroj <strong style={{ color: "var(--text)" }}>{machine}</strong></span>}
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{clock}</span>
        </div>
      </header>

      <div style={{ flex: "1 1 auto", position: "relative", minHeight: 0 }}>
        <iframe
          title="Plánování"
          src={planUrl}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            border: 0,
            visibility: view === "plan" ? "visible" : "hidden",
          }}
        />
        {logicaUrl ? (
          <iframe
            title="Sběr dat"
            src={logicaUrl}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              border: 0,
              visibility: view === "data" ? "visible" : "hidden",
            }}
          />
        ) : (
          view === "data" && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                color: "var(--text-muted)",
                textAlign: "center",
                padding: 24,
              }}
            >
              Tento terminál nemá přiřazený panel Logiky (chybí v KIOSK_DEVICES).
            </div>
          )
        )}
      </div>
    </div>
  );
}
