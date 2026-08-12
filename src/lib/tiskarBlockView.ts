/**
 * Prezentační pravidla karty bloku v tiskařském režimu.
 *
 * Záměrně čistá logika bez Reactu, aby šla pokrýt unit testy — komponenta
 * PrintDoneButton i BlockCard na ní jen staví a samy nic nepočítají.
 */

import { DEFAULT_FONT_SCALE, plannerTypeScale, type PlannerTypeScale } from "./plannerTypography";

const DEFAULT_TS = plannerTypeScale(DEFAULT_FONT_SCALE);

/**
 * Podoba tlačítka Hotovo.
 * `bar` a `square` vrací printDoneSize() podle výšky bloku v plánu;
 * `hero` si sestavuje Monitor sám — v kartě bloku se nikdy nepoužije.
 * `bar.height` je od oprav 8/2026 spojité číslo (ne jen 40/32/24) — na nízkých
 * kartách se nejnižší stupeň pruhu dopočítává z dostupného místa, viz
 * `printDoneSize` níž.
 */
export type PrintDoneSize =
  | { variant: "bar";    height: number; fontSize: number }
  | { variant: "square"; height: number; fontSize: number }
  | { variant: "hero";   height: number; fontSize: number };

/**
 * Odsazení kolem pruhu Hotovo: paddingTop 2 + paddingBottom 5. Sdílené se
 * `splitChipFits` (deklarace je fyzicky níž, ale JS moduly se vyhodnocují
 * shora dolů PŘED prvním voláním exportované funkce, takže pořadí konstant
 * v souboru na běhové chování nemá vliv).
 */
export const PRINT_BAR_PADDING_PX = 7;

/**
 * Spodní podlaha (px), pod kterou karta/tlačítko nesmí klesnout — SDÍLENÁ mezi
 * dvěma nezávislými místy, která ji dřív držela jako dva samostatné literály `20`:
 * dolní mez čtverce `square` tady níž (`printDoneSize`) a podlaha `layoutHeight`
 * (`clampedHeight`/`contentHeight`) v `BlockCard.tsx`. Do task 5c (12. 8. 2026, review)
 * se kryly jen NÁHODOU — kdyby někdo zvýšil stranu čtverce (např. kvůli stížnosti na
 * dotykový cíl) bez úpravy podlahy v `BlockCard.tsx`, tlačítko by se do vlastního boxu
 * přestalo vejít, přesně třída havárie z 3. 8. 2026. Jeden export = jedna pravda;
 * `STRÁŽNÝ TEST 5c` v `tiskarBlockView.test.ts` ověřuje, že `printDoneSize` na
 * hranici téhle podlahy vždycky vrátí výšku `<=` ní.
 */
export const MIN_CARD_CONTENT_HEIGHT_PX = 20;

