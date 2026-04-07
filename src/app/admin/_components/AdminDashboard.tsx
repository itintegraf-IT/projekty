"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@/lib/auth";
import { BADGE_COLOR_KEYS, BADGE_COLOR_LABELS, type BadgeColorKey } from "@/lib/badgeColors";
import type { MachineWorkHoursTemplate } from "@/lib/machineWorkHours";
import JobPresetEditor from "@/components/job-presets/JobPresetEditor";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { summarizeJobPreset, type JobPreset } from "@/lib/jobPresets";
import { durationHoursFromSlots, formatSlot, getSlotRange } from "@/lib/timeSlots";
import { pragueOf, pragueToUTC, utcToPragueDateStr } from "@/lib/dateUtils";

// ─── Typy ────────────────────────────────────────────────────────────────────

interface AdminUser {
  id: number;
  username: string;
  role: string;
  assignedMachine: string | null;
  createdAt: string;
}

interface CodebookItem {
  id: number;
  category: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  isWarning: boolean;
  shortCode: string | null;
  badgeColor: string | null;
}

// ─── Konstanty ───────────────────────────────────────────────────────────────

const ROLES = ["ADMIN", "PLANOVAT", "MTZ", "DTP", "TISKAR", "OBCHODNIK", "VIEWER"] as const;
type Role = typeof ROLES[number];

const ROLE_COLORS: Record<string, string> = {
  ADMIN: "#ff453a",
  PLANOVAT: "#3b82f6",
  MTZ: "#30d158",
  DTP: "#ff9f0a",
  TISKAR: "#ac8cff",
  OBCHODNIK: "#0ea5e9",
  VIEWER: "#636366",
};
const ROLE_BG: Record<string, string> = {
  ADMIN: "rgba(255,69,58,0.15)",
  PLANOVAT: "rgba(59,130,246,0.15)",
  MTZ: "rgba(48,209,88,0.15)",
  DTP: "rgba(255,159,10,0.15)",
  TISKAR: "rgba(172,140,255,0.15)",
  OBCHODNIK: "rgba(14,165,233,0.15)",
  VIEWER: "rgba(99,99,102,0.15)",
};
const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  PLANOVAT: "Plánovač",
  MTZ: "MTZ",
  DTP: "DTP",
  TISKAR: "Tiskař",
  OBCHODNIK: "Obchodník",
  VIEWER: "Prohlížeč",
};
const MACHINE_LABELS: Record<string, string> = {
  XL_105: "XL 105",
  XL_106: "XL 106",
};

const CATEGORIES = ["DATA", "MATERIAL", "BARVY", "LAK"] as const;
type Category = typeof CATEGORIES[number];
const CATEGORY_LABELS: Record<Category, string> = {
  DATA: "DATA",
  MATERIAL: "MATERIÁL",
  BARVY: "BARVY",
  LAK: "LAK",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function userInitial(username: string): string {
  return username[0]?.toUpperCase() ?? "?";
}

// ─── Styly ───────────────────────────────────────────────────────────────────

const PAGE_BG = "var(--bg)";
const SECTION_BG = "var(--surface)";
const SEPARATOR = "color-mix(in oklab, var(--border) 70%, transparent)";
const TEXT_PRIMARY = "var(--text)";
const TEXT_SECONDARY = "var(--text-muted)";
const BORDER_SUBTLE = "var(--border)";

const inputStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "7px 11px",
  color: TEXT_PRIMARY,
  fontSize: 13,
  fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const btnPrimary: React.CSSProperties = {
  background: "var(--brand)",
  color: "var(--brand-contrast)",
  border: "none",
  borderRadius: 8,
  padding: "7px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
  whiteSpace: "nowrap",
};

const btnSecondary: React.CSSProperties = {
  background: "var(--surface-2)",
  color: TEXT_SECONDARY,
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "7px 16px",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
  whiteSpace: "nowrap",
};

const btnDanger: React.CSSProperties = {
  background: "color-mix(in oklab, var(--danger) 15%, transparent)",
  color: "var(--danger)",
  border: "1px solid color-mix(in oklab, var(--danger) 25%, transparent)",
  borderRadius: 8,
  padding: "5px 12px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
  whiteSpace: "nowrap",
};

const btnAddAccent: React.CSSProperties = {
  ...btnSecondary,
  display: "flex",
  alignItems: "center",
  gap: 7,
  background: "rgba(59,130,246,0.12)",
  color: "#3b82f6",
  border: "1px solid rgba(59,130,246,0.3)",
  fontWeight: 600,
};

// ─── Komponenta ──────────────────────────────────────────────────────────────

export default function AdminDashboard({ currentUser }: { currentUser: SessionUser }) {
  const isPlanovat = currentUser.role === "PLANOVAT";
  const visibleTabs = (["users", "codebook", "presets", "audit", "shifts"] as const).filter((tab) => {
    if (isPlanovat) return tab === "codebook" || tab === "presets" || tab === "shifts";
    return true;
  });
  const [activeTab, setActiveTab] = useState<"users" | "codebook" | "presets" | "audit" | "shifts">(
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
        <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>{currentUser.username}</span>
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
              {tab === "users" ? "Uživatelé" : tab === "codebook" ? "Číselníky" : tab === "presets" ? "Presety" : tab === "audit" ? "Audit log" : "Pracovní doba"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "20px" }}>
        {activeTab === "users" && !isPlanovat ? (
          <UsersSection currentUserId={currentUser.id} />
        ) : activeTab === "codebook" ? (
          <CodebookSection />
        ) : activeTab === "presets" ? (
          <PresetSection />
        ) : activeTab === "audit" && !isPlanovat ? (
          <AuditLogSection />
        ) : activeTab === "shifts" ? (
          <WorkShiftsSection />
        ) : null}
      </div>
    </div>
  );
}

// ─── Tab: Uživatelé ──────────────────────────────────────────────────────────

