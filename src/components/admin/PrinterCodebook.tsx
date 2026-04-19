"use client";

import { useEffect, useState } from "react";

export type Printer = {
  id: number;
  name: string;
  isActive: boolean;
  sortOrder: number;
};

export function PrinterCodebook() {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/printers");
      if (!res.ok) throw new Error((await res.json()).error ?? "Chyba načtení");
      setPrinters(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Neznámá chyba");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  const addPrinter = async () => {
    const name = newName.trim();
    if (!name) return;
    const res = await fetch("/api/printers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "Chyba");
      return;
    }
    setNewName("");
    await reload();
  };

  const updateName = async (id: number, name: string) => {
    const res = await fetch(`/api/printers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "Chyba");
      return;
    }
    await reload();
  };

  const deactivate = async (id: number) => {
    if (!confirm("Opravdu deaktivovat tiskaře?")) return;
    const res = await fetch(`/api/printers/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError((await res.json()).error ?? "Chyba");
      return;
    }
    await reload();
  };

  if (loading) return <div>Načítám…</div>;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Tiskaři</h2>
      {error && <div style={{ color: "#ef4444", marginBottom: 12 }}>{error}</div>}

      <div style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Jméno tiskaře"
          style={{ flex: 1, padding: 8, background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155" }}
        />
        <button
          onClick={() => void addPrinter()}
          style={{ padding: "8px 16px", background: "#15803d", color: "#fff", border: "none", cursor: "pointer" }}
        >
          + Přidat
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#1e293b" }}>
            <th style={{ padding: 8, textAlign: "left", border: "1px solid #334155" }}>Jméno</th>
            <th style={{ padding: 8, width: 120, border: "1px solid #334155" }}>Akce</th>
          </tr>
        </thead>
        <tbody>
          {printers.map((p) => (
            <tr key={p.id}>
              <td style={{ padding: 8, border: "1px solid #334155" }}>
                <input
                  defaultValue={p.name}
                  onBlur={(e) => {
                    if (e.target.value !== p.name) void updateName(p.id, e.target.value);
                  }}
                  style={{ width: "100%", padding: 4, background: "transparent", color: "#e2e8f0", border: "none" }}
                />
              </td>
              <td style={{ padding: 8, textAlign: "center", border: "1px solid #334155" }}>
                <button
                  onClick={() => void deactivate(p.id)}
                  style={{ padding: "4px 8px", background: "#b91c1c", color: "#fff", border: "none", cursor: "pointer" }}
                >
                  Deaktivovat
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