/**
 * Rozměr tlačítka Hotovo pro danou výšku bloku (`layoutHeight` z BlockCard).
 *
 * **Práh varianty `bar` MUSÍ zůstat `ts.thresholds.full`** — přesně na hranici,
 * kde se karta přepne do plného layoutu (`MODE_FULL` v `BlockCard.tsx`). Plný
 * layout vykresluje tlačítko Hotovo JEN pro variantu `bar` (`BlockCard.tsx`,
 * u `MODE_FULL && printDone?.variant === "bar"`) — variantu `square` kreslí
 * výhradně kompaktní a jednořádkové layouty. Kdyby práh `bar` ležel nad
 * `ts.thresholds.full` (jako dřív, `Math.max(full, header+26)`), vzniklo by
 * pásmo, kde je karta už v plném layoutu, ale `printDoneSize` by pořád vracela
 * `square` — a tiskař by na kartě neměl VŮBEC žádné tlačítko. Přesně tahle
 * havárie nastala 3. 8. 2026 (a znovu, hůř, při předchozí opravě 8/2026, kdy
 * práh dostal rezervu na výšku pruhu a rozešel se s `MODE_FULL`).
 *
 * Aby se na nízkých kartách (těsně nad `ts.thresholds.full`) pruh do karty
 * reálně vešel, NEzvyšuje se práh, ale zmenšuje se PRUH: nejnižší stupeň bar
 * varianty (dřív napevno 24 px) se dopočítává z toho, co po prvním řádku karty
 * (`ts.rowHeights.header`) a jeho odsazení (`PRINT_BAR_PADDING_PX`) reálně
 * zbývá, se stropem 24 px. Vyšší stupně (32 a 40) mají místa vždycky dost,
 * ty se neupravují.
 *
 * Prahy 140 a 96 rostou s mřížkou (`ts.slotFactor`) — porovnávají se s
 * `layoutHeight`, který taky roste s mřížkou, takže je to dimenzionálně
 * správně. Velikost popisku uvnitř bar varianty naopak roste s PÍSMEM
 * (`ts.fontFactor`) — jinak by na XL popisek „Hotovo" vyrostl jen o 12 %
 * místo 35 % jako zbytek textu karty (nález z code review, 8/2026).
 *
 * Od `ts.thresholds.micro` je čtverec s háčkem, pod tím karta nevykresluje
 * obsah vůbec → `null`.
 *
 * **Čtverec (`square`) se od 8/2026 (task 5b, rozhodnutí majitele 12. 8. 2026)
 * přizpůsobuje výšce karty, ale nikdy neklesne pod `MIN_CARD_CONTENT_HEIGHT_PX`
 * (20 px).** Dřív byl napevno `height: 26` bez ohledu na `layoutHeight` — varianta
 * se ale kreslí od `ts.thresholds.micro` (na M 14 px), takže na spodním konci pásma
 * byl čtverec o 12 px vyšší než karta a `overflow: hidden` ho oříznul. Rozměr se
 * teď dopočítává (`Math.max(MIN_CARD_CONTENT_HEIGHT_PX, Math.min(26, layoutHeight - 2))`)
 * — na velmi nízké kartě je přijatelnější mírný přesah (tlačítko se u stroje mačká
 * prstem, netrefitelný cíl je horší volba). Písmo uvnitř roste úměrně
 * (`15 × squareSide / 26`), ne napevno — jinak by na nejnižší kartě text
 * přerostl zmenšený čtverec.
 */
export function printDoneSize(layoutHeight: number, ts: PlannerTypeScale = DEFAULT_TS): PrintDoneSize | null {
  const big = Math.round(140 * ts.slotFactor);
  const mid = Math.round(96 * ts.slotFactor);
  const barThreshold = ts.thresholds.full;
  if (layoutHeight >= big) return { variant: "bar", height: 40, fontSize: Math.round(16 * ts.fontFactor) };
  if (layoutHeight >= mid) return { variant: "bar", height: 32, fontSize: Math.round(14 * ts.fontFactor) };
  if (layoutHeight >= barThreshold) {
    const height = Math.min(24, layoutHeight - ts.rowHeights.header - PRINT_BAR_PADDING_PX);
    return { variant: "bar", height, fontSize: 11.5 };
  }
  if (layoutHeight >= ts.thresholds.micro) {
    const squareSide = Math.max(MIN_CARD_CONTENT_HEIGHT_PX, Math.min(26, layoutHeight - 2));
    return { variant: "square", height: squareSide, fontSize: 15 * squareSide / 26 };
  }
  return null;
}

// ── Výškový rozpočet karty v tiskařském režimu ────────────────────────────────
// Karta je flex column s `overflow: hidden`, takže co se nevejde, to se ořízne.
// Tlačítko Hotovo má přednost před SplitChipem — tiskař musí mít vždy čím
// odklepnout tisk. Výšky řádků 1 a spec pásu se od 8/2026 berou ze stupně
// písma (`ts.rowHeights`, `plannerTypography.ts`), ne z napevno zapsaných čísel.

/**
 * Výška SplitChipu VČETNĚ marginTop 6, rámečku (1+1) a svislého paddingu (3+3) —
 * dřív napevno 25 px, ale od Task 6 (etapa čitelnost timeline) dostal `SplitChip`
 * prop `fontSize={typeScale.splitChip}` a roste s písmem, takže napevno zapsané
 * číslo přestalo platit pro L/XL (bylo by podhodnocené a rozpočet by na vyšších
 * stupních propouštěl chip, který se ve skutečnosti nevejde). Dopočet ze
 * skutečného box modelu komponenty (`SplitChip.tsx`): marginTop 6 + rámeček
 * (1+1) + padding (3+3) + fontSize × 1,1 (line-height). Na M vychází přesně
 * 25 px (beze změny), na L 26,65 px, na XL 28,85 px.
 */
