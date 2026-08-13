"use client";

import { useState, useEffect, useCallback } from "react";

// ── Tvary z /api/report/health (Date pole přicházejí jako ISO stringy) ──
export type BlockRef = { id: number; orderNumber: string; type: string; startTime: string; endTime: string };
export type OverlapPair = { machine: string; a: BlockRef; b: BlockRef; overlapStart: string; overlapEnd: string; overlapMinutes: number };
export type DriftItem = { id: number; orderNumber: string; machine: string; startTime: string; storedEnd: string; expectedEnd: string | null; reason: string };
export type IntegrityItem = { id: number; orderNumber: string; machine: string; type: string; startTime: string; detail: string };
export type IntegrityIssue = { key: string; label: string; count: number; items: IntegrityItem[] };
export type AttachmentFileRow = { id: number; reservationId: number; originalName: string; storageKey: string };
export type DiskEntry = { reservationId: number; storageKey: string };
export type HealthData = {
  checkedAt: string;
  checks: {
    overlaps: { count: number; items: OverlapPair[] };
    drift: { count: number; items: DriftItem[] };
    outsideHours: { count: number; items: DriftItem[] };
    integrity: { count: number; breakdown: IntegrityIssue[] };
    attachments: { count: number; missingFiles: AttachmentFileRow[]; orphanFiles: DiskEntry[] };
  };
};

export interface UseHealthData {
  data: HealthData | null;
  loading: boolean;
  error: string | null;
  /** Celkový počet nálezů napříč všemi 5 kontrolami. */
  total: number;
  /** Kolik z 5 kontrol má alespoň jeden nález. */
  badChecks: number;
  refetch: () => void;
}

function countFindings(data: HealthData): { total: number; badChecks: number } {
  const counts = [
    data.checks.overlaps.count,
    data.checks.drift.count,
    data.checks.outsideHours.count,
    data.checks.integrity.count,
    data.checks.attachments.count,
  ];
  return {
    total: counts.reduce((a, c) => a + c, 0),
    badChecks: counts.filter((c) => c > 0).length,
  };
}

/**
 * Jediný zdroj pravdy pro data Kontrolního panelu. Fetchuje se jednou při
 * vstupu do Reportů, aby odznak s počtem nálezů byl vidět i bez otevření
 * záložky — a zároveň krmí samotný panel (žádný dvojitý běh drahých kontrol).
 */
export function useHealthData(): UseHealthData {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/report/health");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Neznámá chyba");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const { total, badChecks } = data ? countFindings(data) : { total: 0, badChecks: 0 };

  return { data, loading, error, total, badChecks, refetch };
}