function UsersSection({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addRole, setAddRole] = useState<Role>("PLANOVAT");
  const [addMachine, setAddMachine] = useState<"XL_105" | "XL_106">("XL_105");
  const [addError, setAddError] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  async function loadUsers() {
    setLoading(true);
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, []);

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    if (!addUsername.trim() || !addPassword.trim()) return;
    setAddLoading(true);
    setAddError("");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: addUsername.trim(),
        password: addPassword,
        role: addRole,
        ...(addRole === "TISKAR" ? { assignedMachine: addMachine } : {}),
      }),
    });
    if (res.ok) {
      setAddUsername(""); setAddPassword(""); setAddRole("PLANOVAT"); setAddMachine("XL_105");
      setShowAddForm(false);
      await loadUsers();
    } else {
      const d = await res.json();
      setAddError(d.error ?? "Chyba při vytváření");
    }
    setAddLoading(false);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Uživatelé
        </span>
        <button
          onClick={() => { setShowAddForm(!showAddForm); setAddError(""); }}
          style={btnAddAccent}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6.25" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="7" y1="4" x2="7" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="4" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Přidat
        </button>
      </div>

      <div style={{ background: SECTION_BG, borderRadius: 12, overflow: "hidden", border: `1px solid ${BORDER_SUBTLE}` }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: TEXT_SECONDARY, fontSize: 13 }}>Načítám...</div>
        ) : users.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: TEXT_SECONDARY, fontSize: 13 }}>Žádní uživatelé</div>
        ) : (
          users.map((user, i) => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === currentUserId}
              isLast={i === users.length - 1 && !showAddForm}
              onUpdate={loadUsers}
            />
          ))
        )}

        {/* Přidat uživatele — inline form */}
        {showAddForm && (
          <div style={{
            borderTop: users.length > 0 ? `1px solid ${SEPARATOR}` : "none",
            padding: 16,
          }}>
            <form onSubmit={handleAddUser} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <input
                    style={inputStyle}
                    placeholder="Uživatelské jméno"
                    value={addUsername}
                    onChange={(e) => setAddUsername(e.target.value)}
                    autoFocus
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <input
                    style={inputStyle}
                    type="password"
                    placeholder="Heslo"
                    value={addPassword}
                    onChange={(e) => setAddPassword(e.target.value)}
                  />
                </div>
              </div>
              <RoleSelect value={addRole} onChange={(r) => setAddRole(r as Role)} />
              {addRole === "TISKAR" && (
                <div style={{ display: "flex", gap: 6 }}>
                  {(["XL_105", "XL_106"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setAddMachine(m)}
                      style={{
                        padding: "5px 14px",
                        borderRadius: 7,
                        border: `1px solid ${addMachine === m ? ROLE_COLORS["TISKAR"] : BORDER_SUBTLE}`,
                        background: addMachine === m ? ROLE_BG["TISKAR"] : "transparent",
                        color: addMachine === m ? ROLE_COLORS["TISKAR"] : TEXT_SECONDARY,
                        fontSize: 12, fontWeight: addMachine === m ? 600 : 400,
                        cursor: "pointer",
                        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
                        transition: "all 0.1s ease-out",
                      }}
                    >
                      {MACHINE_LABELS[m]}
                    </button>
                  ))}
                </div>
              )}
              {addError && <span style={{ fontSize: 12, color: "var(--danger)" }}>{addError}</span>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" style={btnSecondary} onClick={() => { setShowAddForm(false); setAddError(""); }}>Zrušit</button>
                <button type="submit" style={btnPrimary} disabled={addLoading || !addUsername.trim() || !addPassword.trim()}>
                  {addLoading ? "Přidávám..." : "Přidat"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function UserRow({ user, isSelf, isLast, onUpdate }: {
  user: AdminUser;
  isSelf: boolean;
  isLast: boolean;
  onUpdate: () => void;
}) {
  const [showRolePopover, setShowRolePopover] = useState(false);
  const [tiskarMachineStep, setTiskarMachineStep] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Zavřít popover při kliknutí mimo
  useEffect(() => {
    if (!showRolePopover) return;
    function handler(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowRolePopover(false);
        setTiskarMachineStep(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showRolePopover]);

  async function handleRoleChange(role: string, assignedMachine?: string) {
    setShowRolePopover(false);
    setTiskarMachineStep(false);
    await fetch(`/api/admin/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, ...(assignedMachine ? { assignedMachine } : {}) }),
    });
    onUpdate();
  }

  function handleRoleClick(role: string) {
    if (role === "TISKAR") {
      setTiskarMachineStep(true);
    } else {
      handleRoleChange(role);
    }
  }

  async function handlePasswordSave() {
    if (!newPassword.trim()) return;
    setPwLoading(true);
    await fetch(`/api/admin/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword }),
    });
    setNewPassword("");
    setShowPasswordForm(false);
    setPwLoading(false);
  }

  async function handleDelete() {
    await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
    onUpdate();
  }

  const bgColor = isSelf ? "color-mix(in oklab, #3b82f6 10%, transparent)" : "transparent";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderBottom: isLast ? "none" : `1px solid ${SEPARATOR}`,
        background: bgColor,
        transition: "background 0.1s ease-out",
      }}
    >
      {/* Hlavní řádek */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 16px",
        height: 56,
      }}>
        {/* Avatar */}
        <div style={{
          width: 34, height: 34, borderRadius: "50%",
          background: ROLE_BG[user.role] ?? "var(--surface-2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 600,
          color: ROLE_COLORS[user.role] ?? "var(--text)",
          flexShrink: 0,
        }}>
          {userInitial(user.username)}
        </div>

        {/* Jméno */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: TEXT_PRIMARY, display: "flex", alignItems: "center", gap: 6 }}>
            {user.username}
            {isSelf && (
              <span style={{ fontSize: 10, color: TEXT_SECONDARY, fontWeight: 400 }}>ty</span>
            )}
          </div>
        </div>

        {/* Role badge — klikatelný (jen ne pro sebe) */}
        <div style={{ position: "relative" }} ref={popoverRef}>
          <button
            onClick={() => !isSelf && setShowRolePopover(!showRolePopover)}
            style={{
              background: ROLE_BG[user.role] ?? "var(--surface-2)",
              color: ROLE_COLORS[user.role] ?? "var(--text)",
              border: "none",
              borderRadius: 6,
              padding: "3px 9px",
              fontSize: 11,
              fontWeight: 600,
              cursor: isSelf ? "default" : "pointer",
              fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
              letterSpacing: "0.02em",
              transition: "opacity 0.1s",
              opacity: isSelf ? 0.7 : 1,
            }}
          >
            {ROLE_LABELS[user.role] ?? user.role}
            {user.role === "TISKAR" && user.assignedMachine && (
              <span style={{ marginLeft: 4, opacity: 0.7, fontWeight: 400 }}>
                · {MACHINE_LABELS[user.assignedMachine] ?? user.assignedMachine}
              </span>
            )}
          </button>

          {/* Role popover */}
          {showRolePopover && (
            <div style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              background: "var(--surface)",
              border: `1px solid ${BORDER_SUBTLE}`,
              borderRadius: 10,
              overflow: "hidden",
              zIndex: 100,
              minWidth: 170,
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}>
              {!tiskarMachineStep ? (
                ROLES.map((role) => (
                  <button
                    key={role}
                    onClick={() => handleRoleClick(role)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "10px 14px",
                      background: role === user.role ? "var(--surface-2)" : "transparent",
                      border: "none",
                      borderBottom: role !== "VIEWER" ? `1px solid ${SEPARATOR}` : "none",
                      color: TEXT_PRIMARY,
                      fontSize: 13,
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => { if (role !== user.role) (e.currentTarget as HTMLElement).style.background = "var(--surface-2)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = role === user.role ? "var(--surface-2)" : "transparent"; }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: ROLE_COLORS[role], flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{ROLE_LABELS[role]}</span>
                    {role === "TISKAR" && <span style={{ fontSize: 10, color: TEXT_SECONDARY }}>→</span>}
                    {role === user.role && role !== "TISKAR" && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                ))
              ) : (
                <div>
                  <div style={{ padding: "8px 14px 6px", fontSize: 11, color: TEXT_SECONDARY, borderBottom: `1px solid ${SEPARATOR}` }}>
                    Přiřadit stroj
                  </div>
                  {(["XL_105", "XL_106"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => handleRoleChange("TISKAR", m)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        width: "100%", padding: "10px 14px",
                        background: user.assignedMachine === m ? "var(--surface-2)" : "transparent",
                        border: "none",
                        borderBottom: m === "XL_105" ? `1px solid ${SEPARATOR}` : "none",
                        color: TEXT_PRIMARY, fontSize: 13, cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--surface-2)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = user.assignedMachine === m ? "var(--surface-2)" : "transparent"; }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: ROLE_COLORS["TISKAR"], flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{MACHINE_LABELS[m]}</span>
                      {user.assignedMachine === m && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Heslo button */}
        <button
          onClick={() => { setShowPasswordForm(!showPasswordForm); setNewPassword(""); }}
          style={{
            background: "transparent",
            border: `1px solid ${BORDER_SUBTLE}`,
            borderRadius: 6,
            padding: "3px 9px",
            fontSize: 11,
            color: TEXT_SECONDARY,
            cursor: "pointer",
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
            whiteSpace: "nowrap",
          }}
        >
          Heslo
        </button>

        {/* Delete button — jen pro ostatní, hover-reveal */}
        {!isSelf && (
          <button
            onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
            style={{
              background: "transparent",
              border: "none",
              padding: "4px",
              cursor: "pointer",
              opacity: hovered ? 1 : 0,
              transition: "opacity 0.15s ease-out",
              display: "flex", alignItems: "center",
              color: "var(--danger)",
            }}
            title="Smazat uživatele"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 3.5h10M5.5 3.5V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M4 3.5l.5 7.5h5L10 3.5" stroke="var(--danger)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Inline: změna hesla */}
      {showPasswordForm && (
        <div style={{ padding: "0 16px 12px", display: "flex", gap: 8 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            type="password"
            placeholder="Nové heslo"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handlePasswordSave(); if (e.key === "Escape") setShowPasswordForm(false); }}
            autoFocus
          />
          <button style={btnSecondary} onClick={() => setShowPasswordForm(false)}>Zrušit</button>
          <button style={btnPrimary} onClick={handlePasswordSave} disabled={pwLoading || !newPassword.trim()}>
            {pwLoading ? "..." : "Uložit"}
          </button>
        </div>
      )}

      {/* Inline: confirm smazání */}
      {showDeleteConfirm && (
        <div style={{
          padding: "0 16px 12px",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 13, color: TEXT_SECONDARY, flex: 1 }}>
            Opravdu smazat <strong style={{ color: TEXT_PRIMARY }}>{user.username}</strong>?
          </span>
          <button style={btnSecondary} onClick={() => setShowDeleteConfirm(false)}>Zrušit</button>
          <button style={btnDanger} onClick={handleDelete}>Smazat</button>
        </div>
      )}
    </div>
  );
}

// ─── Role select helper ───────────────────────────────────────────────────────

function RoleSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {ROLES.map((role) => (
        <button
          key={role}
          type="button"
          onClick={() => onChange(role)}
          style={{
            padding: "5px 12px",
            borderRadius: 7,
            border: `1px solid ${value === role ? ROLE_COLORS[role] : BORDER_SUBTLE}`,
            background: value === role ? ROLE_BG[role] : "transparent",
            color: value === role ? ROLE_COLORS[role] : TEXT_SECONDARY,
            fontSize: 12,
            fontWeight: value === role ? 600 : 400,
            cursor: "pointer",
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
            transition: "all 0.1s ease-out",
          }}
        >
          {ROLE_LABELS[role]}
        </button>
      ))}
    </div>
  );
}

// ─── Tab: Číselníky ──────────────────────────────────────────────────────────

function CodebookSection() {
  const [category, setCategory] = useState<Category>("DATA");
  const [items, setItems] = useState<CodebookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addIsWarning, setAddIsWarning] = useState(false);
  const [addBadgeColor, setAddBadgeColor] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  async function loadItems(cat: Category) {
    setLoading(true);
    const res = await fetch(`/api/codebook?category=${cat}&includeInactive=true`);
    if (res.ok) setItems(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    setShowAddForm(false);
    setAddLabel("");
    setAddBadgeColor(null);
    loadItems(category);
  }, [category]);

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!addLabel.trim()) return;
    setAddLoading(true);
    const res = await fetch("/api/codebook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, label: addLabel.trim(), isWarning: addIsWarning, badgeColor: addBadgeColor }),
    });
    if (res.ok) {
      setAddLabel(""); setAddIsWarning(false); setAddBadgeColor(null); setShowAddForm(false);
      await loadItems(category);
    }
    setAddLoading(false);
  }

  async function handleMoveUp(index: number) {
    if (index === 0) return;
    const a = items[index - 1];
    const b = items[index];
    await Promise.all([
      fetch(`/api/codebook/${a.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: b.sortOrder }),
      }),
      fetch(`/api/codebook/${b.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: a.sortOrder }),
      }),
    ]);
    await loadItems(category);
  }

  async function handleMoveDown(index: number) {
    if (index === items.length - 1) return;
    const a = items[index];
    const b = items[index + 1];
    await Promise.all([
      fetch(`/api/codebook/${a.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: b.sortOrder }),
      }),
      fetch(`/api/codebook/${b.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: a.sortOrder }),
      }),
    ]);
    await loadItems(category);
  }

  return (
    <div>
      {/* Category tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            style={{
              padding: "6px 16px",
              borderRadius: 20,
              border: `1px solid ${category === cat ? "#3b82f6" : BORDER_SUBTLE}`,
              background: category === cat ? "rgba(59,130,246,0.12)" : "var(--surface-2, var(--surface))",
              color: category === cat ? "#3b82f6" : TEXT_PRIMARY,
              fontSize: 13,
              fontWeight: category === cat ? 600 : 500,
              cursor: "pointer",
              fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
              transition: "all 0.1s ease-out",
              outline: "none",
              opacity: category === cat ? 1 : 0.75,
            }}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {CATEGORY_LABELS[category]}
        </span>
        <button
          onClick={() => { setShowAddForm(!showAddForm); setAddLabel(""); setAddIsWarning(false); setAddBadgeColor(null); }}
          style={btnAddAccent}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6.25" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="7" y1="4" x2="7" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="4" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Přidat
        </button>
      </div>

      <div style={{ background: SECTION_BG, borderRadius: 12, overflow: "hidden", border: `1px solid ${BORDER_SUBTLE}` }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: TEXT_SECONDARY, fontSize: 13 }}>Načítám...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: TEXT_SECONDARY, fontSize: 13 }}>Žádné položky</div>
        ) : (
          items.map((item, i) => (
            <CodebookRow
              key={item.id}
              item={item}
              isFirst={i === 0}
              isLast={i === items.length - 1 && !showAddForm}
              onMoveUp={() => handleMoveUp(i)}
              onMoveDown={() => handleMoveDown(i)}
              onUpdate={() => loadItems(category)}
            />
          ))
        )}

        {/* Přidat položku — inline form */}
        {showAddForm && (
          <div style={{
            borderTop: items.length > 0 ? `1px solid ${SEPARATOR}` : "none",
            padding: 16,
          }}>
            <form onSubmit={handleAddItem} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  placeholder="Název položky"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  autoFocus
                />
                <WarningToggle value={addIsWarning} onChange={setAddIsWarning} />
              </div>
              <ColorPicker value={addBadgeColor} onChange={setAddBadgeColor} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" style={btnSecondary} onClick={() => { setShowAddForm(false); setAddBadgeColor(null); }}>Zrušit</button>
                <button type="submit" style={btnPrimary} disabled={addLoading || !addLabel.trim()}>
                  {addLoading ? "Přidávám..." : "Přidat"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function CodebookRow({ item, isFirst, isLast, onMoveUp, onMoveDown, onUpdate }: {
  item: CodebookItem;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(item.label);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  async function handleLabelSave() {
    if (!editLabel.trim() || editLabel.trim() === item.label) {
      setEditLabel(item.label);
      setEditing(false);
      return;
    }
    await fetch(`/api/codebook/${item.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: editLabel.trim() }),
    });
    setEditing(false);
    onUpdate();
  }

  async function handleToggle(field: "isWarning" | "isActive") {
    await fetch(`/api/codebook/${item.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: !item[field] }),
    });
    onUpdate();
  }

  async function handleDelete() {
    await fetch(`/api/codebook/${item.id}`, { method: "DELETE" });
    onUpdate();
  }

  async function handleColorChange(color: string | null) {
    const res = await fetch(`/api/codebook/${item.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ badgeColor: color }),
    });
    if (!res.ok) {
      console.error("Badge color update failed", await res.text());
      return;
    }
    onUpdate();
  }

  const isInactive = !item.isActive;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderBottom: isLast ? "none" : `1px solid ${SEPARATOR}`,
        background: isInactive ? "color-mix(in oklab, var(--surface-2) 65%, transparent)" : "transparent",
        transition: "background 0.1s",
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 12px 0 8px",
        height: 52,
      }}>
        {/* Up/down buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            style={{
              background: "transparent", border: "none",
              color: isFirst ? "color-mix(in oklab, var(--text-muted) 35%, transparent)" : TEXT_SECONDARY,
              cursor: isFirst ? "default" : "pointer",
              padding: "1px 4px", lineHeight: 1, fontSize: 10,
              transition: "color 0.1s",
            }}
            title="Posunout nahoru"
          >▲</button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            style={{
              background: "transparent", border: "none",
              color: isLast ? "color-mix(in oklab, var(--text-muted) 35%, transparent)" : TEXT_SECONDARY,
              cursor: isLast ? "default" : "pointer",
              padding: "1px 4px", lineHeight: 1, fontSize: 10,
              transition: "color 0.1s",
            }}
            title="Posunout dolů"
          >▼</button>
        </div>

        {/* Label — kliknutí zahájí editaci */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input
              ref={inputRef}
              style={{ ...inputStyle, padding: "4px 8px", fontSize: 13 }}
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              onBlur={handleLabelSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLabelSave();
                if (e.key === "Escape") { setEditLabel(item.label); setEditing(false); }
              }}
            />
          ) : (
            <span
              onClick={() => { setEditing(true); setEditLabel(item.label); }}
              style={{
                fontSize: 13,
                color: isInactive ? TEXT_SECONDARY : (item.isWarning ? "var(--warning)" : TEXT_PRIMARY),
                cursor: "text",
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textDecoration: isInactive ? "line-through" : "none",
                opacity: isInactive ? 0.6 : 1,
              }}
              title="Klikněte pro editaci"
            >
              {item.label}
            </span>
          )}
        </div>

        {/* isWarning toggle */}
        <WarningToggle value={item.isWarning} onChange={() => handleToggle("isWarning")} compact />

        {/* Badge color picker */}
        <ColorPicker value={item.badgeColor} onChange={handleColorChange} compact />

        {/* isActive toggle */}
        <button
          onClick={() => handleToggle("isActive")}
          title={item.isActive ? "Aktivní (klikněte pro deaktivaci)" : "Neaktivní (klikněte pro aktivaci)"}
          style={{
            width: 32, height: 18, borderRadius: 9,
            background: item.isActive ? "var(--success)" : "var(--surface-3)",
            border: "none", cursor: "pointer",
            position: "relative", flexShrink: 0,
            transition: "background 0.15s ease-out",
          }}
        >
          <span style={{
            position: "absolute",
            width: 14, height: 14,
            borderRadius: "50%",
            background: "var(--text)",
            top: 2,
            left: item.isActive ? 16 : 2,
            transition: "left 0.15s ease-out",
          }} />
        </button>

        {/* Delete — hover reveal */}
        <button
          onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
          style={{
            background: "transparent", border: "none",
            padding: "4px", cursor: "pointer",
            opacity: hovered ? 1 : 0,
            transition: "opacity 0.15s ease-out",
            color: "var(--danger)",
            display: "flex", alignItems: "center",
          }}
          title="Smazat položku"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 3.5h10M5.5 3.5V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M4 3.5l.5 7.5h5L10 3.5" stroke="var(--danger)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Confirm smazání */}
      {showDeleteConfirm && (
        <div style={{ padding: "0 16px 12px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: TEXT_SECONDARY, flex: 1 }}>
            Smazat <strong style={{ color: TEXT_PRIMARY }}>{item.label}</strong>?
            {" "}<span style={{ fontSize: 11 }}>(existující zakázky zachovají svůj stav)</span>
          </span>
          <button style={btnSecondary} onClick={() => setShowDeleteConfirm(false)}>Zrušit</button>
          <button style={btnDanger} onClick={handleDelete}>Smazat</button>
        </div>
      )}
    </div>
  );
}

// ─── Color picker ─────────────────────────────────────────────────────────────

function ColorPicker({ value, onChange, compact }: {
  value: string | null;
  onChange: (v: string | null) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dotColor = value ? `var(--badge-${value})` : "var(--text-muted)";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={value ? `Barva: ${BADGE_COLOR_LABELS[value as BadgeColorKey] ?? value}` : "Bez barvy"}
          style={{
            display: "flex", alignItems: "center", gap: compact ? 0 : 5,
            background: "var(--surface-2)",
            border: `1px solid ${BORDER_SUBTLE}`,
            borderRadius: 6,
            padding: compact ? "5px 7px" : "5px 10px",
            cursor: "pointer",
            flexShrink: 0,
            minHeight: 32,
          }}
        >
          <span style={{
            width: 12, height: 12, borderRadius: "50%",
            background: dotColor,
            display: "inline-block",
            flexShrink: 0,
            border: value ? "none" : "1px dashed var(--text-muted)",
          }} />
          {!compact && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {value ? (BADGE_COLOR_LABELS[value as BadgeColorKey] ?? value) : "Barva"}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto p-0 border-0"
        style={{
          background: "var(--surface)",
          border: `1px solid ${BORDER_SUBTLE}`,
          borderRadius: 10,
          padding: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
          width: "max-content",
          maxWidth: 240,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 32px)", justifyContent: "center", gap: 8, marginBottom: 10 }}>
          {BADGE_COLOR_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-label={BADGE_COLOR_LABELS[key]}
              aria-pressed={value === key}
              onClick={() => {
                onChange(key);
                setOpen(false);
              }}
              style={{
                width: 32, height: 32, borderRadius: "50%",
                background: `var(--badge-${key})`,
                border: "2px solid color-mix(in oklab, var(--surface) 88%, transparent)",
                boxShadow: value === key
                  ? "0 0 0 2px var(--surface), 0 0 0 4px var(--accent)"
                  : "none",
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
          style={{
            width: "100%", padding: "6px 8px", borderRadius: 6,
            background: value === null ? "color-mix(in oklab, var(--accent) 15%, transparent)" : "transparent",
            border: `1px solid ${value === null ? "var(--accent)" : BORDER_SUBTLE}`,
            color: "var(--text-muted)", fontSize: 11,
            cursor: "pointer", textAlign: "center",
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          }}
        >
          × Bez barvy (výchozí)
        </button>
      </PopoverContent>
    </Popover>
  );
}

// ─── Warning toggle ───────────────────────────────────────────────────────────

function WarningToggle({ value, onChange, compact }: {
  value: boolean;
  onChange: (v: boolean) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      title={value ? "Upozornění zapnuto" : "Upozornění vypnuto"}
      style={{
        display: "flex", alignItems: "center", gap: compact ? 0 : 5,
        background: value ? "color-mix(in oklab, var(--warning) 15%, transparent)" : "var(--surface-2)",
        border: `1px solid ${value ? "color-mix(in oklab, var(--warning) 40%, transparent)" : BORDER_SUBTLE}`,
        borderRadius: 6,
        padding: compact ? "4px 6px" : "5px 10px",
        color: value ? "var(--warning)" : TEXT_SECONDARY,
        fontSize: 13,
        cursor: "pointer",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        transition: "all 0.15s ease-out",
        flexShrink: 0,
      }}
    >
      ⚠{!compact && <span style={{ fontSize: 11 }}>{value ? "Warn" : "off"}</span>}
    </button>
  );
}

// ─── Tab: Presety ────────────────────────────────────────────────────────────

function PresetSection() {
  const [presets, setPresets] = useState<JobPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTitle, setEditorTitle] = useState("Nový preset");
  const [editorSeed, setEditorSeed] = useState<Partial<JobPreset> & { id?: number; isSystemPreset?: boolean; sortOrder?: number }>({
    isActive: true,
    appliesToZakazka: true,
    appliesToRezervace: true,
  });

  async function loadPresets() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/job-presets?includeInactive=true");
    if (!res.ok) {
      setError("Nepodařilo se načíst presety.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setPresets(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => {
    void loadPresets();
  }, []);

  async function handleMove(index: number, direction: -1 | 1) {
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= presets.length) return;
    const current = presets[index];
    const swapWith = presets[swapIndex];
    await Promise.all([
      fetch(`/api/job-presets/${current.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: swapWith.sortOrder }),
      }),
      fetch(`/api/job-presets/${swapWith.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: current.sortOrder }),
      }),
    ]);
    await loadPresets();
  }

  async function handleToggleActive(preset: JobPreset) {
    const res = await fetch(`/api/job-presets/${preset.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !preset.isActive }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Nepodařilo se změnit stav presetu.");
      return;
    }
    await loadPresets();
  }

  async function handleDelete(preset: JobPreset) {
    if (!window.confirm(`Opravdu smazat preset '${preset.name}'?`)) return;
    const res = await fetch(`/api/job-presets/${preset.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Preset se nepodařilo smazat.");
      return;
    }
    await loadPresets();
  }

  function openCreate() {
    setEditorTitle("Nový preset");
    setEditorSeed({
      isActive: true,
      appliesToZakazka: true,
      appliesToRezervace: true,
    });
    setEditorOpen(true);
  }

  function openEdit(preset: JobPreset) {
    setEditorTitle(`Upravit preset: ${preset.name}`);
    setEditorSeed(preset);
    setEditorOpen(true);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Presety Job Builderu
        </span>
        <button
          onClick={openCreate}
          type="button"
          style={btnAddAccent}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <line x1="6" y1="2.25" x2="6" y2="9.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            <line x1="2.25" y1="6" x2="9.75" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          Přidat preset
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 12, borderRadius: 8, padding: "10px 12px", background: "color-mix(in oklab, var(--danger) 10%, transparent)", border: "1px solid color-mix(in oklab, var(--danger) 25%, transparent)", color: "var(--danger)", fontSize: 12 }}>
          {error}
        </div>
      )}

      <div style={{ background: SECTION_BG, borderRadius: 12, overflow: "hidden", border: `1px solid ${BORDER_SUBTLE}` }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: TEXT_SECONDARY, fontSize: 13 }}>Načítám...</div>
        ) : presets.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: TEXT_SECONDARY, fontSize: 13 }}>Žádné presety</div>
        ) : (
          presets.map((preset, index) => {
            const usage = [preset.appliesToZakazka ? "Zakázka" : null, preset.appliesToRezervace ? "Rezervace" : null].filter(Boolean).join(" + ");
            return (
              <div
                key={preset.id}
                style={{
                  borderBottom: index === presets.length - 1 ? "none" : `1px solid ${SEPARATOR}`,
                  background: preset.isActive ? "transparent" : "color-mix(in oklab, var(--surface-2) 60%, transparent)",
                }}
              >
                <div style={{ display: "flex", gap: 10, padding: "12px 12px 12px 8px", alignItems: "stretch" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0, justifyContent: "center" }}>
                    <button onClick={() => handleMove(index, -1)} disabled={index === 0} style={{ ...btnSecondary, padding: "3px 7px", fontSize: 10, opacity: index === 0 ? 0.4 : 1 }}>↑</button>
                    <button onClick={() => handleMove(index, 1)} disabled={index === presets.length - 1} style={{ ...btnSecondary, padding: "3px 7px", fontSize: 10, opacity: index === presets.length - 1 ? 0.4 : 1 }}>↓</button>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY }}>{preset.name}</div>
                      <span style={{
                        fontSize: 10, fontWeight: 700, borderRadius: 999, padding: "2px 8px",
                        background: preset.isSystemPreset ? "rgba(59,130,246,0.12)" : "rgba(16,185,129,0.12)",
                        color: preset.isSystemPreset ? "#60a5fa" : "#34d399",
                        border: `1px solid ${preset.isSystemPreset ? "rgba(59,130,246,0.25)" : "rgba(16,185,129,0.25)"}`,
                      }}>
                        {preset.isSystemPreset ? "Systémový" : "Vlastní"}
                      </span>
                      {!preset.isActive && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, borderRadius: 999, padding: "2px 8px",
                          background: "rgba(148,163,184,0.12)", color: "#94a3b8", border: "1px solid rgba(148,163,184,0.2)",
                        }}>
                          Neaktivní
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: TEXT_SECONDARY, marginTop: 4, lineHeight: 1.45 }}>
                      {summarizeJobPreset(preset)}
                    </div>
                    <div style={{ fontSize: 10, color: TEXT_SECONDARY, marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span>{usage || "Bez použití"}</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, alignItems: "stretch", minWidth: 108 }}>
                    <button style={btnSecondary} onClick={() => openEdit(preset)}>Upravit</button>
                    <button style={btnSecondary} onClick={() => handleToggleActive(preset)}>
                      {preset.isActive ? "Deaktivovat" : "Aktivovat"}
                    </button>
                    {!preset.isSystemPreset && (
                      <button style={btnDanger} onClick={() => handleDelete(preset)}>Smazat</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <JobPresetEditor
        open={editorOpen}
        title={editorTitle}
        initialValue={editorSeed}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          void loadPresets();
        }}
      />
    </div>
  );
}

// ─── Tab: Audit log ───────────────────────────────────────────────────────────

interface AuditLogEntry {
  id: number;
  blockId: number;
  userId: number;
  username: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

const AUDIT_FIELD_LABELS: Record<string, string> = {
  jobPresetLabel: "Preset",
  dataStatusLabel: "DATA stav",
  dataRequiredDate: "DATA datum",
  dataOk: "DATA OK",
  materialStatusLabel: "Materiál stav",
  materialRequiredDate: "Materiál datum",
  materialOk: "Materiál OK",
  deadlineExpedice: "Expedice termín",
};

// ─── Tab: Pracovní doba ───────────────────────────────────────────────────────

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_LABELS_CS = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota", "Neděle"];
const SLOT_OPTIONS = Array.from({ length: 49 }, (_, i) => i); // 0–48

type WorkHoursDay = {
  id?: number;
  dayOfWeek: number;
  startSlot?: number | null;
  endSlot?: number | null;
  startHour?: number;
  endHour?: number;
  isActive: boolean;
};

type DayDraft = { dayOfWeek: number; startSlot: number; endSlot: number; isActive: boolean };

function fmtSlot(slot: number) {
  return formatSlot(slot);
}

function fmtDateRange(validFrom: string, validTo: string | null): string {
  const fmt = (s: string) => {
    const [y, m, d] = s.slice(0, 10).split("-");
    return `${Number(d)}.\u00a0${Number(m)}.`;
  };
  return validTo ? `${fmt(validFrom)}\u00a0–\u00a0${fmt(validTo)}` : `${fmt(validFrom)}\u00a0→`;
}

// Sdílená mřížka hodin — použita jak pro default šablonu, tak pro formulář dočasné šablony
function WorkHoursGrid({
  days,
  machines,
  onUpdate,
}: {
  days: WorkHoursDay[];
  machines: string[];
  onUpdate: (dayOfWeek: number, machine: string, patch: Partial<DayDraft>) => void;
}) {
  return (
    <div style={{
      background: "var(--surface-2)",
      borderRadius: 12,
      overflow: "hidden",
      border: `1px solid ${BORDER_SUBTLE}`,
      width: "fit-content",
    }}>
      {/* Hlavička */}
      <div style={{ display: "grid", gridTemplateColumns: `120px ${machines.map(() => "260px").join(" ")}`, gap: 1, background: BORDER_SUBTLE }}>
        <div style={{ background: "var(--surface-2)", padding: "10px 12px", fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Den</div>
        {machines.map((m) => (
          <div key={m} style={{ background: "var(--surface-2)", padding: "10px 12px", fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, textTransform: "uppercase" as const, letterSpacing: "0.05em", textAlign: "center" as const }}>{m.replace("_", " ")}</div>
        ))}
      </div>
      {DAY_ORDER.map((dow, di) => (
        <div key={dow} style={{ display: "grid", gridTemplateColumns: `120px ${machines.map(() => "260px").join(" ")}`, gap: 1, background: BORDER_SUBTLE }}>
          <div style={{ background: "var(--surface-2)", padding: "12px 12px", fontSize: 13, fontWeight: 500, color: dow === 0 || dow === 6 ? "var(--danger)" : TEXT_PRIMARY, display: "flex", alignItems: "center" }}>
            {DAY_LABELS_CS[di]}
          </div>
          {machines.map((machine) => {
            const row = days.find((d) => d.dayOfWeek === dow);
            if (!row) return <div key={machine} style={{ background: "var(--surface-2)" }} />;
            return (
              <div key={machine} style={{ background: "var(--surface-2)", padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
                <button
                  onClick={() => onUpdate(dow, machine, { isActive: !row.isActive })}
                  title={row.isActive ? "Provoz" : "Mimo provoz"}
                  style={{ width: 32, height: 18, borderRadius: 9, flexShrink: 0, background: row.isActive ? "var(--success)" : "var(--surface-3)", border: "none", cursor: "pointer", position: "relative" as const, transition: "background 0.15s ease-out" }}
                >
                  <span style={{ position: "absolute" as const, width: 14, height: 14, borderRadius: "50%", background: "var(--text)", top: 2, left: row.isActive ? 16 : 2, transition: "left 0.15s ease-out" }} />
                </button>
                {row.isActive ? (
                  <>
                    <select
                      value={getSlotRange(row).startSlot}
                      onChange={(e) => onUpdate(dow, machine, { startSlot: Number(e.target.value) })}
                      style={{ ...inputStyle, width: 74, padding: "3px 6px", fontSize: 12, height: 28 }}
                    >
                      {SLOT_OPTIONS.filter((slot) => slot < getSlotRange(row).endSlot).map((slot) => <option key={slot} value={slot}>{fmtSlot(slot)}</option>)}
                    </select>
                    <span style={{ fontSize: 11, color: TEXT_SECONDARY }}>–</span>
                    <select
                      value={getSlotRange(row).endSlot}
                      onChange={(e) => onUpdate(dow, machine, { endSlot: Number(e.target.value) })}
                      style={{ ...inputStyle, width: 74, padding: "3px 6px", fontSize: 12, height: 28 }}
                    >
                      {SLOT_OPTIONS.filter((slot) => slot > getSlotRange(row).startSlot).map((slot) => <option key={slot} value={slot}>{fmtSlot(slot)}</option>)}
                    </select>
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: TEXT_SECONDARY, fontStyle: "italic" }}>Celý den mimo provoz</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Týdenní přehled — zobrazuje se vedle WorkHoursGrid
function WeekSummary({ days }: { days: { dayOfWeek: number; startSlot?: number | null; endSlot?: number | null; startHour?: number; endHour?: number; isActive: boolean }[] }) {
  const DAY_SHORT = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
  const activeDays = days.filter((d) => d.isActive);
  const totalHours = activeDays.reduce((sum, d) => {
    const { startSlot, endSlot } = getSlotRange(d);
    return sum + durationHoursFromSlots(startSlot, endSlot);
  }, 0);
  const MAX_H = 18; // reference max pro vizuální bar

  return (
    <div style={{
      background: "var(--surface-2)", borderRadius: 12,
      border: `1px solid ${BORDER_SUBTLE}`, padding: "12px 14px",
      display: "flex", flexDirection: "column", gap: 10, minWidth: 160,
      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 4 }}>Přehled</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: TEXT_PRIMARY, letterSpacing: "-0.02em", lineHeight: 1 }}>{totalHours}<span style={{ fontSize: 12, fontWeight: 400, color: TEXT_SECONDARY, marginLeft: 3 }}>h / týden</span></div>
        <div style={{ fontSize: 11, color: TEXT_SECONDARY, marginTop: 2 }}>{activeDays.length} aktivních dnů</div>
      </div>
      {/* Bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
          const d = days.find((x) => x.dayOfWeek === dow);
          const hours = d?.isActive ? durationHoursFromSlots(getSlotRange(d).startSlot, getSlotRange(d).endSlot) : 0;
          const pct = Math.min(hours / MAX_H, 1);
          return (
            <div key={dow} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 500, color: TEXT_SECONDARY, width: 16, textAlign: "right" as const }}>{DAY_SHORT[dow]}</span>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--surface-3)", overflow: "hidden" }}>
                <div style={{ width: `${pct * 100}%`, height: "100%", borderRadius: 3, background: d?.isActive ? "#3b82f6" : "transparent", transition: "width 0.3s ease-out" }} />
              </div>
              <span style={{ fontSize: 10, color: d?.isActive ? TEXT_PRIMARY : TEXT_SECONDARY, width: 24, textAlign: "right" as const }}>{d?.isActive ? `${hours}h` : "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── DatePickerField ─────────────────────────────────────────────────────────
const MONTH_NAMES_CS = ["Leden","Únor","Březen","Duben","Květen","Červen","Červenec","Srpen","Září","Říjen","Listopad","Prosinec"];
const DAY_NAMES_CS   = ["Po","Út","St","Čt","Pá","So","Ne"];
const navBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 8, border: "none",
  background: "var(--surface-2)", color: "var(--text-muted)",
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", transition: "background 100ms ease-out",
};

const PRAGUE_DATE_FMT = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: "Europe/Prague",
  day: "numeric",
  month: "numeric",
});

function parseCivilDate(value: string): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const [year, month, day] = utcToPragueDateStr(parsed).split("-").map(Number);
  return { year, month, day };
}

function formatCivilDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return PRAGUE_DATE_FMT.format(parsed);
}

function datePartsToString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function DatePickerField({ value, onChange, placeholder = "Vyberte datum…" }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const todayParts = parseCivilDate(utcToPragueDateStr(new Date())) ?? { year: 1970, month: 1, day: 1 };
  const selected = parseCivilDate(value);
  const [viewYear,  setViewYear]  = useState(() => selected?.year  ?? todayParts.year);
  const [viewMonth, setViewMonth] = useState(() => (selected?.month ?? todayParts.month) - 1);

  useEffect(() => {
    const parts = parseCivilDate(value);
    if (parts) {
      setViewYear(parts.year);
      setViewMonth(parts.month - 1);
    }
  }, [value]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const firstDow = (new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const displayLabel = selected
    ? formatCivilDate(value)
    : placeholder;

  const CELL = 36; const GAP = 3;

  const trigger = (
    <button style={{
      height: 32, borderRadius: 6,
      border: "1px solid var(--border)", background: "var(--surface-2)",
      color: selected ? "var(--text)" : "var(--text-muted)",
      fontSize: 12, padding: "0 10px",
      display: "flex", alignItems: "center", gap: 6,
      cursor: "pointer", outline: "none", boxSizing: "border-box",
      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      transition: "border-color 120ms ease-out", whiteSpace: "nowrap",
    } as React.CSSProperties}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.4, flexShrink: 0 }}>
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      <span>{displayLabel}</span>
    </button>
  );

  if (!mounted) return trigger;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-auto p-0 border-0" style={{ background: "var(--surface)", borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.35)" }}>
        <div style={{ width: 7 * CELL + 6 * GAP + 32, padding: "16px 16px 12px", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <button onClick={prevMonth} style={navBtnStyle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em" }}>
              {MONTH_NAMES_CS[viewMonth]} {viewYear}
            </span>
            <button onClick={nextMonth} style={navBtnStyle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${CELL}px)`, gap: GAP, marginBottom: 4 }}>
            {DAY_NAMES_CS.map(d => (
              <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 500, color: "var(--text-muted)", paddingBottom: 4 }}>{d}</div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${CELL}px)`, gap: GAP }}>
            {cells.map((day, i) => {
              if (!day) return <div key={i} style={{ width: CELL, height: CELL }} />;
              const isSelected = !!selected && selected.day === day && selected.month - 1 === viewMonth && selected.year === viewYear;
              const isToday    = todayParts.day === day && todayParts.month - 1 === viewMonth && todayParts.year === viewYear;
              return (
                <button key={i}
                  onClick={() => { onChange(datePartsToString(viewYear, viewMonth + 1, day)); setOpen(false); }}
                  style={{
                    width: CELL, height: CELL, borderRadius: "50%",
                    background: isSelected ? "#3b82f6" : isToday && !isSelected ? "rgba(59,130,246,0.15)" : "transparent",
                    color: isSelected ? "#fff" : isToday ? "#3b82f6" : "var(--text)",
                    border: isToday ? "1.5px solid #3b82f6" : "1.5px solid transparent",
                    fontSize: 13, fontWeight: isSelected || isToday ? 700 : 400,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "background 100ms ease-out",
                  }}
                >{day}</button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function defaultDays(): DayDraft[] {
  return [
    { dayOfWeek: 1, startSlot: 12, endSlot: 44, isActive: true },
    { dayOfWeek: 2, startSlot: 12, endSlot: 44, isActive: true },
    { dayOfWeek: 3, startSlot: 12, endSlot: 44, isActive: true },
    { dayOfWeek: 4, startSlot: 12, endSlot: 44, isActive: true },
    { dayOfWeek: 5, startSlot: 12, endSlot: 44, isActive: true },
    { dayOfWeek: 6, startSlot: 12, endSlot: 44, isActive: false },
    { dayOfWeek: 0, startSlot: 12, endSlot: 44, isActive: false },
  ];
}

function WorkShiftsSection() {
  const [templates, setTemplates] = useState<MachineWorkHoursTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Default template edit state
  const [defaultDirty, setDefaultDirty] = useState(false);
  const [defaultSaving, setDefaultSaving] = useState(false);
  const [defaultError, setDefaultError] = useState("");

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addMachine, setAddMachine] = useState<"XL_105" | "XL_106" | "OBA">("OBA");
  const [addValidFrom, setAddValidFrom] = useState("");
  const [addValidTo, setAddValidTo] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addDays, setAddDays] = useState<DayDraft[]>(defaultDays());
  const [addError, setAddError] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [expandedTemplateId, setExpandedTemplateId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Edit state pro dočasné šablony
  const [editingDays, setEditingDays] = useState<Record<number, DayDraft[]>>({});
  const [editingSaving, setEditingSaving] = useState<number | null>(null);
  const [editingError, setEditingError] = useState<Record<number, string>>({});

  // Edit state pro metadata dočasných šablon (label, validFrom, validTo)
  const [editingMeta, setEditingMeta] = useState<Record<number, { label: string; validFrom: string; validTo: string }>>({});

  // Varování o kolizích bloků
  const [conflictWarning, setConflictWarning] = useState<{
    machine: string; validFrom: string; validTo: string | null;
    blocks: Array<{ id: number; orderNumber: string; startTime: string }>;
  } | null>(null);

  useEffect(() => {
    fetch("/api/machine-shifts")
      .then((r) => r.ok ? r.json() : [])
      .then((data: MachineWorkHoursTemplate[]) => { setTemplates(data); setLoading(false); })
      .catch(() => { setTemplates([]); setLoading(false); });
  }, []);

  function updateDefaultDay(machine: string, dayOfWeek: number, patch: Partial<DayDraft>) {
    setTemplates((prev) => prev.map((t) => {
      if (t.machine !== machine || !t.isDefault) return t;
      return { ...t, days: t.days.map((d) => d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d) };
    }));
    setDefaultDirty(true);
    setDefaultError("");
  }

  async function handleSaveDefault(machine: string) {
    const tmpl = templates.find((t) => t.machine === machine && t.isDefault);
    if (!tmpl) return;
    setDefaultSaving(true);
    setDefaultError("");
    try {
      const res = await fetch("/api/machine-shifts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machine,
          days: tmpl.days.map((d) => {
            const { startSlot, endSlot } = getSlotRange(d);
            return { dayOfWeek: d.dayOfWeek, startSlot, endSlot, isActive: d.isActive };
          }),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDefaultError(body.error ?? "Chyba při ukládání.");
      } else {
        setDefaultDirty(false);
        window.dispatchEvent(new CustomEvent("machineScheduleUpdated"));
      }
    } catch {
      setDefaultError("Síťová chyba.");
    } finally {
      setDefaultSaving(false);
    }
  }

  async function handleAddTemplate() {
    setAddError("");
    if (!addValidFrom) { setAddError("Zadej datum platnosti Od."); return; }
    if (addValidTo && addValidTo <= addValidFrom) { setAddError("Datum Do musí být po datu Od."); return; }

    const machines: string[] = addMachine === "OBA" ? ["XL_105", "XL_106"] : [addMachine];
    setAddSaving(true);
    try {
      for (const machine of machines) {
        const res = await fetch("/api/machine-shifts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            machine,
            label: addLabel || null,
            validFrom: addValidFrom,
            validTo: addValidTo || null,
            days: addDays,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setAddError(body.error ?? `Chyba při ukládání (${machine}).`);
          setAddSaving(false);
          return;
        }
        const created: MachineWorkHoursTemplate = await res.json();
        setTemplates((prev) => [...prev, created]);
        window.dispatchEvent(new CustomEvent("machineScheduleUpdated"));
        await checkAndShowConflicts(machine, addValidFrom, addValidTo || null, addDays);
      }
      // Reset form
      setShowAddForm(false);
      setAddValidFrom("");
      setAddValidTo("");
      setAddLabel("");
      setAddDays(defaultDays());
    } catch {
      setAddError("Síťová chyba.");
    } finally {
      setAddSaving(false);
    }
  }

  async function handleDeleteTemplate(id: number) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/machine-shifts/${id}`, { method: "DELETE" });
      if (res.ok || res.status === 204) {
        setTemplates((prev) => prev.filter((t) => t.id !== id));
        window.dispatchEvent(new CustomEvent("machineScheduleUpdated"));
      }
    } catch {
      // tiché selhání
    } finally {
      setDeletingId(null);
    }
  }

  function updateTempDay(templateId: number, baseDays: DayDraft[], dow: number, patch: Partial<DayDraft>) {
    setEditingDays((prev) => ({
      ...prev,
      [templateId]: (prev[templateId] ?? baseDays).map((d) => d.dayOfWeek === dow ? { ...d, ...patch } : d),
    }));
    setEditingError((prev) => ({ ...prev, [templateId]: "" }));
  }

  async function handleSaveTemplate(tmpl: MachineWorkHoursTemplate) {
    const days = editingDays[tmpl.id];
    const meta = editingMeta[tmpl.id];
    if (!days && !meta) return;
    if (meta && meta.validTo && meta.validTo <= meta.validFrom) {
      setEditingError((prev) => ({ ...prev, [tmpl.id]: "Datum Do musí být po datu Od." }));
      return;
    }
    setEditingSaving(tmpl.id);
    setEditingError((prev) => ({ ...prev, [tmpl.id]: "" }));
    try {
      const body: Record<string, unknown> = {};
      if (days) body.days = days;
      if (meta) {
        body.label = meta.label || null;
        body.validFrom = meta.validFrom;
        body.validTo = meta.validTo || null;
      }
      const res = await fetch(`/api/machine-shifts/${tmpl.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const bd = await res.json().catch(() => ({}));
        setEditingError((prev) => ({ ...prev, [tmpl.id]: bd.error ?? "Chyba při ukládání." }));
        return;
      }
      const updated: MachineWorkHoursTemplate = await res.json();
      setTemplates((prev) => prev.map((t) => t.id === updated.id ? updated : t));
      setEditingDays((prev) => { const n = { ...prev }; delete n[tmpl.id]; return n; });
      setEditingMeta((prev) => { const n = { ...prev }; delete n[tmpl.id]; return n; });
      window.dispatchEvent(new CustomEvent("machineScheduleUpdated"));
      const newFrom = meta?.validFrom ?? String(tmpl.validFrom).slice(0, 10);
      const newTo = meta?.validTo || (tmpl.validTo ? String(tmpl.validTo).slice(0, 10) : null);
      await checkAndShowConflicts(
        tmpl.machine,
        newFrom,
        newTo,
        days ?? tmpl.days.map((d) => {
          const { startSlot, endSlot } = getSlotRange(d);
          return { dayOfWeek: d.dayOfWeek, startSlot, endSlot, isActive: d.isActive };
        })
      );
    } catch {
      setEditingError((prev) => ({ ...prev, [tmpl.id]: "Síťová chyba." }));
    } finally {
      setEditingSaving(null);
    }
  }

  async function checkAndShowConflicts(
    machine: string, validFrom: string, validTo: string | null, days: DayDraft[]
  ) {
    try {
      const res = await fetch("/api/blocks");
      if (!res.ok) return;
      const all: Array<{
        id: number; machine: string; type: string;
        orderNumber: string; startTime: string; endTime: string;
      }> = await res.json();

      const fromTs = pragueToUTC(validFrom, 0, 0).getTime();
      const toTs = validTo ? pragueToUTC(validTo, 23, 59).getTime() + 59999 : Infinity;

      const conflicts = all.filter((b) => {
        if (b.machine !== machine || b.type !== "ZAKAZKA") return false;
        const startTs = new Date(b.startTime).getTime();
        if (startTs < fromTs || startTs > toTs) return false;
        const start = new Date(b.startTime);
        const end = new Date(b.endTime);
        const dow = pragueOf(start).dayOfWeek;
        const tmplDay = days.find((d) => d.dayOfWeek === dow);
        if (!tmplDay || !tmplDay.isActive) return true;
        const blockStartSlot = pragueOf(start).slot;
        const blockEndSlot = pragueOf(new Date(Math.max(start.getTime(), end.getTime() - 1))).slot + 1;
        return blockStartSlot < tmplDay.startSlot || blockEndSlot > tmplDay.endSlot;
      });

      if (conflicts.length > 0) {
        setConflictWarning({
          machine, validFrom, validTo,
          blocks: conflicts.map((b) => ({ id: b.id, orderNumber: b.orderNumber, startTime: b.startTime })),
        });
      }
    } catch { /* silent */ }
  }

  if (loading) return <div style={{ color: TEXT_SECONDARY, fontSize: 13, padding: 20, textAlign: "center" }}>Načítám…</div>;

  const machines = ["XL_105", "XL_106"] as const;
  const temporaryTemplates = templates.filter((t) => !t.isDefault);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Popis */}
      <div style={{ background: "var(--surface-2)", borderRadius: 12, padding: "12px 16px", fontSize: 12, color: TEXT_SECONDARY, lineHeight: 1.5 }}>
        Výchozí týdenní šablona pracovní doby. Dočasné šablony přebíjí výchozí v daném časovém období.
      </div>

      {/* Varování o kolizích bloků */}
      {conflictWarning && (
        <div style={{
          background: "rgba(234,179,8,0.12)", border: "1px solid rgba(234,179,8,0.35)",
          borderRadius: 12, padding: "14px 16px",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#ca8a04", marginBottom: 6 }}>
                ⚠ {conflictWarning.blocks.length} {conflictWarning.blocks.length === 1 ? "zakázka mimo" : conflictWarning.blocks.length < 5 ? "zakázky mimo" : "zakázek mimo"} nové směny — {conflictWarning.machine.replace("_", " ")}
              </div>
              <div style={{ fontSize: 12, color: TEXT_SECONDARY, marginBottom: 8 }}>
                Tyto zakázky jsou naplánované mimo provozní hodiny nové šablony. Klikni na zakázku pro otevření v plánovači.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {conflictWarning.blocks.map((b) => (
                  <a
                    key={b.id}
                    href={`/?q=${encodeURIComponent(b.orderNumber)}`}
                    style={{
                      background: "rgba(234,179,8,0.15)", border: "1px solid rgba(234,179,8,0.3)",
                      borderRadius: 6, padding: "3px 8px", fontSize: 12, fontWeight: 500, color: "#ca8a04",
                      textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer",
                    }}
                  >
                    {b.orderNumber} · {new Date(b.startTime).toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric" })}
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                  </a>
                ))}
              </div>
            </div>
            <button
              onClick={() => setConflictWarning(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: TEXT_SECONDARY, fontSize: 18, padding: "0 4px", flexShrink: 0 }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── A) Default šablony ──────────────────────────────────────── */}
      {machines.map((machine) => {
        const tmpl = templates.find((t) => t.machine === machine && t.isDefault);
        if (!tmpl) return (
          <div key={machine} style={{ color: TEXT_SECONDARY, fontSize: 13, padding: 12 }}>
            ⚠ Výchozí šablona pro {machine} nenalezena. Spusťte <code>npm run prisma:bootstrap</code>.
          </div>
        );
        return (
          <div key={machine} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY, paddingLeft: 2 }}>{machine.replace("_", " ")} — výchozí šablona</div>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" as const }}>
              <WorkHoursGrid
                days={tmpl.days}
                machines={[machine]}
                onUpdate={(dow, _m, patch) => updateDefaultDay(machine, dow, patch)}
              />
              <WeekSummary days={tmpl.days} />
            </div>
            {defaultError && <span style={{ fontSize: 12, color: "var(--danger)" }}>{defaultError}</span>}
            {defaultDirty && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button style={btnPrimary} disabled={defaultSaving} onClick={() => handleSaveDefault(machine)}>
                  {defaultSaving ? "Ukládám…" : "Uložit změny"}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* ── B) Dočasné šablony ──────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY, paddingLeft: 2 }}>Dočasné šablony</div>

        {temporaryTemplates.length === 0 && !showAddForm && (
          <div style={{ color: TEXT_SECONDARY, fontSize: 13, padding: "12px 0", fontStyle: "italic" }}>Žádné dočasné šablony</div>
        )}

        {temporaryTemplates.map((tmpl) => {
          const isExpanded = expandedTemplateId === tmpl.id;
          const isDeleting = deletingId === tmpl.id;
          const meta = editingMeta[tmpl.id];
          const origFrom = String(tmpl.validFrom).slice(0, 10);
          const origTo = tmpl.validTo ? String(tmpl.validTo).slice(0, 10) : "";
          const metaDirty = meta && (meta.label !== (tmpl.label ?? "") || meta.validFrom !== origFrom || meta.validTo !== origTo);
          const isDirty = !!editingDays[tmpl.id] || !!metaDirty;
          return (
            <div key={tmpl.id} style={{ background: "var(--surface-2)", borderRadius: 12, border: `1px solid ${BORDER_SUBTLE}`, overflow: "hidden" }}>
              {/* Řádek — celý klikatelný */}
              <div
                onClick={() => {
                  const next = isExpanded ? null : tmpl.id;
                  setExpandedTemplateId(next);
                  if (next !== null && !editingMeta[tmpl.id]) {
                    setEditingMeta((prev) => ({ ...prev, [tmpl.id]: { label: tmpl.label ?? "", validFrom: origFrom, validTo: origTo } }));
                  }
                }}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", cursor: "pointer", userSelect: "none" as const }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  style={{ color: TEXT_SECONDARY, flexShrink: 0, transition: "transform 0.2s ease-out", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: TEXT_PRIMARY }}>{tmpl.label || "Bez názvu"}</div>
                  <div style={{ fontSize: 11, color: TEXT_SECONDARY, marginTop: 2 }}>
                    {tmpl.machine.replace("_", " ")} · {fmtDateRange(tmpl.validFrom, tmpl.validTo)}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tmpl.id); }}
                  disabled={isDeleting}
                  title="Smazat šablonu"
                  style={{
                    background: "none", border: "none", cursor: isDeleting ? "not-allowed" : "pointer",
                    color: TEXT_SECONDARY, fontSize: 18, padding: "4px 6px", borderRadius: 6,
                    opacity: isDeleting ? 0.5 : 1, lineHeight: 1, flexShrink: 0,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = TEXT_SECONDARY)}
                >
                  {isDeleting ? "…" : "×"}
                </button>
              </div>
              {/* Rozbalená editace — iOS styl */}
              {isExpanded && meta && (
                <div style={{ borderTop: `1px solid ${BORDER_SUBTLE}`, padding: "16px" }}>
                  {/* iOS form rows */}
                  <div style={{ background: "var(--surface-3)", borderRadius: 10, marginBottom: 14, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", gap: 12, borderBottom: `1px solid ${BORDER_SUBTLE}` }}>
                      <span style={{ fontSize: 13, color: TEXT_SECONDARY, width: 72, flexShrink: 0 }}>Název</span>
                      <input
                        type="text"
                        value={meta.label}
                        onChange={(e) => setEditingMeta((prev) => ({ ...prev, [tmpl.id]: { ...prev[tmpl.id], label: e.target.value } }))}
                        placeholder="Volitelný popis"
                        style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 13, color: TEXT_PRIMARY, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", textAlign: "right" as const }}
                      />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", gap: 12, borderBottom: `1px solid ${BORDER_SUBTLE}`, justifyContent: "space-between" }}>
                      <span style={{ fontSize: 13, color: TEXT_SECONDARY, flexShrink: 0 }}>Platí od</span>
                      <DatePickerField value={meta.validFrom} onChange={(v) => setEditingMeta((prev) => ({ ...prev, [tmpl.id]: { ...prev[tmpl.id], validFrom: v } }))} placeholder="Vybrat datum" />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", gap: 12, justifyContent: "space-between" }}>
                      <span style={{ fontSize: 13, color: TEXT_SECONDARY, flexShrink: 0 }}>Platí do</span>
                      <DatePickerField value={meta.validTo} onChange={(v) => setEditingMeta((prev) => ({ ...prev, [tmpl.id]: { ...prev[tmpl.id], validTo: v } }))} placeholder="Bez omezení" />
                    </div>
                  </div>
                  {/* Grid + WeekSummary */}
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" as const }}>
                    <WorkHoursGrid
                      days={(editingDays[tmpl.id] ?? tmpl.days).map((d, i) => ({ ...d, id: i }))}
                      machines={[tmpl.machine]}
                      onUpdate={(dow, _m, patch) => updateTempDay(tmpl.id, tmpl.days.map((d) => {
                        const { startSlot, endSlot } = getSlotRange(d);
                        return { dayOfWeek: d.dayOfWeek, startSlot, endSlot, isActive: d.isActive };
                      }), dow, patch)}
                    />
                    <WeekSummary days={editingDays[tmpl.id] ?? tmpl.days} />
                  </div>
                  {editingError[tmpl.id] && (
                    <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 10 }}>{editingError[tmpl.id]}</div>
                  )}
                  {isDirty && (
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                      <button
                        style={{ padding: "7px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", background: "var(--surface-3)", color: TEXT_PRIMARY, border: `1px solid ${BORDER_SUBTLE}`, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }}
                        onClick={() => {
                          setEditingDays((prev) => { const n = { ...prev }; delete n[tmpl.id]; return n; });
                          setEditingMeta((prev) => ({ ...prev, [tmpl.id]: { label: tmpl.label ?? "", validFrom: origFrom, validTo: origTo } }));
                        }}
                      >
                        Zrušit
                      </button>
                      <button style={btnPrimary} disabled={editingSaving === tmpl.id} onClick={() => handleSaveTemplate(tmpl)}>
                        {editingSaving === tmpl.id ? "Ukládám…" : "Uložit změny"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Formulář pro přidání nové šablony */}
        {showAddForm && (
          <div style={{ background: "var(--surface-2)", borderRadius: 12, border: `1px solid ${BORDER_SUBTLE}`, padding: "16px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY, marginBottom: 12 }}>Nová dočasná šablona</div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
              {/* Stroj */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: TEXT_SECONDARY, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Stroj</label>
                <div style={{ display: "flex", gap: 4 }}>
                  {(["OBA", "XL_105", "XL_106"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setAddMachine(m)}
                      style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                        background: addMachine === m ? "#3b82f6" : "transparent",
                        color: addMachine === m ? "#fff" : TEXT_SECONDARY,
                        border: `1px solid ${addMachine === m ? "#3b82f6" : BORDER_SUBTLE}`,
                        fontWeight: addMachine === m ? 600 : 400,
                        transition: "all 0.15s ease-out",
                      }}
                    >
                      {m === "OBA" ? "Oba" : m.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>

              {/* Label */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: TEXT_SECONDARY, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Název (nepovinný)</label>
                <input
                  type="text"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder="např. Letní provoz"
                  style={{ ...inputStyle, width: 180, padding: "4px 8px", fontSize: 12, height: 28 }}
                />
              </div>

              {/* Platí od */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: TEXT_SECONDARY, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Platí od</label>
                <DatePickerField value={addValidFrom} onChange={setAddValidFrom} placeholder="Platí od…" />
              </div>

              {/* Platí do */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: TEXT_SECONDARY, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Platí do</label>
                <DatePickerField value={addValidTo} onChange={setAddValidTo} placeholder="Platí do…" />
                {addValidTo && addValidFrom && addValidTo <= addValidFrom && (
                  <span style={{ fontSize: 11, color: "var(--danger)" }}>Do musí být po Od</span>
                )}
              </div>
            </div>

            <WorkHoursGrid
              days={addDays.map((d, i) => ({ ...d, id: i }))}
              machines={addMachine === "OBA" ? ["XL_105", "XL_106"] : [addMachine]}
              onUpdate={(dow, _m, patch) => setAddDays((prev) => prev.map((d) => d.dayOfWeek === dow ? { ...d, ...patch } : d))}
            />

            {addError && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>{addError}</div>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button
                style={{ ...btnPrimary, background: "var(--surface-3)", color: TEXT_PRIMARY }}
                onClick={() => { setShowAddForm(false); setAddError(""); }}
              >
                Zrušit
              </button>
              <button style={btnPrimary} disabled={addSaving} onClick={handleAddTemplate}>
                {addSaving ? "Ukládám…" : "Uložit šablonu"}
              </button>
            </div>
          </div>
        )}

        {!showAddForm && (
          <button
            onClick={() => {
              // Předvyplnit addDays z aktuální default šablony (první nalezená)
              const defTmpl = templates.find((t) => t.isDefault);
              if (defTmpl) setAddDays(defTmpl.days.map((d) => {
                const { startSlot, endSlot } = getSlotRange(d);
                return { dayOfWeek: d.dayOfWeek, startSlot, endSlot, isActive: d.isActive };
              }));
              setShowAddForm(true);
            }}
            style={{ ...btnAddAccent, alignSelf: "flex-start" }}
          >
            + Přidat šablonu
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Audit log ───────────────────────────────────────────────────────────

function AuditLogSection() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/audit?limit=50")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { setLogs(data); setLoading(false); })
      .catch(() => { setLogs([]); setLoading(false); });
  }, []);

  function fmtDatetime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague", day: "2-digit", month: "2-digit" }) + " " +
      d.toLocaleTimeString("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit" });
  }

  function fmtVal(val: string | null, field: string | null) {
    if (!val || val === "null") return "—";
    if (field === "dataOk" || field === "materialOk") return val === "true" ? "✓ OK" : "✗ Ne";
    if (val.match(/^\d{4}-\d{2}-\d{2}/)) {
      try { return new Date(val).toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague" }); } catch { return val; }
    }
    return val;
  }

  if (loading) {
    return <div style={{ textAlign: "center", color: TEXT_SECONDARY, padding: 40, fontSize: 13 }}>Načítám…</div>;
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY, marginBottom: 12 }}>
        Posledních 50 záznamů
      </div>
      {logs.length === 0 ? (
        <div style={{ textAlign: "center", color: TEXT_SECONDARY, padding: 40, fontSize: 13 }}>
          Žádné záznamy.
        </div>
      ) : (
        <div style={{ borderRadius: 12, overflow: "hidden", border: `1px solid ${SEPARATOR}` }}>
          {logs.map((log, i) => (
            <div
              key={log.id}
              style={{
                display: "grid",
                gridTemplateColumns: "100px 80px 70px 1fr",
                gap: 8,
                padding: "10px 14px",
                borderTop: i > 0 ? `1px solid ${SEPARATOR}` : undefined,
                background: i % 2 === 0 ? "var(--surface)" : "var(--surface-2)",
                alignItems: "center",
                fontSize: 12,
              }}
            >
              <span style={{ color: TEXT_SECONDARY }}>{fmtDatetime(log.createdAt)}</span>
              <span style={{ fontWeight: 600, color: TEXT_PRIMARY }}>{log.username}</span>
              <span style={{ color: TEXT_SECONDARY }}>#{log.blockId}</span>
              <span style={{ color: TEXT_PRIMARY }}>
                {log.action === "UPDATE" && log.field ? (
                  <>
                    {AUDIT_FIELD_LABELS[log.field] ?? log.field}:{" "}
                    <span style={{ color: TEXT_SECONDARY }}>{fmtVal(log.oldValue, log.field)}</span>
                    {" → "}
                    <span style={{ color: TEXT_PRIMARY }}>{fmtVal(log.newValue, log.field)}</span>
                  </>
                ) : log.action === "CREATE" ? (
                  <span style={{ color: "#30d158" }}>Přidána</span>
                ) : log.action === "DELETE" ? (
                  <span style={{ color: "#ff453a" }}>Smazána</span>
                ) : log.action}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