function splitChipPx(ts: PlannerTypeScale): number {
  return 6 + 2 + 6 + ts.splitChip * 1.1;
}
// PRINT_BAR_PADDING_PX (paddingTop 2 + paddingBottom 5 kolem pruhu Hotovo) je
// deklarovaná výš, u printDoneSize — sdílí ji obě funkce.

/**
 * Vejde se SplitChip do karty, aniž by vytlačil tlačítko Hotovo pod ořez?
 *
 * Bez této brzdy skončil na hodinovém bloku (52 px) se split partnerem celý
 * zelený pruh Hotovo mimo kartu a tiskař neměl jak potvrdit tisk — regrese
 * zachycená před nasazením 3. 8. 2026. Výšky řádků se od 8/2026 berou ze stupně
 * písma (`ts.rowHeights`), ne z napevno zapsaných čísel — jinak by se ta regrese
 * při zvětšení písma vrátila.
 */
export function splitChipFits(
  layoutHeight: number,
  printDone: PrintDoneSize | null,
  specRows: 0 | 1 | 2,
  ts: PlannerTypeScale = DEFAULT_TS
): boolean {
  const barReserve = printDone?.variant === "bar" ? printDone.height + PRINT_BAR_PADDING_PX : 0;
  const specReserve = specRows === 2 ? ts.rowHeights.spec2 : specRows === 1 ? ts.rowHeights.spec1 : 0;
  const used = ts.rowHeights.header + specReserve + barReserve;
  return layoutHeight - used >= splitChipPx(ts);
}

/**
 * Vejde se pás specifikace (SpecBand) do karty U TISKAŘE, aniž by vytlačil
 * tlačítko Hotovo pod ořez?
 *
 * `hasSpecBand` v `BlockCard.tsx` u tiskaře donedávna kontrolu vejití
 * ZÁMĚRNĚ obcházela (`isTiskar || specFitsBand`) — pás se ukázal, kdykoliv
 * `showSpec` bylo true, bez ohledu na to, jestli po Řádku 1 a pásu zbylo
 * místo na tlačítko. Tlačítko má přednost před vším ostatním obsahem karty
 * (havárie 3. 8. 2026, kdy tiskař neměl čím odklepnout tisk) — pás
 * specifikace proto u tiskaře musí ustoupit, když by tlačítko nezůstalo celé
 * (rozhodnutí majitele, task 5b, 12. 8. 2026).
 *
 * Stejný rozpočet jako `splitChipFits` (Řádek 1 + pás + pruh Hotovo), jen bez
 * rezervy pro SplitChip navíc — tady se ptáme, jestli se vejde pás SAMOTNÝ
 * spolu s tlačítkem, ne jestli po nich zbyde místo na něco dalšího.
 *
 * **Záruka předpokládá JEDNOŘÁDKOVÝ popis** (`descLineClamp === 1`) —
 * `ts.rowHeights.header` použité tady je odhad Řádku 1 přesně pro tenhle
 * případ. Do task 5d (12. 8. 2026) to byla jen NADĚJE, ne vynucený předpoklad:
 * `descLineClamp` mohl u tiskaře vyjít `>= 2` (nastávalo to prakticky v CELÉM
 * pásmu, kde se pás specifikace u tiskaře vůbec kreslí, viz `tiskarSpecMin`),
 * Řádek 1 pak v DOM přerostl tenhle odhad o ~12,4 px a pruh Hotovo mohl
 * přetéct (~12,9/14,7/17,1 px M/L/XL) i když `specBandFits` vrátila `true`.
 *
 * **Rozhodnutí majitele (task 5d, 12. 8. 2026): ustupuje POPIS, ne pás.**
 * Tiskař potřebuje specifikaci (to je to, co má tisknout) a tlačítko Hotovo
 * (jediná cesta, jak odklepne tisk) víc než dlouhý popis. Předpoklad je teď
 * VYNUCENÝ na straně volajícího, ne jen doufaný: `BlockCard.tsx` volá
 * `descLineClampFor` (níž v tomhle souboru), která pro `ZAKAZKA` s
 * `isTiskar && hasSpecBand` vrátí `1` bez výjimky — `hasSpecBand` se
 * tam počítá (a musí počítat) DŘÍV, než se výsledek použije, aby
 * závislost byla přímá, ne oklikou.
 *
 * **Bezvýhradná je ale JEN v ose VÝŠKY** (`layoutHeight`) — mimo ni zbývají
 * dvě mezery, obě NAMĚŘENÉ, obě VĚDOMĚ NEOPRAVENÉ (review 12. 8. 2026):
 * 1. **Šířka.** Pravý shluk chipů v Řádku 1 (`BlockCard.tsx`, kolem ř. 1069)
 *    má `flexWrap: "wrap"` a v rozpočtu tady není vůbec — nejmenší naměřená
 *    rezerva pod tlačítkem je 1,50/1,44/1,36 px (M/L/XL), zatímco JEDNO
 *    zalomení shluku (dlouhé D/M/E/P chipy, badge poznámek) by stálo
 *    +15,0/+16,2/+17,8 px. Stejná třída havárie jako přetečení výšky, jen
 *    řízená ŠÍŘKOU karty. Neopraveno záměrně — sloupec stroje u tiskaře je
 *    široký ~1250 px, takže je to dnes prakticky nedosažitelné.
 * 2. **Rámeček karty.** Karta má `box-sizing: border-box` a rámeček 1–2,5 px
 *    (zamčená 1,5 px, ve výběru 2,5 px), ale rozpočet měří proti
 *    `layoutHeight`, které rámeček zahrnuje. Dnes to pohlcuje spodní
 *    odsazení pruhu Hotovo (5 px, `PRINT_BAR_PADDING_PX`) — je to nevyslovená
 *    rezerva, na kterou se výška spoléhá, ne samostatně počítaná záruka.
 */
