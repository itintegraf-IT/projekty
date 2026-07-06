# Tiskové hodiny — Deploy checklist (produkce)

> Připraveno v etapě 8 (finále featury), 5. 7. 2026. Provádí Vojta (+ Michal server).
> Produkční server: Ubuntu 24.04, `192.168.10.210`, DB **`igvyroba`** (lowercase!),
> MySQL root přes `sudo mysql` (auth_socket — `-u root -p` selže s error 1698).

## 0) Předpoklady

- [ ] Větev Vojta zmergovaná do main (řeší Vojta sám; merge s Michalovou větví dle domluvy)
- [ ] Lokálně: `npm run build` OK, suita zelená (366/366 k 5. 7.), `git status` čistý

## 1) PRE záloha + snapshot (POVINNÉ, ŽÁDNÉ VÝJIMKY — první krok před čímkoli)

```bash
sudo mysqldump --single-transaction igvyroba > ~/zalohy/igvyroba-pred-tiskove-hodiny-$(date +%Y%m%d-%H%M).sql
ls -la ~/zalohy/ | tail -3   # ověřit velikost > 0
```

PRE snapshot otisku dat (porovná se s POST — sum_secs vzor z minulých deployů):

```bash
sudo mysql igvyroba -e "SELECT COUNT(*) AS bloku, SUM(TIMESTAMPDIFF(SECOND, startTime, endTime)) AS sum_secs, MAX(updatedAt) AS last_upd FROM Block;"
```

Výstup PŘILEPIT do poznámky deploye.

## 1b) ENV kontrola (nález security review D4)

- [ ] Produkční `DATABASE_URL` má explicitní pool parametry, např.
  `...?connection_limit=10&pool_timeout=20` — hromadný reflow (tx až 30 s) jinak může
  při opakovaném volání vyčerpat výchozí pool a zablokovat ostatní mutace.
  (Aplikace má navíc per-stroj in-flight guard — 409 při souběžném přepočtu téhož stroje.)

## 2) Kód + migrace

```bash
cd /cesta/k/aplikaci && git pull
npx prisma migrate deploy        # přidá Block.printMinutes + scheduleBypassed s backfillem
npm run prisma:bootstrap         # seed číselníků (bezpečné pro existující data)
npm ci && npm run build          # build PŘED restartem služby
# restart služby dle Michalova deploy.sh (chmod +x && ./deploy.sh — gotcha z minula)
```

Pozn.: migrace featury NEpřidávají FK na Block.id → gotcha „INT UNSIGNED errno 150" se netýká.
Pokud `migrate deploy` hlásí P2022/P2000 → nejdřív `SHOW COLUMNS` (vzor CLAUDE.md, známé ruční odchylky).

## 3) Legacy bypass audit (po migraci, PŘED předáním uživatelům)

```bash
node --env-file=.env --import tsx scripts/detect-legacy-bypass.ts            # dry-run
# → zkontrolovat výpis (dev baseline byl 165 ok / 14 bypass / 1 korupce — produkce bude mít jiná čísla)
node --env-file=.env --import tsx scripts/detect-legacy-bypass.ts --apply    # až po kontrole výpisu
```

## 4) Oprava korupce #388 (end < start) — pokud na produkci existuje

Chain push ji od etapy 3 odmítá s 422, ale blokuje přesuny v okolí. Postup:

```bash
sudo mysql igvyroba -e "SELECT id, orderNumber, machine, startTime, endTime, printMinutes FROM Block WHERE endTime < startTime;"
```

- [ ] Každý nalezený blok posoudit s plánovačem (smazat vs. ručně narovnat end přes UI po deployi)
- [ ] Po opravě ověřit: dotaz výše vrací 0 řádků

## 5) POST verifikace

```bash
sudo mysql igvyroba -e "SELECT COUNT(*) AS bloku, SUM(TIMESTAMPDIFF(SECOND, startTime, endTime)) AS sum_secs, MAX(updatedAt) AS last_upd FROM Block;"
# sum_secs se smí lišit JEN o vědomé opravy z kroků 3–4; počet bloků stejný (± smazané korupce)
```

Smoke testy v prohlížeči (role PLANOVAT):
- [ ] Login + načtení planneru (bloky vidět, žádná chyba v konzoli)
- [ ] Queue drop testovacího bloku 27 h přes víkend → přiléhavé umístění s pauzou (NE teleport) → smazat
- [ ] Prodloužit odstávku pod blokem → ⚠ KALENDÁŘ badge → Přepočítat → překreslí se HNED bez F5
- [ ] Denní report + dashboard reporty se načtou, čísla vypadají rozumně
- [ ] BlockEdit dropdown nabízí do 40 h

## 6) Rollback (kdyby cokoli)

```bash
# zastavit službu, pak:
sudo mysql igvyroba < ~/zalohy/igvyroba-pred-tiskove-hodiny-<timestamp>.sql
git checkout <předchozí-produkční-commit> && npm ci && npm run build && ./deploy.sh
```

Migrace featury jsou aditivní (nové sloupce s defaulty) — starý kód nad novou DB běží,
ale rollback DB je čistší (backfill hodnoty by po rollbacku kódu nikdo neudržoval).
