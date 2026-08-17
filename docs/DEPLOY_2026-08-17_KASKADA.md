# Nasazení: pravdivá kontrola kaskády směn — testovací instance

Připraveno 17. 8. 2026 večer, **k provedení 18. 8. z firemní sítě.**
Řídí se `docs/DEPLOY_WORKFLOW.md`; tady je jen to specifické pro tuhle dávku.

**Cíl: testovací instance, ne produkce.**
Složka `/var/www/planovanivyroby-test` · port **3021** · DB **`igvyroba_test`** ·
PM2 **`planovani-TEST`**

**13 commitů** (`9c67d752`..`3de43525`) · **žádná migrace** · rollback = `git reset --hard` + build

---

## Co se nasazuje

Dialog „Zkrácení směny ovlivní existující bloky" byl falešný poplach — vyskakoval i při pouhém
přidání směny. Kontrola cílový stav nově **měří** místo aby ho simulovala. K tomu značka na
Monitoru u stroje a zobecněný záchranný skript po havárii.

| Oblast | Rizikovost |
| --- | --- |
| `PUT /api/machine-week-shifts` — měření v transakci, rollback při konfliktu | **zápisová cesta** |
| Dialog kaskády — texty, důvod, force jen za stroj z dialogu | admin + planner |
| **Monitor u stroje** — značka „⚠ nesedí na kalendář" | **visí u stroje v provozu** |
| `scripts/revert-revision-group.ts` | ruční ops nástroj, neběží sám |
| Dokumentace (`CLAUDE.md`, `POUCENI.md`, historie, `OPS_ZALOHY.md`) | nulová |

---

## Krok 1 — Mac (hotovo 17. 8. večer, kromě pushe)

- [x] pracovní strom čistý
- [x] `npx tsc --noEmit` čistý
- [x] **1314/1314** testů zelených
- [ ] `git push origin Vojta` ← **neprošlo, Mac byl mimo síť; udělat jako první**

```bash
git status --short --branch     # musí být čistý, 13 ahead
git push origin Vojta
```

Build lokálně **nespouštět** — dev instance na portech 3001/3111 sdílejí `.next`.
Na testovací instanci je to v pořádku: build běží na serveru a když selže, starý běh běží dál.

---

## Krok 2 — zjistit, na čem instance stojí

```bash
ssh administrator@192.168.10.210
cd /var/www/planovanivyroby-test
git branch -vv
git log --oneline -3            # ← ZAPSAT, je to rollback bod
pm2 list | grep planovani
```

---

## Krok 3 — záloha a PRE otisk (POVINNÉ i na testu)

```bash
cd /var/www/planovanivyroby-test
sudo mysqldump igvyroba_test > ~/zaloha-test-kaskada-$(date +%F-%H%M).sql
ls -lh ~/zaloha-test-kaskada-*.sql     # nesmí být 0 bajtů
tail -1 ~/zaloha-test-kaskada-*.sql    # musí končit "Dump completed"

sudo mysql igvyroba_test -e "
  SELECT COUNT(*) AS bloku,
         SUM(TIMESTAMPDIFF(SECOND, startTime, endTime)) AS sum_secs,
         SUM(printMinutes) AS sum_print_min
  FROM Block;"
```

`sum_secs` je ten podstatný údaj — počet řádků sám o sobě posun bloků nezachytí.

---

## Krok 4 — deploy (bez migrace)

```bash
cd /var/www/planovanivyroby-test
git fetch origin --prune
git log --oneline origin/Vojta -3      # musí ukazovat 3de43525
git pull --ff-only origin Vojta

npx prisma migrate deploy              # tahle dávka migraci NEMÁ → musí vypsat "No pending migrations"
npm run build
pm2 restart planovani-TEST
pm2 logs planovani-TEST --lines 40     # Ctrl+C po ověření, že naběhlo
```

Kdyby `migrate deploy` hlásil čekající migraci, **zastavit** — znamenalo by to, že instance
nemá dotaženou předchozí vlnu, a to je jiná situace, než pro kterou je tenhle postup psaný.

---

## Krok 5 — POST otisk a průzkum dat

Týž dotaz jako v kroku 3. `bloku`, `sum_secs` i `sum_print_min` **musí sedět s PRE** —
tahle dávka nesahá na bloky vůbec. Když se liší, zastavit a zjistit proč.

Pak průzkum, který ukáže, co uživatel reálně uvidí:

```bash
cd /var/www/planovanivyroby-test
npx tsx scripts/cascade-data-survey.ts
```

