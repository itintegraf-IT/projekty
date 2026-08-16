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
  target: AttentionTarget;
};

/**
 * Kam položka vede.
 *
 * `tab` NENÍ odkaz, ale přepnutí záložky na místě. Původně to odkaz byl
 * (`href: "/reporty"`) a nefungoval: režim je lokální `useState`, stránka
 * žádný query parametr nečte a `<a>` na vlastní URL udělá plný reload — takže
 * „Výhled →" z Retrospektivy skončilo zase na Retrospektivě a „Kontrolní
 * panel →" z Výhledu dokonce tiše zahodilo záložku, na které člověk stál.
 * Mrtvý odkaz je horší než žádný; tenhle byl ještě horší než mrtvý.
 *
 * `href` zůstává jen tam, kde se opravdu jde na jinou stránku.
 */
export type AttentionTarget =
  | { kind: "tab"; tab: "retro" | "outlook" | "health"; label: string }
  | { kind: "href"; href: string; label: string };

export type OverbookedMachine = {
  machine: string;
  overbookedHours: number;
  /** Kolik dní horizontu je nad kapacitou. Nemusí jít o souvislý úsek. */
  overbookedDays: number;
};

export type WaitingReservation = {
  id: number;
  orderNumber: string;
  /** `SUBMITTED` = nikdo neotevřel · `QUEUE_READY` = převzato, čeká na místo v plánu. */
  status: string;
  waitingDays: number;
};

/**
 * `loaded: false` znamená „nevíme", ne „je čisto". Rozdíl je podstatný: bez
 * něj by pás při selhání fetche tvrdil, že je uklizeno.
 */
export type HealthInput = { loaded: boolean; total: number; uncomputed: number };

export type AttentionInput = {
  overbooked: OverbookedMachine[];
  waiting: WaitingReservation[];
  health: HealthInput;
  /**
   * Kolik dní horizontu šlo u kterého stroje posoudit. Den bez kapacity se
   * přeskakuje, takže tohle číslo NENÍ vždycky rovno horizontu — a klidná
   * věta se podle něj řídí. Chybějící klíč znamená „neposuzováno".
   */
  checkedDaysByMachine?: Record<string, number>;
};

/** Desetinná čárka. Jedno místo, ať se zápis nerozejde se zbytkem reportu. */
const cz = (n: number) => String(n).replace(".", ",");

/**
 * České skloňování po číslovce. Exportované, protože týž tvar potřebuje
 * i seznam rezervací ve Výhledu — bez něj tam stálo „čeká 1 dní“.
 */
export const plural = (n: number, one: string, few: string, many: string) =>
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
      detail: "některý den nad kapacitou stroje",
      when: `${m.overbookedDays} ${plural(m.overbookedDays, "den", "dny", "dní")} z ${ATTENTION_THRESHOLDS.overbookedHorizonDays}`,
      target: { kind: "tab", tab: "outlook", label: "Výhled →" },
    });
  }

  if (input.health.loaded && input.health.total > 0) {
    items.push({
      key: "health:findings",
      severity: "bad",
      title: `${input.health.total} ${plural(input.health.total, "nález", "nálezy", "nálezů")} v datech`,
      detail: "Kontrolní panel našel nesrovnalosti",
      when: "",
      target: { kind: "tab", tab: "health", label: "Kontrolní panel →" },
    });
  }

  /*
   * Rezervace se dělí na DVĚ položky podle stavu, ne na jednu.
   *
   * Původně pás bral jen `SUBMITTED`, kdežto seznam v sekci RIZIKA počítá
   * i `QUEUE_READY` — a barví řádky TÝMŽ prahem. Vznikl tím protimluv na
   * jedné obrazovce: pás hlásil „nic nevyžaduje pozornost", zatímco pod ním
   * svítily čtyři červené řádky s čekáním 6–9 dní.
   *
   * Sloučit je do jedné položky by ale zamlžilo rozdíl, který je věcný:
   * „bez odezvy" znamená, že se na to nikdo nepodíval; „čeká na naplánování"
   * znamená, že někdo převzal a shání místo v plánu. Jsou to dvě různé
   * činnosti pro dva různé lidi.
   */
  const late = input.waiting.filter((r) => r.waitingDays > ATTENTION_THRESHOLDS.reservationWaitingDays);
  const groups: Array<{ key: string; statuses: string[]; noun: (n: number) => string; detail: string }> = [
    {
      key: "reservations:unanswered",
      statuses: ["SUBMITTED"],
      noun: (n) => plural(n, "rezervace bez odezvy", "rezervace bez odezvy", "rezervací bez odezvy"),
      detail: `nikdo je zatím nepřevzal, čekají déle než ${thresholdDays()}`,
    },
    {
      key: "reservations:queued",
      statuses: ["QUEUE_READY"],
      noun: (n) => plural(n, "rezervace čeká na naplánování", "rezervace čekají na naplánování", "rezervací čeká na naplánování"),
      detail: `převzaté, ale zatím bez místa v plánu`,
    },
  ];
  for (const g of groups) {
    const rows = late.filter((r) => g.statuses.includes(r.status));
    if (rows.length === 0) continue;
    const longest = Math.max(...rows.map((r) => r.waitingDays));
    items.push({
      key: g.key,
      severity: "warn",
      title: `${rows.length} ${g.noun(rows.length)}`,
      detail: g.detail,
      when: `nejdéle ${longest} ${plural(longest, "den", "dny", "dní")}`,
      target: { kind: "href", href: "/rezervace", label: "Rezervace →" },
    });
  }

  if (input.health.loaded && input.health.uncomputed > 0) {
    items.push({
      key: "health:uncomputed",
      severity: "warn",
      title: `${input.health.uncomputed} ${plural(input.health.uncomputed, "kontrola se nespočetla", "kontroly se nespočetly", "kontrol se nespočetlo")}`,
      detail: "výsledek není úplný",
      when: "",
      target: { kind: "tab", tab: "health", label: "Kontrolní panel →" },
    });
  }

  return items;
}

