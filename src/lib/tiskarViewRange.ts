/**
 * Kolik dní plánu vidí TISKAŘ.
 *
 * Tiskař nemá ovládání rozsahu (na dotykové obrazovce u stroje by to byl další
 * prvek k omylu), takže hodnoty jsou pevné a uložená preference `daysBack`
 * z jiné role se na něj nesmí přenést.
 *
 * Historie byla do 17. 8. 2026 JEDEN den. Tiskaři si postěžovali, že se
 * nedostanou k tomu, co jeli minulý týden — typicky když si potřebují dohledat
 * nastavení stroje u opakované zakázky. Data k tomu v prohlížeči celou dobu
 * byla (`GET /api/blocks` vrací všechny bloky bez datumového filtru), chyběl
 * jen rozsah vykreslení.
 */

/** Dní zpět. Zvednuto z 1 na 5 (17. 8. 2026, prosba tiskařů). */
export const TISKAR_DAYS_BACK = 5;

/** Dní dopředu. Beze změny — tiskaři plánovaný výhled stačí. */
export const TISKAR_DAYS_AHEAD = 5;

/**
 * Jediný vynucovací bod pravidla „tiskař nedědí uložený rozsah plánu".
 *
 * Stejný vzor jako `gridSlotHeight` v PlannerPage u zoomu: nezáleží, ODKUD by
 * se `daysBack` vzal (localStorage, serverová preference, budoucí URL parametr
 * kiosku) — pro tiskaře se vždycky přepíše na `TISKAR_DAYS_BACK`. Kdo tenhle
 * převod obejde a sáhne na syrový stav, vrátí past zpátky.
 */
export function viewDaysBack(isTiskar: boolean, daysBack: number): number {
  return isTiskar ? TISKAR_DAYS_BACK : daysBack;
}

/** Totéž dopředu — viz `viewDaysBack`. */
export function viewDaysAhead(isTiskar: boolean, daysAhead: number): number {
  return isTiskar ? TISKAR_DAYS_AHEAD : daysAhead;
}
