"use client";

import React from "react";
import { copyFor } from "@/lib/healthCheckCopy";

/**
 * Dvojice vět nad tabulkou nálezů: co porušení znamená a co s ním udělat.
 * Neznámý klíč nevykreslí nic — panel nikdy nespadne kvůli chybějícímu textu.
 */
export default function CheckExplainer({ copyKey }: { copyKey: string }) {
  const copy = copyFor(copyKey);
  if (!copy) return null;
  return (
    <div
      style={{
        background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 9,
        padding: "10px 13px", marginTop: 8, fontSize: 12.5, lineHeight: 1.55, color: "var(--text-muted)",
        display: "flex", flexDirection: "column", gap: 6,
      }}
    >
      <div><strong style={{ color: "var(--text)" }}>Co to znamená:</strong> {copy.znamena}</div>
      <div><strong style={{ color: "var(--text)" }}>Co s tím:</strong> {copy.coStim}</div>
    </div>
  );
}
