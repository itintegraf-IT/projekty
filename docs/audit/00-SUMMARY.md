# 00 — SUMMARY (shrnutí pro rozhodnutí)

> **Nezávislý read-only hloubkový audit** aplikace Integraf Výrobní plán před plným nasazením do produkce.
> Datum: 6. 7. 2026 · Branch `Vojta` · HEAD `1473d402` (stage 8).
> Metoda: mapování repa → 10 paralelních audit subagentů (1 oblast každý) → dedup → **nezávislé adversariální ověření 3 subagenty s čistým kontextem**.
> Detaily: [01-FINDINGS.md](01-FINDINGS.md) · Plán oprav: [02-FIX-PLAN.md](02-FIX-PLAN.md) · Zjištění o codebase: [LESSONS.md](LESSONS.md)

---

## TL;DR — verdikt

**Aplikace je v překvapivě dobrém stavu a je blízko produkční zralosti.** Build prochází, lint 0 chyb, **366/366 testů zelených**, žádná SQL injection, žádné XSS, autorizace je vynucená server-side na všech 43 API cestách, transakční disciplína je výborná. **Nenašli jsme žádný potvrzený P0 blocker.**

Co brání bezvýhradnému „go" jsou **tři deployment fakty, které znám jen já a ty** (ne z kódu), a **jedna třída jemných nálezů**, kde vypadá bezpečně něco, co ve skutečnosti neběží. Po zodpovězení 3 otázek níže a odbavení P1 nálezů je aplikace bezpečně nasaditelná.

**Nálezy celkem: 79** (0 potvrzených P0 · 15 P1 · 30 P2 · 31 P3). Dvě podmíněné P0 (viz otázky 1–2).

---

## ⚠️ 4 otázky, které potřebuju od tebe zodpovědět (mění severitu)

Tohle jsou fakta o produkčním nasazení, která nejdou vyčíst z repa — a přímo určují, jestli jsou některé nálezy P0, nebo P2.

1. **Běží před produkční aplikací (`192.168.10.210:3020`) TLS reverse proxy (nginx/caddy s HTTPS)?**
   → V kódu je cookie nastavená jako `Secure` v produkci, což znamená, že po čistém HTTP prohlížeč session zahodí a **login by nefungoval**. Buď tam TLS proxy je (pak OK, jen to není nikde zdokumentované), nebo prod běží po HTTP a je to **P0 rozbití** ([SEC-001], [STAB-001]). Ptej se Michala; ověřit lze `curl -sI http://192.168.10.210:3020/`.

2. **Má produkční databáze účty ze seedu (`admin/admin`, `planovac/planovac`…) nebo bootstrap heslo `ChangeMe123!`?**
   → Seed skript vytváří účty, kde heslo == jméno; bootstrap má natvrdo `ChangeMe123!`. Pokud přežily do produkce, je to **přímý admin přístup** = P0/P1 ([SEC-008], [SEC-009]). Nemám přístup na prod DB — ověř `SELECT username FROM User` a zkus se přihlásit.

3. **Existuje organizační proces pro GDPR (retence a výmaz osobních údajů)?** Aplikace drží PII (jména firem, kontakty, uživatelská jména) bez technického retenčního mechanismu ([SEC-016], [PERF-007]).

4. **Má produkční `DATABASE_URL` parametr `connection_limit`?** Deploy checklist to zmiňuje, kód to nevynucuje ([PERF-005]).

---

## Nejdůležitější zjištění (i kdybys četl jen jeden odstavec)

**Dvě obranné vrstvy jsou naprogramované, ale obě odpojené — falešný pocit bezpečí.** Nezávislé ověření to označilo za nejrizikovější zjištění celého auditu:
- Server umí **optimistic locking** (zabránit tomu, aby dva lidé přepsali stejný blok) přes `expectedUpdatedAt` — **ale klient tuto hodnotu nikdy neposílá**, takže v praxi platí „poslední zápis vyhraje" bez varování. Když ty a Michal upravíte stejný blok, jeden o svou změnu tiše přijde. ([STAB-002])
- Klient umí zavřít stream a odhlásit uživatele po vypršení session přes SSE event `session-expired` — **ale server ten event nikdy nepošle**, takže planner otevřený přes noc dál ukazuje „živý" plán s prošlou session. ([STAB-001])

Obojí vypadá v kódu vyřešeně, ale reálně to nechrání. Oprava obou je malá (S/M).

---

## Top rizika podle priority

### 🔴 Podmíněné P0 (rozhodne odpověď na otázky 1–2)
- **[SEC-001]** Secure cookie vs. HTTP → login možná strukturálně nefunkční bez TLS proxy.
- **[SEC-008]** Seedovaná hesla `admin/admin` — pokud jsou v produkci, triviální admin přístup.

