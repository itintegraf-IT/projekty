"use client";

import { Suspense, useState } from "react";
import type { SessionUser } from "@/lib/auth";
import ThemeToggle from "@/app/_components/ThemeToggle";
import { ShiftRoster } from "@/components/admin/ShiftRoster";
import { MachineWorkHoursWeek } from "@/components/admin/MachineWorkHoursWeek";
import { AuditLogPanel } from "@/components/admin/AuditLogPanel";
import { UsersSection } from "./UsersSection";
import { CodebookSection } from "./CodebookSection";
import { PresetSection } from "./PresetSection";
import { SEPARATOR, TEXT_PRIMARY, TEXT_SECONDARY } from "./adminShared";

// ─── Styly ───────────────────────────────────────────────────────────────────

const PAGE_BG = "var(--bg)";

// Sdílené admin styly (btnPrimary/btnSecondary/btnDanger/btnAddAccent/inputStyle) → src/lib/uiStyles.ts (audit #43)

// ─── Komponenta ──────────────────────────────────────────────────────────────

export default function AdminDashboard({ currentUser }: { currentUser: SessionUser }) {
  const isPlanovat = currentUser.role === "PLANOVAT";
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  const visibleTabs = (["users", "codebook", "presets", "audit", "shifts", "rozpis"] as const).filter((tab) => {
    if (isPlanovat) return tab === "codebook" || tab === "presets" || tab === "shifts" || tab === "rozpis";
    return true;
  });
  const [activeTab, setActiveTab] = useState<"users" | "codebook" | "presets" | "audit" | "shifts" | "rozpis">(
    isPlanovat ? "presets" : "users"
  );

  return (
    <div style={{
      minHeight: "100vh",
      background: PAGE_BG,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
      color: TEXT_PRIMARY,
    }}>
      {/* Top bar */}
      <div style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "color-mix(in oklab, var(--surface) 88%, transparent)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: `1px solid ${SEPARATOR}`,
        padding: "0 20px",
        height: 52,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <a href="/" style={{
          display: "flex", alignItems: "center", gap: 6,
          color: "#3b82f6", fontSize: 13, textDecoration: "none",
          fontWeight: 600, padding: "6px 12px", borderRadius: 8,
          background: "rgba(59,130,246,0.12)",
          border: "1px solid rgba(59,130,246,0.35)",
          transition: "background 120ms ease-out",
        }}>
          <svg width="8" height="13" viewBox="0 0 8 13" fill="none">
            <path d="M7 1L1 6.5L7 12" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Plánování
        </a>
        <span style={{ fontSize: 16, fontWeight: 600, position: "absolute", left: "50%", transform: "translateX(-50%)" }}>
          Správa systému
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>{currentUser.username}</span>
          <ThemeToggle />
          <button
            onClick={handleLogout}
            style={{ padding: "3px 10px", fontSize: 11, borderRadius: 6, background: "transparent", border: `1px solid ${SEPARATOR}`, color: TEXT_SECONDARY, cursor: "pointer", fontFamily: "inherit" }}
          >
            Odhlásit
          </button>
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{ padding: "20px 20px 0", display: "flex", justifyContent: "center" }}>
        <div style={{
          display: "flex",
          background: "var(--surface-2)",
          borderRadius: 10,
          padding: 3,
          gap: 3,
        }}>
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "7px 20px",
                borderRadius: 8,
                border: "none",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
                transition: "all 0.15s ease-out",
                background: activeTab === tab ? "var(--surface-3)" : "transparent",
                color: activeTab === tab ? TEXT_PRIMARY : TEXT_SECONDARY,
              }}
            >
              {tab === "users" ? "Uživatelé" : tab === "codebook" ? "Číselníky" : tab === "presets" ? "Presety" : tab === "audit" ? "Audit log" : tab === "shifts" ? "Pracovní doba" : "Rozpis směn"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{
        maxWidth: (activeTab === "rozpis" || activeTab === "shifts" || activeTab === "audit") ? 1280 : 680,
        margin: "0 auto",
        padding: "20px",
      }}>
        {activeTab === "users" && !isPlanovat ? (
          <UsersSection currentUserId={currentUser.id} />
        ) : activeTab === "codebook" ? (
          <CodebookSection />
        ) : activeTab === "presets" ? (
          <PresetSection />
        ) : activeTab === "audit" && !isPlanovat ? (
          <Suspense fallback={null}>
            <AuditLogPanel />
          </Suspense>
        ) : activeTab === "shifts" ? (
          <MachineWorkHoursWeek />
        ) : activeTab === "rozpis" ? (
          <ShiftRoster />
        ) : null}
      </div>
    </div>
  );
}
