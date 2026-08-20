import { machineLabel } from "@/lib/machines";
import type { DriftedBlock } from "@/lib/calendarDrift.server";

/**
 * Texty kaskádového dialogu. Čistá funkce, ať se dají testovat — titulek byl od
 * 20. 4. 2026 napevno a čtyři měsíce (do 17. 8. 2026) tvrdil „Zkrácení směny…"
 * i u přidání směny.
 *
 * Počet je v závorce záměrně: vyhýbá se skloňování bez zavádění dalšího helperu
 * (v repu jsou dnes dva a rozcházejí se na nule — sjednocení je samostatný úklid).
 * Terminologie: jev se v aplikaci jmenuje „nesedí na kalendář", žádný nový pojem.
 */
export const CASCADE_REASON_LABELS: Record<DriftedBlock["reason"], string> = {
  START_NOT_RUNNABLE: "Začátek padne mimo provoz stroje",
  HORIZON_EXCEEDED: "Podle nového rozvrhu nejde dopočítat konec",
  END_MISMATCH: "Konec nesedí na kalendář",
};

export function cascadeDialogTitle(machine: string, count: number): string {
  return `Změna směn na ${machineLabel(machine)} vystěhuje z pracovní doby bloky (${count})`;
}

/**
 * Neblokující věta o blocích, kterým se konec PRODLOUŽIL. Jediná věta v celé
 * etapě, která má vztah k riziku kaskády: takový blok je latentní detonátor,
 * protože jeho příští úprava ho nafoukne a odsune navazující bloky.
 *
 * Obecně „bloků/bloky", ne „zakázek/zakázky" (F3, finální review etapy 9) —
 * od etapy 9 může `newlyLonger` nést i tiskovou rezervaci, ne jen ZAKAZKA.
 */
export function longerBlocksSentence(count: number): string | null {
  if (count === 0) return null;
  return `Žádný další blok se nevystěhuje. U ${count} bloků se ale tímto zkrácením prodlouží ` +
    `spočítaný konec — jejich příští úprava odsune navazující bloky.`;
}
