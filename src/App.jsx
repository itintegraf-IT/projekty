import { useState, useRef, useMemo, useEffect } from "react";

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  bg:       "#0a0b0f",
  surface:  "#111318",
  surface2: "#181b22",
  border:   "#1e2130",
  border2:  "#252a3a",
  text:     "#e8eaf0",
  muted:    "#4a5068",
  accent:   "#FFE600",

  // Job colors
  ok:          "#1a6bcc",   // confirmed order – blue
  okLight:     "#2484f5",
  reservation: "#7c3aed",  // reservation – purple
  resLight:    "#9d5cf7",
  maintenance: "#c0392b",  // maintenance/repair – red
  maintLight:  "#e74c3c",
  past:        "#2a2d38",  // already produced – grey
  pastText:    "#444860",
};

// ─── Constants ────────────────────────────────────────────────────────────────
const MACHINE_XL105 = "XL 105-6L";
const MACHINE_XL106 = "XL106-8";
const MACHINES = [MACHINE_XL105, MACHINE_XL106];
const SLOTS_PER_HOUR = 2; // half-hour slots
const TOTAL_SLOTS = 24 * SLOTS_PER_HOUR; // 48
const SLOT_H = 26; // px per half-hour slot
const HOUR_H = SLOT_H * SLOTS_PER_HOUR;

const DAYS_CZ  = ["Ne","Po","Út","St","Čt","Pá","So"];
const MONTHS_S = ["Led","Úno","Bře","Dub","Kvě","Čvn","Čvc","Srp","Zář","Říj","Lis","Pro"];

const JOB_TYPES = [
  { value:"ok",          label:"Zakázka (potvrzená)",  color:T.ok,          lightColor:T.okLight },
  { value:"reservation", label:"Rezervace",            color:T.reservation, lightColor:T.resLight },
  { value:"maintenance", label:"Údržba / Oprava",      color:T.maintenance, lightColor:T.maintLight },
];

