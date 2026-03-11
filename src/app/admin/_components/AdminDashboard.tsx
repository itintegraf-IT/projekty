"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@/lib/auth";

// ─── Typy ────────────────────────────────────────────────────────────────────

interface AdminUser {
  id: number;
  username: string;
  role: string;
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
}

// ─── Konstanty ───────────────────────────────────────────────────────────────

const ROLES = ["ADMIN", "PLANOVAT", "MTZ", "DTP", "VIEWER"] as const;
type Role = typeof ROLES[number];

const ROLE_COLORS: Record<string, string> = {
  ADMIN: "#ff453a",
  PLANOVAT: "#3b82f6",
  MTZ: "#30d158",
  DTP: "#ff9f0a",
  VIEWER: "#636366",
};
const ROLE_BG: Record<string, string> = {
  ADMIN: "rgba(255,69,58,0.15)",
  PLANOVAT: "rgba(59,130,246,0.15)",
  MTZ: "rgba(48,209,88,0.15)",
  DTP: "rgba(255,159,10,0.15)",
  VIEWER: "rgba(99,99,102,0.15)",
};
const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  PLANOVAT: "Plánovač",
  MTZ: "MTZ",
  DTP: "DTP",
  VIEWER: "Prohlížeč",
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

// ─── Komponenta ──────────────────────────────────────────────────────────────

export default function AdminDashboard({ currentUser }: { currentUser: SessionUser }) {
  const [activeTab, setActiveTab] = useState<"users" | "codebook">("users");

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
          color: "var(--accent)", fontSize: 14, textDecoration: "none",
          fontWeight: 500,
        }}>
          <svg width="8" height="13" viewBox="0 0 8 13" fill="none">
            <path d="M7 1L1 6.5L7 12" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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
          {(["users", "codebook"] as const).map((tab) => (
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
              {tab === "users" ? "Uživatelé" : "Číselníky"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "20px" }}>
        {activeTab === "users" ? (
          <UsersSection currentUserId={currentUser.id} />
        ) : (
          <CodebookSection />
        )}
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
      body: JSON.stringify({ username: addUsername.trim(), password: addPassword, role: addRole }),
    });
    if (res.ok) {
      setAddUsername(""); setAddPassword(""); setAddRole("PLANOVAT");
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
          style={{
            display: "flex", alignItems: "center", gap: 5,
            background: "transparent", border: "none",
            color: "var(--accent)", fontSize: 13, fontWeight: 500,
            cursor: "pointer", padding: "4px 8px",
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6.25" stroke="var(--accent)" strokeWidth="1.5"/>
            <line x1="7" y1="4" x2="7" y2="10" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="4" y1="7" x2="10" y2="7" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
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
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showRolePopover]);

  async function handleRoleChange(role: string) {
    setShowRolePopover(false);
    await fetch(`/api/admin/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    onUpdate();
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
              minWidth: 160,
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}>
              {ROLES.map((role) => (
                <button
                  key={role}
                  onClick={() => handleRoleChange(role)}
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
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: ROLE_COLORS[role],
                    flexShrink: 0,
                  }} />
                  <span style={{ flex: 1 }}>{ROLE_LABELS[role]}</span>
                  {role === user.role && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              ))}
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
    loadItems(category);
  }, [category]);

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!addLabel.trim()) return;
    setAddLoading(true);
    const res = await fetch("/api/codebook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, label: addLabel.trim(), isWarning: addIsWarning }),
    });
    if (res.ok) {
      setAddLabel(""); setAddIsWarning(false); setShowAddForm(false);
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
              border: `1px solid ${category === cat ? "var(--accent)" : BORDER_SUBTLE}`,
              background: category === cat ? "color-mix(in oklab, var(--accent) 15%, transparent)" : "transparent",
              color: category === cat ? "var(--accent)" : TEXT_SECONDARY,
              fontSize: 13,
              fontWeight: category === cat ? 600 : 400,
              cursor: "pointer",
              fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
              transition: "all 0.1s ease-out",
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
          onClick={() => { setShowAddForm(!showAddForm); setAddLabel(""); setAddIsWarning(false); }}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            background: "transparent", border: "none",
            color: "var(--accent)", fontSize: 13, fontWeight: 500,
            cursor: "pointer", padding: "4px 8px",
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6.25" stroke="var(--accent)" strokeWidth="1.5"/>
            <line x1="7" y1="4" x2="7" y2="10" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="4" y1="7" x2="10" y2="7" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
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
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" style={btnSecondary} onClick={() => { setShowAddForm(false); }}>Zrušit</button>
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