export function specBandFits(
  layoutHeight: number,
  printDone: PrintDoneSize | null,
  specRows: 1 | 2,
  ts: PlannerTypeScale = DEFAULT_TS
): boolean {
  const barReserve = printDone?.variant === "bar" ? printDone.height + PRINT_BAR_PADDING_PX : 0;
  const specReserve = specRows === 2 ? ts.rowHeights.spec2 : ts.rowHeights.spec1;
  return ts.rowHeights.header + specReserve + barReserve <= layoutHeight;
}

/**
 * Smí mít popis u TISKAŘE víc než jeden řádek, když je na kartě pás
 * specifikace?
 *
 * Rozhodnutí majitele (task 5d, 12. 8. 2026): NE — ustupuje popis, ne pás.
 * Tiskař potřebuje specifikaci (to je to, co má tisknout) a tlačítko Hotovo
 * (jediná cesta, jak odklepne tisk) víc než dlouhý popis; ten se u tiskaře
 * zkrátí na jeden řádek elipsou. Zůstává dostupný jen v atributu `title`
 * (hover) a plný, dvouřádkový na **Monitoru** u stroje — na dotykovém
 * kiosku hover nenastane, `title` tam nikdo nepřečte (review 12. 8. 2026,
 * viz `descLineClampFor`); Monitor je proto skutečná záchrana pro tiskaře,
 * ne tooltip. `BlockCard.tsx` kreslí popis, tahle funkce jen rozhoduje POČET
 * řádků.
 *
 * **Omezeno na `ZAKAZKA`** — pruh Hotovo se kreslí jen pro `ZAKAZKA`
 * (`BlockCard.tsx`), takže u REZERVACE/UDRZBA není co chránit. Bez tyhle
 * podmínky by rezervace/údržba se specifikací přišly o řádky popisu bez
 * bezpečnostního důvodu (review 12. 8. 2026, nález 4).
 *
 * Volající (`BlockCard.tsx`, přes `descLineClampFor`) tím VYNUCUJE
 * jednořádkový předpoklad, na kterém `specBandFits` výš počítá Řádek 1
 * (`ts.rowHeights.header`) — do téhle opravy to byla jen NADĚJE (viz historie
 * v docstringu `specBandFits`): dvouřádkový popis mohl Řádek 1 v DOM zvednout
 * nad odhad a pruh Hotovo přetéct. Rozpočet teď říká pravdu, ne se jen stává
 * konzervativnějším.
 *
 * `hasSpecBand` (volající strana) MUSÍ být spočítaná DŘÍV, než se použije
 * výsledek týhle funkce — jinak by závislost šla oklikou a pořadí by nebylo
 * z kódu čitelné.
 */
