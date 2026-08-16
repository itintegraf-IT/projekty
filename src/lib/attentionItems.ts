import { MACHINES, machineLabel } from "@/lib/machines";

/**
 * Stavový pás nad záložkami Reportů — co vyžaduje pozornost.
 *
 * Modul je ČISTÝ a sdílený: serverová část (`/api/report/attention`) mu podá
 * přeplánované stroje a čekající rezervace, klient přidá stav Kontrolního
 * panelu, který má už stažený. Kdyby si každá strana skládala věty sama,
 * rozešly by se — přesně jako legenda heatmapy s mřížkou před etapou R2.
 *
 * Kontrolní panel se ZÁMĚRNĚ nepočítá na serveru: `useHealthData` ho stahuje
 * při vstupu do Reportů a jeho kontroly skenují disk kvůli přílohám. Druhý
 * běh na každé načtení stránky by byl zbytečně drahý.
 */

export const ATTENTION_THRESHOLDS = {
  /** Rezervace se hlásí, až když čeká DÉLE než tolik dní (ostrá nerovnost). */
  reservationWaitingDays: 3,
  /**
   * Horizont, ve kterém se hlídá přeplánování. PEVNÝ, nezávislý na zvoleném
   * období — jinak by pás hlásil něco jiného podle toho, co má člověk zrovna
   * vybrané, a „vyžaduje pozornost" by přestalo znamenat cokoliv.
   */
  overbookedHorizonDays: 30,
} as const;

export type AttentionSeverity = "bad" | "warn";

export type AttentionItem = {
  /** Stabilní klíč pro React i pro testy. */
  key: string;
  severity: AttentionSeverity;
  /** Tučná část věty. */
  title: string;
  /** Zbytek věty. */
  detail: string;
  /** Pravý sloupec — rozsah nebo doba čekání. */
  when: string;
  href: string;
  linkLabel: string;
};

export type OverbookedMachine = {
  machine: string;
  overbookedHours: number;
  /** Kolik dní horizontu je nad kapacitou. Nemusí jít o souvislý úsek. */
  overbookedDays: number;
};

export type WaitingReservation = { id: number; orderNumber: string; waitingDays: number };

/**
 * `loaded: false` znamená „nevíme", ne „je čisto". Rozdíl je podstatný: bez
 * něj by pás při selhání fetche tvrdil, že je uklizeno.
 */
export type HealthInput = { loaded: boolean; total: number; uncomputed: number };

export type AttentionInput = {
  overbooked: OverbookedMachine[];
  waiting: WaitingReservation[];
  health: HealthInput;
};

/** Desetinná čárka. Jedno místo, ať se zápis nerozejde se zbytkem reportu. */
const cz = (n: number) => String(n).replace(".", ",");

const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n < 5 ? few : many;

/**
 * Práh ve dnech se objevuje ve dvou větách a skloňuje se — při změně konstanty
 * na 1 nebo 5 by natvrdo psané „dny" přestalo sedět.
 */
const thresholdDays = () => {
  const d = ATTENTION_THRESHOLDS.reservationWaitingDays;
  return `${d} ${plural(d, "den", "dny", "dní")}`;
};

export function buildAttentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  // Pořadí je pořadím naléhavosti: přeplánovaný stroj se řeší dnes, rezervace
  // tento týden. Uvnitř skupiny řadíme podle velikosti problému.
  for (const m of [...input.overbooked].sort((a, b) => b.overbookedHours - a.overbookedHours)) {
    items.push({
      key: `overbooked:${m.machine}`,
      severity: "bad",
      title: `${machineLabel(m.machine)} přeplánován o ${cz(m.overbookedHours)} h`,
      detail: "plán nad kapacitou stroje",
      // Nula dní není chyba výpočtu: den bez kapacity (víkend, celozávodní
      // odstávka) se do počtu přeplánovaných dní nezapočítá, protože vytížení
      // je tam nedefinované. Stroj přeplánovaný VÝHRADNĚ mimo pracovní dobu by
      // tedy dostal větu „0 dní z 30", což se čte jako protimluv. Ten případ
      // dostane vlastní text — a je to zároveň užitečnější informace.
      when: m.overbookedDays > 0
        ? `${m.overbookedDays} ${plural(m.overbookedDays, "den", "dny", "dní")} z ${ATTENTION_THRESHOLDS.overbookedHorizonDays}`
        : "mimo pracovní dobu",
      href: "/reporty",
      linkLabel: "Výhled →",
    });
  }

  if (input.health.loaded && input.health.total > 0) {
    items.push({
      key: "health:findings",
      severity: "bad",
      title: `${input.health.total} ${plural(input.health.total, "nález", "nálezy", "nálezů")} v datech`,
      detail: "Kontrolní panel našel nesrovnalosti",
      when: "",
      href: "/reporty",
      linkLabel: "Kontrolní panel →",
    });
  }

  // Rezervace se slučují do JEDNÉ položky — pás má být krátký a čitelný na
  // jeden pohled. Seznam s čísly zakázek je v sekci RIZIKA ve Výhledu.
  //
  // POZOR na rozdíl proti kartě „Čekající na zpracování" ve Výhledu: ta počítá
  // SUBMITTED i QUEUE_READY, pás jen SUBMITTED. Není to nedopatření — jsou to
  // dva různé stavy. QUEUE_READY někdo převzal a čeká na místo v plánu;
  // SUBMITTED nikdo neotevřel. Pás hlásí druhé, a text to musí říct, jinak
  // vypadají dvě různá čísla na téže stránce jako protimluv.
  const late = input.waiting.filter((r) => r.waitingDays > ATTENTION_THRESHOLDS.reservationWaitingDays);
  if (late.length > 0) {
    const longest = Math.max(...late.map((r) => r.waitingDays));
    items.push({
      key: "reservations:waiting",
      severity: "warn",
      title: `${late.length} ${plural(late.length, "rezervace bez odezvy", "rezervace bez odezvy", "rezervací bez odezvy")}`,
      detail: `nikdo je zatím nepřevzal, čekají déle než ${thresholdDays()}`,
      when: `nejdéle ${longest} ${plural(longest, "den", "dny", "dní")}`,
      href: "/rezervace",
      linkLabel: "Rezervace →",
    });
  }

  if (input.health.loaded && input.health.uncomputed > 0) {
    items.push({
      key: "health:uncomputed",
      severity: "warn",
      title: `${input.health.uncomputed} ${plural(input.health.uncomputed, "kontrola se nespočetla", "kontroly se nespočetly", "kontrol se nespočetlo")}`,
      detail: "výsledek není úplný",
      when: "",
      href: "/reporty",
      linkLabel: "Kontrolní panel →",
    });
  }

  return items;
}

/**
 * Věta pro klidný stav. Vyjmenovává, co bylo ověřeno — a NIKDY netvrdí víc.
 * Když se Kontrolní panel nenačetl, o kontrolách mlčí.
 */
export function attentionCalmSentence(input: AttentionInput): string {
  // „Oba stroje" by se stalo lží ve chvíli, kdy `MACHINES` dostane třetí prvek —
  // a věta o klidném stavu je poslední místo, kde chceme tiché nepřesnosti.
  const machinesPhrase = MACHINES.length === 2 ? "oba stroje v kapacitě" : "všechny stroje v kapacitě";
  const checked = [machinesPhrase, `žádná rezervace nečeká déle než ${thresholdDays()}`];
  if (input.health.loaded) checked.push("kontroly bez nálezu");
  return `${checked.join(" · ")}.`;
}
