"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import ReservationForm from "./ReservationForm";
import ReservationList from "./ReservationList";
import ReservationDetail from "./ReservationDetail";
import ThemeToggle from "@/app/_components/ThemeToggle";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

export interface Reservation {
  id: number;
  code: string;
  status: string;
  companyName: string;
  erpOfferNumber: string;
  requestedExpeditionDate: string;
  requestedDataDate: string;
  requestText: string | null;
  requestedByUserId: number;
  requestedByUsername: string;
  plannerUserId: number | null;
  plannerUsername: string | null;
  plannerDecisionReason: string | null;
  planningPayload: Record<string, unknown> | null;
  preparedAt: string | null;
  scheduledBlockId: number | null;
  scheduledMachine: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: ReservationAttachment[];
}

export interface ReservationAttachment {
  id: number;
  reservationId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: number;
  uploadedByUsername: string;
  createdAt: string;
}

interface Props {
  currentUser: { id: number; username: string; role: string };
  initialSelectedId?: number;
}

type TabObchodnik = "nova" | "aktivni" | "archiv";
type TabPlanner = "nova" | "nove" | "fronta" | "archiv";
type AnyTab = TabObchodnik | TabPlanner;

const isObchodnik = (role: string) => role === "OBCHODNIK";
const isPlanner = (role: string) => ["ADMIN", "PLANOVAT"].includes(role);

