import { useEffect, useMemo, useRef, useState } from "react";
import type { Block, CompanyDay } from "@/app/_components/TimelineGrid";
import { normalizeBlockVariant, type BlockVariant } from "@/lib/blockVariants";
import {
  addDaysToCivilDate,
  addMonthsToCivilDate,
  normalizeCivilDateInput,
  pragueToUTC,
  utcToPragueDateStr,
  utcToPragueHour,
} from "@/lib/dateUtils";
import { snapToNextValidStartWithTemplates } from "@/lib/workingTime";
import { findNextFreeSlot } from "@/lib/scheduleSlotFinder";
import { typeUsesTiskoveHodiny } from "@/lib/printTime";
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import {
  applyJobPresetToDraft,
  presetSupportsType,
  type JobPreset,
  type JobPresetDraftValues,
} from "@/lib/jobPresets";
import { DEFAULT_DURATION_HOURS, type CodebookOption } from "@/lib/plannerTypes";
import { parseProductionTags } from "@/lib/productionTags";
import type { Toast } from "@/components/ToastContainer";

// ─── Typy ─────────────────────────────────────────────────────────────────────
export type QueueItem = {
  id: number | string;
  orderNumber: string;
  type: string;
  blockVariant: BlockVariant;
  jobPresetId?: number | null;
  jobPresetLabel?: string | null;
  machine?: string | null;
  durationHours: number;
  description: string;
  dataStatusId: number | null;
  dataStatusLabel: string | null;
  dataRequiredDate: string | null;
  materialStatusId: number | null;
  materialStatusLabel: string | null;
  materialRequiredDate: string | null;
  materialInStock: boolean;
  materialIssued: boolean;
  pantoneInStock: boolean;
  pantoneIssued: boolean;
  pantoneRequiredDate: string | null;
  pantoneOk: boolean;
  pantoneRequired: boolean;
  barvyStatusId: number | null;
  barvyStatusLabel: string | null;
  lakStatusId: number | null;
  lakStatusLabel: string | null;
  specifikace: string;
  deadlineExpedice: string;
  recurrenceType: string;
  recurrenceCount: number;
  obalka: boolean;
  vnitrky: boolean;
  tiskoveArchy: string[];
  serie: string[];
  // Rezervace-specific
  reservationId?: number;
  reservationCode?: string;
  companyName?: string;
  reservationMachine?: string | null;
};

function emptyPresetDraft(type: string): JobPresetDraftValues {
  return {
    blockVariant: type === "ZAKAZKA" ? "STANDARD" : normalizeBlockVariant("STANDARD", type),
    specifikace: "",
    dataStatusId: "",
    dataRequiredDate: "",
    materialStatusId: "",
    materialRequiredDate: "",
    materialInStock: false,
    pantoneRequired: false,
    pantoneRequiredDate: "",
    pantoneInStock: false,
    barvyStatusId: "",
    lakStatusId: "",
    deadlineExpedice: "",
    jobPresetId: null,
    jobPresetLabel: "",
  };
}

// ─── Reservation queue types ──────────────────────────────────────────────────
export type ReservationQueueItem = {
  id: number;
  code: string;
  companyName: string;
  planningPayload: Record<string, unknown> | null;
  requestedExpeditionDate: string | null;
  requestedDataDate: string | null;
  preparedAt: string | null;
};