// ─── Date helpers ─────────────────────────────────────────────────────────────
const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function dateKey(d) { return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`; }
function parseKey(s) { const [d,m,y] = s.split(".").map(Number); return new Date(y, m-1, d); }
function fmtShort(d) { return `${d.getDate()}. ${MONTHS_S[d.getMonth()]}`; }
function fmtMini(v) {
  if (!v) return "";
  // ISO format from date input: "2026-02-20" → "20.2"
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [, m, d] = v.split("-").map(Number);
    return `${d}.${m}`;
  }
  // Legacy "19.02.2026" or "19.2" → "19.2"
  const p = v.split(".");
  if (p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) return `${parseInt(p[0])}.${parseInt(p[1])}`;
  return v;
}
function fmtTime(d) { return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

// slot index → decimal hours (e.g. slot 3 → 1.5h)
function slotToHours(slot) { return slot / SLOTS_PER_HOUR; }
// hours → slot index
function hoursToSlot(h) { return Math.round(h * SLOTS_PER_HOUR); }
// current time as slot index
function nowSlot() {
  const n = new Date();
  return hoursToSlot(n.getHours() + n.getMinutes() / 60);
}
// is a given job "in the past" (its date < today OR same day but all slots already passed)
function jobIsPast(job, nowSlotVal) {
  const jDate = parseKey(job.date);
  const td = today();
  if (jDate < td) return true;
  if (jDate.getTime() === td.getTime()) {
    return (job.slot + job.durationSlots) <= nowSlotVal;
  }
  return false;
}

// ─── Seed data ────────────────────────────────────────────────────────────────
const BASE_DATE = today();

function mkJob(id, machine, dayOff, slot, durationSlots, orderNum, description, type, opts = {}) {
  return {
    id, machine,
    date: dateKey(addDays(BASE_DATE, dayOff)),
    slot,          // half-hour slot index (0-47)
    durationSlots, // in half-hour slots
    orderNum, description,
    type: type || "ok",
    color: (JOB_TYPES.find(t=>t.value===type)||JOB_TYPES[0]).color,
    mat: opts.mat || "", matOk: opts.matOk || false,
    dataDate: opts.dataDate || "", dataOk: opts.dataOk || false,
    exp: opts.exp || "",
    bold: opts.bold || false, badge: opts.badge || "",
  };
}

const initialJobs = [
  // Today
  mkJob(1,  MACHINE_XL105, 0, 12, 2, "16955",   "ALL IN AGENCY - Leták - 1 930 ta 4/4 otočka",             "ok",          { mat:"13.2", exp:"26.2" }),
  mkJob(2,  MACHINE_XL105, 0, 14, 2, "16956/1", "Flamengo - samolepky - 170 ta 1/0 + 1/0 lesk",            "ok",          { mat:"ok", matOk:true, exp:"26.2" }),
  mkJob(3,  MACHINE_XL105, 0, 16, 2, "16974/1", "prodialog - PR - 34 130 ta + 2 570 ta, 4/0 + 1/0 mat",    "ok",          { mat:"ok", matOk:true, exp:"27.2" }),
  mkJob(4,  MACHINE_XL105, 0, 18, 2, "16936",   "Modrá pyramida - Plakát - 500 ta, 4/0",                   "ok",          { mat:"ok", matOk:true, exp:"24.2" }),
  mkJob(5,  MACHINE_XL105, 0, 20, 3, "16964/1", "Hu-Fa - leták - 630 ta 4/4 otočka",                       "ok",          { mat:"ok", matOk:true, exp:"23.2" }),
  mkJob(6,  MACHINE_XL105, 0, 23, 2, "16964/2", "Hu-Fa - leták - 1 770 ta + 870 ta, 4/4 + 1/1 mat",        "reservation", { mat:"ok", matOk:true, exp:"23.2" }),
  mkJob(7,  MACHINE_XL105, 0, 26, 2, "16894/2", "ČSOB - Plakát - 50 ta, 4/0 + 1/0 lesk",                   "ok",          { mat:"ok", matOk:true, exp:"26.2" }),
  mkJob(8,  MACHINE_XL105, 0, 30, 2, "17000",   "R4674 ČMS - Pohlednice - 3 680 ta, 4/1 + 1/0 PŘES OBRACÁK","ok",         { mat:"19.2", exp:"24.2", bold:true }),
  mkJob(9,  MACHINE_XL105, 0, 34, 2, "16975",   "Rolrodruck - Mappen - 300 TA, 5/0 + 1/ LESK PANTONE OK",  "ok",          { mat:"iv", exp:"24.2", bold:true }),
  mkJob(10, MACHINE_XL105, 0, 38, 2, "16980",   "LUMAX - Univeralbrief - 2 510 ta, 4/0",                   "ok",          { mat:"iv", exp:"23.2" }),
  mkJob(11, MACHINE_XL106, 0, 8,  4, "16900",   "R4666 siblog - Leták - 28 150 ta",                         "ok",          { mat:"16.2", exp:"25.2", badge:"SCH Lumina LED" }),
  mkJob(12, MACHINE_XL106, 0, 12, 6, "16899",   "R4667 siblog - Leták - 37 550 ta",                         "ok",          { mat:"16.2", exp:"25.2", badge:"SCH Lumina LED" }),
  mkJob(13, MACHINE_XL106, 0, 20, 4, "16909",   "DIRECT MIND - Letáky - 5 120 ta + 13 990 ta + 3 110 ta",  "ok",          { mat:"19.2", exp:"20.2", badge:"SCH Lumina LED" }),
  mkJob(14, MACHINE_XL106, 0, 28, 2, "",        "Údržba tiskového stroje – výměna gumy",                    "maintenance", {}),
  mkJob(15, MACHINE_XL106, 0, 34, 3, "16896",   "ČSOB - Leták DL - 19 860 ta",                              "ok",          { mat:"16.2", exp:"26.2", badge:"SCH Lumina LED" }),
  mkJob(16, MACHINE_XL106, 0, 40, 4, "",        "Rezervace – DM projekt (čeká na objednávku)",               "reservation", {}),
  // Tomorrow
  mkJob(17, MACHINE_XL105, 1, 12, 4, "17010",   "Print House - Katalog - 5 000 ta, 4/4",                    "ok",          { mat:"20.2", exp:"1.3", dataDate:"20.2" }),
  mkJob(18, MACHINE_XL105, 1, 20, 2, "17011",   "SportArt - Leták - 12 000 ta, 4/0",                        "reservation", { mat:"21.2", exp:"3.3" }),
  mkJob(19, MACHINE_XL106, 1, 14, 8, "17012",   "MediPharma - Příbalák - 80 000 ta, 1/1",                   "ok",          { mat:"ok", matOk:true, exp:"25.2", badge:"SCH Lumina LED" }),
  mkJob(20, MACHINE_XL106, 1, 26, 2, "",        "Preventivní prohlídka – kalibrace",                         "maintenance", {}),
  // Day after tomorrow
  mkJob(21, MACHINE_XL105, 2, 10, 6, "17020",   "Škoda Auto - Plakát A1 - 2 500 ta, 4/0 lesk",              "ok",          { mat:"22.2", exp:"28.2" }),
  mkJob(22, MACHINE_XL106, 2, 16, 4, "17021",   "Komerční banka - DL Leták - 45 000 ta, 4/4",                "ok",          { mat:"ok", matOk:true, exp:"2.3", badge:"SCH Lumina LED" }),
  mkJob(23, MACHINE_XL105, 2, 24, 3, "",        "Rezervace – katalog Q2",                                    "reservation", {}),
  // +3
  mkJob(24, MACHINE_XL105, 3, 14, 4, "17030",   "Datart - Katalog - 3 200 ta, 4/4 + 1/1 mat",               "ok",          { mat:"23.2", exp:"5.3" }),
  mkJob(25, MACHINE_XL106, 3, 20, 6, "17031",   "Penny Market - Leták - 120 000 ta, 4/0",                    "ok",          { mat:"ok", matOk:true, exp:"6.3", badge:"SCH Lumina LED" }),
  // +4
  mkJob(26, MACHINE_XL105, 4, 12, 2, "17040",   "Alza.cz - Banner - 800 ta, 4/0 UV lesk",                   "ok",          { mat:"ok", matOk:true, exp:"4.3" }),
  mkJob(27, MACHINE_XL106, 4, 16, 10,"17041",   "Albert - Leták - 200 000 ta, 4/0",                          "ok",          { mat:"25.2", exp:"8.3", badge:"SCH Lumina LED" }),
  // +7
  mkJob(28, MACHINE_XL105, 7, 14, 4, "17060",   "Tesco - Leták - 150 000 ta, 4/0",                          "ok",          { mat:"28.2", exp:"12.3" }),
  mkJob(29, MACHINE_XL106, 7, 18, 6, "17061",   "O2 Czech - Plakát B2 - 5 000 ta, 4/0 lesk",                "ok",          { mat:"ok", matOk:true, exp:"13.3", badge:"SCH Lumina LED" }),
];

const emptyBuilder = {
  orderNum:"", description:"", mat:"", dataDate:"", exp:"",
  durationSlots:2, type:"ok", badge:"",
};

function isSlotFree(jobs, machine, date, startSlot, dSlots, excludeId=null) {
  for (let s = startSlot; s < startSlot + dSlots; s++) {
    if (jobs.some(j => j.id !== excludeId && j.machine === machine && j.date === date && s >= j.slot && s < j.slot + j.durationSlots))
      return false;
  }
  return true;
}

function typeColor(type) { return (JOB_TYPES.find(t=>t.value===type)||JOB_TYPES[0]).color; }
function typeLightColor(type) { return (JOB_TYPES.find(t=>t.value===type)||JOB_TYPES[0]).lightColor; }

// ─── Parse short date "dd.m" or "dd.mm.yyyy" → Date or null ─────────────────
function parseShortDate(v) {
  if (!v || v === "ok" || v === "iv") return null;
  // ISO format from date input
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v);
  const p = v.split(".");
  if (p.length < 2) return null;
  const d = parseInt(p[0]), m = parseInt(p[1]);
  if (isNaN(d) || isNaN(m)) return null;
  const y = p.length >= 3 && !isNaN(parseInt(p[2])) ? parseInt(p[2]) : new Date().getFullYear();
  return new Date(y, m - 1, d);
}

function isOverdue(value, isOk) {
  if (isOk) return false;
  const d = parseShortDate(value);
  if (!d) return false;
  const t = new Date(); t.setHours(0,0,0,0);
  return d < t;
}

// ─── CheckBadge ──────────────────────────────────────────────────────────────
function CheckBadge({ label, value, isOk, onToggle, canCheck }) {
  const overdue = canCheck && isOverdue(value, isOk);
  return (
    <div
      onClick={canCheck ? onToggle : undefined}
      title={canCheck ? (isOk ? "Klikni pro zrušení" : overdue ? `⚠ Po termínu! (${fmtMini(value)}) – Označit jako OK` : "Označit jako OK") : undefined}
      style={{
        display:"inline-flex", alignItems:"center", gap:3,
        background: isOk
          ? "rgba(34,197,94,.18)"
          : overdue
            ? "rgba(239,68,68,.22)"
            : "rgba(255,255,255,.07)",
        border: `1px solid ${isOk ? "rgba(34,197,94,.45)" : overdue ? "rgba(239,68,68,.7)" : "rgba(255,255,255,.1)"}`,
        borderRadius:4, padding:"1px 5px 1px 4px",
        cursor: canCheck ? "pointer" : "default",
        transition:"all .15s", userSelect:"none",
        maxWidth:54,
        boxShadow: overdue ? "0 0 6px rgba(239,68,68,.4)" : "none",
      }}
    >
      <span style={{ fontSize:7, fontWeight:800, color: isOk ? "#4ade80" : overdue ? "#f87171" : "#a0aec0", textTransform:"uppercase", letterSpacing:.5, flexShrink:0 }}>
        {overdue && !isOk ? "⚠" : label}
      </span>
      {isOk
        ? <span style={{ fontSize:9, color:"#4ade80", fontWeight:800, lineHeight:1 }}>✓</span>
        : <span style={{ fontSize:8, color: overdue ? "#fca5a5" : "#cbd5e0", lineHeight:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:28, fontWeight: overdue ? 700 : 500 }}>{fmtMini(value)||"—"}</span>
      }
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [jobs, setJobs]             = useState(initialJobs);
  const [queue, setQueue]           = useState([]);
  const [storageReady, setStorageReady] = useState(false);
  const [builder, setBuilder]       = useState(emptyBuilder);
  const [dragging, setDragging]     = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [editJob, setEditJob]       = useState(null);
  const [panelW, setPanelW]         = useState(320);
  const [visibleDays, setVisibleDays] = useState(3);
  const [startOffset, setStartOffset] = useState(0);
  const [filterText, setFilterText]   = useState("");
  const [now, setNow]               = useState(new Date());
  const [locked, setLocked]         = useState(true);
  const [showLockModal, setShowLockModal] = useState(false);
  const [lockInput, setLockInput]   = useState("");
  const [lockError, setLockError]   = useState(false);
  const [printDate, setPrintDate]   = useState(null);
  const [zoom, setZoom]             = useState(36);  // px per half-hour slot (width)
  const [rowH, setRowH]             = useState(52);  // px height per machine row per day
  const [numDays, setNumDays]       = useState(14);  // how many days to show
  const resizing = useRef(false);

  const PASS = "integraf273";
  const unlock = () => {
    if (lockInput === PASS) { setLocked(false); setShowLockModal(false); setLockInput(""); setLockError(false); }
    else { setLockError(true); setLockInput(""); }
  };
  const lock = () => { setLocked(true); setShowLockModal(false); };

  // ── Persistent storage: load on mount ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get('plan-jobs');
        if (r?.value) setJobs(JSON.parse(r.value));
      } catch(_) {}
      try {
        const r = await window.storage.get('plan-queue');
        if (r?.value) setQueue(JSON.parse(r.value));
      } catch(_) {}
      setStorageReady(true);
    })();
  }, []);

  // ── Persistent storage: save on change (only after initial load) ─────────
  useEffect(() => {
    if (!storageReady) return;
    window.storage.set('plan-jobs', JSON.stringify(jobs)).catch(()=>{});
  }, [jobs, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    window.storage.set('plan-queue', JSON.stringify(queue)).catch(()=>{});
  }, [queue, storageReady]);

  // Update clock every minute
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const currentNowSlot = useMemo(() => nowSlot(), [now]);
  const todayKey = useMemo(() => dateKey(today()), [now]);

  const visibleDates = useMemo(() =>
    Array.from({ length: numDays }, (_, i) => addDays(today(), i)),
    [numDays, now]
  );

  const filteredJobs = useMemo(() => {
    if (!filterText) return jobs;
    const q = filterText.toLowerCase();
    return jobs.filter(j => j.orderNum.toLowerCase().includes(q) || j.description.toLowerCase().includes(q));
  }, [jobs, filterText]);

  // ── Check toggles ────────────────────────────────────────────────────────────
  const toggleField = (id, field) => setJobs(prev => prev.map(j => j.id === id ? {...j, [field]: !j[field]} : j));

  // ── Drag ─────────────────────────────────────────────────────────────────────
  const onPlanDragStart  = (e, job)  => { if (locked) return; setDragging({ source:"plan", job }); e.dataTransfer.effectAllowed="move"; };
  const onQueueDragStart = (e, qj)   => { if (locked) return; setDragging({ source:"queue", job:qj }); e.dataTransfer.effectAllowed="copy"; };
  const onDragEnd        = ()        => { setDragging(null); setDropTarget(null); };

  const onCellDragOver = (e, machine, date, slot) => { e.preventDefault(); setDropTarget({ machine, date, slot }); };
  // Merge all sibling parts of the same splitId that are now contiguous
  const mergeAllSiblings = (jobsArr) => {
    const splitIds = [...new Set(jobsArr.filter(j => j.splitId).map(j => j.splitId))];
    let result = [...jobsArr];

    for (const sid of splitIds) {
      const allParts = result.filter(j => j.splitId === sid);
      const machines = [...new Set(allParts.map(j => j.machine))];

      for (const mac of machines) {
        const parts = allParts.filter(j => j.machine === mac);
        if (parts.length < 2) continue;

        parts.sort((a, b) => {
          const da = parseKey(a.date).getTime(), db = parseKey(b.date).getTime();
          if (da !== db) return da - db;
          return a.slot - b.slot;
        });

        let ok = true;
        for (let i = 0; i < parts.length - 1; i++) {
          const cur = parts[i], nxt = parts[i + 1];
          const curEnd = cur.slot + cur.durationSlots;
          const dayDiff = Math.round((parseKey(nxt.date) - parseKey(cur.date)) / 86400000);
          const contiguous =
            (curEnd === TOTAL_SLOTS && dayDiff === 1 && nxt.slot === 0) ||
            (dayDiff === 0 && curEnd === nxt.slot);
          if (!contiguous) { ok = false; break; }
        }

        if (!ok) continue;

        const totalSlots = parts.reduce((s, j) => s + j.durationSlots, 0);
        const merged = { ...parts[0], durationSlots: totalSlots, splitId: undefined };
        const ids = new Set(parts.map(j => j.id));
        result = [...result.filter(j => !ids.has(j.id)), merged];
      }
    }
    return result;
  };

  const onCellDrop = (e, machine, date, slot) => {
    if (locked) return;
    e.preventDefault(); setDropTarget(null);
    if (!dragging) return;
    const { source, job } = dragging;

    const excl = source === "plan" ? job.id : null;
    const slotsLeft = TOTAL_SLOTS - slot;
    const willOverflow = job.durationSlots > slotsLeft;

    if (willOverflow) {
      if (!isSlotFree(jobs, machine, date, slot, slotsLeft, excl)) { setDragging(null); return; }

      const splitId = job.splitId || job.id;
      let remaining = job.durationSlots - slotsLeft;
      const parts = [{ date, slot, durationSlots: slotsLeft }];
      let nextDate = addDays(parseKey(date), 1);
      while (remaining > 0) {
        const chunk = Math.min(remaining, TOTAL_SLOTS);
        parts.push({ date: dateKey(nextDate), slot: 0, durationSlots: chunk });
        remaining -= chunk;
        nextDate = addDays(nextDate, 1);
      }

      if (source === "plan") {
        setJobs(prev => {
          const without = prev.filter(j => j.id !== job.id);
          const newJobs = parts.map((p, i) => ({
            ...job, splitId,
            id: i === 0 ? job.id : Date.now() + i,
            machine, date: p.date, slot: p.slot, durationSlots: p.durationSlots,
          }));
          return [...without, ...newJobs];
        });
      } else {
        const color = typeColor(job.type);
        setJobs(prev => {
          const newJobs = parts.map((p, i) => ({
            ...job, id: Date.now() + i, splitId, machine, color,
            date: p.date, slot: p.slot, durationSlots: p.durationSlots,
          }));
          return [...prev, ...newJobs];
        });
        setQueue(prev => prev.filter(q => q.id !== job.id));
      }
    } else {
      if (!isSlotFree(jobs, machine, date, slot, job.durationSlots, excl)) { setDragging(null); return; }
      if (source === "plan") {
        setJobs(prev => {
          const updated = prev.map(j => j.id === job.id ? { ...j, machine, date, slot } : j);
          return mergeAllSiblings(updated);
        });
      } else {
        const color = typeColor(job.type);
        setJobs(prev => mergeAllSiblings([...prev, { ...job, id: Date.now(), machine, date, slot, color }]));
        setQueue(prev => prev.filter(q => q.id !== job.id));
      }
    }
    setDragging(null);
  };

  // ── Edit ──────────────────────────────────────────────────────────────────────
  const saveEdit  = () => { setJobs(prev => prev.map(j => j.id===editJob.id ? {...editJob, color:typeColor(editJob.type)} : j)); setEditJob(null); };
  const deleteJob = (id) => { setJobs(prev => prev.filter(j => j.id !== id)); setEditJob(null); };

  // ── Panel resize ──────────────────────────────────────────────────────────────
  const onResizeMouseDown = (e) => {
    resizing.current = true;
    const sx=e.clientX, sw=panelW;
    const onMove = ev => { if (resizing.current) setPanelW(Math.max(260, Math.min(520, sw-(ev.clientX-sx)))); };
    const onUp   = () => { resizing.current=false; window.removeEventListener("mousemove",onMove); window.removeEventListener("mouseup",onUp); };
    window.addEventListener("mousemove",onMove);
    window.addEventListener("mouseup",onUp);
  };

  const [jumpInput, setJumpInput] = useState("");

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  const anyFilter = !!filterText;

  return (
    <div style={{ display:"flex", height:"100vh", overflow:"hidden", fontFamily:"'Inter','Segoe UI',system-ui,sans-serif", background:T.bg, color:T.text, fontSize:12 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;height:4px;background:transparent;}
        ::-webkit-scrollbar-thumb{background:#1e2130;border-radius:4px;}
        ::-webkit-scrollbar-thumb:hover{background:#252a3a;}
        input,select,textarea{font-family:inherit;}
        .cell{transition:background .08s;}
        .cell:hover{background:rgba(255,255,255,.03)!important;}
        .drop-ok{background:rgba(36,132,245,.18)!important;outline:1.5px dashed rgba(36,132,245,.6);outline-offset:-1px;}
        .drop-bad{background:rgba(220,38,38,.1)!important;outline:1.5px dashed rgba(220,38,38,.5);outline-offset:-1px;}
        .jb{cursor:grab;transition:filter .12s,box-shadow .12s;}
        .jb.locked-view{cursor:not-allowed!important;}
        .jb:hover{filter:brightness(1.12);box-shadow:0 4px 20px rgba(0,0,0,.5);}
        .jb:active{cursor:grabbing;}
        .jb.dim{opacity:.22;}
        .jb.faded{opacity:.3;}
        .qcard{cursor:grab;transition:transform .15s,filter .15s;}
        .qcard:hover{transform:translateX(4px);filter:brightness(1.1);}
        .qcard:active{cursor:grabbing;}
        .nbtn{background:${T.surface2};border:1px solid ${T.border2};color:${T.text};border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;transition:all .12s;white-space:nowrap;}
        .nbtn:hover{background:#1f2435;border-color:#353d55;}
        .nbtn.active{background:${T.accent};color:#000;border-color:${T.accent};}
        input[type=text],input[type=number],select,textarea{background:${T.surface2};border:1px solid ${T.border};color:${T.text};padding:7px 10px;border-radius:6px;width:100%;font-size:11px;transition:border-color .15s;}
        input:focus,select:focus,textarea:focus{outline:none;border-color:#3a5a9a;}
        textarea{resize:vertical;}
        label{display:block;font-size:10px;color:#8892aa;font-weight:600;margin-bottom:4px;letter-spacing:.2px;}
        .rh{width:4px;background:${T.surface};cursor:col-resize;flex-shrink:0;transition:background .15s;}
        .rh:hover{background:#2484f5;}
        .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);z-index:999;display:flex;align-items:center;justify-content:center;}
        .modal{background:${T.surface};border:1px solid ${T.border2};border-radius:12px;padding:24px;width:460px;max-height:90vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.6);}
        .modal h3{font-size:15px;font-weight:700;color:${T.text};margin-bottom:18px;}
        .fr{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}
        .fc{margin-bottom:12px;}
        .pill{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:999px;font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;}
        @media print{body{background:#fff!important;}.no-print{display:none!important;}.print-page{display:block!important;}}
        .print-page{display:none;}
      `}</style>

      {/* ══════ LEFT PLAN ══════ */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", minWidth:0 }}>

        {/* ── Top bar ── */}
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"0 14px", height:52, background:T.surface, borderBottom:`1px solid ${T.border}`, flexShrink:0, flexWrap:"wrap" }}>

          <div style={{ display:"flex", alignItems:"center", gap:8, marginRight:6 }}>
            <div style={{ width:28, height:28, background:"#E53935", borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, color:"#fff", flexShrink:0 }}>I</div>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:T.text, lineHeight:1, letterSpacing:.3 }}>INTEGRAF</div>
              <div style={{ fontSize:9, color:T.muted, letterSpacing:.3 }}>Výrobní plán</div>
            </div>
          </div>

          <div style={{ width:1, height:28, background:T.border, flexShrink:0 }} />

          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
            <span style={{ fontSize:14, fontWeight:700, color:T.text, fontFamily:"'JetBrains Mono',monospace", lineHeight:1 }}>{fmtTime(now)}</span>
            <span style={{ fontSize:9, color:T.muted }}>{DAYS_CZ[now.getDay()]} {fmtShort(now)}</span>
          </div>

          <div style={{ width:1, height:28, background:T.border, flexShrink:0 }} />

          <div style={{ display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
            <span style={{ fontSize:9, color:T.muted, fontWeight:600, letterSpacing:.5, textTransform:"uppercase" }}>Zobrazit</span>
            {[7,14,21,30].map(n => (
              <button key={n} className={`nbtn${numDays===n?" active":""}`} onClick={() => setNumDays(n)}>{n} dní</button>
            ))}
          </div>

          <div style={{ width:1, height:28, background:T.border, flexShrink:0 }} />

          <div style={{ position:"relative", display:"flex", alignItems:"center" }}>
            <span style={{ position:"absolute", left:9, fontSize:11, color:T.muted, pointerEvents:"none" }}>⌕</span>
            <input type="text" value={filterText} onChange={e => setFilterText(e.target.value)}
              placeholder="Hledat zakázku…" style={{ width:160, padding:"5px 9px 5px 26px", fontSize:11 }} />
          </div>
          {filterText && <button className="nbtn" style={{ color:"#f87171" }} onClick={() => setFilterText("")}>✕</button>}

          <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
            {JOB_TYPES.map(t => (
              <div key={t.value} className="pill" style={{ background:`${t.color}22`, border:`1px solid ${t.color}55`, color:t.color }}>
                <div style={{ width:6, height:6, borderRadius:2, background:t.color }} />
                {t.label.split(" ")[0]}
              </div>
            ))}
            <div className="pill" style={{ background:`${T.past}aa`, border:`1px solid #3a3d50`, color:T.muted }}>
              <div style={{ width:6, height:6, borderRadius:2, background:"#3a3d50" }} />
              Hotovo
            </div>
          </div>

          <button onClick={() => setPrintDate(dateKey(addDays(today(), 1)))} title="Tisk / PDF"
            style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(255,230,0,.1)", border:"1px solid rgba(255,230,0,.3)", borderRadius:8, padding:"5px 12px", color:T.accent, cursor:"pointer", fontSize:11, fontWeight:700, flexShrink:0 }}>
            🖨 Tisk / PDF
          </button>

          <button onClick={() => locked ? setShowLockModal(true) : lock()}
            style={{ display:"flex", alignItems:"center", gap:6, background: locked?"rgba(239,68,68,.12)":"rgba(34,197,94,.12)", border:`1px solid ${locked?"rgba(239,68,68,.4)":"rgba(34,197,94,.4)"}`, borderRadius:8, padding:"5px 12px", color:locked?"#f87171":"#4ade80", cursor:"pointer", fontSize:11, fontWeight:700, flexShrink:0 }}>
            <span style={{ fontSize:14 }}>{locked ? "🔒" : "🔓"}</span>
            {locked ? "Zamčeno" : "Odemčeno"}
          </button>
        </div>

        {/* ── GRID ── */}
        <div style={{ flex:1, overflowY:"auto", overflowX:"hidden" }}>

          <div style={{ position:"sticky", top:0, zIndex:20, display:"flex", background:T.surface, borderBottom:`2px solid ${T.border2}` }}>
            <div style={{ width:116, flexShrink:0, borderRight:`1px solid ${T.border}` }} />
            {MACHINES.map((m, mi) => {
              const mc = [{bg:"rgba(15,120,100,.22)",border:"rgba(20,184,166,.35)",text:"#5eead4",dot:"#14b8a6"},{bg:"rgba(160,90,10,.22)",border:"rgba(245,158,11,.35)",text:"#fcd34d",dot:"#f59e0b"}][mi];
              return (
                <div key={m} style={{ flex:1, height:36, padding:"0 14px", borderLeft:mi===0?`1px solid ${T.border}`:`3px solid #1e3535`, background:mc.bg, borderBottom:`1px solid ${mc.border}`, display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
                  <div style={{ width:8, height:8, borderRadius:2, background:mc.dot, flexShrink:0, boxShadow:`0 0 8px ${mc.dot}99` }} />
                  <span style={{ fontSize:12, fontWeight:800, color:mc.text, letterSpacing:.5, textTransform:"uppercase", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m}</span>
                </div>
              );
            })}
          </div>

          {visibleDates.map((date) => {
            const dk = dateKey(date);
            const isToday = dk === todayKey;
            const isWeekend = date.getDay()===0||date.getDay()===6;

            return (
              <div key={dk} style={{ display:"flex", borderBottom:`2px solid ${isToday?"#2484f5":isWeekend?"rgba(234,88,12,.6)":T.border2}` }}>

                <div style={{ width:44, flexShrink:0, position:"sticky", left:0, zIndex:6,
                  background:isToday?"rgba(10,25,70,.97)":isWeekend?"rgba(90,38,5,.97)":"rgba(17,19,24,.97)",
                  borderRight:`1px solid ${T.border}`,
                  borderLeft:isToday?"3px solid #2484f5":isWeekend?"3px solid rgba(234,88,12,.8)":`3px solid ${T.border}`,
                  display:"flex", flexDirection:"column", justifyContent:"center", alignItems:"center", gap:1, padding:"4px 2px" }}>
                  <span style={{ fontSize:18, fontWeight:800, color:isToday?"#60a5fa":isWeekend?"#fb923c":T.text, lineHeight:1 }}>{date.getDate()}.</span>
                  <span style={{ fontSize:9, fontWeight:700, color:isToday?"#60a5fa":isWeekend?"#fb923c":T.muted, textTransform:"uppercase" }}>{MONTHS_S[date.getMonth()]}</span>
                  <span style={{ fontSize:9, fontWeight:700, color:isToday?"#60a5fa":isWeekend?"#fb923c":T.muted }}>{DAYS_CZ[date.getDay()]}</span>
                  {isToday && <span style={{ fontSize:7, background:"#2484f5", color:"#fff", borderRadius:3, padding:"1px 3px", fontWeight:700, marginTop:1 }}>DNES</span>}
                </div>

                <div style={{ width:72, flexShrink:0, background:"rgba(17,19,24,.97)", borderRight:`1px solid ${T.border}` }}>
                  {Array.from({length:TOTAL_SLOTS},(_,s) => (
                    <div key={s} style={{ height:SLOT_H, display:"flex", alignItems:"flex-start", justifyContent:"flex-end", paddingRight:6, borderBottom:s%2===1?`1px solid ${T.border}33`:`1px dashed transparent` }}>
                      {s%2===0 && (
                        <span style={{ fontSize:9, fontWeight:600, color:s%8===0?T.muted:"#2a3040", fontFamily:"'JetBrains Mono',monospace", lineHeight:`${SLOT_H}px`, marginTop:-1 }}>
                          {String(s/2).padStart(2,"0")}:00
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {MACHINES.map((machine, mi) => (
                  <div key={machine} style={{ flex:1, position:"relative", height:TOTAL_SLOTS*SLOT_H, borderLeft:mi===0?`1px solid ${T.border}`:`3px solid #1e3535`, background:mi===0?"rgba(15,120,100,.02)":"rgba(160,90,10,.02)", minWidth:0 }}>

                    {Array.from({length:TOTAL_SLOTS},(_,s) => (
                      <div key={s} style={{ position:"absolute", left:0, right:0, top:s*SLOT_H, height:SLOT_H,
                        borderBottom:s%2===1?`1px solid ${T.border}33`:`1px dashed ${T.border}18`,
                        background:isWeekend?(s%4<2?"rgba(194,65,12,.06)":"rgba(194,65,12,.10)"):
                          mi===0?(s%4<2?"rgba(15,120,100,.03)":"rgba(15,120,100,.06)"):
                          (s%4<2?"rgba(160,90,10,.03)":"rgba(160,90,10,.06)") }} />
                    ))}

                    {Array.from({length:TOTAL_SLOTS},(_,s) => {
                      const isDT = dropTarget?.machine===machine && dropTarget.date===dk && dropTarget.slot===s;
                      const excl = isDT && dragging?.source==="plan" ? dragging.job.id : null;
                      const slotsLeftHere = TOTAL_SLOTS - s;
                      const willOverflowHere = isDT && dragging && dragging.job.durationSlots > slotsLeftHere;
                      const dropOk = isDT && dragging && (willOverflowHere
                        ? isSlotFree(jobs, machine, dk, s, slotsLeftHere, excl)
                        : isSlotFree(jobs, machine, dk, s, dragging.job.durationSlots, excl));
                      return (
                        <div key={s}
                          className={`cell${isDT?(dropOk?" drop-ok":" drop-bad"):""}`}
                          style={{ position:"absolute", left:0, right:0, top:s*SLOT_H, height:SLOT_H, zIndex:1 }}
                          onDragOver={e => onCellDragOver(e, machine, dk, s)}
                          onDrop={e => onCellDrop(e, machine, dk, s)}
                        />
                      );
                    })}

                    {isToday && (
                      <div style={{ position:"absolute", left:0, right:0, top:currentNowSlot*SLOT_H, height:2, background:"rgba(255,80,80,.9)", zIndex:10, pointerEvents:"none", boxShadow:"0 0 8px rgba(255,80,80,.5)" }}>
                        <div style={{ position:"absolute", left:0, top:-4, width:9, height:9, borderRadius:"50%", background:"#ff5050", boxShadow:"0 0 6px #ff5050" }} />
                      </div>
                    )}

                    {filteredJobs.filter(j => j.machine===machine && j.date===dk).map(job => {
                      const isPast  = jobIsPast(job, isToday?currentNowSlot:(parseKey(job.date)<today()?999:-1));
                      const isDim   = dragging?.source==="plan" && dragging.job.id===job.id;
                      const isFaded = anyFilter && !filteredJobs.find(j=>j.id===job.id&&(j.orderNum.toLowerCase().includes(filterText.toLowerCase())||j.description.toLowerCase().includes(filterText.toLowerCase())));
                      const jColor  = isPast?T.past:job.color;
                      const jText   = isPast?T.pastText:"#fff";
                      const lightC  = isPast?"#3a3d50":typeLightColor(job.type);
                      return (
                        <div key={job.id}
                          className={`jb${isDim?" dim":""}${isFaded?" faded":""}${locked?" locked-view":""}`}
                          draggable
                          onDragStart={e => onPlanDragStart(e, job)}
                          onDragEnd={onDragEnd}
                          onDoubleClick={e => { if(locked) return; e.stopPropagation(); setEditJob({...job}); }}
                          title={`${job.orderNum||job.type} – ${job.description}`}
                          style={{
                            position:"absolute", left:2, right:2,
                            top:job.slot*SLOT_H+1, height:job.durationSlots*SLOT_H-2,
                            background:isPast?`linear-gradient(135deg,${T.past} 0%,#1e2130 100%)`:`linear-gradient(135deg,${jColor} 0%,${lightC} 100%)`,
                            borderRadius:6, display:"flex", alignItems:"stretch", overflow:"hidden",
                            boxShadow:isPast?"none":`0 2px 8px ${jColor}44, inset 0 1px 0 rgba(255,255,255,.12)`,
                            zIndex:2, border:isPast?`1px solid #252a3a`:`1px solid ${lightC}66`,
                          }}
                        >
                          {job.type !== "maintenance" && (
                            <div style={{ width:46, flexShrink:0, background:"rgba(0,0,0,.35)", display:"flex", flexDirection:"column", justifyContent:"center", padding:"2px 3px", gap:2, borderRight:"1px solid rgba(255,255,255,.1)" }}
                              onClick={e=>e.stopPropagation()}>
                              <CheckBadge label="D" value={job.dataDate} isOk={job.dataOk} onToggle={()=>toggleField(job.id,"dataOk")} canCheck />
                              <CheckBadge label="M" value={job.mat}      isOk={job.matOk}  onToggle={()=>toggleField(job.id,"matOk")}  canCheck />
                              <CheckBadge label="E" value={job.exp}      isOk={false}       canCheck={false} />
                            </div>
                          )}
                          <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"flex-start", padding:"3px 6px", overflow:"hidden", minWidth:0 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:1 }}>
                              <span style={{ fontSize:10, fontWeight:700, color:jText, lineHeight:1.2, opacity: isPast ? 0.6 : 1, overflow:"hidden", wordBreak:"break-word" }}>
                                {job.orderNum||job.description.substring(0,14)}
                              </span>
                              {isPast && job.durationSlots>=3 && <span style={{ fontSize:7, background:"rgba(255,255,255,.08)", color:T.muted, borderRadius:3, padding:"1px 4px", fontWeight:600, flexShrink:0 }}>HOTOVO</span>}
                              {job.badge && !isPast && job.durationSlots>=4 && <span style={{ fontSize:7, background:"rgba(0,0,0,.35)", color:"rgba(255,255,255,.7)", borderRadius:3, padding:"1px 4px", fontWeight:600, marginLeft:"auto", flexShrink:0 }}>{job.badge}</span>}
                            </div>
                            {job.durationSlots >= 2 && (
                              <span style={{ fontSize:9, color:`${jText}${isPast?"55":"bb"}`, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"normal", lineHeight:1.3, fontWeight:job.bold?600:400, wordBreak:"break-word" }}>
                                {job.description}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {!locked && <div className="rh" onMouseDown={onResizeMouseDown} />}

      {!locked && (
        <div style={{ width:panelW, flexShrink:0, display:"flex", flexDirection:"column", background:T.surface, borderLeft:`1px solid ${T.border}` }}>

          <div style={{ padding:"16px 16px 14px", borderBottom:`1px solid ${T.border}`, flexShrink:0, background:"linear-gradient(135deg,#13161f 0%,#0f1118 100%)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
              <div style={{ width:30, height:30, background:"linear-gradient(135deg,#E53935,#ff6b35)", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:900, color:"#fff", flexShrink:0 }}>J</div>
              <div>
                <div style={{ fontSize:14, fontWeight:800, color:"#fff", letterSpacing:.3, lineHeight:1 }}>Job Builder</div>
                <div style={{ fontSize:9, color:"#E53935", fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", marginTop:2 }}>Integraf</div>
              </div>
            </div>
            <div style={{ fontSize:10, color:"#6b7894", lineHeight:1.5 }}>
              Vyplň formulář → přidej do fronty → přetáhni do plánu
            </div>
          </div>

          <div style={{ padding:"0", flexShrink:0, overflowY:"auto" }}>

            <div style={{ padding:"14px 16px 12px", borderBottom:`1px solid ${T.border}` }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#9ba8c0", textTransform:"uppercase", letterSpacing:1.2, marginBottom:8 }}>Typ záznamu</div>
              <div style={{ display:"flex", gap:6 }}>
                {JOB_TYPES.map(t => (
                  <button key={t.value}
                    onClick={() => setBuilder(p => ({...p, type:t.value}))}
                    style={{ flex:1, padding:"8px 4px", borderRadius:8, border:`1px solid ${builder.type===t.value?t.color:T.border2}`, background:builder.type===t.value?`${t.color}28`:T.surface2, color:builder.type===t.value?t.color:"#6b7894", fontSize:9, fontWeight:700, cursor:"pointer", textAlign:"center", lineHeight:1.4 }}>
                    <div style={{ fontSize:14, marginBottom:2 }}>
                      {t.value==="ok"?"📋":t.value==="reservation"?"📌":"🔧"}
                    </div>
                    {t.label.split("(")[0].trim()}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ padding:"14px 16px 12px", borderBottom:`1px solid ${T.border}` }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#9ba8c0", textTransform:"uppercase", letterSpacing:1.2, marginBottom:10 }}>
                {builder.type==="maintenance"?"Detail údržby":"Zakázka"}
              </div>
              {builder.type !== "maintenance" && (
                <div className="fr">
                  <div><label>Číslo zakázky</label><input type="text" value={builder.orderNum} onChange={e=>setBuilder(p=>({...p,orderNum:e.target.value}))} placeholder="17001" /></div>
                  <div>
                    <label>Délka tisku</label>
                    <select value={builder.durationSlots} onChange={e=>setBuilder(p=>({...p,durationSlots:parseInt(e.target.value)}))}>
                      {Array.from({length:48},(_,i)=>i+1).map(s=>(
                        <option key={s} value={s}>{s%2===0?`${s/2} hod`:`${Math.floor(s/2)}:30`}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              {builder.type === "maintenance" && (
                <div className="fc">
                  <label>Délka</label>
                  <select value={builder.durationSlots} onChange={e=>setBuilder(p=>({...p,durationSlots:parseInt(e.target.value)}))}>
                    {Array.from({length:48},(_,i)=>i+1).map(s=>(
                      <option key={s} value={s}>{s%2===0?`${s/2} hod`:`${Math.floor(s/2)}:30`}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="fc" style={{ marginBottom:0 }}>
                <label>{builder.type==="maintenance"?"Popis údržby / opravy":"Popis zakázky"}</label>
                <textarea rows={2} value={builder.description} onChange={e=>setBuilder(p=>({...p,description:e.target.value}))} placeholder={builder.type==="maintenance"?"Výměna gumy, kalibrace…":"Firma – produkt – počet ta…"} />
              </div>
            </div>

            {builder.type !== "maintenance" && (
              <div style={{ padding:"14px 16px 12px", borderBottom:`1px solid ${T.border}` }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#9ba8c0", textTransform:"uppercase", letterSpacing:1.2, marginBottom:10 }}>Termíny</div>
                <div className="fr">
                  <div>
                    <label>📥 Data – příjem podkladů</label>
                    <input type="date" value={builder.dataDate} onChange={e=>setBuilder(p=>({...p,dataDate:e.target.value}))} style={{ colorScheme:"dark" }} />
                  </div>
                  <div>
                    <label>📦 Materiál – příjem</label>
                    <input type="date" value={builder.mat} onChange={e=>setBuilder(p=>({...p,mat:e.target.value}))} style={{ colorScheme:"dark" }} />
                  </div>
                </div>
                <div className="fr" style={{ marginBottom:0 }}>
                  <div>
                    <label>🚚 Expedice – termín</label>
                    <input type="date" value={builder.exp} onChange={e=>setBuilder(p=>({...p,exp:e.target.value}))} style={{ colorScheme:"dark" }} />
                  </div>
                  <div>
                    <label>Badge (volitelné)</label>
                    <input type="text" value={builder.badge} onChange={e=>setBuilder(p=>({...p,badge:e.target.value}))} placeholder="SCH Lumina LED" />
                  </div>
                </div>
              </div>
            )}

            {(builder.orderNum || builder.description) && (
              <div style={{ padding:"14px 16px 0" }}>
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:"#9ba8c0", textTransform:"uppercase", letterSpacing:1.2, marginBottom:8 }}>Náhled</div>
                  <div style={{ background:`linear-gradient(135deg,${typeColor(builder.type)} 0%,${typeLightColor(builder.type)} 100%)`, borderRadius:8, padding:"8px 10px", display:"flex", gap:8, alignItems:"center", boxShadow:`0 4px 16px ${typeColor(builder.type)}44`, border:`1px solid ${typeLightColor(builder.type)}66` }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:"#fff" }}>{builder.orderNum||"—"}</div>
                      <div style={{ fontSize:9, color:"rgba(255,255,255,.75)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginTop:2 }}>{builder.description||"—"}</div>
                    </div>
                    <div style={{ background:"rgba(0,0,0,.25)", borderRadius:6, padding:"4px 8px", textAlign:"center", flexShrink:0 }}>
                      <div style={{ fontSize:15, fontWeight:800, color:"rgba(255,255,255,.8)" }}>{builder.durationSlots%2===0?builder.durationSlots/2:Math.floor(builder.durationSlots/2)}</div>
                      <div style={{ fontSize:7, color:"rgba(255,255,255,.5)" }}>{builder.durationSlots%2===0?"HOD":":30"}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div style={{ padding:"12px 16px 16px" }}>
              <button
                onClick={() => {
                  if (locked || (!builder.description && !builder.orderNum)) return;
                  setQueue(prev => [...prev, { ...builder, id:Date.now(), color:typeColor(builder.type) }]);
                  setBuilder(emptyBuilder);
                }}
                style={{ width:"100%", padding:"11px", borderRadius:8, border:"none", background:T.accent, color:"#000", fontSize:12, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
                onMouseEnter={e=>e.target.style.filter="brightness(1.08)"}
                onMouseLeave={e=>e.target.style.filter=""}
              >
                <span style={{ fontSize:14 }}>+</span> Přidat do fronty
              </button>
            </div>
          </div>

          <div style={{ flex:1, overflowY:"auto", padding:"14px 16px 16px", borderTop:`1px solid ${T.border}` }}>
            <div style={{ fontSize:10, color:"#9ba8c0", fontWeight:700, textTransform:"uppercase", letterSpacing:1.2, marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
              Fronta ke naplánování
              {queue.length > 0 && <span style={{ background:T.accent, color:"#000", borderRadius:999, fontSize:9, fontWeight:800, padding:"1px 6px", marginLeft:"auto" }}>{queue.length}</span>}
            </div>

            {queue.length === 0 && (
              <div style={{ color:T.border2, fontSize:11, textAlign:"center", padding:"20px 0" }}>
                Fronta je prázdná.<br />
                <span style={{ fontSize:9 }}>Přidej zakázku výše.</span>
              </div>
            )}

            {queue.map(qj => (
              <div key={qj.id} className="qcard" draggable onDragStart={e=>onQueueDragStart(e,qj)} onDragEnd={onDragEnd}
                style={{ background:`linear-gradient(135deg,${typeColor(qj.type)} 0%,${typeLightColor(qj.type)} 100%)`, borderRadius:8, marginBottom:8, display:"flex", alignItems:"stretch", overflow:"hidden", boxShadow:`0 2px 12px ${typeColor(qj.type)}44`, border:`1px solid ${typeLightColor(qj.type)}66` }}>
                <div style={{ background:"rgba(0,0,0,.2)", width:36, flexShrink:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
                  <span style={{ fontSize:14, fontWeight:800, color:"rgba(255,255,255,.85)", lineHeight:1 }}>{qj.durationSlots%2===0?qj.durationSlots/2:Math.floor(qj.durationSlots/2)}</span>
                  <span style={{ fontSize:7, color:"rgba(255,255,255,.4)", letterSpacing:.3 }}>{qj.durationSlots%2===0?"HOD":":30"}</span>
                </div>
                <div style={{ flex:1, padding:"8px 10px", minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:"#fff", lineHeight:1, marginBottom:3 }}>{qj.orderNum||"—"}</div>
                  <div style={{ fontSize:9, color:"rgba(255,255,255,.65)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{qj.description}</div>
                  {(qj.mat||qj.exp) && (
                    <div style={{ display:"flex", gap:5, marginTop:3 }}>
                      {qj.mat && <span style={{ fontSize:8, background:"rgba(0,0,0,.2)", color:"rgba(255,255,255,.6)", borderRadius:3, padding:"1px 4px" }}>MAT {fmtMini(qj.mat)}</span>}
                      {qj.exp && <span style={{ fontSize:8, background:"rgba(0,0,0,.2)", color:"rgba(255,255,255,.6)", borderRadius:3, padding:"1px 4px" }}>EXP {fmtMini(qj.exp)}</span>}
                    </div>
                  )}
                </div>
                <button onClick={()=>setQueue(prev=>prev.filter(q=>q.id!==qj.id))}
                  style={{ background:"rgba(0,0,0,.15)", border:"none", color:"rgba(255,255,255,.4)", cursor:"pointer", padding:"0 10px", fontSize:14, flexShrink:0 }}>✕</button>
              </div>
            ))}

            {queue.length > 0 && (
              <div style={{ fontSize:9, color:T.border2, textAlign:"center", marginTop:6 }}>← přetáhni kartu do plánu vlevo</div>
            )}
          </div>
        </div>
      )}

      {/* PRINT MODAL */}
      {printDate && (() => {
        const pdk = printDate;
        const pDate = parseKey(pdk);
        const pJobs = jobs.filter(j => j.date === pdk);
        const schedule = MACHINES.map(machine => ({
          machine,
          jobs: pJobs.filter(j => j.machine===machine).sort((a,b)=>a.slot-b.slot)
        }));
        const fmtSlot = s => { const h=Math.floor(s/2), m=s%2===0?"00":"30"; return `${String(h).padStart(2,"0")}:${m}`; };
        const fmtDur  = s => s%2===0?`${s/2}h`:`${Math.floor(s/2)}:30h`;
        return (
          <div className="modal-bg no-print" onClick={()=>setPrintDate(null)}>
            <div style={{ background:"#fff", borderRadius:12, width:"90vw", maxWidth:900, maxHeight:"90vh", display:"flex", flexDirection:"column", overflow:"hidden", boxShadow:"0 24px 64px rgba(0,0,0,.5)" }} onClick={e=>e.stopPropagation()}>
              <div style={{ padding:"16px 20px", borderBottom:"1px solid #e5e7eb", display:"flex", alignItems:"center", gap:12, background:"#f9fafb" }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#E53935", letterSpacing:2, textTransform:"uppercase" }}>INTEGRAF</div>
                  <div style={{ fontSize:16, fontWeight:800, color:"#111" }}>Výrobní plán – {fmtShort(pDate)} {pDate.getFullYear()} ({DAYS_CZ[pDate.getDay()]})</div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <input type="date" value={`${pdk.split(".")[2]}-${pdk.split(".")[1]}-${pdk.split(".")[0]}`}
                    onChange={e=>{const [y,m,d]=e.target.value.split("-");setPrintDate(`${d}.${m}.${y}`);}}
                    style={{ border:"1px solid #d1d5db", borderRadius:6, padding:"6px 10px", fontSize:12, colorScheme:"light" }} />
                  <button onClick={()=>window.print()} style={{ background:"#E53935", color:"#fff", border:"none", borderRadius:8, padding:"8px 18px", fontSize:12, fontWeight:700, cursor:"pointer" }}>🖨 Tisk / PDF</button>
                  <button onClick={()=>setPrintDate(null)} style={{ background:"#f3f4f6", color:"#374151", border:"1px solid #d1d5db", borderRadius:8, padding:"8px 14px", fontSize:12, fontWeight:600, cursor:"pointer" }}>✕ Zavřít</button>
                </div>
              </div>
              <div style={{ overflowY:"auto", padding:"20px", background:"#fff" }}>
                {schedule.map(({machine, jobs:mJobs}) => (
                  <div key={machine} style={{ marginBottom:24 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, paddingBottom:8, borderBottom:"2px solid #111" }}>
                      <div style={{ width:10, height:10, borderRadius:2, background:machine===MACHINE_XL105?"#14b8a6":"#f59e0b" }} />
                      <span style={{ fontSize:15, fontWeight:800, color:"#111", letterSpacing:.5, textTransform:"uppercase" }}>{machine}</span>
                      <span style={{ fontSize:11, color:"#6b7280", marginLeft:"auto" }}>{mJobs.length} zakázek</span>
                    </div>
                    {mJobs.length===0 ? (
                      <div style={{ fontSize:12, color:"#9ca3af", fontStyle:"italic" }}>Žádné zakázky</div>
                    ) : (
                      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                        <thead>
                          <tr style={{ background:"#f3f4f6" }}>
                            {["Čas","Délka","Zakázka","Popis","Data","Materiál","Expedice"].map(h => (
                              <th key={h} style={{ padding:"6px 10px", textAlign:"left", fontWeight:700, color:"#374151", fontSize:10, textTransform:"uppercase", borderBottom:"1px solid #e5e7eb" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {mJobs.map((job,ri) => {
                            const ti = JOB_TYPES.find(t=>t.value===job.type)||JOB_TYPES[0];
                            return (
                              <tr key={job.id} style={{ background:ri%2===0?"#fff":"#f9fafb", borderBottom:"1px solid #e5e7eb" }}>
                                <td style={{ padding:"8px 10px", fontWeight:700, fontFamily:"monospace" }}>{fmtSlot(job.slot)}</td>
                                <td style={{ padding:"8px 10px" }}>{fmtDur(job.durationSlots)}</td>
                                <td style={{ padding:"8px 10px" }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                    <div style={{ width:8, height:8, borderRadius:2, background:ti.color, flexShrink:0 }} />
                                    <span style={{ fontWeight:700, color:"#111" }}>{job.orderNum||"—"}</span>
                                  </div>
                                </td>
                                <td style={{ padding:"8px 10px", color:"#374151" }}>{job.description}</td>
                                <td style={{ padding:"8px 10px", textAlign:"center" }}>{job.dataOk?<span style={{ color:"#16a34a", fontWeight:700 }}>✓</span>:<span>{fmtMini(job.dataDate)||"—"}</span>}</td>
                                <td style={{ padding:"8px 10px", textAlign:"center" }}>{job.matOk?<span style={{ color:"#16a34a", fontWeight:700 }}>✓</span>:<span style={{ color:isOverdue(job.mat,job.matOk)?"#dc2626":"#374151", fontWeight:isOverdue(job.mat,job.matOk)?700:400 }}>{fmtMini(job.mat)||"—"}</span>}</td>
                                <td style={{ padding:"8px 10px", textAlign:"center" }}>{fmtMini(job.exp)||"—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
                <div style={{ marginTop:16, paddingTop:12, borderTop:"1px solid #e5e7eb", display:"flex", justifyContent:"space-between", fontSize:10, color:"#9ca3af" }}>
                  <span>INTEGRAF – Výrobní plán</span>
                  <span>Vytištěno: {fmtShort(today())} {today().getFullYear()} {fmtTime(now)}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* LOCK MODAL */}
      {showLockModal && (
        <div className="modal-bg" onClick={()=>{setShowLockModal(false);setLockInput("");}}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{ width:320, textAlign:"center" }}>
            <div style={{ fontSize:48, marginBottom:16 }}>🔒</div>
            <h3 style={{ textAlign:"center", marginBottom:8, fontSize:18 }}>Plán je zamčen</h3>
            <p style={{ fontSize:12, color:T.muted, marginBottom:20, lineHeight:1.6 }}>
              Zadej heslo plánovače výroby<br />pro odemčení editace.
            </p>
            <input type="password" value={lockInput}
              onChange={e=>{setLockInput(e.target.value);setLockError(false);}}
              onKeyDown={e=>e.key==="Enter"&&unlock()}
              placeholder="Heslo…" autoFocus
              style={{ textAlign:"center", letterSpacing:4, fontSize:16, marginBottom:8, border:lockError?"1px solid #ef4444":undefined, background:lockError?"rgba(239,68,68,.08)":undefined }} />
            {lockError && <div style={{ fontSize:11, color:"#f87171", marginBottom:10, fontWeight:600 }}>✕ Nesprávné heslo</div>}
            {!lockError && <div style={{ marginBottom:16 }} />}
            <button onClick={unlock} style={{ width:"100%", padding:"10px", borderRadius:8, border:"none", background:T.accent, color:"#000", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              Odemknout plán
            </button>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {editJob && (
        <div className="modal-bg" onClick={()=>setEditJob(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <h3>Editovat záznam</h3>
            <div className="fc">
              <label>Typ</label>
              <div style={{ display:"flex", gap:8 }}>
                {JOB_TYPES.map(t => (
                  <button key={t.value} onClick={()=>setEditJob(p=>({...p,type:t.value,color:typeColor(t.value)}))}
                    style={{ flex:1, padding:"7px 6px", borderRadius:6, border:`1px solid ${editJob.type===t.value?t.color:T.border2}`, background:editJob.type===t.value?`${t.color}22`:T.surface2, color:editJob.type===t.value?t.color:T.muted, fontSize:10, fontWeight:700, cursor:"pointer" }}>
                    {t.label.split("(")[0].trim()}
                  </button>
                ))}
              </div>
            </div>
            <div className="fr">
              <div><label>Číslo zakázky</label><input type="text" value={editJob.orderNum||""} onChange={e=>setEditJob(p=>({...p,orderNum:e.target.value}))} /></div>
              <div>
                <label>Délka</label>
                <select value={editJob.durationSlots} onChange={e=>setEditJob(p=>({...p,durationSlots:parseInt(e.target.value)}))}>
                  {Array.from({length:48},(_,i)=>i+1).map(s=>(
                    <option key={s} value={s}>{s%2===0?`${s/2} hod`:`${Math.floor(s/2)}:30`}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="fr">
              <div><label>Datum (dd.mm.rrrr)</label><input type="text" value={editJob.date} onChange={e=>setEditJob(p=>({...p,date:e.target.value}))} /></div>
              <div>
                <label>Čas začátku</label>
                <select value={editJob.slot} onChange={e=>setEditJob(p=>({...p,slot:parseInt(e.target.value)}))}>
                  {Array.from({length:48},(_,s)=>{
                    const h=Math.floor(s/2), m=s%2===0?"00":"30";
                    return <option key={s} value={s}>{String(h).padStart(2,"0")}:{m}</option>;
                  })}
                </select>
              </div>
            </div>
            <div><label style={{ marginBottom:4 }}>Stroj</label>
              <select value={editJob.machine} onChange={e=>setEditJob(p=>({...p,machine:e.target.value}))}>
                {MACHINES.map(m=><option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="fc"><label>Popis</label><textarea rows={2} value={editJob.description} onChange={e=>setEditJob(p=>({...p,description:e.target.value}))} /></div>
            <div className="fr">
              <div><label>Data – příjem podkladů</label><input type="date" value={editJob.dataDate||""} onChange={e=>setEditJob(p=>({...p,dataDate:e.target.value}))} style={{ colorScheme:"dark" }} /></div>
              <div><label>Materiál – příjem</label><input type="date" value={editJob.mat||""} onChange={e=>setEditJob(p=>({...p,mat:e.target.value}))} style={{ colorScheme:"dark" }} /></div>
            </div>
            <div className="fc"><label>Expedice – termín</label><input type="date" value={editJob.exp||""} onChange={e=>setEditJob(p=>({...p,exp:e.target.value}))} style={{ colorScheme:"dark" }} /></div>
            <div className="fc"><label>Badge</label><input type="text" value={editJob.badge||""} onChange={e=>setEditJob(p=>({...p,badge:e.target.value}))} /></div>
            <div style={{ display:"flex", gap:10, padding:"10px 0 14px", borderTop:`1px solid ${T.border}`, marginTop:4 }}>
              <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:12, color:T.muted }}>
                <input type="checkbox" checked={!!editJob.dataOk} onChange={e=>setEditJob(p=>({...p,dataOk:e.target.checked}))} />
                Data OK
              </label>
              <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:12, color:T.muted }}>
                <input type="checkbox" checked={!!editJob.matOk} onChange={e=>setEditJob(p=>({...p,matOk:e.target.checked}))} />
                Materiál OK
              </label>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={saveEdit} style={{ flex:1, padding:"9px", borderRadius:6, border:"none", background:T.accent, color:"#000", fontSize:12, fontWeight:700, cursor:"pointer" }}>Uložit</button>
              <button onClick={()=>setEditJob(null)} style={{ padding:"9px 16px", borderRadius:6, border:`1px solid ${T.border2}`, background:T.surface2, color:T.muted, fontSize:12, fontWeight:600, cursor:"pointer" }}>Zrušit</button>
              <button onClick={()=>deleteJob(editJob.id)} style={{ padding:"9px 14px", borderRadius:6, border:"none", background:"#7f1d1d", color:"#fca5a5", fontSize:12, fontWeight:700, cursor:"pointer" }}>Smazat</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
