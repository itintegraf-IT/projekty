"use client";

import { useEffect, useState } from "react";
import type { LoginOverview } from "@/lib/loginLogStats";

function fmt(iso: string | null): string {
  if (!iso) return "nikdy";
  return new Date(iso).toLocaleString("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const TD: React.CSSProperties = { padding: "9px 12px", borderBottom: "1px solid var(--border)", fontSize: 13 };
const TH: React.CSSProperties = { textAlign: "left", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600, padding: "9px 12px", borderBottom: "1px solid var(--border)" };

function Kpi({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", flex: "1 1 0", minWidth: 130 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: danger && value > 0 ? "var(--danger)" : "var(--text)" }}>{value}</div>
    </div>
  );
}

export function LoginLogPanel() {
  const [data, setData] = useState<LoginOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch("/api/admin/login-log", { signal: ctrl.signal });
        if (!r.ok) throw new Error("Nepodařilo se načíst přehled přihlášení");
        setData((await r.json()) as LoginOverview);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Neznámá chyba");
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, []);

  if (loading) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Načítám…</div>;
  if (error) return <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>;
  if (!data) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Kpi label="Přihlášení dnes" value={data.summary.loginsToday} />
        <Kpi label="Tento týden" value={data.summary.loginsWeek} />
        <Kpi label="Aktivní uživatelé (7 dní)" value={data.summary.activeUsersWeek} />
        <Kpi label="Neúspěšné (7 dní)" value={data.summary.failed7d} danger />
        <Kpi label="Nikdy nepřihlášen" value={data.summary.neverLoggedIn} />
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620 }}>
          <thead>
            <tr>
              <th style={TH}>Uživatel</th>
              <th style={TH}>Role</th>
              <th style={{ ...TH, textAlign: "right" }}>Přihlášení (30 dní)</th>
              <th style={TH}>Poslední přihlášení</th>
              <th style={{ ...TH, textAlign: "right" }}>Neúspěchy (30 dní)</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.username}>
                <td style={{ ...TD, fontWeight: 600 }}>{u.username}</td>
                <td style={TD}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: "var(--surface-3)", color: "var(--text-muted)" }}>{u.role ?? "—"}</span>
                </td>
                <td style={{ ...TD, textAlign: "right", fontVariantNumeric: "tabular-nums", color: u.count30d === 0 ? "var(--text-muted)" : "var(--text)" }}>{u.count30d}</td>
                <td style={{ ...TD, color: u.lastLoginAt ? "var(--text)" : "var(--text-muted)" }}>{fmt(u.lastLoginAt)}</td>
                <td style={{ ...TD, textAlign: "right", fontVariantNumeric: "tabular-nums", color: u.failed30d > 0 ? "var(--danger)" : "var(--text-muted)" }}>{u.failed30d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