export function tiskarDescClampsToOneLine(isTiskar: boolean | undefined, hasSpecBand: boolean, blockType: string): boolean {
  return !!isTiskar && hasSpecBand && blockType === "ZAKAZKA";
}

/**
 * Kolik řádků smí mít popis v Řádku 1 karty (MODE_FULL)?
 *
 * JEDINÉ místo, které vzorec `Math.max(2, Math.floor(...))` počítá — dřív žil
 * inline v `BlockCard.tsx` a nešel pokrýt testem. Review 12. 8. 2026: dřívější
 * extrakce (jen booleovské rozhodnutí `tiskarDescClampsToOneLine`) mutační
 * test nechytila na páté z pěti vsazených chyb — smazání volání v
 * `BlockCard.tsx` nechalo platný, tiše regresní kód (starý inline vzorec vedle
 * něj). `BlockCard.tsx` teď volá TUHLE funkci a nic víc, žádná záložní větev
 * vedle volání — smazání volání znamená chybějící proměnnou (chyba typové
 * kontroly), ne tichou regresi.
 *
 * Práh `× 1,4` (`ts.thresholds.descMultiline`) se přestěhoval do
 * `plannerTypography.ts` k ostatním prahům — je to číslo stejné povahy jako
 * `thresholds.full`/`compact`/`tiny`, jen dřív žilo osamocené v komponentě.
 */
export function descLineClampFor(
  layoutHeight: number,
  ts: PlannerTypeScale,
  opts: { isTiskar?: boolean; hasSpecBand: boolean; blockType: string }
): number {
  if (tiskarDescClampsToOneLine(opts.isTiskar, opts.hasSpecBand, opts.blockType)) return 1;
  if (layoutHeight < ts.thresholds.descMultiline) return 1;
  return Math.max(2, Math.floor((layoutHeight - ts.thresholds.full - 7) / Math.round(ts.desc * 1.3)));
}

/**
 * Svislý padding Řádku 1 (číslo + popis + pravý shluk chipů) v plném layoutu —
 * `BlockCard.tsx`, paddingTop 5 + paddingBottom 3. Sdílené s `splitChipFitsInHeaderRow`.
 */
const HEADER_ROW_PADDING_PX = 8;