/**
 * Věta pro klidný stav. Vyjmenovává, co bylo ověřeno — a NIKDY netvrdí víc.
 *
 * Dvě věci, které se sem musely doplnit, protože věta jinak lhala:
 *  - Když se Kontrolní panel nenačetl, o kontrolách mlčí (`loaded: false`).
 *  - Když stroj nemá v horizontu ani jeden den s kapacitou (nenaseedované
 *    týdny směn), pás ho neposuzoval — a věta „ani jeden stroj není nad
 *    kapacitou" pak tvrdila výsledek třiceti kontrol, z nichž neproběhla
 *    žádná.
 */
export function attentionCalmSentence(input: AttentionInput): string {
  const checked: string[] = [];

  const days = input.checkedDaysByMachine;
  const posouzeno = days == null
    ? MACHINES.slice()
    : MACHINES.filter((m) => (days[m] ?? 0) > 0);

  if (posouzeno.length === MACHINES.length) {
    // „Oba" přestane platit, až `MACHINES` dostane třetí prvek.
    const word = MACHINES.length === 2 ? "ani jeden stroj" : "žádný stroj";
    checked.push(`${word} není v příštích ${ATTENTION_THRESHOLDS.overbookedHorizonDays} dnech nad kapacitou`);
  } else if (posouzeno.length > 0) {
    checked.push(`${posouzeno.map(machineLabel).join(" a ")} v příštích ${ATTENTION_THRESHOLDS.overbookedHorizonDays} dnech nad kapacitou není`);
  }
  // Když neposouzen ani jeden stroj, o kapacitě se prostě mlčí.

  checked.push(`žádná rezervace nečeká déle než ${thresholdDays()}`);
  if (input.health.loaded) checked.push("kontroly bez nálezu");

  return `${checked.join(" · ")}.`;
}

/**
 * Ví pás vůbec dost na to, aby směl tvrdit „nic nevyžaduje pozornost"?
 *
 * Kontrolní panel se stahuje zvlášť a doběhne později — nebo vůbec. Bez
 * tohohle rozlišení pás vypsal tučné „Nic nevyžaduje pozornost." ve chvíli,
 * kdy o kontrolách nevěděl nic, a na sousední záložce přitom svítil odznak
 * „!". Odznak má kvůli témuž riziku tři stavy; pás měl dva.
 */
export function attentionIsFullyVerified(input: AttentionInput): boolean {
  if (!input.health.loaded) return false;
  const days = input.checkedDaysByMachine;
  if (days == null) return true;
  return MACHINES.every((m) => (days[m] ?? 0) > 0);
}
