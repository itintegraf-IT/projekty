/**
 * Texty „co to znamená / co s tím" pro Kontrolní panel — JEDINÝ zdroj pravdy,
 * sdílený kartami i integritními řádky. Dvě věty na kontrolu: první říká, co
 * porušení znamená provozně, druhá co s ním má člověk udělat.
 *
 * Nový klíč kontroly → nový záznam tady, jinak shodí strážný test.
 */
export type CheckCopy = { znamena: string; coStim: string };

export const HEALTH_COPY: Record<string, CheckCopy> = {
  // ── Karty ──
  overlaps: {
    znamena: "Dva bloky stojí na stejném stroji ve stejný čas. Stroj obojí naráz neutiskne, takže jeden z nich se reálně nestihne.",
    coStim: "Otevři je v plánu a jeden přetáhni jinam. Pojistka proti překryvům běží na serveru, tyhle nálezy jsou obvykle starší data nebo ruční zásah do databáze.",
  },
  drift: {
    znamena: "Někdo změnil směny nebo odstávky a uložený konec zakázky už tomu neodpovídá. Karta v plánu je jinak dlouhá, než jak se doopravdy potiskne.",
    coStim: "V plánu klikni nad strojem na „Přepočítat\" — bloky se posunou na platné sloty, zamčené se přeskočí. Vědomě odložené zakázky se sem záměrně nepočítají.",
  },
  outsideHours: {
    znamena: "Zakázka začíná v čase, kdy stroj nejede — mimo směnu nebo v odstávce. Není to vědomé odložení, takže plán slibuje tisk, který nezačne.",
    coStim: "Přetáhni zakázku na běžící slot, nebo uprav pracovní dobu stroje ve Správě, pokud se má tisknout právě tehdy.",
  },
  integrity: {
    znamena: "Hodnoty v databázi, které nedávají smysl — neplatný stroj, konec před začátkem, odkaz na smazaný preset. Vznikají importem, starými daty nebo ručním zásahem.",
    coStim: "Rozbal jednotlivé řádky níž; u každého je konkrétní vadná hodnota a odkaz do plánu.",
  },
  attachments: {
    znamena: "Databáze a disk si neodpovídají: buď je v databázi příloha, jejíž soubor chybí, nebo na disku leží soubor, o kterém databáze neví.",
    coStim: "Chybějící soubor znamená ztracenou přílohu — obnov ji ze zálohy podle docs/OPS_ZALOHY.md. Osamocený soubor na disku je neškodný zbytek po smazané rezervaci.",
  },

  // ── Integritní řádky ──
  orphanJobPreset: {
    znamena: "Blok odkazuje na preset, který už neexistuje. Preset jako jediná z vazeb nemá v databázi cizí klíč, takže se to stát může.",
    coStim: "Otevři blok a vyber platný preset, nebo ho nech prázdný. Uložením se odkaz srovná.",
  },
  invalidMachine: {
    znamena: "Blok je přiřazený stroji, který v aplikaci neexistuje. V plánu se pak nevykreslí nikde a je fakticky neviditelný.",
    coStim: "Blok je nutné opravit v databázi — z aplikace se na neexistující stroj nedá dostat. Připrav zálohu a domluv zásah s IT.",
  },
  invalidType: {
    znamena: "Blok má typ mimo ZAKÁZKA / REZERVACE / ÚDRŽBA. Kód pro takový typ nemá pravidla, takže se chová nepředvídatelně.",
    coStim: "Stejně jako u neplatného stroje: oprava patří do databáze, ne do aplikace. Připrav zálohu a domluv zásah s IT.",
  },
  negativeInterval: {
    znamena: "Blok končí dřív, než začíná. Je to poškozený záznam — v plánu má zápornou výšku a do výpočtů vnáší nesmysly.",
    coStim: "Otevři blok a nastav konec znovu. Pokud nejde otevřít, patří oprava do databáze.",
  },
  badPrintMinutes: {
    znamena: "Tiskový čas není násobek 30 minut, je nulový, nebo přesahuje limit 40 hodin. Blok se pak nevejde do mřížky, na které plán stojí.",
    coStim: "Otevři zakázku a nastav délku tisku znovu — formulář nabízí jen platné hodnoty.",
  },
  unalignedStart: {
    znamena: "Zakázka začíná mimo půlhodinovou mřížku, tedy třeba v 8:17. Karta pak v plánu sedí posunutá proti ostatním a špatně se s ní pracuje.",
    coStim: "Přetáhni zakázku v plánu o kousek — pustí se na nejbližší platný slot sama.",
  },
  inconsistentPrintCompleted: {
    znamena: "U dokončeného tisku chybí jeden ze dvou údajů: buď je čas bez uživatele, nebo uživatel bez času. Nejde pak dohledat, kdo tisk odklepl.",
    coStim: "V plánu tisk vrať a znovu odklepni — zapíší se oba údaje najednou.",
  },
  splitFieldsDiverged: {
    znamena: "Části rozdělené zakázky mají mít shodné údaje (číslo zakázky, popis, deadline, stavy dat, materiálu a Pantone). Tady se rozešly, takže každá část tvrdí něco jiného.",
    // POZOR na formulaci: propagace v PUT /api/blocks/[id] bere hodnoty z EDITOVANÉHO
    // bloku a `updateMany` je rozešle na sourozence. Starší text („otevři kteroukoli
    // část") tedy naváděl přepsat správnou hodnotu tou špatnou.
    coStim: "Otevři tu část, která má správné hodnoty — v tabulce výš je u každého pole vidět, co která část tvrdí — a ulož ji. Server hodnotu rozešle na zbytek skupiny. Pozor: uloží se hodnoty z části, kterou otevřeš, takže na pořadí záleží.",
  },
};

/** Bezpečné čtení: neznámý klíč vrátí `null`, ne výjimku. */
export function copyFor(key: string): CheckCopy | null {
  return HEALTH_COPY[key] ?? null;
}