### 🟠 P1 — řešit před / kolem go-live (15 nálezů)
- **Bezpečnost:** [SEC-002] žádná CSRF ochrana nad rámec `SameSite=Lax` · [SEC-003] JWT 7 dní bez revokace (změna role se projeví až za týden) · [SEC-004] chybí security headers (CSP/HSTS/…).
- **Závislosti:** [DEP-001] `next@16.1.6` → **16.2.10** (jediná prod-relevantní zranitelnost; high middleware-bypass + SSRF, přímo míří na autorizační vrstvu) · [DEP-002] 12× `"latest"` pin = nereprodukovatelný build.
- **Stabilita:** [STAB-001] mrtvý session-expired (viz výše).
- **Kvalita:** [QUAL-001] expedition route obchází chybový standard 11× (produkční `/expedice` modul).
- **Provoz:** [OBS-001] žádný health-check endpoint · [OBS-002] přihlášení a změny uživatelů/rolí se nikam trvale nelogují (nulová forenzní stopa).
- **Architektura:** [ARCH-001]/[ARCH-002] dva „god-component" soubory (4163 + 4359 řádků) mísící prezentaci a mutace · [ARCH-003] doménový typ `Block` definovaný v prezentační komponentě.
- **Testy:** [TEST-001..004, 009] **celá auth/authz vrstva je netestovaná** (JWT, middleware, login, role field-filter) — není to živý defekt, ale největší riziko neodhalené regrese.

### 🟡 P2 (30) a 🟢 P3 (31)
Hardening, výkonové optimalizace pro budoucí růst, redundance, úklid dead code. Detaily v [01-FINDINGS.md](01-FINDINGS.md), pořadí v [02-FIX-PLAN.md](02-FIX-PLAN.md).

---

## Co je naopak genuinely dobré (a ověřené)

Aby prioritizace měla kontext — tohle jsou reálné silné stránky, ne formality:
- **Autorizace:** každá z 43 API cest vynucuje roli/vlastnictví server-side; IDOR na rezervacích a přílohách je neprůstřelný; DTP/MTZ mají field-level filtr vynucený na serveru (nemůžou měnit cizí pole).
- **Injection/XSS:** 0 SQL injection (jediný raw dotaz je parametrizovaný), 0 `dangerouslySetInnerHTML`.
- **Souběh bloků:** tvrdě serializovaný přes `SELECT … FOR UPDATE` (gap-lock) ve všech třech mutačních cestách.
- **Transakce:** každá mutace bloku + audit běží atomicky v `$transaction`.
- **Upload příloh:** UUID storage-key (žádný path traversal) + MIME + magic-bytes + velikostní validace.
- **Secrets:** `.env` není a nikdy nebyl v gitu; `JWT_SECRET` je povinný bez fallbacku; hesla přes bcrypt.
- **Výkon dnes:** malý objem dat (204 bloků), všechny dotazy rychlé; perf nálezy jsou „časované bomby" pro růst 10–100×, ne dnešní problém.
- **Architektonické jádro:** Prisma se nevolá z komponent, žádný server-only kód neteče do klientského bundle, scheduling logika je čistý acyklický DAG.

---

## Doporučení k nasazení

**Podmíněné go.** Postup:
1. **Zodpovědět otázky 1–2** (deployment topologie + prod účty). To buď odhalí 2 P0, nebo je smete ze stolu — je to nejlevnější a nejdůležitější krok.
2. **Odbavit „quick wins" P1** — bump `next`, security headers, health endpoint, oprava dvou dormantních obran, audit bezpečnostních událostí. Většina je S/M pracnost (viz [02-FIX-PLAN.md](02-FIX-PLAN.md), sekce Quick wins).
3. **Testy auth vrstvy** ([TEST-001/009]) doplnit paralelně — sníží riziko regresí při opravách výše.
4. P2/P3 (výkon při růstu, dekompozice god-components, úklid) řešit průběžně po nasazení; neblokují go-live.

Perf, redundance a architektura jsou o dlouhodobé udržitelnosti, ne o tom, jestli appka teď funguje — ta funguje.

---

## Poznámka k metodě a jistotě

Každý nález má konkrétní `soubor:řádek` + úryvek reálného kódu. Load-bearing nálezy (P0–P2) prošly **druhým, nezávislým adversariálním ověřením** subagentem s čistým kontextem, který se je snažil vyvrátit. To přineslo mj. korekce: spor o „neautentizovaný přístup k číselníku" byl vyvrácen (middleware anonyma blokuje → severita klesla na P3), únik dat rezervací je naopak **širší**, než první agent tvrdil (týká se i seznamu a všech PATCH odpovědí, ne jen detailu). Nálezy označené `NEOVĚŘENO` vyžadují buď tvou odpověď (deployment), nebo krok, který jsem v read-only režimu nemohl provést (prod DB). Nic z toho jsem neopravoval — dle zadání je výstupem posouzení.
