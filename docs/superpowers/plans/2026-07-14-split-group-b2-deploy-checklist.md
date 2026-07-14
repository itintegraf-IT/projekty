# Split-skupiny B2 — deploy checklist (Fáze 7)

> Migrace `20260713120000_split_group_table` na produkci. Provádí Vojta (+ Michal server).
> Server: Ubuntu 24.04, `192.168.10.210`, DB `igvyroba` (lowercase), MariaDB 10.11.14,
> MySQL root přes `sudo mysql` (auth_socket). PM2 + `ecosystem.config.cjs`.
>
> Prod fakta (ověřená): `Block.id` i `Block.splitGroupId` = `int(10) unsigned`; 17 split skupin / 34 částí.
> Migrace je aditivně bezpečná — `MODIFY splitGroupId UNSIGNED` je na produkci **no-op** (sloupec už byl
> unsigned z původní migrace `20260326204352`), backfill vytvoří 17 `SplitGroup` řádků, nová FK typově sedí.

## ⚠️ DVA blokující read-only pre-checky (spustit PŘEDEM, mimo deploy okno)

**1) Jméno FK constraintu** — nejpravděpodobnější příčina selhání. Migrace dělá
`DROP FOREIGN KEY Block_splitGroupId_fkey`. Když produkce má FK jiného jména (historicky ruční
sloupce), `DROP` spadne errno 1091.
```bash
sudo mysql igvyroba -e "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='igvyroba' AND TABLE_NAME='Block' AND COLUMN_NAME='splitGroupId' AND REFERENCED_TABLE_NAME IS NOT NULL;"
```
Očekává se přesně `Block_splitGroupId_fkey`. Když je jiné → upravit `DROP` statement v migraci před deployem.

**2) Orphan pre-check** — MUSÍ vrátit 0 řádků.
```bash
sudo mysql igvyroba -e "SELECT b.id, b.orderNumber, b.machine, b.splitGroupId FROM Block b LEFT JOIN Block root ON b.splitGroupId=root.id WHERE b.splitGroupId IS NOT NULL AND root.id IS NULL;"
```
Když > 0: split část ukazuje na neexistující root Block. Řešení dle situace:
- osamocená část (jediná ve skupině) → `UPDATE ... SET splitGroupId = NULL` (stane se standalone);
- část skupiny s dalšími žijícími členy → nechat (backfill vytvoří SplitGroup; pod B2 je to korektní stav).

**3) (nízká priorita) connection_limit v prod `.env`** — `grep -c connection_limit .env` (audit PERF-005, neblokující).

---

## Deploy postup (v pořadí)

**0) Lokálně před zásahem:** větev Vojta → main (dle domluvy s Michalem); `npm run build` OK; lib testy 392/392, undo 20/20; `git status` čistý.

**1) PRE záloha (POVINNÉ, PRVNÍ KROK):**
```bash
sudo mysqldump --single-transaction --databases igvyroba > ~/zalohy/igvyroba-pred-splitgroup-$(date +%Y%m%d-%H%M).sql
ls -la ~/zalohy/ | tail -3   # velikost > 0
```
PRE otisk (porovná se s POST):
```bash
sudo mysql igvyroba -e "SELECT COUNT(*) AS bloku, SUM(TIMESTAMPDIFF(SECOND,startTime,endTime)) AS sum_secs, MAX(updatedAt) AS last_upd FROM Block;"
sudo mysql igvyroba -e "SELECT COUNT(DISTINCT splitGroupId) AS skupin, COUNT(*) AS casti FROM Block WHERE splitGroupId IS NOT NULL;"  # čekej 17 / 34
```

**2) App-stop** (ne-atomická DDL → žádné souběžné zápisy):
```bash
pm2 stop planovanivyroby   # pm2 status → stopped
```

**3) Orphan pre-check** (bod 2 výše) — když > 0, NEPOKRAČOVAT, app-start zpět, řešit.

**4) Kód + migrace:**
```bash
cd /cesta/k/aplikaci
git pull --ff-only
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate deploy      # aplikuje 20260713120000_split_group_table
```

