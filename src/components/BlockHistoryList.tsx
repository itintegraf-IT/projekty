"use client";

import { type BlockHistoryEntry } from "@/lib/blockHistory";
import { FIELD_LABELS, fmtAuditVal, classifyUndoRedoField } from "@/lib/auditFormatters";
import { formatPragueDateShort, formatPragueTime } from "@/lib/dateUtils";

/**
 * Řádky historie změn jedné zakázky — sloučená osa `AuditLog` + `BlockRevision`
 * z `GET /api/blocks/[id]/audit` (etapa 3 září 2026).
 *
 * Řádky jsou DOSLOVNĚ přesunuté z `BlockDetail.tsx`, včetně starších hex barev
 * vedle tokenů: plánovač nesmí v detailu bloku poznat žádný rozdíl. Sdílí je
 * detail (v rámečku s nadpisem, `maxHeight` 220 px) a `BlockHistoryDialog` (bez
 * `maxHeight` — seznam vyplní dialog a scrolluje uvnitř něj).
 *
 * Komponenta nic nenačítá a nic nefiltruje. Data drží `useBlockHistory`, poznámky
 * tiskaře rolím bez práva odstraňuje už server (`visibleHistoryFor`).
 */
export function BlockHistoryList({ entries, maxHeight }: { entries: BlockHistoryEntry[]; maxHeight?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        ...(maxHeight !== undefined ? { maxHeight } : { flex: 1, minHeight: 0 }),
      }}
    >
      {entries.map((log, i) => {
        // Revizní řádek: co se SKUTEČNĚ změnilo v databázi (přesun, natažení,
        // zamčení, popis) — tedy to, o čem `AuditLog` mlčí. Rozvržení je
        // schválně TOTOŽNÉ s auditním řádkem níž: je to jedna časová osa,
        // ne dva seznamy. Popisek děje se bere z `label`, NIKDY z `action`
        // (ten neodliší směr a u přeřazení v expedici není z čeho odvozovat).
        if (log.source === "revision") {
          return (
            <div key={`r${log.id}`} style={{ padding: "5px 10px", borderTop: i > 0 ? "1px solid var(--border)" : undefined, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)", whiteSpace: "nowrap", paddingTop: 1, minWidth: 70 }}>
                {formatPragueDateShort(new Date(log.createdAt))} {formatPragueTime(new Date(log.createdAt))}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", flex: 1 }}>
                <span style={{ color: "var(--text)", fontWeight: 600 }}>{log.username}</span>
                {/* Změna, která se sem jen promítla z jiného bloku (dnes výhradně
                    sdílené pole rozdělené zakázky). Text i barva jsou schválně
                    TOTOŽNÉ s auditním řádkem SPLIT_PROPAGATE o kus níž — jinak by
                    táž věc měla v jednom panelu dvě různé podoby. */}
                {log.propagated && (
                  <span style={{ color: "var(--info)" }}> · ↔ Převzato z rozdělené zakázky</span>
                )}
                {log.lines.map((line, j) => (
                  <span key={j} style={{ color: "var(--text)" }}> · {line}</span>
                ))}
              </div>
            </div>
          );
        }
        // Fix round 1 (review): klasifikace se počítá jednou za řádek, ať ji obě
        // podmínky níž (span vs. seznam polí) čtou konzistentně ze stejného zdroje.
        // Konzistentní s InfoPanel.tsx — obě místa musí ukazovat totéž.
        const undoRedo = log.action === "UNDO" || log.action === "REDO"
          ? classifyUndoRedoField(log.field, log.newValue)
          : null;
        return (
        <div key={log.id} style={{ padding: "5px 10px", borderTop: i > 0 ? "1px solid var(--border)" : undefined, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", whiteSpace: "nowrap", paddingTop: 1, minWidth: 70 }}>
            {formatPragueDateShort(new Date(log.createdAt))} {formatPragueTime(new Date(log.createdAt))}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", flex: 1 }}>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>{log.username}</span>
            {log.action === "UPDATE" && log.field && (
              <span> · {FIELD_LABELS[log.field] ?? log.field}: <span style={{ color: "var(--text)" }}>{fmtAuditVal(log.oldValue, log.field)} → {fmtAuditVal(log.newValue, log.field)}</span></span>
            )}
            {/* Propagace sdíleného pole ze split skupiny — odlišeno od UPDATE, protože
                šlo o jeden zásah na jiném bloku, který se sem jen automaticky promítl
                (ne nezávislou editaci tohoto bloku). Konzistentní s InfoPanel.tsx. */}
            {log.action === "SPLIT_PROPAGATE" && log.field && (
              <span> · <span style={{ color: "var(--info)" }}>↔ Převzato z rozdělené zakázky</span> · {FIELD_LABELS[log.field] ?? log.field}: <span style={{ color: "var(--text)" }}>{fmtAuditVal(log.oldValue, log.field)} → {fmtAuditVal(log.newValue, log.field)}</span></span>
            )}
            {log.action === "CREATE" && <span style={{ color: "#22c55e" }}> · Přidána</span>}
            {log.action === "DELETE" && <span style={{ color: "#ef4444" }}> · Smazána</span>}
            {log.action === "EXPEDITION_PUBLISH" && <span style={{ color: "#22c55e" }}> · Zařazena do expedice</span>}
            {log.action === "EXPEDITION_UNPUBLISH" && <span style={{ color: "#f59e0b" }}> · Odebrána z expedice</span>}
            {/* Potvrzení/vrácení tisku. Tenhle panel je (na rozdíl od InfoPanel.tsx)
                neuměl a řádek se vykreslil PRÁZDNÝ — jen jméno a čas. Doplněno
                v Tasku 12: mapa pokrytí `auditCoverage.ts` u PRINT_* revizi
                ZÁMĚRNĚ potlačuje s odůvodněním „pokrývá ji auditní řádek", takže
                bez téhle větve by potvrzení tisku z osy zmizelo úplně. Texty jsou
                shodné s InfoPanel.tsx, barvy přes tokeny (hex vedle je starší kód). */}
            {log.action === "PRINT_COMPLETE" && <span style={{ color: "var(--success)" }}> · ✓ Tisk dokončen</span>}
            {log.action === "PRINT_UNDO" && <span style={{ color: "var(--warning)" }}> · Vráceno hotovo</span>}
            {log.action === "PRINT_RESET" && <span style={{ color: "var(--text-muted)" }}> · Reset potvrzení (přeplánováno)</span>}
            {log.action === "AUTO_SHIFT" && log.oldValue && log.newValue && (
              <span style={{ color: "#f59e0b" }}> · Automaticky posunuto: <span style={{ color: "var(--text)" }}>{fmtAuditVal(log.oldValue, "startTime")} → {fmtAuditVal(log.newValue, "startTime")}</span></span>
            )}
            {log.action === "AUTO_REFLOW" && log.oldValue && log.newValue && (
              <span style={{ color: "#f59e0b" }}> · ⟳ přepočet dle kalendáře: <span style={{ color: "var(--text)" }}>{fmtAuditVal(log.oldValue, "startTime")} → {fmtAuditVal(log.newValue, "startTime")}</span></span>
            )}
            {undoRedo && (
              <span style={{ color: "var(--text-muted)" }}>
                {" "}· {log.action === "UNDO" ? "↶ vráceno zpět" : "↷ znovu provedeno"}
                {/* I2 (go/no-go audit 5. 8. 2026), rozšířeno fix round 1: "fields" značí
                    čistě obchodní obnovu (oldValue/newValue nejsou span, ale seznam klíčů
                    — NESMÍ se vykreslit jako šipka mezi časy, falešný dojem přesunu, který
                    se nekonal). "mixed" (fix round 1) obnovilo POZICI I business pole
                    zároveň v jednom kroku — ukáže OBOJÍ, jinak by smíšená editace (dnes
                    nejběžnější případ, viz mergeAnchorPositionIfChanged) o vrácených
                    polích mlčela stejně, jako to dřív dělala vždy. */}
                {undoRedo.kind !== "fields" && log.oldValue && log.newValue && (
                  <span style={{ color: "var(--text)" }}>: {fmtAuditVal(log.oldValue, "startTime")} → {fmtAuditVal(log.newValue, "startTime")}</span>
                )}
                {undoRedo.kind !== "position" && undoRedo.keys.length > 0 && (
                  <span style={{ color: "var(--text)" }}>{undoRedo.kind === "mixed" ? " · " : ": "}obnoveno {undoRedo.keys.map((k) => FIELD_LABELS[k] ?? k).join(", ")}</span>
                )}
              </span>
            )}
            {log.action === "NOTE_CREATE" && log.newValue && (
              <span> · <span style={{ color: "#f59e0b" }}>📝 Přidána poznámka tiskaře:</span> <span style={{ color: "var(--text)" }}>{log.newValue}</span></span>
            )}
            {log.action === "NOTE_UPDATE" && (
              <span> · <span style={{ color: "#f59e0b" }}>📝 Upravena poznámka:</span> <span style={{ color: "var(--text)" }}>{log.oldValue ?? ""} → {log.newValue ?? ""}</span></span>
            )}
            {log.action === "NOTE_DELETE" && (
              <span> · <span style={{ color: "#ef4444" }}>📝 Smazána poznámka:</span> <span style={{ color: "var(--text-muted)" }}>{log.oldValue ?? ""}</span></span>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}