export default function RezervacePage({ currentUser, initialSelectedId }: Props) {
  const router = useRouter();
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  const [activeTab, setActiveTab] = useState<AnyTab>(
    isObchodnik(currentUser.role) ? "nova" : "nove"
  );
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Ref pro deep link — drží pending ID přes re-rendery, vyčistí se po úspěšném výběru
  const deepLinkPendingId = useRef<number | null>(initialSelectedId ?? null);

  // Mapování záložky → bucket pro API
  function tabToBucket(tab: AnyTab): string {
    if (tab === "nova" || tab === "nove") return "new";
    if (tab === "aktivni" || tab === "fronta") return "active";
    return "archive";
  }

  const fetchReservations = useCallback(async (tab: AnyTab) => {
    setLoading(true);
    // Nečistit selectedId pokud čekáme na deep link výběr — ten nastavíme po fetchnutí dat
    if (!deepLinkPendingId.current) {
      setSelectedId(null);
    }
    try {
      const bucket = tabToBucket(tab);
      const res = await fetch(`/api/reservations?bucket=${bucket}`);
      if (!res.ok) throw new Error("Chyba načítání");
      const data: Reservation[] = await res.json();
      setReservations(data);
      // Po načtení dat: pokud čeká deep link, vybrat odpovídající rezervaci
      if (deepLinkPendingId.current) {
        const found = data.find((r) => r.id === deepLinkPendingId.current);
        if (found) {
          setSelectedId(found.id);
          deepLinkPendingId.current = null;
        }
      }
    } catch (err) {
      console.error("[RezervacePage] fetchReservations", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "nova") {
      fetchReservations(activeTab);
    }
  }, [activeTab, fetchReservations]);

  // Deep link: ?id=X — zjistit stav rezervace a přepnout na správnou záložku
  // fetchReservations po přepnutí záložky pak sám nastaví selectedId přes deepLinkPendingId
  useEffect(() => {
    if (!initialSelectedId) return;
    (async () => {
      try {
        const res = await fetch(`/api/reservations/${initialSelectedId}`);
        if (!res.ok) return;
        const r: Reservation = await res.json();
        let targetTab: AnyTab;
        if (isObchodnik(currentUser.role)) {
          targetTab = r.status === "SUBMITTED" || r.status === "ACCEPTED" || r.status === "QUEUE_READY"
            ? "aktivni" : "archiv";
        } else {
          if (r.status === "SUBMITTED") targetTab = "nove";
          else if (r.status === "ACCEPTED" || r.status === "QUEUE_READY") targetTab = "fronta";
          else targetTab = "archiv";
        }
        // Pokud je to jiná záložka než výchozí, přepnout — to spustí fetchReservations který vybere item
        // Pokud je to ta samá záložka, fetchReservations se znovu nespustí — vybrat přímo
        setActiveTab((prev) => {
          if (prev === targetTab) {
            // Záložka se nemění → fetchReservations se znovu nespustí → vybrat teď
            setReservations((prevRes) => {
              const found = prevRes.find((x) => x.id === r.id);
              if (found) {
                setSelectedId(r.id);
                deepLinkPendingId.current = null;
              }
              return prevRes;
            });
          }
          return targetTab;
        });
      } catch {
        // Ignorovat — odkaz je nepovinný
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedId]);

  function handleTabChange(tab: AnyTab) {
    setActiveTab(tab);
  }

  function handleCreated() {
    // Po úspěšném vytvoření → přepnout na Moje aktivní
    setActiveTab(isObchodnik(currentUser.role) ? "aktivni" : "fronta");
  }

  function handleReservationUpdated() {
    fetchReservations(activeTab);
    setSelectedId(null);
  }

  const selectedReservation = reservations.find((r) => r.id === selectedId) ?? null;

  const tabsObchodnik: { key: TabObchodnik; label: string }[] = [
    { key: "nova", label: "Nová žádost" },
    { key: "aktivni", label: "Moje aktivní" },
    { key: "archiv", label: "Archiv" },
  ];

  const tabsPlanner: { key: TabPlanner; label: string }[] = [
    { key: "nova", label: "Nová žádost" },
    { key: "nove", label: "Nové žádosti" },
    { key: "fronta", label: "K naplánování" },
    { key: "archiv", label: "Archiv" },
  ];

  const tabs = isObchodnik(currentUser.role) ? tabsObchodnik : tabsPlanner;

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--background)",
      color: "var(--foreground)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
    }}>
      {/* Header */}
      <header style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 20px",
        height: 52,
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
      }}>
        <button
          onClick={() => router.push("/")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 8,
            border: "none",
            background: "var(--surface-2)",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 13,
            fontFamily: "inherit",
          }}
        >
          ← Planner
        </button>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Rezervace</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 12,
            color: "var(--text-muted)",
            background: "var(--surface-2)",
            padding: "3px 8px",
            borderRadius: 6,
          }}>
            {currentUser.username} · {currentUser.role}
          </span>
          <ThemeToggle />
          <button
            onClick={handleLogout}
            style={{ padding: "3px 10px", fontSize: 11, borderRadius: 6, background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer", fontFamily: "inherit" }}
          >
            Odhlásit
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "20px 16px" }}>
        {/* Segmented control — záložky */}
        <div style={{
          display: "flex",
          gap: 2,
          background: "var(--surface-2)",
          borderRadius: 10,
          padding: 3,
          marginBottom: 24,
        }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key as AnyTab)}
              style={{
                flex: 1,
                padding: "7px 12px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
                fontFamily: "inherit",
                transition: "background 150ms ease-out, color 150ms ease-out",
                background: activeTab === tab.key ? "var(--card)" : "transparent",
                color: activeTab === tab.key ? "var(--foreground)" : "var(--text-muted)",
                boxShadow: activeTab === tab.key ? "0 1px 4px rgba(0,0,0,0.12)" : "none",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Obsah záložek */}
        {(activeTab === "nova") && (
          <ReservationForm currentUser={currentUser} onCreated={handleCreated} />
        )}

        {(activeTab !== "nova") && (
          <div style={{ display: "grid", gap: 12 }}>
            {loading ? (
              <LoadingSpinner />
            ) : reservations.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontSize: 14 }}>
                Žádné rezervace v této kategorii
              </div>
            ) : (
              reservations.map((r) => (
                <div key={r.id}>
                  <ReservationList
                    reservation={r}
                    currentUser={currentUser}
                    isSelected={r.id === selectedId}
                    onSelect={() => setSelectedId(selectedId === r.id ? null : r.id)}
                  />
                  {selectedId === r.id && (
                    <ReservationDetail
                      reservation={r}
                      currentUser={currentUser}
                      onUpdated={handleReservationUpdated}
                    />
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