Čte se to takhle:
- **„s vnitřní pauzou"** — zakázky, které stará kontrola hlásila **falešně**. Na produkci jich
  bylo 15. Po nasazení u nich musí být ticho; ověří se to scénářem 2 v kroku 6.
- **„nemá kde být"** — jediná kategorie, která nově blokuje uložení směn.
- **„konec později"** — latentní detonátor ze zkrácení směny (příští úprava bloku odsune
  navazující zakázky). Neblokuje, jen se o něm napíše.

---

## Krok 6 — proklik, řazeno podle rizika

### 6.1 Údržba a vypnutá sobota — NEJVYŠŠÍ RIZIKO

Jediné **zúžení proti stavu před vlnou**: nová kontrola měří jen `ZAKAZKA`.

- [ ] Postav víkendovou **údržbu** na sobotu, pak sobotní směnu **vypni**
- [ ] Očekávané: **neozve se nic** (žádný dialog, žádný toast) — je to vědomé
- [ ] Pak zkus vedle té údržby pustit drop navazující zakázky → ověř, jestli se z ní stala
      **zeď** (chain push ji nesmí posunout, drop se odmítne 409)

### 6.2 Jádro opravy — Lukešova stížnost

- [ ] **Přidat sobotní směnu** k víkendové zakázce → **žádný dialog** ← *tohle je ta stížnost*
- [ ] **Uložit beze změny** (otevřít správu směn a hned uložit) → **žádný dialog**
- [ ] **Zkrátit směnu tak, aby se konec jen prodloužil** (start zůstane spustitelný) →
      **žádný dialog**, ale **info toast** o prodloužení konce
- [ ] **Vypnout směnu pod zakázkou** → dialog vyskočí, titulek nese **název stroje**
      („XL 106", ne `XL_106`), sloupec **„Proč nesedí"**, počet v závorce

### 6.3 Dialog — chování

- [ ] **Escape** dialog zavře, klik na pozadí taky
- [ ] Po otevření je fokus na **„Zrušit změnu"**, ne na červeném tlačítku
- [ ] „Zrušit změnu" → rozeditovaná změna **zůstane na obrazovce** (dřív mizela)
- [ ] Změň směny na **obou strojích** tak, aby kaskáda nastala jen na druhém → „Uložit i přesto"
      → ověř v adminu/DB, že force šel **jen za ten jeden stroj**
- [ ] Po potvrzení kaskády sedí počet v toastu i za stroje uložené **před** dialogem

### 6.4 Monitor u stroje

- [ ] Zakázka s rozejitým koncem nese ve frontě i na velké kartě **„⚠ nesedí na kalendář"**
- [ ] **Vědomě odložená** zakázka značku **nemá nikde**
- [ ] **Nezačatá** zakázka na velké kartě značku má (byla to oprava M2)
- [ ] Přepnout **M / L / XL** — značka škáluje a tlačítko **HOTOVO zůstává vidět** ve všech třech

### 6.5 Záchranný skript — nasucho

```bash
cd /var/www/planovanivyroby-test
npx tsx scripts/revert-revision-group.ts --group NEEXISTUJICI_GROUP     # srozumitelná chyba, exit 1
npx tsx scripts/revert-revision-group.ts --group <reálná groupId>       # dry-run, NIC nezapíše
```

- [ ] Dry-run nad reálnou skupinou proběhne a vypíše cílový stav
- [ ] Skupina, jejíž revize měnila i `machine`/`printMinutes` → **odmítne** (je čistě poziční)
- [ ] `--also-revision`, která není poslední UPDATE revizí bloku → **odmítne**
- [ ] **`--apply` nepouštět**, dokud to nebude opravdu potřeba po havárii

---

## Krok 7 — rollback

```bash
cd /var/www/planovanivyroby-test
git reset --hard <commit z kroku 2>
npm run build
pm2 restart planovani-TEST
```

Databázi vracet **není potřeba** — dávka nemá migraci a na bloky nesahá.

---

## Co tahle vlna NEZAVÍRÁ

Havárii z 16:31. Chain push u `ZAKAZKA` pořád **nemá strop posunu** (rigidní blok má 7 dní),
takže se 87 bloků může odsunout bez potvrzení a bez cesty zpět. Je to zapsané jako otevřený
dluh v `CLAUDE.md`, `docs/POUCENI.md` (P31) a `docs/vyvoj-historie.md` a je to položka číslo
jedna v backlogu specu.
