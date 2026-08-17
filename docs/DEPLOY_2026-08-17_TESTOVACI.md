# Nasazení na testovací instanci — 17. 8. 2026

Postup pro **jednu velkou dávku**: šest etap, 160+ commitů, jedna migrace.
Řídí se `docs/DEPLOY_WORKFLOW.md`; tady je jen to, co je pro tuhle dávku
specifické, a **seznam k prokliku**, protože ten je tentokrát to hlavní.

**Cíl: testovací instance, ne produkce.**
Složka `/var/www/planovanivyroby-test` · port **3021** · DB **`igvyroba_test`** ·
PM2 **`planovani-TEST`**.

---

## Co se nasazuje

`origin/Vojta` visí na commitu z 13. 8. — **72 commitů nikdy neopustilo Mac.**
Od posledního produkčního nasazení (`0e050141`, 11. 8.) je to celkem **151 commitů
a 92 zdrojových souborů.**

| Etapa | Kdy | Rizikovost |
| --- | --- | --- |
| Pantone parita (SKLADEM / VYDÁNO) | 11. 8. | **migrace + zápisové cesty** |
| Škála písma v planneru (M/L/XL) | 12. 8. | planner, Monitor |
| Připomínky Monitoru a plánovače | 13. 8. | **Monitor u stroje** |
| Zkratky odolné vůči Caps Locku | 14. 8. | planner |
| Reporty R1 — správnost čísel | 14. 8. | jen `/reporty` |
| Reporty R2 — tokeny a čitelnost | 16. 8. | `/reporty` + `globals.css` + Monitor + BlockEdit |
| Reporty R3 — přeskládání | 16. 8. | `/reporty` + nový endpoint |
| Reporty R4a — kaskáda kapacity | 17. 8. | jen `/reporty` |

**Reporty jsou nejmenší a nejbezpečnější část** — nic tam nezapisuje do plánu.
Rizikové je to ostatní.

---

## Krok 0 — rozhodnutí před začátkem