/**
 * Vejde se SplitChip do PRVNÍHO ŘÁDKU karty, na místo textové značky „✂1/2"
 * v pravém shluku (Task 6, fix „mizející pilulka" po zvětšení SplitChipu v etapě
 * čitelnost timeline)?
 *
 * Je to ZÁLOŽNÍ umístění pro pásmo, kde `splitChipFits` (dnešní umístění pod
 * pásem specifikace/tlačítkem Hotovo) vrátí false — karta je v MODE_FULL, ale
 * na spodní pilulku už nezbude místo. Řádek 1 bez pilulky měří přesně
 * `ts.rowHeights.header`; s pilulkou uvnitř o něco naroste, protože pilulka je
 * vyšší než drobná textová značka, kterou nahrazuje.
 *
 * Počítá se BEZ vlastního `marginTop` SplitChipu (na rozdíl od `splitChipPx`
 * použitého v `splitChipFits`) — `BlockCard.tsx` pilulku na tomhle místě obaluje
 * wrapperem s `marginTop: -6`, který vestavěné odsazení zruší. V horizontálním
 * shluku drobných chipů (`alignItems: "center"`) by ten margin jen zbytečně
 * nafukoval Řádek 1 a ubíral místo tlačítku Hotovo pod ním — přesně ta třída
 * chyby, které `splitChipFits` brání na spodním umístění.
 *
 * Řádek 1 může narůst NAD `ts.rowHeights.header` jen do výšky pilulky — pokud
 * by číslo/popis samo o sobě bylo vyšší (víceřádkový popis na vysoké kartě),
 * `Math.max` to zohlední.
 *
 * SKUTEČNÝ obor volání z `BlockCard.tsx` (`showSplitChipInHeader`) je ŠIRŠÍ,
 * než by se čekalo (ověřeno přepočtem, krok 0,5 px, `specRows` odvozené z
 * reálné cesty `hasSpecBand` u tiskaře — `tiskarSpecMin` a `specTwoLine` mají
 * STEJNÝ vzorec `round(80·s)`, takže `specRows` u tiskaře přeskakuje rovnou
 * z 0 na 2, `specRows === 1` se v praxi nikdy nevolá):
 *   - M: 58–79,5 px bez pásu specifikace; s pásem 92–95,5 a 100–121,5 px.
 *   - L: 60–83,5 px bez pásu; s pásem 98–100,5 a 106–129,5 px.
 *   - XL: 62–88,5 px bez pásu; s pásem 105–107,5 a 113–139,5 px.
 *
 * **OPRAVENO task 5d (12. 8. 2026):** v pásmech S PÁSEM specifikace (výš)
 * `descLineClamp` dřív NEBYL vždy 1 — teď JE, vždycky, u tiskaře s `ZAKAZKA`
 * (`descLineClampFor` vynucuje 1 řádek, viz její docstring). Funkce je tam
 * teď BEZPEČNĚJŠÍ, než tenhle odstavec dřív tvrdil: Řádek 1 v těch pásmech
 * nemůže přerůst `ts.rowHeights.header` vůbec, takže argument níž („i
 * víceřádkový popis pilulce neškodí") se na ně už nevztahuje — je to tam
 * triviálně bezpečné, ne shodou okolností bezpečné.
 *
 * V pásmech BEZ pásu specifikace (`hasSpecBand` false — mimo `ZAKAZKA` u
 * tiskaře, nebo mimo tiskaře úplně) `descLineClamp` (`descLineClampFor`)
 * dál NENÍ vždy 1 a platí původní argument: tohle funkce ve svém vzorci
 * nepočítá vůbec, ale tlačítku Hotovo to navzdory tomu neškodí — kdykoliv je
 * popis víceřádkový, jeho skutečná výška (`desc × 1,3 × descLineClamp`) už
 * PŘED pilulkou přerůstá box pilulky (ověřeno stejným přepočtem) — Řádek 1 je
 * v těch pásmech ve skutečné DOM vyšší, než `ts.rowHeights.header` navrhuje,
 * ale o tolik víc, kolik by tam přidat sám popis BEZ pilulky. Pilulka na tenhle
 * již existující (a už dřív zdokumentovaný, viz komentář u `specFitsBand`
 * v `BlockCard.tsx`) rozjezd nic nepřidává navíc. Je to STEJNÁ třída
 * neopravované mezery jako `hasSpecBand` bypass `specFitsBand` u tiskaře
 * (samostatný nález, viz `task-6-report.md`) — mimo kontrakt téhle funkce,
 * ne regrese Task 6.
 */
export function splitChipFitsInHeaderRow(
  layoutHeight: number,
  printDone: PrintDoneSize | null,
  specRows: 0 | 1 | 2,
  ts: PlannerTypeScale = DEFAULT_TS
): boolean {
  const barReserve = printDone?.variant === "bar" ? printDone.height + PRINT_BAR_PADDING_PX : 0;
  const specReserve = specRows === 2 ? ts.rowHeights.spec2 : specRows === 1 ? ts.rowHeights.spec1 : 0;
  const chipContentHeight = 2 + 6 + ts.splitChip * 1.1; // rámeček (1+1) + padding (3+3) + line-height, BEZ marginTop
  const headerRowWithChip = Math.max(ts.rowHeights.header, HEADER_ROW_PADDING_PX + chipContentHeight);
  return headerRowWithChip + specReserve + barReserve <= layoutHeight;
}

/**
 * Běží tisk bloku právě teď? Rozhoduje o zeleném zvýraznění karty u tiskaře.
 * Konec je vyloučený (t < end), aby na hranici dvou navazujících bloků
 * svítil vždy jen jeden. Odklepnutý blok neběží, i když je uvnitř svého času.
 */
export function isBlockRunningNow(
  startTime: string | Date,
  endTime: string | Date,
  now: Date,
  isPrintDone: boolean
): boolean {
  if (isPrintDone) return false;
  const t = now.getTime();
  return t >= new Date(startTime).getTime() && t < new Date(endTime).getTime();
}