export function reservationToQueueItem(r: ReservationQueueItem): QueueItem {
  const p = r.planningPayload ?? {};
  return {
    id: `r_${r.id}`,
    orderNumber: r.code,
    type: "REZERVACE",
    blockVariant: "STANDARD",
    // Výrobní štítky z planningPayload (PlanningForm je ukládá stejným tvarem
    // jako Block — archy/série jako JSON string). Do 8/2026 tu byly natvrdo
    // false/[] a štítky nastavené plánovačem u rezervace se cestou do fronty
    // tiše ztrácely.
    obalka: Boolean(p.obalka),
    vnitrky: Boolean(p.vnitrky),
    tiskoveArchy: parseProductionTags(typeof p.tiskoveArchy === "string" ? p.tiskoveArchy : null),
    serie: parseProductionTags(typeof p.serie === "string" ? p.serie : null),
    jobPresetId: typeof p.jobPresetId === "number" ? p.jobPresetId : typeof p.jobPresetId === "string" ? Number(p.jobPresetId) || null : null,
    jobPresetLabel: typeof p.jobPresetLabel === "string" ? p.jobPresetLabel : null,
    durationHours: typeof p.durationHours === "number" ? p.durationHours : DEFAULT_DURATION_HOURS,
    description: typeof p.description === "string" ? p.description : r.companyName,
    dataStatusId: null,
    dataStatusLabel: null,
    dataRequiredDate: typeof p.dataRequiredDate === "string" ? p.dataRequiredDate : r.requestedDataDate ? r.requestedDataDate.slice(0, 10) : null,
    materialStatusId: null,
    materialStatusLabel: null,
    materialRequiredDate: typeof p.materialRequiredDate === "string" ? p.materialRequiredDate : null,
    materialInStock: Boolean(p.materialInStock),
    materialIssued: Boolean(p.materialIssued),
    pantoneInStock: Boolean(p.pantoneInStock),
    pantoneIssued: Boolean(p.pantoneIssued),
    pantoneRequiredDate: typeof p.pantoneRequiredDate === "string" ? p.pantoneRequiredDate : null,
    pantoneOk: Boolean(p.pantoneOk),
    pantoneRequired: Boolean(p.pantoneRequired),
    barvyStatusId: null,
    barvyStatusLabel: null,
    lakStatusId: null,
    lakStatusLabel: null,
    specifikace: typeof p.specifikace === "string" ? p.specifikace : "",
    deadlineExpedice: typeof p.deadlineExpedice === "string" ? p.deadlineExpedice : r.requestedExpeditionDate ? r.requestedExpeditionDate.slice(0, 10) : "",
    recurrenceType: "NONE",
    recurrenceCount: 1,
    reservationId: r.id,
    reservationCode: r.code,
    companyName: r.companyName,
    reservationMachine: typeof p.machine === "string" ? p.machine : null,
  };
}

type SeriesPreviewOccurrence = {
  date: string;
  hour: number;
  dataRequiredDate: string;
  deadlineExpedice: string;
  wasShifted: boolean;
  originalDate: string;
  originalHour: number;
};

export type UseJobBuilderProps = {
  showToast: (message: string, type?: Toast["type"]) => void;
  onBlockCreated: (newBlock: Block) => void;
  blocks: Block[];
  companyDays: CompanyDay[];
  machineWeekShifts: MachineWeekShiftsRow[];
  initialQueueReservations: ReservationQueueItem[];
};