**Build se lokálně nespustil.** `CLAUDE.md` ho před pushem předepisuje („chytí TS
chyby dřív než server"), ale běžící dev instance na portech 3000 a 3111 sdílejí
`.next` a build by je shodil. Ověřeno místo něj: `npx tsc --noEmit` čistý,
`npx eslint` bez chyb, **1262/1262 testů zelených**.

Zbývá riziko, které `tsc` nechytí — chyby specifické pro Next build (statická
analýza `"use client"`, nepoužité importy v produkčním režimu). Volba:

- **(a)** Zastavit dev servery, spustit `npm run build` lokálně, pak pustit znovu.
- **(b)** Nechat to na serveru — build tam běží jako součást deploye a když selže,
  starý běh poběží dál (nasazení se prostě nedokončí).

U testovací instance je **(b)** rozumné. U produkce bych trval na (a).

---

## Krok 1 — Mac (dělám já)

```bash
git status --short --branch          # musí být čistý
npx tsc --noEmit                     # musí projít
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git push origin Vojta
```

**Větev `michal` se pro testovací instanci nemerguje** — nejdřív se musí zjistit,
na které větvi test stojí (krok 2). Kdyby stál na `michal`, půjde merge až po
prokliku, ne teď.

---

## Krok 2 — zjistit stav testovací instance

```bash
ssh administrator@192.168.10.210
cd /var/www/planovanivyroby-test
git branch -vv
git log --oneline -3
pm2 list | grep planovani
```

**Očekávám**, že instance visí na starém commitu (poznámka z 13. 8.), ale ověř to.
Zapiš si, na čem stojí — bude se to hodit při případném rollbacku.

Zároveň zjisti, **jak je stará testovací databáze**:

```bash
sudo mysql igvyroba_test -e "
  SELECT (SELECT COUNT(*) FROM Block) AS bloku,
         (SELECT MAX(createdAt) FROM Block) AS posledni_blok,
         (SELECT COUNT(*) FROM _prisma_migrations) AS migraci;"
```

Když je kopie stará měsíce, stojí za zvážení ji před testem obnovit z čerstvého
dumpu produkce — jinak se proklik dělá nad daty, která neodpovídají realitě.

---

## Krok 3 — záloha a PRE snapshot (POVINNÉ)

I na testovací instanci. Je to levné a bez otisku se nedá prokázat, že migrace
nic neposunula.

```bash
cd /var/www/planovanivyroby-test
sudo mysqldump igvyroba_test > ~/zaloha-test-$(date +%F-%H%M).sql
ls -lh ~/zaloha-test-*.sql          # nesmí být 0 bajtů
tail -1 ~/zaloha-test-*.sql         # musí končit "Dump completed"
```

PRE otisk — **`sum_secs` je ten podstatný údaj**, počet řádků sám o sobě posun
nezachytí:

```bash
sudo mysql igvyroba_test -e "
  SELECT COUNT(*) AS bloku,
         SUM(TIMESTAMPDIFF(SECOND, startTime, endTime)) AS sum_secs,
         SUM(printMinutes) AS sum_print_min,
         SUM(pantoneOk) AS pantone_ok,
         SUM(materialInStock) AS material_sklad
  FROM Block;"
```

Výstup si ulož — porovnává se v kroku 5.

---

## Krok 4 — deploy

```bash
cd /var/www/planovanivyroby-test
git fetch origin --prune
git log --oneline origin/Vojta -3     # musí ukazovat commit, co jsem právě pushl
git pull --ff-only origin Vojta

npx prisma migrate deploy             # ← migrace Pantone, JDE PRVNÍ
npm run build
pm2 restart planovani-TEST
pm2 logs planovani-TEST --lines 40    # Ctrl+C po ověření, že naběhlo
```

**Migrace `20260811120000_add_pantone_in_stock_issued`** přidává dva sloupce na
`Block`. Je aditivní, takže rollback zpět je bezpečný (sloupce prostě zůstanou).

Kdyby `migrate deploy` selhal s `P2022`/`P2000`, **nejdřív ověř skutečný typ
sloupce** (`SHOW COLUMNS FROM Block`) — prod DB má doložené ruční odchylky od
migrací a testovací kopie je zdědila.

---

## Krok 5 — POST snapshot a porovnání

Týž dotaz jako v kroku 3. Očekávaný výsledek:

- `bloku`, `sum_secs`, `sum_print_min` — **shodné s PRE**
- `pantone_ok`, `material_sklad` — **shodné s PRE** (migrace přidává sloupce
  s defaultem, nemění existující hodnoty)

Když se `sum_secs` liší, **zastavit a zjistit proč** dřív, než na instanci někdo
klikne. Rozdíl znamená, že se posunuly bloky.

---

## Krok 6 — co proklikat

Řazeno podle rizika, ne podle toho, co je nové. **Reporty jsou až na konci
schválně** — je to největší kus práce, ale nejmenší riziko.

### 6.1 Monitor u stroje — nejvyšší priorita

Visí u tiskového stroje v provozu a dotkly se ho tři etapy.

- [ ] Velká karta zakázky — chipy, pás specifikace, tlačítko **HOTOVO**
- [ ] Fronta pod ní včetně sekce **nedodělaných** zakázek
- [ ] Chip „čekání" — R2 mu měnila barvu písma (`--warning` → `--warning-text`).
      **Ve světlém i tmavém režimu.**
- [ ] Odklepnout tisk a vrátit ho zpět

### 6.2 Pantone parita — jde s migrací

Jediná věc, kterou nelze vrátit prostým redeployem.

- [ ] MTZ: přepnout **SKLADEM** a **VYDÁNO** na zakázce
- [ ] Totéž pro **Pantone** — nové sloupce `pantoneInStock` / `pantoneIssued`
- [ ] Ověřit, že se stav propíše na kartu bloku v planneru
- [ ] Split zakázky — sdílená pole se musí propsat na všechny sourozence
- [ ] **Undo** té změny

### 6.3 Zápisové cesty

Split-skupiny a undo mají v tomhle repu historii tichých chyb.

- [ ] Vytvořit blok · upravit · přetáhnout · resize
- [ ] **Rozdělit** zakázku a rozdělenou přetáhnout
- [ ] **Undo** a **redo** u každého z toho
- [ ] Přetáhnout blok tak, aby odsunul navazující (chain push)
- [ ] Editor **presetů zakázek** — vytvořit a upravit

### 6.4 Planner — škála písma

- [ ] Přepnout **M / L / XL** a na každém stupni ověřit, že se **tlačítko HOTOVO
      nevejde pod ořez** (havárie 3. 8. a znovu 12. 8.)
- [ ] Zkratky s **zapnutým Caps Lockem** — kopírovat, vložit, smazat
- [ ] Zámek bloku v BlockEdit — R2 měnila barvu štítku (`--brand` → `--brand-text`),
      **ve světlém režimu** byl předtím neviditelný

### 6.5 Reporty — čtyři etapy, ale nejmenší riziko

**Vždy v obou režimech** — R2 měnila barvy.

- [ ] **Stavový pás** nad záložkami. Zkusit stav „klid" i „něco hoří".
      Odkazy musí přepínat záložku, ne reloadovat stránku.
- [ ] Retrospektiva: sekce VÝROBA · PRŮCHOD ZAKÁZEK · PLÁNOVÁNÍ · OBCHOD
- [ ] **VYUŽITÍ KALENDÁŘE** — čtyři pásy, rozpad pod nimi. Ověřit, jestli řádek
      „chybí rozvrh" není velký (to by znamenalo, že testovací DB nemá naseedované
      směny a sekce je zatím k ničemu)
