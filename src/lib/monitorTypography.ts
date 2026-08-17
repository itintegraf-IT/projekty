import { PLANNER_FONT_SCALES, type PlannerFontScale } from "./plannerTypography";

/**
 * Velikost písma na Monitoru u stroje — jediný zdroj pravdy (17. 8. 2026,
 * prosba tiskařů o větší písmo u zakázek ve frontě).
 *
 * Monitor měl velikosti zapsané absolutně v pixelech, takže přepínač M/L/XL
 * z plánu (etapa čitelnost timeline, 8/2026) na něj vůbec nesahal: tiskař si
 * zvětšil plán, přepnul na domovskou obrazovku a fronta zůstala drobná.
 *
 * **Stupeň sdílí s plánem** (`PLANNER_FONT_SCALES` i `FONT_SCALE_STORAGE_KEY`) —
 * je to jedno nastavení jedné obrazovky u stroje, ne dvě nezávislá. Vlastní
 * škála existuje jen proto, že Monitor má úplně jiné rozměry než karta bloku
 * v mřížce (46px číslo zakázky přes půl obrazovky vs. 12px v plánu).
 *
 * Čistá logika bez Reactu, aby šla pokrýt unit testy.
 */

/**
 * Pevná výška tlačítek na velké kartě (HOTOVO / Další / Vrátit / Přeskočit).
 *
 * ZÁMĚRNĚ neroste se stupněm písma: je to dotykový cíl u stroje, na který
 * tiskař sahá v rukavici, a 96 px je už dnes pohodlných. Roste jen popisek —
 * a strážný test v `monitorTypography.test.ts` hlídá, že se do téhle výšky
 * vejde i v XL.
 */
export const MONITOR_HERO_BUTTON_HEIGHT = 96;

export type MonitorTypeScale = {
  key: PlannerFontScale;
  /** Násobitel stupně — sdílený s plánem. */
  fontFactor: number;

  // ── Hlavička ──────────────────────────────────────────────────────────────
  /** Název stroje vlevo. */
  headMachine: number;
  /** Hodiny. */
  headClock: number;
  /** Tlačítka Najít / Celý plán / Odhlásit. */
  headButton: number;

  // ── Velká karta ───────────────────────────────────────────────────────────
  /** Nadpis stavu (TEĎ BĚŽÍ / PŘETAHUJE / ZAČÍNÁ / ✓ ODKLEPNUTO). */
  kicker: number;
  /** Číslo zakázky. */
  heroOrder: number;
  /** Popis zakázky. */
  heroDesc: number;
  /** Amber pás specifikace. */
  heroSpec: number;
  /** Řádek „Začíná v …" u budoucí zakázky. */
  heroTiming: number;
  /** Časy kolem pruhu postupu. */
  heroTimingRow: number;
  /** Popisek dne a „Zbývá / Přetahuje o". */
  heroTimingLabel: number;
  /** Hláška „✓ Hotovo HH:MM" u odklepnuté zakázky. */
  heroDone: number;
  /** Řádek se stavem druhého stroje u rozdělené zakázky. */
  heroPartner: number;
  /** Poznámka „vybráno ručně" a její tlačítko. */
  heroNote: number;
  /** Hláška v prázdné kartě. */
  heroEmpty: number;

  // ── Tlačítka velké karty ──────────────────────────────────────────────────
  btnDone: number;
  btnNext: number;
  btnRevert: number;
  /** Popisek „OPRAVDU VRÁTIT?" — delší text, proto menší než `btnRevert`. */
  btnRevertConfirm: number;
  btnSkip: number;

  // ── Fronta ────────────────────────────────────────────────────────────────
  /** Nadpisy sekcí NEDODĚLÁNO / DNES / ZÍTRA a nadpis fronty. */
  sectionTitle: number;
  queueOrder: number;
  queueDesc: number;
  queueTime: number;
  queueSpec: number;
  /** Zúžený řádek sekce NEDODĚLÁNO. */
  queueOrderCompact: number;
  queueDescCompact: number;
  queueTimeCompact: number;
  /** Řádek údržby: štítek „🔧 ÚDRŽBA" a název/popis pod ním. */
  queueMaintLabel: number;
  queueMaintText: number;
  /** Hláška prázdné fronty. */
  queueEmpty: number;

  // ── Chipy (velká karta i fronta) ──────────────────────────────────────────
  chipHero: number;
  chipQueue: number;
};

/**
 * `Math.round` je záměrný: Monitor stojí na velkých velikostech a celá čísla
 * se na kioskových panelech vykreslí ostřeji než subpixelové zlomky. U stupně
 * M vyjde každá hodnota přesně na dnešní číslo (násobitel je 1) — hlídá to
 * strážný test, aby zavedení škály nikomu nepřemalovalo výchozí vzhled.
 */
export function monitorTypeScale(key: PlannerFontScale): MonitorTypeScale {
  const s = PLANNER_FONT_SCALES[key];
  const px = (base: number) => Math.round(base * s);

  return {
    key,
    fontFactor: s,

    headMachine: px(17),
    headClock: px(18),
    headButton: px(13),

    kicker: px(12),
    heroOrder: px(46),
    heroDesc: px(24),
    heroSpec: px(17),
    heroTiming: px(17),
    heroTimingRow: px(16),
    heroTimingLabel: px(15),
    heroDone: px(20),
    heroPartner: px(13),
    heroNote: px(13),
    heroEmpty: px(16),

    btnDone: px(30),
    btnNext: px(26),
    btnRevert: px(22),
    btnRevertConfirm: px(16),
    btnSkip: px(18),

    sectionTitle: px(11),
    queueOrder: px(14),
    queueDesc: px(13),
    queueTime: px(13),
    queueSpec: px(13),
    queueOrderCompact: px(13),
    queueDescCompact: px(12),
    queueTimeCompact: px(12),
    queueMaintLabel: px(11),
    queueMaintText: px(13),
    queueEmpty: px(14),

    chipHero: px(12),
    chipQueue: px(11),
  };
}