**5) POST verifikace DB:**
```bash
sudo mysql igvyroba -e "SELECT COUNT(*) AS split_groups FROM SplitGroup;"   # čekej 17
sudo mysql igvyroba -e "SELECT COUNT(*) AS orphan_po FROM Block b LEFT JOIN SplitGroup g ON b.splitGroupId=g.id WHERE b.splitGroupId IS NOT NULL AND g.id IS NULL;"   # čekej 0
sudo mysql igvyroba -e "SELECT REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='igvyroba' AND CONSTRAINT_NAME='Block_splitGroupId_fkey';"   # čekej SplitGroup
sudo mysql igvyroba -e "SELECT COUNT(*) AS bloku, SUM(TIMESTAMPDIFF(SECOND,startTime,endTime)) AS sum_secs FROM Block;"   # = PRE otisk
sudo mysql igvyroba -e "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name='20260713120000_split_group_table';"   # finished_at nenull, rolled_back_at null
```

**6) Bootstrap** (bezpečný, jen doplní číselníky — NIKDY `prisma:seed` na produkci):
```bash
npm run prisma:bootstrap
```

**7) Build:** `npm run build`

**8) App-start:**
```bash
pm2 start ecosystem.config.cjs   # nebo pm2 restart planovanivyroby
pm2 save && pm2 status           # online
```
> Pozn.: NEspouštět přes `./deploy.sh` — ten app před migrací nezastavuje (obchází app-stop gate).

**9) Force-reload klientů:** otevření plánovači mají starý klientský stav (undo logika se změnila) → Ctrl+Shift+R, nebo počkat na SSE reconnect/polling.

**10) Smoke testy (role PLANOVAT, prohlížeč):**
- [ ] Planner se načte, 17 split skupin má `✂` chipy
- [ ] Split (3 části) → smaž prostřední → **Ctrl+Z → 3/3** (jádro featury)
- [ ] Smaž **root** část → Ctrl+Z → skupina celá (dřív se rozpouštěla)
- [ ] Přesun split části (drag i Ctrl+X→Ctrl+V) → `splitGroupId` zůstává
- [ ] Editace sdíleného pole na jedné části → hned split jiné části → **žádný falešný 409** (#9)
- [ ] Publish/unpublish split zakázky v expedici → hned split části → **žádný falešný 409** (#5a)

---

## Rollback

**Preferováno — obnova ze zálohy** (nejčistší):
```bash
pm2 stop planovanivyroby
sudo mysql igvyroba < ~/zalohy/igvyroba-pred-splitgroup-<timestamp>.sql
git checkout <předchozí-produkční-commit> && npm ci && npm run build
pm2 start ecosystem.config.cjs
```

**Manuální DB rollback** (když nechceš přijít o data zapsaná po deployi) — `sudo mysql igvyroba`, statement po statementu:
```sql
ALTER TABLE `Block` DROP FOREIGN KEY `Block_splitGroupId_fkey`;
-- vyNULLovat části bez odpovídajícího Block.id (jinak re-add starého self-FK spadne 1452):
UPDATE `Block` b LEFT JOIN `Block` root ON b.splitGroupId=root.id
  SET b.splitGroupId = NULL WHERE b.splitGroupId IS NOT NULL AND root.id IS NULL;
ALTER TABLE `Block` ADD CONSTRAINT `Block_splitGroupId_fkey`
  FOREIGN KEY (`splitGroupId`) REFERENCES `Block`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
DROP TABLE `SplitGroup`;
```
```bash
npx prisma migrate resolve --rolled-back 20260713120000_split_group_table
git checkout <předchozí-produkční-commit> && npm ci && npm run build && pm2 restart planovanivyroby
```

**Half-applied** (proces zemřel uprostřed, `_prisma_migrations` má `failed`): zjistit stav (`SHOW TABLES LIKE 'SplitGroup'` + FK check); když `SplitGroup` existuje a FK chybí → buď ručně `ADD FK ... REFERENCES SplitGroup(id)` + `migrate resolve --applied`, nebo (bezpečněji) plný rollback ze zálohy.