- [ ] Přepnout na **Dnes** — sekce zmizí a **řekne proč**
- [ ] Výhled: heatmapa na **týden i měsíc**. V měsíci mají být čísla v dlaždicích.
- [ ] Rizika: seznam rezervací s čísly zakázek, přiznaný strop u údržeb
- [ ] Kontrolní panel — rozbalit nálezy, odkazy „Otevřít v plánu →"

---

## Krok 7 — rollback, kdyby se to zvrtlo

```bash
cd /var/www/planovanivyroby-test
git log --oneline -3                  # najdi commit z kroku 2
git reset --hard <starý-commit>
npm run build
pm2 restart planovani-TEST
```

Databázi vracet **není potřeba** — migrace jen přidává sloupce. Kdyby přesto
bylo potřeba:

```bash
sudo mysql igvyroba_test < ~/zaloha-test-<časová-značka>.sql
```

---

## Po prokliku

Až bude testovací instance odsouhlasená, na produkci půjde **týž postup** s těmito
rozdíly:

1. Předtím **spustit `npm run build` lokálně** (krok 0, varianta a).
2. Aktualizovat větev `michal` (`docs/DEPLOY_WORKFLOW.md`, krok 3).
3. Složka `/var/www/planovanivyroby`, DB `igvyroba`, PM2 podle `ecosystem.config.cjs`
   (produkce běží na portu **3020**).
4. Záloha a PRE/POST otisk **nejsou volitelné**.

**A jedna věc navíc, kterou je potřeba změřit na PRODUKCI, ne na testu** — pokrytí
rozvrhů a vyplněnost polí, na kterých stojí R4a a chystaná R4b:

```sql
SELECT machine, COUNT(*) AS radku, MIN(weekStart) AS od, MAX(weekStart) AS do
FROM MachineWeekShifts
WHERE weekStart >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
GROUP BY machine;

SELECT COUNT(*) AS zakazek,
       ROUND(100 * SUM(jobPresetId IS NOT NULL) / COUNT(*), 1)      AS preset_pct,
       ROUND(100 * SUM(deadlineExpedice IS NOT NULL) / COUNT(*), 1) AS termin_pct,
       ROUND(100 * SUM(printCompletedAt IS NOT NULL) / COUNT(*), 1) AS potvrzeno_pct
FROM Block
WHERE type = 'ZAKAZKA' AND startTime >= DATE_SUB(NOW(), INTERVAL 90 DAY);
```

První dotaz je **tvrdá podmínka pro sekci Využití kalendáře**, druhý rozhoduje
o pořadí prací v R4b.
