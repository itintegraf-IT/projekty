# Debrief: oprava překrývajících se zakázek

**Datum:** 9. 6. 2026
**Větev:** Vojta → michal (commity `eb4c213e` … `098488fc`, 14 commitů)
**Stav:** nasazeno na produkci, ověřeno

---

## 1. Zadání → výsledek (TL;DR)

**Zadání:** zakázky se v produkci náhodně překrývaly na stejném stroji — objevovalo se po reloadu, hlavně u budoucích týdnů. Úkol: najít příčinu **dřív**, než cokoliv opravovat.

**Výsledek:** příčina dokázána produkčními daty, oprava nasazena a ověřena (`sum_secs` PRE=POST=10294200, žádná ztráta dat), 1 starý překryv uklizen, 3 minulé vědomě ponechané, vznikl hlídací skript. ~1200 řádků, 209 testů.

---

## 2. Root cause (technicky)

V DB nebyla **žádná bariéra proti překryvu**. Jediná ochrana `checkBlockOverlap` se na všech pohybových cestách (drag, resize, lasso, paste, série) vypínala flagem `bypassOverlapCheck:true`. Po zápisu měl překryvy uklidit **klientský `autoResolveOverlap` (~200 řádků v prohlížeči)** — dvoufázový design „nejdřív ulož přes sebe, pak to v prohlížeči ukliď".

Když druhá fáze (úklid) selhala nebo se přerušila — odskok z planneru, zastaralý stav při 2 plánovačích, série z fronty kde se na děti úklid vůbec nevolal — **překryv zůstal v DB natrvalo**. UI vypadalo OK (úklid běžel jen v prohlížeči), ale data byla překrytá. Proto se to vídalo „náhodně po reloadu" a hlavně u druhého plánovače.

**Doloženo daty:** všechny 4 reálné produkční překryvy vznikly tímto mechanismem:
- `233/314` — nový blok vytvořen rovnou překrytý (POST bez pojistky)
- `219/287` — single drag na obsazené místo (neauditováno)
- `222/295`, `216/223` — lasso posun uložil překryté pozice (batch bez pojistky)

---

## 3. Oprava (technicky)

Server se stal **jediným zdrojem pravdy** pro řešení překryvů:
- `src/lib/overlapResolver.ts` — `computeChainPush` (pure: anchor fixní, navazující ustoupí, zamčené/vytištěné se přeskočí).
- `src/lib/overlapResolver.server.ts` — `resolveChainPushFromDb` (chain push proti DB, companyDays + pracovní doba re-validace, okno 90 dní, excludeIds pro lasso).
- `src/lib/overlapCheck.ts` — `assertNoOverlapForBlocks` běží **vždy** pro ZAKAZKA na konci každé transakce (POST/PUT/batch), používá `SELECT … FOR UPDATE` (gap-lock proti phantom souběhu pod MySQL REPEATABLE READ). Vyžaduje index `Block(machine,startTime,endTime)`.
- Klient přepojen: drag/resize/lasso/edit/paste/série → `resolveChain:true`; klientský `autoResolveOverlap` + mrtvý `dragInProgressRef` odstraněny.
- Náprava existujících: `scripts/fix-existing-overlaps.ts`. Hlídání: `scripts/check-overlaps-new.sql`.

---

## 4. Workflow (jak jsme postupovali)

1. Nejdřív root cause, žádné fixy (systematic debugging) — paralelní agenti.
2. Produkční read-only diagnostika (Vojta spouštěl) → data potvrdila příčinu.
3. Plan mode → schválený 6fázový plán.
4. Implementace po fázích, **zastavení po každé**, čekání na OK.
5. Multi-agent review po rizikových fázích (Fáze 2, 3 — vždy 3 revieweři).
6. 3 auditoři na „všechny mezery".
7. Lokální code-review (místo placeného ultra) → finální kontrola.
8. Deploy: záloha + PRE/POST snapshot, dry-run, migrate deploy.

---

## 5. Co fungovalo

- **Disciplína „příčina před opravou".** Fix mířil přesně, protože data potvrdila mechanismus.
- **Multi-agent review se vyplatil.** Finální lokální review chytil dvě věci, co by produkce odhalila bolestivě: vytištěné bloky se daly přeplánovat (`printCompletedAt` ≠ `locked`) a chybějící transakční timeout u PUT/POST.
- **Vojtovo zpochybnění u zakázky 18153** („mně to problémy nedělalo, možná se to jen neukládalo") — nejcennější moment. Vynutilo doložit příčinu daty místo tvrzení; ukázalo se, že měl částečně pravdu (vizuálně fungovalo, ukládalo se špatně).
- Fázování se zastávkami, povinná záloha/snapshot u produkce.

---

## 6. Co nefungovalo / co se opravovalo

**Vojtovy klíčové zásahy (produktová rozhodnutí):** dokázat 18153 daty; navazující se odsunou i u vkládání; backward-overlap necháme nově; „zalep všechny mezery" (→ 3 auditoři); náprava jen 1 + 3 nechat; lokální review místo placeného.

**Technické chyby (stály nás kolečka):**

| Co | Proč | Cena |
|---|---|---|
| SQL na serveru opakovaně (scp ze špatné složky, `#` komentáře v zsh, `ssh` spuštěný na serveru = rekurzivní) | postup psán „z Macu", ale Vojta zůstával na serveru | 3–4 zbytečná kolečka |
| Nápravný skript spadl na produkci (`$queryRaw` vrací `id` jako BigInt, Prisma čeká Int) | na dev prošlo náhodou, neotestováno na reálném BigInt | kolečko + commit navíc |
| POST pojistka jen ve `resolveChain` větvi | nezopakován vzor z PUT/batch | chytil auditor |
| Zapomenutý timeout u PUT/POST (zvednut jen batch) | nekonzistence | chytil finální review |
| Vytištěné bloky se daly přeplánovat | chybějící doménová znalost | chytil finální review |
| Zastaralý doc komentář (tvrdil opak `FOR UPDATE`) | neaktualizováno po refaktoru | chytil review |

---

## 7. Co příště dělat jinak

1. **Produkční SQL hned robustně** — heredoc spouštěný na serveru (ne `scp + ssh`), počítat, že uživatel zůstane přihlášený, žádné `#` komentáře do zsh příkazů.
2. **Skripty pro produkci testovat na realistických datech** — Prisma `$queryRaw` vrací `BigInt`/`Date`, ne `Int`/`string`.
3. **Konzistence od prvního průchodu** — pojistka/audit/timeout udělat rovnou na všech cestách (POST/PUT/batch), ne nechat na review.
4. **Doménová pravidla do designu předem** (vytištěné bloky jsou fixní).
5. **Komentáře aktualizovat při refaktoru.**

Co NEměnit: příčina-před-opravou, multi-agent review u rizikových změn, fázování se zastávkami, povinná záloha/snapshot.

---

## 8. Follow-up (ne bugy, refaktorový cleanup)

- Sjednotit 3× kopírovaný chain-push + AUTO_SHIFT audit blok (POST/PUT/batch) do helperu.
- `applyBatch` 2× (handleBlockUpdate / handleMultiBlockUpdate) → jedna utilita.
- Interval-overlap test na 5 místech → sdílený helper `intervalsOverlap`.
- Batch dělá `findMany` per anchor → shared snapshot per stroj.