export function useJobBuilder({
  showToast,
  onBlockCreated,
  blocks,
  companyDays,
  machineWeekShifts,
  initialQueueReservations,
}: UseJobBuilderProps) {
  // Builder form fields
  const [orderNumber, setOrderNumber]     = useState("");
  const [type, setType]                   = useState("ZAKAZKA");
  const [blockVariant, setBlockVariant]   = useState<BlockVariant>("STANDARD");
  const [durationHours, setDurationHours] = useState(DEFAULT_DURATION_HOURS);
  const [description, setDescription]     = useState("");
  const [bDeadlineExpedice, setBDeadlineExpedice] = useState("");
  const [bDataStatusId, setBDataStatusId]         = useState<string>("");
  const [bDataRequiredDate, setBDataRequiredDate] = useState<string>("");
  const [bMaterialStatusId, setBMaterialStatusId]         = useState<string>("");
  const [bMaterialRequiredDate, setBMaterialRequiredDate] = useState<string>("");
  const [bMaterialInStock, setBMaterialInStock]           = useState(false);
  const [bPantoneInStock, setBPantoneInStock]             = useState(false);
  const [bPantoneRequiredDate, setBPantoneRequiredDate]   = useState<string>("");
  const [bPantoneOk, setBPantoneOk]                       = useState(false);
  const [bPantoneRequired, setBPantoneRequired]           = useState(false);
  const [bBarvyStatusId, setBBarvyStatusId]       = useState<string>("");
  const [bLakStatusId, setBLakStatusId]           = useState<string>("");
  const [bSpecifikace, setBSpecifikace]           = useState("");
  const [bObalka, setBObalka]             = useState(false);
  const [bVnitrky, setBVnitrky]           = useState(false);
  const [bTiskoveArchy, setBTiskoveArchy] = useState<string[]>([]);
  const [bSerie, setBSerie]               = useState<string[]>([]);
  const [bJobPresetId, setBJobPresetId]           = useState<number | null>(null);
  const [bJobPresetLabel, setBJobPresetLabel]     = useState("");
  const [bRecurrenceType, setBRecurrenceType]     = useState("NONE");
  const [bRecurrenceCount, setBRecurrenceCount]   = useState(2);
  // Serie flow (jen pro bRecurrenceType !== "NONE")
  const [bSeriesMachine, setBSeriesMachine]       = useState<"XL_105" | "XL_106">("XL_105");
  const [bSeriesFirstDate, setBSeriesFirstDate]   = useState<string>("");
  const [bSeriesFirstHour, setBSeriesFirstHour]   = useState<number>(7);
  const [seriesPreview, setSeriesPreview]         = useState<SeriesPreviewOccurrence[]>([]);
  const [seriesScheduling, setSeriesScheduling]   = useState(false);

  // Číselníky pro builder
  const [bDataOpts, setBDataOpts]         = useState<CodebookOption[]>([]);
  const [bMaterialOpts, setBMaterialOpts] = useState<CodebookOption[]>([]);
  const [bBarvyOpts, setBBarvyOpts]       = useState<CodebookOption[]>([]);
  const [bLakOpts, setBLakOpts]           = useState<CodebookOption[]>([]);
  const [bTiskoveArchyOpts, setBTiskoveArchyOpts] = useState<string[]>([]);
  const [bSerieOpts, setBSerieOpts]               = useState<string[]>([]);
  const [jobPresets, setJobPresets]       = useState<JobPreset[]>([]);

  // Lookup mapa badgeColor pro TimelineGrid — jen id → barva, fallback null = zachovat per-field výchozí
  const badgeColorMap: Record<number, string | null> = Object.fromEntries(
    [...bDataOpts, ...bMaterialOpts, ...bBarvyOpts, ...bLakOpts]
      .map((o) => [o.id, o.badgeColor])
  );

  const compatibleBuilderPresets = useMemo(
    () => jobPresets.filter((preset) => preset.isActive && presetSupportsType(preset, type)),
    [jobPresets, type]
  );
  useEffect(() => {
    if (type === "UDRZBA") {
      if (bJobPresetId !== null || bJobPresetLabel) {
        setBJobPresetId(null);
        setBJobPresetLabel("");
      }
      return;
    }
    if (bJobPresetId === null) return;
    const existingPreset = jobPresets.find((preset) => preset.id === bJobPresetId);
    if (existingPreset && presetSupportsType(existingPreset, type)) return;
    setBJobPresetId(null);
    setBJobPresetLabel("");
  }, [bJobPresetId, bJobPresetLabel, jobPresets, type]);

  // Výrobní štítky (obalka/vnitrky/tiskoveArchy/serie) dávají smysl u zakázek
  // i rezervací (parita s BlockEditem, kde je nemá jen údržba) — u UDRZBA je
  // při přepnutí typu vynulovat, ať ve stavu nezůstane stará hodnota.
  useEffect(() => {
    if (type !== "UDRZBA") return;
    setBObalka(false);
    setBVnitrky(false);
    setBTiskoveArchy([]);
    setBSerie([]);
  }, [type]);

  // Queue (manuální)
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueIdRef = useRef(0);
  const [draggingQueueItem, setDraggingQueueItem] = useState<QueueItem | null>(null);

  // Rezervační fronta (QUEUE_READY rezervace ze serveru — persistentní)
  const [reservationQueue, setReservationQueue] = useState<QueueItem[]>(() =>
    initialQueueReservations.map(reservationToQueueItem)
  );

  // Načtení číselníků pro builder
  useEffect(() => {
    Promise.all([
      fetch("/api/codebook?category=DATA").then((r) => r.json()),
      fetch("/api/codebook?category=MATERIAL").then((r) => r.json()),
      fetch("/api/codebook?category=BARVY").then((r) => r.json()),
      fetch("/api/codebook?category=LAK").then((r) => r.json()),
      fetch("/api/job-presets?includeInactive=true").then((r) => r.json()),
    ]).then(([d, m, b, l, presets]) => {
      setBDataOpts(d);
      setBMaterialOpts(m);
      setBBarvyOpts(b);
      setBLakOpts(l);
      setJobPresets(Array.isArray(presets) ? presets : []);
    }).catch((error) => {
      console.error("Planner supporting data load failed", error);
      showToast("Nepodařilo se načíst číselníky a presety.", "error");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Promise.all([
      fetch("/api/codebook?category=TISKOVY_ARCH").then((r) => r.json()),
      fetch("/api/codebook?category=SERIE").then((r) => r.json()),
    ]).then(([ta, se]) => {
      setBTiskoveArchyOpts((ta as Array<{ label: string }>).map((o) => o.label));
      setBSerieOpts((se as Array<{ label: string }>).map((o) => o.label));
    }).catch(() => { /* prázdný seznam = dropdown ukáže hint */ });
  }, []);

  function buildBuilderPresetDraft(): JobPresetDraftValues {
    return {
      blockVariant,
      specifikace: bSpecifikace,
      dataStatusId: bDataStatusId,
      dataRequiredDate: bDataRequiredDate,
      materialStatusId: bMaterialStatusId,
      materialRequiredDate: bMaterialRequiredDate,
      materialInStock: bMaterialInStock,
      pantoneRequired: bPantoneRequired,
      pantoneRequiredDate: bPantoneRequiredDate,
      pantoneInStock: bPantoneInStock,
      barvyStatusId: bBarvyStatusId,
      lakStatusId: bLakStatusId,
      deadlineExpedice: bDeadlineExpedice,
      jobPresetId: bJobPresetId,
      jobPresetLabel: bJobPresetLabel,
    };
  }

  function applyPresetToBuilder(preset: JobPreset) {
    const { next, overwrittenFields } = applyJobPresetToDraft(buildBuilderPresetDraft(), preset, type);
    if (
      overwrittenFields.length > 0 &&
      !window.confirm(`Preset přepíše ${overwrittenFields.length} vyplněných polí. Pokračovat?`)
    ) {
      return;
    }
    setBlockVariant(next.blockVariant);
    setBSpecifikace(next.specifikace);
    setBDataStatusId(next.dataStatusId);
    setBDataRequiredDate(next.dataRequiredDate);
    setBMaterialStatusId(next.materialStatusId);
    setBMaterialRequiredDate(next.materialRequiredDate);
    setBMaterialInStock(next.materialInStock);
    setBPantoneRequiredDate(next.pantoneRequiredDate);
    setBPantoneRequired(next.pantoneRequired);
    setBPantoneInStock(next.pantoneInStock);
    setBBarvyStatusId(next.barvyStatusId);
    setBLakStatusId(next.lakStatusId);
    setBDeadlineExpedice(next.deadlineExpedice);
    setBJobPresetId(next.jobPresetId);
    setBJobPresetLabel(next.jobPresetLabel);
  }

  function clearBuilderPresetSelection() {
    const next = emptyPresetDraft(type);
    setBlockVariant(next.blockVariant);
    setBSpecifikace(next.specifikace);
    setBDataStatusId(next.dataStatusId);
    setBDataRequiredDate(next.dataRequiredDate);
    setBMaterialStatusId(next.materialStatusId);
    setBMaterialRequiredDate(next.materialRequiredDate);
    setBMaterialInStock(next.materialInStock);
    setBPantoneRequiredDate(next.pantoneRequiredDate);
    setBPantoneRequired(next.pantoneRequired);
    setBPantoneInStock(next.pantoneInStock);
    setBBarvyStatusId(next.barvyStatusId);
    setBLakStatusId(next.lakStatusId);
    setBDeadlineExpedice(next.deadlineExpedice);
    setBJobPresetId(null);
    setBJobPresetLabel("");
  }

  function resetBuilderForm() {
    setOrderNumber("");
    setDescription("");
    setBDataStatusId("");
    setBDataRequiredDate("");
    setBMaterialStatusId("");
    setBMaterialRequiredDate("");
    setBMaterialInStock(false);
    setBPantoneRequiredDate("");
    setBPantoneOk(false);
    setBPantoneRequired(false);
    setBPantoneInStock(false);
    setBBarvyStatusId("");
    setBLakStatusId("");
    setBSpecifikace("");
    setBObalka(false);
    setBVnitrky(false);
    setBTiskoveArchy([]);
    setBSerie([]);
    setBDeadlineExpedice("");
    setBRecurrenceType("NONE");
    setBRecurrenceCount(2);
    setBJobPresetId(null);
    setBJobPresetLabel("");
    setBlockVariant("STANDARD");
    // Délka se resetuje spolu se zbytkem formuláře — bez toho každý další záznam
    // zdědil délku naposledy přidaného (připomínka plánovače, 8/2026).
    setDurationHours(DEFAULT_DURATION_HOURS);
  }

  function handleAddToQueue() {
    if (!orderNumber.trim()) return;
    const findLabel = (opts: CodebookOption[], id: string) =>
      opts.find((o) => String(o.id) === id)?.label ?? null;
    setQueue((prev) => [
      ...prev,
      {
        id: ++queueIdRef.current,
        orderNumber: orderNumber.trim(),
        type,
        blockVariant: type === "ZAKAZKA" ? blockVariant : "STANDARD",
        jobPresetId: type === "UDRZBA" ? null : bJobPresetId,
        jobPresetLabel: type === "UDRZBA" ? null : bJobPresetLabel || null,
        machine: type === "UDRZBA" ? null : (jobPresets.find((p) => p.id === bJobPresetId)?.machineConstraint ?? null),
        durationHours,
        description: description.trim(),
        dataStatusId: bDataStatusId ? Number(bDataStatusId) : null,
        dataStatusLabel: findLabel(bDataOpts, bDataStatusId),
        dataRequiredDate: bDataRequiredDate || null,
        materialStatusId: bMaterialStatusId ? Number(bMaterialStatusId) : null,
        materialStatusLabel: findLabel(bMaterialOpts, bMaterialStatusId),
        materialRequiredDate: bMaterialInStock ? null : bMaterialRequiredDate || null,
        materialInStock: bMaterialInStock,
        materialIssued: false,
        pantoneRequiredDate: bPantoneInStock ? null : bPantoneRequiredDate || null,
        pantoneOk: bPantoneOk,
        pantoneRequired: bPantoneRequired,
        pantoneInStock: bPantoneInStock,
        pantoneIssued: false,
        barvyStatusId: bBarvyStatusId ? Number(bBarvyStatusId) : null,
        barvyStatusLabel: findLabel(bBarvyOpts, bBarvyStatusId),
        lakStatusId: bLakStatusId ? Number(bLakStatusId) : null,
        lakStatusLabel: findLabel(bLakOpts, bLakStatusId),
        specifikace: bSpecifikace,
        deadlineExpedice: bDeadlineExpedice,
        recurrenceType: bRecurrenceType,
        recurrenceCount: bRecurrenceType !== "NONE" ? bRecurrenceCount : 1,
        // Štítky nese zakázka i rezervace (ne údržba); u série se nastavují až
        // po založení editací bloku, proto guard na recurrenceType.
        obalka: type !== "UDRZBA" && bRecurrenceType === "NONE" ? bObalka : false,
        vnitrky: type !== "UDRZBA" && bRecurrenceType === "NONE" ? bVnitrky : false,
        tiskoveArchy: type !== "UDRZBA" && bRecurrenceType === "NONE" ? bTiskoveArchy : [],
        serie: type !== "UDRZBA" && bRecurrenceType === "NONE" ? bSerie : [],
      },
    ]);
    resetBuilderForm();
  }

  async function handleScheduleSeries() {
    if (!orderNumber.trim() || seriesPreview.length === 0 || seriesScheduling) return;
    const durationMs = durationHours * 3600000;
    const findLabel = (opts: CodebookOption[], id: string) => opts.find((o) => String(o.id) === id)?.label ?? null;
    const baseBody = {
      orderNumber: orderNumber.trim(),
      machine: bSeriesMachine,
      type,
      blockVariant: type === "ZAKAZKA" ? blockVariant : "STANDARD",
      jobPresetId: type === "UDRZBA" ? null : bJobPresetId,
      description: description.trim() || null,
      dataStatusId: bDataStatusId ? Number(bDataStatusId) : null,
      dataStatusLabel: findLabel(bDataOpts, bDataStatusId),
      materialStatusId: bMaterialStatusId ? Number(bMaterialStatusId) : null,
      materialStatusLabel: findLabel(bMaterialOpts, bMaterialStatusId),
      materialRequiredDate: bMaterialInStock ? null : bMaterialRequiredDate || null,
      materialInStock: bMaterialInStock,
      pantoneRequiredDate: bPantoneInStock ? null : bPantoneRequiredDate || null,
      pantoneOk: bPantoneOk,
      pantoneRequired: bPantoneRequired,
      pantoneInStock: bPantoneInStock,
      pantoneIssued: false,
      barvyStatusId: bBarvyStatusId ? Number(bBarvyStatusId) : null,
      barvyStatusLabel: findLabel(bBarvyOpts, bBarvyStatusId),
      lakStatusId: bLakStatusId ? Number(bLakStatusId) : null,
      lakStatusLabel: findLabel(bLakOpts, bLakStatusId),
      specifikace: bSpecifikace || null,
      recurrenceType: bRecurrenceType,
      autoShiftIfBusy: true,
      ...(typeUsesTiskoveHodiny(type) ? { printMinutes: Math.round(durationHours * 60) } : {}),
    };
    setSeriesScheduling(true);
    let parentId: number | null = null;
    let created = 0;
    const shiftedToasts: Array<{ original: string; final: string }> = [];
    const failedSlots: Array<{ date: string; hour: number; reason: string }> = [];

    for (let i = 0; i < seriesPreview.length; i++) {
      const occ = seriesPreview[i];
      const startTime = pragueToUTC(occ.date, occ.hour);
      const endTime = new Date(startTime.getTime() + durationMs);
      const body: Record<string, unknown> = {
        ...baseBody,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        dataRequiredDate: occ.dataRequiredDate || null,
        deadlineExpedice: occ.deadlineExpedice || null,
      };
      if (parentId !== null) body.recurrenceParentId = parentId;
      try {
        const res = await fetch("/api/blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const block: Block & { autoShift?: { originalStart: string } } = await res.json();
          if (i === 0) parentId = block.id;
          onBlockCreated(block);
          created++;
          if (block.autoShift) {
            const orig = new Date(block.autoShift.originalStart);
            const final = new Date(block.startTime);
            const fmt = (d: Date) => d.toLocaleString("cs-CZ", {
              timeZone: "Europe/Prague",
              day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
            });
            shiftedToasts.push({ original: fmt(orig), final: fmt(final) });
          }
        } else {
          const err = await res.json().catch(() => ({ error: "neznámá chyba" }));
          failedSlots.push({ date: occ.date, hour: occ.hour, reason: err.error ?? "chyba serveru" });
        }
      } catch {
        failedSlots.push({ date: occ.date, hour: occ.hour, reason: "síťová chyba" });
      }
    }
    setSeriesScheduling(false);

    // Per-blok info-toasty pro auto-shift (max 5, aby se uživatel neutopil v toastech)
    shiftedToasts.slice(0, 5).forEach((s) => {
      showToast(`${s.original} → ${s.final} — přesunuto z kapacitních důvodů`, "info");
    });
    if (shiftedToasts.length > 5) {
      showToast(`+${shiftedToasts.length - 5} dalších bloků posunuto. Zkontroluj timeline.`, "info");
    }

    // Souhrn
    if (created === seriesPreview.length) {
      const shiftedCount = shiftedToasts.length;
      const msg = shiftedCount > 0
        ? `Série ${created} bloků naplánována (${shiftedCount} posunuto).`
        : `Série ${created} bloků naplánována.`;
      showToast(msg, "success");
    } else if (created > 0) {
      showToast(`Naplánováno ${created}/${seriesPreview.length}. ${failedSlots.length} bloků selhalo — zkontroluj timeline.`, "error");
    } else {
      showToast(`Naplánování série selhalo: ${failedSlots[0]?.reason ?? "neznámá chyba"}.`, "error");
    }

    if (created > 0) {
      resetBuilderForm();
      setBSeriesFirstDate(""); setBSeriesFirstHour(7);
      setSeriesPreview([]);
    }
  }

  function addRecurrenceInterval(date: Date, type: string): Date {
    const dateStr = normalizeCivilDateInput(date);
    if (!dateStr) return date;
    if (type === "DAILY") return pragueToUTC(addDaysToCivilDate(dateStr, 1), 12, 0);
    if (type === "WEEKLY") return pragueToUTC(addDaysToCivilDate(dateStr, 7), 12, 0);
    if (type === "MONTHLY") return pragueToUTC(addMonthsToCivilDate(dateStr, 1), 12, 0);
    return date;
  }

  function generateSeriesPreview(
    firstDate: string,
    firstHour: number,
    count: number,
    rType: string,
    defaultDataDate: string,
    defaultExpedice: string,
    machine: string,
    durationH: number,
    allBlocks: Block[],
    allCompanyDays: CompanyDay[],
    weekShifts: MachineWeekShiftsRow[]
  ): SeriesPreviewOccurrence[] {
    if (!firstDate || rType === "NONE" || count < 1) return [];
    const occurrences: SeriesPreviewOccurrence[] = [];

    const durationMs = durationH * 3600000;

    // Sbíráme obsazené intervaly: bloky stroje + firemní odstávky
    // (machine=null = celá firma, jinak specificky náš stroj) + sloty,
    // které jsme v této sérii právě naplánovali. Stejná logika jako server.
    const blockedIntervals: Array<{ start: Date; end: Date }> = [
      ...allBlocks
        .filter((b) => b.machine === machine)
        .map((b) => ({ start: new Date(b.startTime), end: new Date(b.endTime) })),
      ...allCompanyDays
        .filter((cd) => cd.machine == null || cd.machine === machine)
        .map((cd) => ({ start: new Date(cd.startDate), end: new Date(cd.endDate) })),
    ];

    // UTC noon — bezpečné pro aritmetiku celých dnů ve všech timezone (zachovat současné chování).
    let cur = new Date(firstDate + "T12:00:00.000Z");
    for (let i = 0; i < count; i++) {
      const originalDate = cur.toISOString().slice(0, 10);
      const originalHour = firstHour;
      const proposed = pragueToUTC(originalDate, originalHour);
      const slot = findNextFreeSlot(machine, proposed, durationMs, blockedIntervals, weekShifts);

      if (slot.found) {
        const finalDate = utcToPragueDateStr(slot.startTime);
        const finalHour = utcToPragueHour(slot.startTime);
        blockedIntervals.push({ start: slot.startTime, end: slot.endTime });
        occurrences.push({
          date: finalDate,
          hour: finalHour,
          dataRequiredDate: defaultDataDate,
          deadlineExpedice: defaultExpedice,
          wasShifted: slot.wasShifted,
          originalDate,
          originalHour,
        });
      } else {
        // Slot se nepodařilo najít do 7 dní — zařadit s původním časem.
        // Server odmítne 409, klient ukáže chybový toast v handleScheduleSeries.
        occurrences.push({
          date: originalDate,
          hour: originalHour,
          dataRequiredDate: defaultDataDate,
          deadlineExpedice: defaultExpedice,
          wasShifted: false,
          originalDate,
          originalHour,
        });
      }

      cur = addRecurrenceInterval(cur, rType);
    }
    return occurrences;
  }

  // Regeneruje preview série při změně parametrů
  // POZOR: bDataRequiredDate a bDeadlineExpedice jsou jen defaulty pro nově generované řádky —
  // záměrně nejsou v dep array, aby ruční editace per-occurrence hodnot nebyla přepsána
  // při změně počtu bloků nebo intervalu.
  useEffect(() => {
    if (bRecurrenceType === "NONE" || !bSeriesFirstDate) {
      setSeriesPreview([]);
      return;
    }
    setSeriesPreview(generateSeriesPreview(
      bSeriesFirstDate, bSeriesFirstHour, bRecurrenceCount, bRecurrenceType,
      bDataRequiredDate, bDeadlineExpedice,
      bSeriesMachine, durationHours, blocks, companyDays, machineWeekShifts
    ));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bRecurrenceType, bRecurrenceCount, bSeriesFirstDate, bSeriesFirstHour, bSeriesMachine, durationHours]);

  return {
    // Builder form fields
    orderNumber, setOrderNumber,
    type, setType,
    blockVariant, setBlockVariant,
    durationHours, setDurationHours,
    description, setDescription,
    bDeadlineExpedice, setBDeadlineExpedice,
    bDataStatusId, setBDataStatusId,
    bDataRequiredDate, setBDataRequiredDate,
    bMaterialStatusId, setBMaterialStatusId,
    bMaterialRequiredDate, setBMaterialRequiredDate,
    bMaterialInStock, setBMaterialInStock,
    bPantoneInStock, setBPantoneInStock,
    bPantoneRequiredDate, setBPantoneRequiredDate,
    bPantoneOk, setBPantoneOk,
    bPantoneRequired, setBPantoneRequired,
    bBarvyStatusId, setBBarvyStatusId,
    bLakStatusId, setBLakStatusId,
    bSpecifikace, setBSpecifikace,
    bObalka, setBObalka,
    bVnitrky, setBVnitrky,
    bTiskoveArchy, setBTiskoveArchy,
    bSerie, setBSerie,
    bJobPresetId, setBJobPresetId,
    bJobPresetLabel, setBJobPresetLabel,
    bRecurrenceType, setBRecurrenceType,
    bRecurrenceCount, setBRecurrenceCount,
    bSeriesMachine, setBSeriesMachine,
    bSeriesFirstDate, setBSeriesFirstDate,
    bSeriesFirstHour, setBSeriesFirstHour,
    seriesPreview, setSeriesPreview,
    seriesScheduling, setSeriesScheduling,
    // Číselníky
    bDataOpts, setBDataOpts,
    bMaterialOpts, setBMaterialOpts,
    bBarvyOpts, setBBarvyOpts,
    bLakOpts, setBLakOpts,
    bTiskoveArchyOpts,
    bSerieOpts,
    jobPresets, setJobPresets,
    // Derived
    badgeColorMap,
    compatibleBuilderPresets,
    // Queue
    queue, setQueue,
    draggingQueueItem, setDraggingQueueItem,
    reservationQueue, setReservationQueue,
    // Handlery
    applyPresetToBuilder,
    clearBuilderPresetSelection,
    resetBuilderForm,
    handleAddToQueue,
    addRecurrenceInterval,
    handleScheduleSeries,
  };
}

export type UseJobBuilderReturn = ReturnType<typeof useJobBuilder>;
