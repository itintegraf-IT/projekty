"use client";

import { useState, useEffect, useCallback } from "react";
import { summarizeHealth } from "@/lib/healthSummary";

// ── Tvary z /api/report/health (Date pole přicházejí jako ISO stringy) ──
export type BlockRef = { id: number; orderNumber: string; type: string; startTime: string; endTime: string };
export type OverlapPair = { machine: string; a: BlockRef; b: BlockRef; overlapStart: string; overlapEnd: string; overlapMinutes: number };
export type DriftItem = { id: number; orderNumber: string; machine: string; startTime: string; storedEnd: string; expectedEnd: string | null; reason: string };
export type IntegrityItem = { id: number; orderNumber: string; machine: string; type: string; startTime: string; detail: string };
export type IntegrityIssue = { key: string; label: string; count: number | null; items: IntegrityItem[]; error?: string };
export type AttachmentFileRow = { id: number; reservationId: number; originalName: string; storageKey: string };
export type DiskEntry = { reservationId: number; storageKey: string };
export type HealthData = {
  checkedAt: string;
  checks: {
    overlaps: { count: number | null; items: OverlapPair[]; error?: string };
    drift: { count: number | null; items: DriftItem[]; error?: string };
    outsideHours: { count: number | null; items: DriftItem[]; error?: string };
    integrity: { count: number | null; breakdown: IntegrityIssue[]; error?: string };
    attachments: { count: number | null; missingFiles: AttachmentFileRow[]; orphanFiles: DiskEntry[]; error?: string };
  };
};

export interface UseHealthData {
  data: HealthData | null;
  loading: boolean;
  error: string | null;
  /** Celkový počet nálezů napříč spočtenými kontrolami. */
  total: number;
  /** Kolik z 5 kontrol má alespoň jeden nález. */
  badChecks: number;
  /** Kolik z 5 kontrol se nepodařilo spočítat. */
  uncomputed: number;
  refetch: () => void;
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

  const { total, badChecks, uncomputed } = data
    ? summarizeHealth([
        data.checks.overlaps, data.checks.drift, data.checks.outsideHours,
        data.checks.integrity, data.checks.attachments,
      ])
    : { total: 0, badChecks: 0, uncomputed: 0 };

  return { data, loading, error, total, badChecks, uncomputed, refetch };
}
