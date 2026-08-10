/**
 * Retence „černé skříňky" (`BlockRevision`) — jediné místo, kde se nastavuje.
 *
 * Čtou ji DVA nezávislí konzumenti a musí se shodovat:
 *  - `scripts/prune-revisions.ts` — co maže (cron 3:50, `docs/OPS_ZALOHY.md`),
 *  - `src/app/api/report/dashboard/route.ts` — odkdy smí metrika „Stabilita
 *    plánu" tvrdit, že o období něco ví.
 *
 * Kdyby se ty dvě hodnoty rozešly, report by sliboval čísla za období, které
 * úklid už vymazal — a mlčky by vycházela nula změn místo poctivého „—".
 */
export const REVISION_RETENTION_DAYS = 90;

/**
 * Migrace, která tabulku `BlockRevision` založila. Teprve od jejího NASAZENÍ
 * se každá mutace bloku zapisuje, takže je to skutečný začátek nahrávání.
 *
 * PROČ NE `MIN(createdAt)` z revizí: to je datum PRVNÍ ZMĚNY, ne začátek
 * nahrávání. Když se poctivě nahrává a nikdo se celý den ničeho nedotkne,
 * první revize přijde pozdě — a metrika by to ticho přečetla jako „nemám data"
 * místo správného „nic se nepohnulo". Přesně na to narazil ruční test
 * 10. 8. 2026: bloky se přesouvaly, revize vznikaly, a karta pořád ukazovala „—".
 *
 * Název je vázaný na složku v `prisma/migrations/`. Jméno už nasazené migrace
 * se nikdy nemění, takže je to stabilní klíč; datum ve jméně je ale jen datum
 * VZNIKU souboru — rozhoduje `finished_at` z `_prisma_migrations`, tedy kdy
 * migrace doběhla na tom kterém prostředí (na produkci 9. 8. 2026 večer).
 */
export const REVISION_MIGRATION_NAME = "20260807120000_block_revision";
