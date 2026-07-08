# 01 — FINDINGS (detailní nálezy)

> Read-only hloubkový audit aplikace **Integraf Výrobní plán** (Next.js 16 + Prisma 5 + MySQL).
> Datum: 6. 7. 2026 · Branch: `Vojta` · HEAD: `1473d402` (stage 8).
> Metoda: 10 paralelních audit subagentů (1 oblast každý) → dedup → **nezávislé adversariální ověření 3 subagenty s čistým kontextem**.
> **Tento dokument je psán pro AI (Opus 4.8), která bude nálezy opravovat.** Každý nález má umístění, důkaz, dopad, stav ověření a NAVRŽENÝ postup opravy (popis, ne implementace) + pracnost (S/M/L) + riziko regrese + závislosti.

## Legenda priorit
- **P0** = blocker go-live: aktivně exploitovatelná díra s reálným dopadem v daném nasazení, nebo aktivní ztráta dat / rozbití funkce.
- **P1** = vysoká: řešit před nebo těsně kolem go-live.
- **P2** = střední: řešit brzy, ne však blokující.
- **P3** = nízká: hygiena, úklid, hardening do hloubky.
- Deployment-citlivé nálezy mají **dvojí severitu** `LAN/HTTP: Px · přísný standard: Py` (dle rozhodnutí Vojty počítat obojí).
- Perf nálezy mají `dnes: Px · při růstu 10–100×: Py` (dnešní objem dat je malý: Block 204, AuditLog 965 řádků).

## Stav ověření
Každý nález nese **Ověření:** `OVĚŘENO` (přečteno v kódu / EXPLAIN / běh) nebo `NEOVĚŘENO` (+ jak potvrdit). Load-bearing nálezy (P0–P2) prošly navíc nezávislým adversariálním přeověřením — výsledek je v poznámce `[V: …]`.

## ⚠️ Otevřené otázky pro Vojtu (blokují finální severitu 3 nálezů)
1. **Běží před produkční aplikací (`192.168.10.210:3020`) TLS reverse proxy (nginx/caddy)?** V repu žádná TLS/proxy konfigurace není. Pokud **NE**, je [SEC-001] podmíněně **P0** (login strukturálně nefunkční po HTTP). Pokud **ANO**, [SEC-001] → P2 a [SEC-006] (XFF spoof) je nižší.
2. **Obsahuje produkční DB slabé účty ze seedu (`admin/admin`…) nebo bootstrap heslo `ChangeMe123!`?** (Nemám přístup na produkci, jen na dev.) Pokud ano → [SEC-008]/[SEC-009] jsou **P0/P1**.
3. **Má produkční `DATABASE_URL` parametr `connection_limit`?** ([PERF-005], deploy checklist to zmiňuje, kód nevynucuje.)

---

# SEC — Bezpečnost (17 nálezů)

### SEC-001 — Secure cookie v produkci vs. HTTP nasazení (možný rozbitý login / vynucená TLS závislost)
- **Priorita:** `LAN/HTTP: P1 · přísný: P2` — **podmíněně P0** (viz otevřená otázka 1)
- **Kategorie:** Session / Cookie / deployment
- **Umístění:** `src/lib/auth.ts:51-60`, `ecosystem.config.cjs:19`
- **Popis:** `getCookieOptions()` vrací `secure = (NODE_ENV === "production")`. `ecosystem.config.cjs` natvrdo nastavuje `NODE_ENV: "production"`. Prohlížeč cookie s příznakem `Secure` po čistém HTTP **neuloží**. Escape-hatch `ALLOW_HTTP_SESSION=true` v produkci navíc **vyhazuje výjimku** (ř. 52-56) — secure NELZE zeslabit. V repu není žádná nginx/caddy/TLS konfigurace ani zpracování `X-Forwarded-Proto`.
- **Důkaz:**
```ts
// src/lib/auth.ts:52-59
if (process.env.NODE_ENV === "production" && process.env.ALLOW_HTTP_SESSION === "true") {
  throw new Error("[auth] ALLOW_HTTP_SESSION=true is not permitted in production. ...");
}
const secure = process.env.NODE_ENV === "production";
return { secure };
```
- **Dopad:** Bez TLS-terminující proxy je produkční login nefunkční (cookie se po HTTP zahodí → nekonečná smyčka login→/). S proxy je vše OK, ale proxy je pak **tvrdá nezdokumentovaná závislost**.
- **Ověření:** `NEOVĚŘENO` (deployment). Potvrdit: na serveru `curl -sI http://192.168.10.210:3020/`, existence `/etc/nginx/sites-enabled/*` s `proxy_pass …:3020`, `pm2 env 0 | grep NODE_ENV`. [V: POTVRZENO na úrovni kódu; grep repa na `nginx|caddy|x-forwarded-proto|tls` = 0 výskytů — proxy může být jen mimo repo.]
- **Návrh opravy:** Pokud prod je čisté HTTP: derivovat `secure` z reálného protokolu (`X-Forwarded-Proto`) nebo explicitní ENV `COOKIE_SECURE`, ne slepě z `NODE_ENV`. Pokud existuje TLS proxy: žádná změna kódu, jen zdokumentovat proxy do deploy checklistu jako tvrdou závislost + přidat HSTS ([SEC-004]).
- **Pracnost:** S · **Riziko regrese:** střední (dotýká se auth cesty všech uživatelů) · **Závislosti:** rozhodnutí Vojty (otázka 1); souvisí [SEC-004], [STAB-001].

### SEC-002 — Žádná explicitní CSRF ochrana nad rámec `SameSite=Lax`
- **Priorita:** `LAN/HTTP: P2 · přísný: P1`
- **Kategorie:** CSRF
- **Umístění:** `src/lib/auth.ts:62-72` (cookie config); globálně všechny mutační routes
- **Popis:** Session je cookie-based (`httpOnly`, `sameSite: "lax"`). Neexistuje CSRF token ani origin/referer kontrola (grep `csrf|origin-check|referer` = 0). `SameSite=Lax` je funkční baseline (blokuje cross-site POST/PUT/PATCH/DELETE) a **žádná mutační GET cesta neexistuje** (ověřeno) — takže reálné zbytkové riziko je nízké (staré prohlížeče bez SameSite defaultu, útok ze stejné origin).
- **Důkaz:**
```ts
// src/lib/auth.ts:65-71
(await cookies()).set(COOKIE, token, { httpOnly: true, secure, sameSite: "lax", maxAge: ..., path: "/" });
```
- **Dopad:** Pro moderní prohlížeče `Lax` většinu CSRF pokrývá; zbytkové riziko cross-site útoku na mutační API přihlášeného admina z okrajových prohlížečů / stejné LAN origin.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO; upřesnění — „žádná CSRF ochrana" je mírně nadhodnocené, `Lax` + absence mutačních GET je funkční baseline.]
- **Návrh opravy:** Buď `sameSite: "strict"` (pozor: rozbije deep-linky z externích odkazů), nebo origin/referer validace v `middleware.ts` pro mutační metody (odmítnout POST/PUT/PATCH/DELETE, kde `Origin` header ≠ host).
- **Pracnost:** S (origin check) / M (CSRF token) · **Riziko regrese:** střední · **Závislosti:** —

### SEC-003 — JWT session 7 dní bez revokace, role zapečená v tokenu (stale privilege)
- **Priorita:** `LAN/HTTP: P2 · přísný: P1`
- **Kategorie:** Session / JWT
- **Umístění:** `src/lib/auth.ts:42-48`, `src/middleware.ts:27-28`
- **Popis:** JWT má expiraci 7 dní, `role`/`assignedMachine` jsou v tokenu, middleware i handlery čtou roli **z payloadu, ne z DB**. Neexistuje revokační mechanismus (grep `revoke|tokenVersion|sessionId|blocklist` = 0). `deleteSession()` jen maže cookie u klienta — token zůstává platný.
- **Důkaz:**
```ts
// src/lib/auth.ts:46
.setExpirationTime("7d")
// src/middleware.ts:28
const role = payload.role as string | undefined;  // role z tokenu, ne z DB
```
- **Dopad:** Po změně role (degradace ADMIN→VIEWER) nebo smazání účtu má bývalý uživatel platný přístup až 7 dní. Kompromitovaný token nelze odvolat.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO.]
- **Návrh opravy:** Zkrátit expiraci (např. 24 h) s refresh mechanismem; NEBO přidat `tokenVersion`/`sessionId` do JWT a validovat proti DB (revokace zvýšením verze); u citlivých akcí načítat čerstvou roli z DB.
- **Pracnost:** M · **Riziko regrese:** střední (mění auth cestu — nutné testy) · **Závislosti:** posiluje ho [TEST-001].

### SEC-004 — Chybějící security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- **Priorita:** `LAN/HTTP: P2 · přísný: P1`
- **Kategorie:** Security headers
- **Umístění:** `next.config.mjs` (žádná `headers()` funkce), `src/middleware.ts` (nepřidává hlavičky)
- **Popis:** `next.config.mjs` má jen `experimental.serverActions.bodySizeLimit`. Žádné bezpečnostní hlavičky. Bez CSP je jakákoli budoucí XSS plně exploitovatelná; bez `nosniff` MIME sniffing (relevantní pro download příloh, [SEC-011]); bez frame-ancestors clickjacking.
- **Důkaz:**
```js
// next.config.mjs — celý soubor
const nextConfig = { experimental: { serverActions: { bodySizeLimit: "11mb" } } };
export default nextConfig;
```
- **Dopad:** Chybí obrana do hloubky. Na LAN nižší, ale hardening zdarma.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO.]
- **Návrh opravy:** Přidat `async headers()` do `next.config.mjs` se statickými hlavičkami (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`; HSTS jen za TLS proxy). CSP nasadit iterativně přes `Content-Security-Policy-Report-Only` kvůli Next.js inline scriptům/Tailwindu.
- **Pracnost:** S (statické) / M (funkční CSP) · **Riziko regrese:** nízké (statické) / střední (striktní CSP) · **Závislosti:** HSTS závisí na [SEC-001] deployment; řeší i [SEC-011].

### SEC-005 — Rate-limiting jen na login a machine-week-shifts; rezervace, upload a admin/users nechráněné
- **Priorita:** `LAN/HTTP: P2 · přísný: P2`
- **Kategorie:** Rate limiting / DoS
- **Umístění:** `src/app/api/auth/login/route.ts:9-10`, `src/app/api/machine-week-shifts/route.ts:184,219`; chybí v `reservations/route.ts`, `reservations/[id]/attachments/route.ts`, `admin/users/**`
- **Popis:** `checkRateLimit` je jen ve 3 souborech. Nechráněné: `POST /api/reservations` (DB spam), `POST …/attachments` (upload 10 MB × 5 = storage DoS), `POST/PUT admin/users` (bcrypt cost 10 = CPU). Limiter je navíc in-memory per-instance.
- **Důkaz:**
```ts
// reservations/route.ts POST — jen getSession + role gate, žádný checkRateLimit
```
- **Dopad:** Přihlášený uživatel s nízkými právy (OBCHODNIK) zaplaví DB/disk; insider/kompromitovaný účet.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO; week-shifts má fakticky 2 limitery klíčované na `session.id`.]
- **Návrh opravy:** Přidat `checkRateLimit` (per `session.id`) na tvorbu rezervace, upload příloh a admin user mutace.
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** —

### SEC-006 — `getClientIp` důvěřuje `X-Forwarded-For` → obejití login rate-limitu (brute-force)
- **Priorita:** `LAN/HTTP: P2 · přísný: P2`
- **Kategorie:** Rate limiting / Spoofing
- **Umístění:** `src/lib/rateLimiter.ts:17-24`, `src/app/api/auth/login/route.ts:9-10`
- **Popis:** `getClientIp` bere první hodnotu z klientem řízené hlavičky `x-forwarded-for`; login rate-limit (10/15 min) je na ni klíčovaný. Bez proxy, která hlavičku přepíše, může útočník na každý pokus poslat jiné `X-Forwarded-For` a limit obejít.
- **Důkaz:**
```ts
// src/lib/rateLimiter.ts:19-21
h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown"
```
- **Dopad:** Bez důvěryhodné proxy je login rate-limit bezcenný → neomezený brute-force (v kombinaci se slabými hesly [SEC-008]/[SEC-009] okamžitě uhodnutelný).
- **Ověření:** `OVĚŘENO` (kód). Reálný dopad `NEOVĚŘENO` (deployment — přepisuje proxy XFF?). [V: POTVRZENO.]
- **Návrh opravy:** V single-instance/přímém deploymentu použít socket IP (`request.ip`/`req.socket.remoteAddress`) místo XFF, nebo XFF důvěřovat jen za známým proxy hopem; přidat i per-username rate-limit.
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** souvisí [SEC-001] (topologie).

### SEC-007 — `serializeReservation` vystavuje interní plánovací pole obchodníkovi (systémový leak)
- **Priorita:** `LAN/HTTP: P2 · přísný: P2`
- **Kategorie:** Nadměrně vystavená data / PII / IDOR-adjacent
- **Umístění:** `src/lib/reservationSerialization.ts:21-23`; konzumenti `reservations/route.ts` (list-GET), `reservations/[id]/route.ts` (GET + **všechny PATCH** odpovědi: ř. 119, 159, 186, 229, 283, 325, 365)
- **Popis:** `serializeReservation` dělá `return { ...reservation }` (spread celého záznamu, žádný role-filtr). OBCHODNIK u vlastní rezervace (i v seznamu i po každé PATCH akci) dostane interní pole: `plannerDecisionReason` (`@db.Text`), `planningPayload` (Json), `plannerUsername`, `counterProposedReason`, `withdrawnReason`.
- **Důkaz:**
```ts
// src/lib/reservationSerialization.ts:21
export function serializeReservation<T extends ReservationLike>(reservation: T) {
  return { ...reservation, /* jen date pole přeformátuje, žádný filtr */ };
```
- **Dopad:** Únik interního rozhodovacího kontextu plánovače k externímu obchodníkovi. Porušení need-to-know / minimalizace dat (GDPR čl. 5).
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO **a širší, než původně** — leak není jen na GET `[id]`, ale i v list-GET a všech PATCH odpovědích. Oprava na jednom endpointu nestačí — nutná role-aware serializace.]
- **Návrh opravy:** Role-aware serializace: `serializeReservation(reservation, viewerRole)` s whitelistem polí; pro OBCHODNIK vypustit `plannerDecisionReason`, `planningPayload`, `plannerUsername`, `counterProposedReason`. Opravit v serializační vrstvě (jedno místo pokryje všechny konzumenty).
- **Pracnost:** M · **Riziko regrese:** střední (ověřit, že `RezervacePage.tsx` na vypuštěná pole nespoléhá) · **Závislosti:** —

### SEC-008 — Seed vytváří účty s heslem == username (`admin/admin`, …)
- **Priorita:** `LAN/HTTP: P2 · přísný: P1` — **podmíněně P0** pokud prod obsahuje tyto účty (otázka 2)
- **Kategorie:** Slabé přihlašovací údaje / Secrets
- **Umístění:** `prisma/seed.ts:290-303`
- **Popis:** `prisma:seed` vytváří 6 účtů s heslem == username (`admin/admin`, `planovac/planovac`, `mtz/mtz`, `dtp/dtp`, `viewer/viewer`, `obchodnik/obchodnik`). CLAUDE.md `prisma:seed` označuje jako destruktivní dev-only, ale existuje riziko, že tato data přežijí do jiných prostředí nebo se seed omylem spustí.
- **Důkaz:**
```ts
// prisma/seed.ts:290-295
{ username: "admin", password: "admin", role: "ADMIN" },
{ username: "planovac", password: "planovac", role: "PLANOVAT" }, ...
// bcrypt.hash(u.password, 10) — ř. 303
```
- **Dopad:** Účet `admin/admin` s plnými právy je triviálně uhodnutelný (v kombinaci se [SEC-006] okamžitě).
- **Ověření:** `OVĚŘENO` (kód seedu). Prod stav `NEOVĚŘENO` — **ověřit na produkci** `SELECT username FROM User` + zkusit, zda `admin/admin` projde. [V: POTVRZENO.]
- **Návrh opravy:** Neseedovat výchozí účty vůbec, nebo generovat náhodná hesla a vypsat je jednorázově; nikdy heslo == username.
- **Pracnost:** S (dev-only skript) · **Riziko regrese:** nízké · **Závislosti:** ověření prod DB.

### SEC-009 — Žádná délková politika hesla + hardcoded bootstrap heslo `ChangeMe123!`
- **Priorita:** `LAN/HTTP: P2 · přísný: P2`
- **Kategorie:** Hashování / Politika hesel / Secrets
- **Umístění:** `src/app/api/admin/users/[id]/route.ts:57-61`, `src/app/api/admin/users/route.ts:39-42`, `prisma/bootstrap-prod.ts:136`
- **Popis:** (a) Změna hesla admina validuje jen `length < 1` → jednoznakové heslo projde; POST tvorby uživatele min. délku nekontroluje. (b) `bootstrap-prod.ts` má hardcoded `ChangeMe123!` (použije se jen pokud žádný ADMIN neexistuje). (c) bcrypt cost = 10 (OWASP dnes doporučuje ≥ 12).
- **Důkaz:**
```ts
// admin/users/[id]/route.ts:57-60
if (String(body.password).length < 1) return NextResponse.json({ error: "Heslo nesmí být prázdné" }, { status: 400 });
// bootstrap-prod.ts:136
const defaultPassword = "ChangeMe123!";
```
- **Dopad:** Admin může (omylem) nastavit triviální heslo; bootstrap heslo je veřejně v gitu — pokud nebylo změněno, je to přímý přístup.
- **Ověření:** `OVĚŘENO` (všechny 4 části). [V: POTVRZENO.] Prod stav bootstrap hesla `NEOVĚŘENO`.
- **Návrh opravy:** Vynutit min. délku hesla (≥ 10–12) v POST i PUT admin/users; bootstrap heslo generovat náhodně a vypsat jednorázově (ne konstanta); zvážit bcrypt cost 12.
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** ověření prod admin hesla.

### SEC-010 — `jwtVerify` bez pinnutého algoritmu (`algorithms: ["HS256"]`)
- **Priorita:** `LAN/HTTP: P3 · přísný: P2`
- **Kategorie:** Session / JWT (alg-confusion hardening)
- **Umístění:** `src/middleware.ts:27`, `src/lib/auth.ts:78`
- **Popis:** Obě ověření volají `jwtVerify(token, SECRET)` bez `{ algorithms: ["HS256"] }`. Reálný dopad **nízký**: `jose` se symetrickým klíčem (`Uint8Array`) asymetrické `alg` (RS/ES) i `alg: none` odmítne — klasická confusion je blokovaná typem klíče. Přesto je explicitní allow-list best-practice.
- **Důkaz:**
```ts
// src/middleware.ts:27
const { payload } = await jwtVerify(cookie.value, SECRET);
```
- **Dopad:** Prakticky žádný při současném HMAC klíči; teoretická obrana do hloubky.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO včetně platné mitigace — nízký reálný dopad.]
- **Návrh opravy:** Přidat `{ algorithms: ["HS256"] }` do obou `jwtVerify` volání.
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** —

### SEC-011 — Download příloh bez `X-Content-Type-Options: nosniff`
- **Priorita:** `LAN/HTTP: P3 · přísný: P2`
- **Kategorie:** XSS (MIME sniffing) / Security headers
- **Umístění:** `src/app/api/reservations/[id]/attachments/[attachmentId]/route.ts:48-56`
- **Popis:** GET přílohy vrací `Content-Type` z DB + `Content-Disposition: attachment`, ale bez `nosniff`. MIME allowlist při uploadu ([SEC-013] pozitivum) blokuje HTML/SVG, takže hlavní stored-XSS vektor je zavřený; zbytkové riziko je MIME-sniffing u okrajových typů.
- **Důkaz:**
```ts
// [attachmentId]/route.ts:48-55 — chybí "X-Content-Type-Options": "nosniff"
return new NextResponse(fileBuffer, { headers: { "Content-Type": attachment.mimeType, "Content-Disposition": ... } });
```
- **Dopad:** Nízký (MIME allowlist + disposition mitigují).
- **Ověření:** `OVĚŘENO`.
- **Návrh opravy:** Přidat `nosniff` (ideálně globálně přes [SEC-004]).
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** [SEC-004].

### SEC-012 — `GET /api/codebook` bez in-handler kontroly session (defense-in-depth mezera)
- **Priorita:** `LAN/HTTP: P3 · přísný: P3`
- **Kategorie:** Broken access control (defense-in-depth)
- **Umístění:** `src/app/api/codebook/route.ts:8-25`
- **Popis:** Jediný GET handler ze 43, který nevolá `getSession()`. **Korekce po ověření:** middleware neautentizovaný přístup **blokuje** (matcher pokrývá `/api/codebook`, redirect na `/login` bez cookie) — číselník tedy NENÍ dostupný anonymně, čte ho jen libovolná **přihlášená** role. Data jsou nízko-citlivá (labely stavů, barvy). Problém je čistě nekonzistence a to, že by při změně matcheru cesta zůstala nechráněná.
- **Důkaz:**
```ts
// codebook/route.ts:8 — GET bez getSession; POST/PUT/DELETE mají ["ADMIN","PLANOVAT"]
export async function GET(request: NextRequest) { const { searchParams } = new URL(request.url); ...
```
- **Dopad:** Nízký — libovolná přihlášená role si přečte číselník. Žádný anonymní leak, žádná mutace.
- **Ověření:** `OVĚŘENO`. [V: **KOREKCE** — QUAL agent tvrdil „neautentizovaný přístup", to je NEPRAVDA; middleware anonyma blokuje. Rozpor rozhodnut ve prospěch AUTHZ agenta → severita P3.]
- **Návrh opravy:** Přidat na začátek GET `const session = await getSession(); if (!session) return 401;` — parita s ostatními GET routes.
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** —

### SEC-013 — `GET /api/machine-week-shifts?weekStart=…` je skrytá mutace dostupná všem přihlášeným rolím
- **Priorita:** `LAN/HTTP: P3 · přísný: P3`
- **Kategorie:** Read endpoint s postranním zápisem
- **Umístění:** `src/app/api/machine-week-shifts/route.ts:192` (GET → `ensureWeekSeeded`, ř. 152-153)
- **Popis:** GET s `weekStart` spustí `ensureWeekSeeded`, který přes `createMany` zapíše až 14 řádků + `Notification` (CALENDAR_DRIFT) — zápis vyvolaný GETem od jakékoli role (i VIEWER), zatímco PUT je `["ADMIN","PLANOVAT"]`. Idempotentní (`skipDuplicates`), rate-limited.
- **Důkaz:**
```ts
// route.ts:192
await ensureWeekSeeded(parsed, session);  // uvnitř GET
```
- **Dopad:** Nižší role může auto-seedovat týdny a nepřímo generovat drift notifikace pro plánovače; data se nepoškodí.
- **Ověření:** `OVĚŘENO`.
- **Návrh opravy:** Omezit seedující GET na `["ADMIN","PLANOVAT"]`, nebo seed přesunout mimo GET (lazy write jen z admin cesty).
- **Pracnost:** M · **Riziko regrese:** střední (planner klient na seed spoléhá při zobrazení týdne) · **Závislosti:** —

### SEC-014 — `POST /api/notifications` nevaliduje `targetUserId` proti existenci uživatele
- **Priorita:** `P3`
- **Kategorie:** Chybějící validace cílového objektu
- **Umístění:** `src/app/api/notifications/route.ts:17-23`
- **Popis:** Handler je gate-ovaný `["ADMIN","PLANOVAT"]`, ale `targetUserId` se kontroluje jen jako `number` — ADMIN/PLANOVAT může vytvořit notifikaci s libovolným `message` na jakékoli/neexistující userId.
- **Důkaz:**
```ts
// route.ts:17-23
if (typeof targetUserId !== "number") return 400;
await prisma.notification.create({ data: { ...targetUserId, message: message ?? "", ... } });
```
- **Dopad:** Nízký (oprávněná role, jen notifikace) — potenciál matoucího/phishingového in-app textu, mrtvé záznamy.
- **Ověření:** `OVĚŘENO`.
- **Návrh opravy:** Ověřit `targetUserId` přes `user.findUnique`; případně omezit `message` na server-generované šablony.
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** —

### SEC-015 — Middleware negatuje `/admin` pro DTP/MTZ/VIEWER (mitigováno page-checkem)
- **Priorita:** `P3`
- **Kategorie:** Neúplná middleware gate (nekonzistence, ne díra)
- **Umístění:** `src/middleware.ts:42-45` vs. `src/app/admin/page.tsx:7`
- **Popis:** Middleware z `/admin` redirectuje jen OBCHODNIK a TISKAR; DTP/MTZ/VIEWER pustí. **Skutečnou obranou je server-side check ve stránce** (`admin/page.tsx:7` redirect + všechny admin API mají vlastní `["ADMIN","PLANOVAT"]` gate). Neexploitovatelné.
- **Důkaz:**
```ts
// admin/page.tsx:7
if (!session || !["ADMIN", "PLANOVAT"].includes(session.role)) redirect("/");
```
- **Dopad:** Žádný praktický — jen nekonzistence vrstev.
- **Ověření:** `OVĚŘENO`.
- **Návrh opravy:** Pro čistotu doplnit do middleware pozitivní whitelist `/admin` na `["ADMIN","PLANOVAT"]`.
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** [ARCH-008] (sdílené role helpery).

### SEC-016 — PII v rezervacích/AuditLogu bez retenční politiky a práva na výmaz (GDPR)
- **Priorita:** `LAN/HTTP: P3 · přísný: P2`
- **Kategorie:** PII / GDPR
- **Umístění:** `prisma/schema.prisma:227-292` (Reservation, ReservationAttachment, User, AuditLog:10)
- **Popis:** Ukládá se PII: `companyName`, `requestText` (@db.Text volný text), denormalizované usernames napříč tabulkami (`requestedByUsername`, `plannerUsername`, `uploadedByUsername`…), přílohy s obsahem, AuditLog. Žádný retenční mechanismus, access-logging čtení PII, ani proces výmazu (GDPR čl. 17). Denormalizované usernames znemožňují čistý výmaz uživatele.
- **Důkaz:** grep v repu žádný cron/cleanup PII; `AuditLog`/`Notification` bez mazání (viz [PERF-007]).
- **Dopad:** GDPR compliance mezera (minimalizace, omezení uložení, právo být zapomenut).
- **Ověření:** `NEOVĚŘENO` (organizační proces mimo repo?) — potvrdit s Vojtou.
- **Návrh opravy:** Definovat retenční politiku (archivace/mazání uzavřených rezervací a starých audit logů po N letech); proces anonymizace uživatele (nahradit denormalizovaná jména neutrálním „smazaný uživatel"); posoudit, zda `requestText`/`plannerDecisionReason` nemají obsahovat PII.
- **Pracnost:** L · **Riziko regrese:** střední · **Závislosti:** [PERF-007], organizační rozhodnutí.

### SEC-017 — Nekonzistentní magic-bytes validace pro staré `.doc/.xls` (nový nález z ověření)
- **Priorita:** `P3`
- **Kategorie:** Upload / validace
- **Umístění:** `src/app/api/reservations/[id]/attachments/route.ts:23-45` (`validateMagicBytes`, ~ř.42)
- **Popis:** `validateMagicBytes` očekává u MIME `application/msword` a `application/vnd.ms-excel` prefix `PK` (ZIP), ale legitimní staré binární `.doc/.xls` (OLE2/CFBF) začínají `D0 CF 11 E0`. Důsledek: (a) legitimní staré Office soubory validací neprojdou, (b) **jakýkoli ZIP přejmenovaný na `.doc` s MIME `application/msword` projde**. Není to path traversal (storageKey = UUID), ale MIME/magic-bytes kontrola je u těchto typů nekonzistentní.
- **Důkaz:** `validateMagicBytes` mapuje `application/msword` → očekává `PK` (ZIP signature), zatímco starý `.doc` má OLE2 signaturu.
- **Dopad:** Nízký — obchází se jen typová kontrola přílohy (obsah se nikde nespouští), plus false-negative na legitimních starých souborech.
- **Ověření:** `OVĚŘENO` (nezávislý verifikátor, čtení `validateMagicBytes`).
- **Návrh opravy:** Pro `application/msword`/`application/vnd.ms-excel` akceptovat OLE2 signaturu `D0 CF 11 E0 A1 B1 1A E1`; moderní `.docx/.xlsx` (`application/vnd.openxmlformats-*`) ponechat na `PK`.
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** —

---

# DEP — Závislosti (5 nálezů)

### DEP-001 — `next@16.1.6` → bump na 16.2.10 (jediná prod-runtime zranitelnost; middleware bypass + SSRF)
- **Priorita:** `P1`
- **Kategorie:** Zranitelná závislost
- **Umístění:** `package.json:36` (`"next": "latest"` → resolvnuto 16.1.6)
- **Popis:** Z 15 zranitelností v `npm audit` je `next` **jediná prod-runtime-relevantní**. Obsahuje **high** advisory: middleware/proxy bypass (GHSA-492v-c6pp-mqqv CVSS 8.1; GHSA-267c/26hh segment-prefetch 7.5; fix <16.2.6) a SSRF přes WebSocket upgrade (GHSA-c4j6-fc7j-m34r CVSS 8.6; fix <16.2.5). **Middleware bypass je relevantní, protože část autorizace stojí na `src/middleware.ts`.**
- **Důkaz:** `npm why next` → přímá dep; `npm audit` `fixAvailable: { name: "next", version: "16.2.10" }`.
- **Dopad:** Prod runtime (PM2, port 3020). Přímý bezpečnostní dopad na autorizační vrstvu.
- **Ověření:** `OVĚŘENO` (chain + fix z auditu). Zda konkrétní bypass obchází zdejší matcher `NEOVĚŘENO` — potvrdit pen-testem po bumpu. [V: POTVRZENO verze + dev/prod split.]
- **Návrh opravy:** Bump `next` na **16.2.10** (zavírá všech 20 next CVE + tranzitivní postcss XSS). Přišpendlit v `package.json`, `npm install`, `npm run build`, manuální smoke test middleware/auth cest.
- **Pracnost:** S · **Riziko regrese:** střední (minor bump v 16.x — nutný build + test authz) · **Závislosti:** dělat současně s [DEP-002]; řeší i postcss XSS.

### DEP-002 — 12× `"latest"` pin v `package.json` → nereprodukovatelný build
- **Priorita:** `P1`
- **Kategorie:** Pinning
- **Umístění:** `package.json` — `next`, `react`, `react-dom`, `typescript`, `eslint`, `eslint-config-next`, `tailwindcss`, `autoprefixer`, `postcss`, `@types/node`, `@types/react`, `tsx`
- **Popis:** 12 závislostí (3 prod runtime) má rozsah `"latest"`. `npm update` / čerstvý `npm install` bez `npm ci` může kdykoli vytáhnout novější major a rozbít build či zavléct CVE bez auditní stopy. U bezpečnostně kritického `next` obzvlášť riskantní.
- **Důkaz:** `grep -c '"latest"' package.json` = 12.
- **Dopad:** Ohrožuje reprodukovatelnost produkčního buildu.
- **Ověření:** `OVĚŘENO`. [V: **KOREKCE** — 12 pinů, ne 11 (chyběl `eslint-config-next`).]
- **Návrh opravy:** Přišpendlit každou na aktuálně resolvnutou verzi (caret): `next 16.2.10`, `react/react-dom ^18.3.1`, `typescript ^5.9.3`, `eslint ^9.39.3`, `eslint-config-next ^16.2.10` (držet v páru s next), `tailwindcss ^4.2.1`, `autoprefixer ^10.4.27`, `postcss ^8.5.10`, `tsx ^4.21.0`, `@types/node ^25.3.3`, `@types/react ^19.2.14`.
- **Pracnost:** S · **Riziko regrese:** nízké (piny = už nainstalovaný stav) · **Závislosti:** [DEP-001]. Pozn.: `@types/react@19` vs `react@18` je major mismatch typů — prověřit samostatně.

### DEP-003 — `date-fns` nepoužitá prod závislost
- **Priorita:** `P2` · **Kategorie:** Unused · **Umístění:** `package.json:33`
- **Popis:** Projekt používá vlastní `src/lib/dateUtils.ts`; grep `date-fns` v `src/` = 0 importů.
- **Ověření:** `OVĚŘENO`. `NEOVĚŘENO` zda peer `react-day-picker` — ověřit `npm ls date-fns` před odebráním. [V: POTVRZENO 0 importů.]
- **Návrh opravy:** Odebrat z `dependencies` (po peer-checku). · **Pracnost:** S · **Riziko regrese:** nízké.

### DEP-004 — `tailwindcss-animate` nepoužitá prod závislost
- **Priorita:** `P2` · **Kategorie:** Unused · **Umístění:** `package.json:42`
- **Popis:** Plugin se nikde nenačítá (žádná reference v globals.css/config, jen scaffold ze shadcn).
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO.]
- **Návrh opravy:** Odebrat z `dependencies`. · **Pracnost:** S · **Riziko regrese:** nízké.

### DEP-005 — SQLite relikty `better-sqlite3` + `@types/better-sqlite3` (devDep)
- **Priorita:** `P3` · **Kategorie:** Unused · **Umístění:** `package.json:46,51`; jediný konzument `prisma/export-to-mysql.ts:1`
- **Popis:** Nativní modul jen v historickém migračním skriptu (SQLite→MySQL). Není v runtime cestě.
- **Ověření:** `OVĚŘENO`.
- **Návrh opravy:** Archivovat/smazat `prisma/export-to-mysql.ts` (+ `dev.db`, `vojta-export.sql`) a odebrat obě deps. · **Pracnost:** S · **Riziko regrese:** nízké.

---

# STAB — Funkčnost a stabilita (7 nálezů)

### STAB-001 — SSE `session-expired`: klient tvrdě redirectuje, server event NIKDY neemituje (mrtvá logika)
- **Priorita:** `P1`
- **Kategorie:** Realtime / broken-state
- **Umístění:** `src/hooks/useSSE.ts:65-68`, `src/app/api/events/route.ts:125` (emit chybí)
- **Popis:** Klient poslouchá `session-expired` a dělá `window.location.href = "/"`. Grep celého `src/` = jediný výskyt = ten listener, **0 emitů**. `getSession()` v `/api/events` se volá jen jednou při otevření streamu; expiraci JWT (7 dní) za běhu nikdo nekontroluje → stream žije s mrtvou session donekonečna.
- **Důkaz:**
```ts
// useSSE.ts:65 — čeká na event, který nepřijde
es.addEventListener("session-expired", () => { es.close(); window.location.href = "/"; });
```
- **Dopad:** Uživatel s otevřeným plannerem přes noc má po expiraci JWT „živý" plán, ale je odhlášený; stale stav bez varování až do reloadu / první mutace (401).
- **Ověření:** `OVĚŘENO` (emit neexistuje). [V: POTVRZENO — **spolu s [STAB-002] nejrizikovější zjištění**: dvě obranné vrstvy naprogramované, obě odpojené.]
- **Návrh opravy:** Buď v heartbeat intervalu periodicky re-verifikovat session a při selhání emitnout `session-expired` + zavřít controller; NEBO odstranit mrtvý listener a spolehnout se na 401 z mutací + reconnect.
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** souvisí [SEC-003] (JWT expirace), [STAB-002].

### STAB-002 — Optimistic locking na drag/resize/edit je dormantní (klient neposílá `expectedUpdatedAt`)
- **Priorita:** `P2`
- **Kategorie:** Race condition
- **Umístění:** `src/app/api/blocks/[id]/route.ts:172-181` (server umí), `batch/route.ts:73-87`; klient `TimelineGrid.tsx:2715`, `PlannerPage.tsx` (neposílá)
- **Popis:** Server implementuje optimistic locking přes `expectedUpdatedAt` (CONFLICT při neshodě `updatedAt`), ale grep `expectedUpdatedAt` v `src/app/_components` + `src/components` = **prázdný**. Drag/resize/edit tedy = last-write-wins bez detekce.
- **Důkaz:**
```ts
// blocks/[id]/route.ts:176 (server umí)
if (oldBlock.updatedAt.getTime() !== expected.getTime()) throw new AppError("CONFLICT", "Blok byl mezitím změněn ...");
// TimelineGrid.tsx:2715 — drag PUT body BEZ expectedUpdatedAt
```
- **Dopad:** Dva uživatelé (Vojta + Michal, nebo dva ADMINi) na týž blok → poslední zápis tiše přepíše předchozí bez varování.
- **Ověření:** `OVĚŘENO` (server i absence klientského pole). [V: POTVRZENO — obranná vrstva existuje, ale je odpojená (false sense of safety).]
- **Návrh opravy:** Klientské mutační cesty posílat `expectedUpdatedAt: block.updatedAt` a zpracovat 409 (toast „blok mezitím změněn, obnov"). Alternativně vědomě přijmout last-write-wins a dormantní serverový kód odstranit.
- **Pracnost:** M · **Riziko regrese:** střední (nové 409 cesty v UI nutno ošetřit) · **Závislosti:** souvisí [STAB-001].

### STAB-003 — Split (head PUT + tail POST) je multi-request mimo transakci; pád klienta = ztráta tiskového času
- **Priorita:** `P2`
- **Kategorie:** broken-state
- **Umístění:** `src/app/_components/TimelineGrid.tsx:2875-3054` (`handleSplitBlockAt`)
- **Popis:** Split dělá 2-3 samostatné HTTP requesty (Krok 1 zkrátit hlavu PUT ~ř.2945, volitelně splitGroupId PUT ~ř.2978, Krok 3 tail POST ~ř.3002). Hlava commituje **první**. Kompenzace (LIFO) kryje serverové selhání kroku 2/3, ale NE pád/zavření klienta mezi kroky → hlava zůstane trvale zkrácená bez ocasu = tichá ztráta ~poloviny tiskového času.
- **Důkaz:**
```ts
// TimelineGrid.tsx:2945 Krok 1 (hlava) commit; :3002 Krok 3 (tail) — mezi tím pád klienta = catch se nespustí
```
- **Dopad:** Uživatel rozdělí blok, zavře tab na pomalé síti po Kroku 1 → hlava zkrácená, ocas neexistuje, tiskový čas zmizel bez auditní stopy o problému.
- **Ověření:** `OVĚŘENO` (struktura). [V: POTVRZENO.]
- **Návrh opravy:** Atomický serverový split endpoint `POST /api/blocks/[id]/split` s `{ splitAt }`, který hlavu+ocas+splitGroupId+chain push provede v jedné `$transaction` (CLAUDE.md to eviduje jako „v2 backlog").
- **Pracnost:** L · **Riziko regrese:** střední · **Závislosti:** —

### STAB-004 — TOCTOU při editaci week-shifts vs. insert bloku — re-check bez `FOR UPDATE` (vědomý limit)
- **Priorita:** `P2`
- **Kategorie:** Race condition
- **Umístění:** `src/app/api/machine-week-shifts/route.ts:356-358`, `src/lib/findConflictingBlocks.ts:128-131,162-173`
- **Popis:** In-tx re-check `assertNoConflictingBlocks` je čistý READ (`findMany`) bez `FOR UPDATE`/gap-locku. Souběžný insert bloku (dosud necommitnutá transakce) není zachycen → blok skončí mimo provozní dobu. CLAUDE.md to přiznává; self-heal existuje přes drift detekci + „Přepočítat".
- **Důkaz:**
```ts
// findConflictingBlocks.ts:128 — findMany bez FOR UPDATE
await db.block.findMany({ where: { machine, ...conflictWindowWhere } });
```
- **Dopad:** Úzké souběžné okno (admin zmenšuje směnu × plánovač vkládá blok) → nekonzistentní mezistav; odchytí drift.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO — asymetrie: blok×blok je tvrdě serializován `FOR UPDATE` ([STAB pozitivum]), ale shift×blok jen měkce ex-post.]
- **Návrh opravy:** Dokumentovaný akceptovaný limit — ponechat na self-healu je legitimní. Pokud striktní konzistence: `SELECT … FOR UPDATE` nad oknem bloků v re-checku (za cenu kontence).
- **Pracnost:** M · **Riziko regrese:** střední · **Závislosti:** —

### STAB-005 — PUT `[id]` čte `jobPreset` globálním `prisma` klientem uvnitř transakce (má být `tx`)
- **Priorita:** `P3`
- **Kategorie:** Race / konzistence vzoru
- **Umístění:** `src/app/api/blocks/[id]/route.ts:324-327`
- **Popis:** Uvnitř `$transaction(async (tx)=>…)` je `prisma.jobPreset.findUnique` přes globální `prisma`, ne `tx`. Jde o read-only lookup (validace kompatibility při změně typu) → žádná ztráta atomicity zápisů, ale čte mimo izolaci transakce.
- **Důkaz:**
```ts
// [id]/route.ts:324 — `prisma`, ne `tx`
const existingPreset = await prisma.jobPreset.findUnique({ where: { id: oldBlock.jobPresetId }, select: {...} });
```
- **Dopad:** Nízký (jen validační hláška může vidět jinou verzi presetu).
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO.]
- **Návrh opravy:** Změnit na `tx.jobPreset.findUnique`.
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** —

### STAB-006 — Attachment POST: tichý rollback `.catch(() => {})` → osiřelý DB záznam bez souboru
- **Priorita:** `P3`
- **Kategorie:** silent-catch / broken-state
- **Umístění:** `src/app/api/reservations/[id]/attachments/route.ts:177`
- **Popis:** Při selhání zápisu na disk se kompenzačně maže DB záznam přes `.delete().catch(() => {})`. Pokud i tento delete selže (DB blip), chyba je spolykaná bez logu → osiřelý metadata-záznam (příloha v DB, soubor chybí) → pozdější download 404/500.
- **Důkaz:**
```ts
// attachments/route.ts:177
await prisma.reservationAttachment.delete({ where: { id: attachment.id } }).catch(() => {});
```
- **Dopad:** Nízká pravděpodobnost (dvojí selhání), ale bez logu neodhalitelné.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO.]
- **Návrh opravy:** Doplnit `logger.error("[attachment] rollback DB delete failed", e)` do `.catch`; ideálně zapisovat soubor PŘED DB záznamem (a při selhání DB smazat soubor).
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** —

### STAB-007 — `complete/route.ts` read-then-write bez optimistic locku (idempotentní, nízký dopad)
- **Priorita:** `P3`
- **Kategorie:** Race
- **Umístění:** `src/app/api/blocks/[id]/complete/route.ts:33-72`
- **Popis:** Načte blok mimo transakci, pak `$transaction([update, auditLog])` bez `expectedUpdatedAt`/WHERE guardu. Mezi read a update se blok může změnit, ale toggle je idempotentní boolean → dopad minimální.
- **Důkaz:** read na ř. 33, update v tx bez guardu.
- **Dopad:** Nízký (idempotence).
- **Ověření:** `OVĚŘENO`.
- **Návrh opravy:** Přidat re-check typu uvnitř tx, případně `expectedUpdatedAt`.
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** [STAB-002].

---

# PERF — Datová vrstva a výkon (10 nálezů)

> Dnešní objem dat je malý (Block 204, AuditLog 965, MachineWeekShifts 1470 řádků) → perf nálezy mají dnes nízký dopad. Severita `dnes / při růstu 10–100×`. **`Block.orderNumber` index NEPŘIDÁVAT** — žádný dotaz podle něj nefiltruje (ověřeno).

### PERF-001 — `GET /api/blocks` (celý planner): full scan + filesort, bez horizontu a bez limitu
- **Priorita:** `dnes: P3 · při růstu: P1`
- **Kategorie:** scaling
- **Umístění:** `src/app/api/blocks/route.ts:30-37`
- **Popis:** `findMany` bez povinného `machine` ve WHERE (když query param chybí → `where: undefined` = všechny bloky napříč stroji i historií), `orderBy: startTime`, `include` (ne `select`), **bez `take`/limitu a bez časového horizontu**. EXPLAIN: `type: ALL`, `Using filesort`. Nejfrekventovanější read (každý user + SSE reconnect).
- **Důkaz:**
```
EXPLAIN SELECT * FROM Block ORDER BY startTime ASC → type: ALL, key: NULL, Extra: "Using filesort"
```
- **Dopad:** Dnes ms. Při tisících bloků + rostoucí historii (bloky se nemažou) filesort celé tabulky + serializace ~50 sloupců každého bloku, zvlášť pod SSE reconnect bouří.
- **Ověření:** `OVĚŘENO` (EXPLAIN). [V: POTVRZENO — žádný `take`/horizon; „latentní časovaná bomba" v kombinaci s [PERF-007].]
- **Návrh opravy:** Omezit default okno (`endTime > now − 30d`), pak `Block_machine_time_idx` pomůže i řazení; `select` jen sloupce, které karta potřebuje.
- **Pracnost:** M · **Riziko regrese:** střední (mění kontrakt seznamu — projít klienta) · **Závislosti:** [PERF-007].

### PERF-002 — `report/dashboard` block range dotaz: full scan (machine mimo WHERE)
- **Priorita:** `dnes: P3 · při růstu: P1`
- **Kategorie:** scaling / missing-index
- **Umístění:** `src/app/api/report/dashboard/route.ts:70-73` (retro), `:202-205` (outlook)
- **Popis:** `where: { startTime: { lt: end }, endTime: { gt: start } }` bez `machine` → composite `Block_machine_time_idx` nepoužitelný (chybí prefix `machine`) → full scan. Dělení per stroj se dělá až v JS.
- **Důkaz:** EXPLAIN `type: ALL, key: NULL`.
- **Dopad:** Nejtěžší analytický dotaz; při růstu Block + širokém okně dashboardu full scan + JS agregace.
- **Ověření:** `OVĚŘENO` (EXPLAIN).
- **Návrh opravy:** Index `(endTime, startTime)` pro range „přesah okna", nebo dotazovat per-machine (2× s `machine` prefixem využije stávající index).
- **Pracnost:** S (index) · **Riziko regrese:** nízké · **Závislosti:** —

### PERF-003 — Batch (lasso) přesun: N+1 fetchů kalendáře v jedné transakci
- **Priorita:** `dnes: P2 · při růstu: P1`
- **Kategorie:** n+1
- **Umístění:** `src/app/api/blocks/batch/route.ts:99-114`, `src/lib/printTime.server.ts:43-89` (`loadMachineCalendar`)
- **Popis:** Smyčka přes ZAKAZKA updaty, každý volá `validateAndComputeEnd` → `expandPrintTimeFromDb` → `loadMachineCalendar` = 2 dotazy (weekShifts + companyDays) **per blok**. `reflow.server.ts` už řeší `preloadedCalendar`, batch NE.
- **Důkaz:**
```ts
// batch/route.ts:99-114
for (const u of zakazkaUpdates) { const sched = await validateAndComputeEnd(tx, u.machine, ...); }
```
- **Dopad:** Větší dávky (desítky bloků) = mnoho round-tripů v transakci → delší držení zámků, riziko contention/timeoutu pod `connection_limit`.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO; bypass větev kalendář nečte.]
- **Návrh opravy:** Preload kalendář jednou per unikátní `machine` v dávce a předat do validace — stejný `preloadedCalendar` vzor jako `reflowMachineInTx`.
- **Pracnost:** M · **Riziko regrese:** střední (mění signaturu validace) · **Závislosti:** —

### PERF-004 — `AuditLog.orderNumber contains` = leading-wildcard LIKE; nejrychleji rostoucí tabulka
- **Priorita:** `dnes: P3 · při růstu: P2`
- **Kategorie:** missing-index / scaling
- **Umístění:** `src/lib/auditQuery.ts:110`
- **Popis:** Jediné hledání dle orderNumber v celém repu je nad `AuditLog` (NE Block) přes `contains` = `LIKE '%q%'` (leading wildcard → index nepoužitelný). AuditLog roste s každou mutací.
- **Důkaz:**
```ts
// auditQuery.ts:110
[{ orderNumber: { contains: safe } }]  // AuditLog, LIKE '%…%'
```
- **Dopad:** Dnes rychlé. Při statisících audit záznamů full-scan LIKE hledání zpomalí.
- **Ověření:** `OVĚŘENO` (EXPLAIN). [V: POTVRZENO obě části — Block.orderNumber se nefiltruje nikde.]
- **Návrh opravy:** Krátkodobě žádná akce. Střednědobě: prefix hledání (`startsWith` → sargable) nebo FULLTEXT index; primárně ale **retence AuditLogu** ([PERF-007]).
- **Pracnost:** S (prefix) / L (fulltext) · **Riziko regrese:** nízké (prefix mění sémantiku — konzultovat) · **Závislosti:** [PERF-007].

### PERF-005 — Produkční `connection_limit` není vynucen v kódu (jen v deploy checklistu)
- **Priorita:** `dnes: P2 · při růstu: P2`
- **Kategorie:** pooling
- **Umístění:** `src/lib/prisma.ts:7-11`
- **Popis:** PrismaClient se instancuje jen s `log`, bez pool/datasource konfigurace. Pool se řídí výhradně `?connection_limit=` v `DATABASE_URL` — jen doporučeno v checklistu, nevynuceno. Hromadný reflow běží v tx až 30 s (routes mapují `P2028`→503, tzn. scénář nastává).
- **Důkaz:**
```ts
// prisma.ts:9-11 — jen log, žádný pool
new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["error","warn"] : ["error"] });
```
- **Dopad:** Provozní — souběh reflow + běžné mutace může vyčerpat pool → 503/latence.
- **Ověření:** `NEOVĚŘENO` (prod DATABASE_URL) — ověřit na serveru `grep connection_limit .env`. [V: POTVRZENO absence v kódu.]
- **Návrh opravy:** Ověřit prod `.env`; přidat fail-fast log warning při startu, když v produkci `connection_limit` chybí.
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** otázka 3.

### PERF-006 — Migrace `drop_legacy_shift_tables`: DROP TABLE bez migrace dat uvnitř (ztráta při replay ze starého dumpu)
- **Priorita:** `dnes: P2 · při růstu: P2`
- **Kategorie:** migration
- **Umístění:** `prisma/migrations/20260419180000_drop_legacy_shift_tables/migration.sql`
- **Popis:** Migrace bezpodmínečně dropuje 3 legacy tabulky; data se migrovala **samostatným skriptem** `scripts/migrate-to-week-shifts.ts` (není součást migrace). Na produkci proběhlo OK. Riziko: `prisma migrate deploy` na obnově ze staršího dumpu BEZ manuálního skriptu = nenávratná ztráta rozvrhů.
- **Důkaz:** migrace obsahuje jen `DROP TABLE IF EXISTS` + komentář o externím skriptu.
- **Dopad:** Nulový za normálního provozu; reálný jen při disaster recovery ze starého snapshotu.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO; pořadí dropů respektuje FK.]
- **Návrh opravy:** Neopravovat historickou migraci. Zaznamenat do runbooku: „obnova z dumpu < 2026-04-19 vyžaduje nejdřív spustit migrate-to-week-shifts.ts".
- **Pracnost:** S (dokumentace) · **Riziko regrese:** nízké · **Závislosti:** —

### PERF-007 — Žádná retenční politika pro append-only tabulky (AuditLog, Notification)
- **Priorita:** `dnes: P3 · při růstu: P2`
- **Kategorie:** scaling
- **Umístění:** tabulky `AuditLog`, `Notification`; grep `deleteMany` = 0
- **Popis:** Obě tabulky jsou čistě append-only — nikde mazání ani archivace. AuditLog roste nejrychleji (každý drag/resize/split/reflow = 1+ řádek).
- **Důkaz:** `grep auditLog.deleteMany|notification.deleteMany src/` = prázdné.
- **Dopad:** Za rok+ desetitisíce až statisíce řádků → hledání ([PERF-004]) a dashboard agregace rostou; tabulka bez horní hranice.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO.]
- **Návrh opravy:** Retence/archivace (cron mazání > N měsíců nebo přesun do archivní tabulky); Notification mazat přečtené > X dní. Konzultovat compliance/retenci.
- **Pracnost:** M · **Riziko regrese:** nízké · **Závislosti:** [SEC-016] (GDPR retence).

### PERF-008 — `GET /api/notifications`: filesort přes `OR(isRead)` + `ORDER BY isRead` (minor)
- **Priorita:** `dnes: P3 · při růstu: P3` · **Umístění:** `src/app/api/notifications/route.ts:74-78`
- **Popis:** `OR` na `isRead` + `ORDER BY isRead` → `Using filesort`, ale `take: 50` drží pracovní set malý. EXPLAIN `type: range`, rows 3.
- **Ověření:** `OVĚŘENO` (EXPLAIN). · **Návrh:** ponechat; případně rozdělit na 2 dotazy bez `OR`. · **Pracnost:** S · **Riziko:** nízké.

### PERF-009 — `Block` self-FK `ON DELETE SET NULL` → tiché rozbití split/recurrence skupin
- **Priorita:** `P3` · **Umístění:** `prisma/schema.prisma:78-82` (SHOW CREATE potvrzuje `ON DELETE SET NULL`)
- **Popis:** Smazání root bloku split/recurrence skupiny nastaví potomkům `splitGroupId`/`recurrenceParentId` na NULL → skupina se tiše rozpadne bez auditní stopy. (`ReservationAttachment`/`BlockNote` mají správně CASCADE.)
- **Ověření:** `OVĚŘENO` (SHOW CREATE). · **Návrh:** ověřit záměr; logovat rozpad skupiny do AuditLogu při DELETE root. · **Pracnost:** S · **Riziko:** nízké.

### PERF-010 — Migrace `add_print_minutes`: full-table UPDATE backfill (aditivní, bezpečné)
- **Priorita:** `dnes: P3 · při růstu: P2` · **Umístění:** `prisma/migrations/20260702093854_add_print_minutes_and_bypass/migration.sql:6`
- **Popis:** 2 aditivní sloupce + `UPDATE Block SET printMinutes=TIMESTAMPDIFF(...) WHERE type='ZAKAZKA'` (bez indexu na `type`). Datově bezpečné, jen výkonově roste.
- **Ověření:** `OVĚŘENO`. · **Návrh:** nic k opravě; budoucí backfilly nad velkou tabulkou dávkovat (`LIMIT`). · **Pracnost:** S · **Riziko:** nízké.

---

# ARCH — Architektura (9 nálezů)

> Jádro architektury je zdravé (ověřeno): Prisma se z Reactu nevolá přímo, žádný `.server.ts` modul neprosakuje do klienta, scheduling logika je acyklický DAG, RSC boundary správná, `getSession()` uniformní. Problém je koncentrace v prezentační vrstvě + nedotažená konzistence napříč API.

### ARCH-001 — `TimelineGrid` je god-component mísící prezentaci s datovou/mutační vrstvou
- **Priorita:** `P1` (architektura/údržba)
- **Kategorie:** god-component
- **Umístění:** `src/app/_components/TimelineGrid.tsx` (4163 ř., **13 fetch mutací**, ~55 props, 19 useState)
- **Popis:** Komponenta prezentovaná jako „vizuální grid" přímo provádí serverové mutace bloků (split PUT+POST, resize PUT, DTP data PUT). Prezentační vrstva zná HTTP kontrakt (`bypassScheduleValidation`, `resolveChain`, payload tvary). Mutace bloků existují na dvou místech (TimelineGrid i PlannerPage).
- **Důkaz:**
```ts
// TimelineGrid.tsx:3002 — "vizuální grid" dělá split tail POST
const res2 = await fetch("/api/blocks", { method: "POST", body: JSON.stringify({ ...tailPayload, resolveChain: true }) });
```
- **Dopad:** Dvojí údržba HTTP kontraktu; komponenta netestovatelná bez API; ~55 props = extrémní coupling.
- **Ověření:** `OVĚŘENO`. [V: **KOREKCE** — 13 fetch volání, ne 9.]
- **Návrh opravy:** Vyzvednout mutace (split/resize/DTP) do sdílené vrstvy — buď callback-props do PlannerPage, nebo tenký klientský data-modul `src/lib/blockMutations.ts`, který jediný zná HTTP kontrakt. TimelineGrid pak jen renderuje a hlásí intenty.
- **Pracnost:** L · **Riziko regrese:** vysoké · **Závislosti:** koordinovat s [REDU-004] (extrakce téhož souboru), [ARCH-007].

### ARCH-002 — `PlannerPage` orchestrátor kumuluje neúnosný počet zodpovědností
- **Priorita:** `P1` (architektura/údržba)
- **Kategorie:** god-component
- **Umístění:** `src/app/_components/PlannerPage.tsx` (4359 ř., 84 useState, 20 useEffect, 22 useRef, 48 fetch)
- **Popis:** Jediná komponenta drží veškerý planner state, SSE sync, 48 fetch cest, clipboard flow, DnD, lasso. Prezentace + datová orchestrace + business rozhodnutí v jednom souboru.
- **Důkaz:** `grep -c` potvrzeno (84 useState, 48 fetch).
- **Dopad:** Kognitivní zátěž; vysoké riziko regrese (84 stavů se ovlivňuje); nemožnost izolovaného testu.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO (4359/84/48).]
- **Návrh opravy:** Extrahovat kohezní domény do custom hooků: `usePlannerData`, `usePlannerSSE`, `useClipboard`, `useBlockMutations`. Komponenta jen skládá hooky a renderuje.
- **Pracnost:** L · **Riziko regrese:** vysoké · **Závislosti:** koordinovat s [REDU-003].

### ARCH-003 — Kanonický doménový typ `Block` je definován uvnitř prezentační komponenty (lib na ní závisí)
- **Priorita:** `P1` (architektura)
- **Kategorie:** layer-boundary
- **Umístění:** `src/app/_components/TimelineGrid.tsx:79` (`export type Block`)
- **Popis:** Nejdůležitější doménový typ není v `src/lib`, ale uvnitř „use client" komponenty. **Ověření odhalilo horší inverzi, než se čekalo:** typ importuje 7 souborů včetně **library kódu** `src/lib/pasteTarget.ts:1` a `src/lib/splitHelpers.ts:1` — tj. `src/lib` závisí na prezentační komponentě. Navíc `ReportView.tsx:11` má **vlastní duplicitní `interface Block`** (nesdílí ho).
- **Důkaz:**
```ts
// src/components/BlockDetail.tsx:7
import { type Block } from "@/app/_components/TimelineGrid";
// src/lib/pasteTarget.ts:1 — LIB importuje typ z komponenty (obrácená závislost)
```
- **Dopad:** Změna gridu rozbije typování lib/reportů; nemožnost sdílet typ se serverem; riziko divergence `serializeBlock` (wire tvar) vs. klientský `Block` (+ duplicitní def v ReportView).
- **Ověření:** `OVĚŘENO`. [V: **stronger** — lib→component inverze + duplicitní def v ReportView.]
- **Návrh opravy:** Přesunout `Block` do `src/lib` (ideálně odvodit z `serializeBlock` přes `ReturnType<typeof serializeBlock>` jako single source of truth); sjednotit ReportView na tentýž typ.
- **Pracnost:** M · **Riziko regrese:** střední · **Závislosti:** —

### ARCH-004 — Chybí jednotný vzor chybových odpovědí — `AppError` používá jen 16/43 rout
- **Priorita:** `P2` · **Kategorie:** consistency · **Umístění:** 27 route.ts bez `AppError` (např. `reservations`, `codebook`, `job-presets`, `report/dashboard`)
- **Popis:** CLAUDE.md definuje `AppError`/`isAppError` jako povinný; realita 16/43. Zbytek řeší chyby ad-hoc přes ruční `NextResponse.json({error}, {status})`.
- **Důkaz:** `grep -rl AppError src/app/api --include=route.ts | wc -l` = 16; celkem 43.
- **Dopad:** Nekonzistentní chybové kódy/hlášky; catch bloky se různí; drift se prohlubuje.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO 16/43.]
- **Návrh opravy:** Zavést wrapper `withApiHandler(fn)` (auth → try/catch → `isAppError` mapping → jednotná response) a postupně jím obalit routy.
- **Pracnost:** M · **Riziko regrese:** nízké · **Závislosti:** souvisí [QUAL-001].

### ARCH-005 — Audit-logování není konzistentní — celé domény mutací nelogují do `AuditLog`
- **Priorita:** `P2` · **Kategorie:** consistency · **Umístění:** `reservations/[id]`, `admin/users`, `codebook`, `job-presets`, `printers`, `company-days`, `notifications`
- **Popis:** `AuditLog.create` je jen v `blocks*` + `machine-week-shifts` (8 souborů). Změny stavu rezervace, CRUD uživatelů/číselníků/presetů/tiskáren/odstávek nezapisují audit; část běží i mimo `$transaction`.
- **Důkaz:** `grep -rln auditLog.create src/app/api` = jen blocks* + machine-week-shifts.
- **Dopad:** Chybí auditní stopa u citlivých operací; nekonzistence vůči vlastnímu standardu.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO. Souvisí [OBS-002].]
- **Návrh opravy:** Rozhodnout scope auditu (buď „každá mutace", nebo explicitně zúžit standard v CLAUDE.md) a dorovnat chybějící routy — audit do stejné `$transaction`.
- **Pracnost:** M · **Riziko regrese:** nízké · **Závislosti:** [OBS-002].

### ARCH-006 — Stavový automat rezervací je zapečený v route handleru (bez lib/testu)
- **Priorita:** `P2` · **Kategorie:** layer-boundary · **Umístění:** `src/app/api/reservations/[id]/route.ts:101-175+`
- **Popis:** Kompletní přechodový automat (povolené přechody, guardy `if (status !== "SUBMITTED")`) žije v HTTP handleru, ne v `src/lib`. Na rozdíl od bloků (logika v lib, testovaná) nemá lib protějšek ani test.
- **Důkaz:** inline `if (action === "accept") { if (reservation.status !== "SUBMITTED") {...} }`.
- **Dopad:** Přechodová pravidla netestovatelná bez HTTP; snadná nekonzistence s UI.
- **Ověření:** `OVĚŘENO`.
- **Návrh opravy:** Extrahovat čistou `reservationTransition(current, action, actorRole)` do `src/lib/reservationStateMachine.ts` (testovatelná); handler jen orchestruje DB+SSE+audit.
- **Pracnost:** M · **Riziko regrese:** střední · **Závislosti:** [TEST-003].

### ARCH-007 — `blocks/[id]/route.ts` přetížený handler (704 ř.) s in-line doménovou orchestrací
- **Priorita:** `P2` · **Kategorie:** god-component · **Umístění:** `src/app/api/blocks/[id]/route.ts:1-704`
- **Popis:** PUT řeší role field-filter, bypass parsing, `validateAndComputeEnd`, split-shared-fields propagaci, chain push, notes gating, SSE broadcast + inline `SPLIT_SHARED_FIELDS`. Duplicitní bypass/flag parsing vůči POST a batch.
- **Důkaz:** 704 ř., inline `SPLIT_SHARED_FIELDS` (ř. 56), komentáře-varování typu „NIKDY sem nepřidávat startTime".
- **Dopad:** Vysoká hustota rozhodovací logiky → náchylné na regrese; duplicita vůči POST/batch.
- **Ověření:** `OVĚŘENO`.
- **Návrh opravy:** Vyzdvihnout orchestrační jádro PUT (field filter + bypass + split propagace) do `src/lib/blockUpdate.server.ts` sdíleného mezi POST/PUT/batch.
- **Pracnost:** L · **Riziko regrese:** vysoké · **Závislosti:** souvisí [TEST-002] (field-filter extrakce odemkne test).

### ARCH-008 — Duplicitní inline autorizační logika napříč handlery místo sdíleného helperu (security-relevant)
- **Priorita:** `P3` (ale security-relevant) · **Kategorie:** consistency · **Umístění:** napříč `src/app/api/**/route.ts`
- **Popis:** Autorizace řešena ručně opakovanými výrazy (`!== "ADMIN"`, `.includes([...])`, `=== "OBCHODNIK" && ownerId !== session.id`) v každém handleru; žádný `requireRole()` helper. Vzory se drobně liší. Terén, kde vznikají autorizační mezery (middleware zde není záchytná síť — viz [DEP-001]).
- **Důkaz:** `reservations/route.ts:8` `ALLOWED_ROLES` vs. `blocks/[id]/route.ts:84` inline `["ADMIN","PLANOVAT"].includes`.
- **Dopad:** Roztříštěná autorizace → obtížný audit „kdo smí co"; snadné opomenutí v nové routě.
- **Ověření:** `OVĚŘENO`.
- **Návrh opravy:** Sdílené authz helpery v `src/lib/auth.ts` (`requireRole(session, roles)`, `requireSelfOrRole(...)`) vracející `AppError`; použít konzistentně. (Totéž řeší [REDU-001] role konstanty.)
- **Pracnost:** M · **Riziko regrese:** střední · **Závislosti:** [REDU-001], [SEC-015].

### ARCH-009 — Role-gating SSE událostí je logika duplikovaná mezi `events/route.ts` a 13 producenty
- **Priorita:** `P3` · **Kategorie:** coupling · **Umístění:** `src/app/api/events/route.ts:53-106` vs. 13× `emitSSE`
- **Popis:** Filtrace (`canReceive`) a notes-stripping jsou v `events/route.ts`, ale znalost eventů + payload tvarů je roztroušená přes 13 emitujících rout. Přidání event typu = 3 synchronní zásahy → riziko, že nový event unikne role-filtru.
- **Ověření:** `OVĚŘENO`. · **Návrh:** centralizovat kontrakt eventů (typ + role + strip) u `eventBus.ts`. · **Pracnost:** M · **Riziko:** nízké.

---

# REDU — Redundance a délka souborů (12 nálezů)

> Pozn.: [REDU-001/003/004] popisují stejné soubory jako [ARCH-008/002/001] z pohledu „jak vyjmout" — při opravě koordinovat, aby se stejný soubor neupravoval dvakrát.

### REDU-001 — Role-list `["ADMIN","PLANOVAT"]` inline 38× (žádná sdílená konstanta) → `roles.ts`
- **Priorita:** `P2` · **Kategorie:** dup-logic · **Umístění:** 38 výskytů (middleware:63,71; blocks/route:48; blocks/[id]:84,598; batch:24; reflow:28; shift-assignments 4×; PlannerPage:522,3148,3174; …)
- **Popis:** Množina „plánovacích" rolí ručně na 38 místech + varianty `["ADMIN","PLANOVAT","OBCHODNIK"]` a plný seznam. Změna oprávnění vyžaduje projít desítky souborů → bezpečnostní riziko opomenutí.
- **Ověření:** `OVĚŘENO`.
- **Návrh opravy:** `src/lib/roles.ts` s `PLANNER_ROLES`, `RESERVATION_ROLES`, `ALL_ROLES` + `isPlanner()`. **Pozor: middleware běží v Edge runtime — soubor bez Node-only importů.**
- **Pracnost:** M · **Riziko regrese:** nízké (čistá konstanta) · **Závislosti:** [ARCH-008] (tentýž refaktor).

### REDU-002 — Lokální kopie `const MACHINES` ve 3 komponentách navzdory `src/lib/machines.ts`
- **Priorita:** `P2` · **Kategorie:** dup-logic · **Umístění:** `TimelineGrid.tsx:74`, `MachineWorkHoursWeek.tsx:34`, `ShiftRoster.tsx:42`
- **Popis:** Konsolidace (CLAUDE.md etapa 7) proběhla jen server-side (5 API routes); 3 klientské komponenty mají vlastní kopii. Přidání XL_107 by minulo grid + admin.
- **Ověření:** `OVĚŘENO`. · **Návrh:** nahradit importem `import { MACHINES } from "@/lib/machines"`. · **Pracnost:** S · **Riziko:** nízké.

### REDU-003 — `PlannerPage.tsx` (4359 ř.) — vyjmout paste/company-day/note klastry
- **Priorita:** `P2` · **Kategorie:** file-size · **Umístění:** paste 2513-2734, company-day 1874-1896, note 1240-1300
- **Popis:** Tři tematicky uzavřené klastry s minimem sdíleného stavu (ref-only). Kandidáti: `src/hooks/usePasteBlocks.ts`, `src/lib/companyDayClient.ts`, `src/hooks/useBlockNotes.ts`.
- **Ověření:** `OVĚŘENO`. · **Návrh:** viz umístění. · **Pracnost:** M · **Riziko:** střední (klastry drží refy+toast — stale closure) · **Závislosti:** [ARCH-002] (tentýž soubor).

### REDU-004 — `TimelineGrid.tsx` (4163 ř.) — vyjmout czechHolidays, InlineDatePicker, chip helpery
- **Priorita:** `P2` · **Kategorie:** file-size · **Umístění:** svátky 304-341 (pure funkce), InlineDatePicker 591-712, chip helpery 534-848
- **Popis:** Izolovatelné jednotky bez závislosti na grid logice. Kandidáti: `src/lib/czechHolidays.ts` (+test — výpočet Velikonoc), `src/components/InlineDatePicker.tsx`, `src/lib/blockChipColors.ts` + `src/components/ProductionChips.tsx`.
- **Ověření:** `OVĚŘENO`. · **Návrh:** viz umístění. · **Pracnost:** M · **Riziko:** střední (chip barvy vizuálně citlivé) · **Závislosti:** [ARCH-001].

### REDU-005 — Prague date-formátování (`fmtDate`) duplikováno v ~4 komponentách navzdory `dateUtils.ts`
- **Priorita:** `P2` · **Kategorie:** dup-logic · **Umístění:** `ReservationDetail.tsx:20`, `ReservationList.tsx:35`, `TimelineGrid.tsx:501,513`, `ShiftCascadeDialog.tsx:15`, `AuditLogPanel.tsx:843+` (kanonické: `dateUtils.ts:213-229`)
- **Popis:** `dateUtils.ts` má hotové `formatPragueDate*`, ale ≥4 komponenty mají vlastní `fmtDate` s ručním `toLocaleString`.
- **Ověření:** `NEOVĚŘENO` (přesná shoda formátů) — ověřit, že cílový formát odpovídá některému `formatPrague*`. · **Návrh:** nahradit importy; chybějící kombinace přidat do `dateUtils.ts`. · **Pracnost:** S-M · **Riziko:** nízké.

### REDU-006 — Shifted-refetch Prisma dotaz + SSE emit skoro identický ve 3 blocks routes
- **Priorita:** `P2` · **Kategorie:** dup-query · **Umístění:** `blocks/route.ts:352-361`, `blocks/[id]/route.ts:555-565`, `batch/route.ts:255-264`
- **Popis:** Tři cesty po auto-shiftu spouští prakticky totožný `findMany` + `include {Reservation, notes}` + `.map(serializeBlock)` + `emitSSE`. `include` shape se opakuje 6×.
- **Ověření:** `OVĚŘENO`. · **Návrh:** `BLOCK_SSE_INCLUDE` konstanta + helper `refetchAndBroadcastShifted(prisma, ids, sourceUserId)` do `src/lib/blockBroadcast.ts`. · **Pracnost:** M · **Riziko:** střední (notes gating citlivý).

### REDU-007 — `AdminDashboard.tsx` (1478 ř.) — sekce jsou už samostatné funkce, přesunout do souborů
- **Priorita:** `P3` · **Umístění:** `UsersSection`:292, `CodebookSection`:770, `PresetSection`:1283
- **Návrh:** Přesunout do `src/components/admin/{UsersSection,CodebookSection,PresetSection}.tsx`. · **Pracnost:** M · **Riziko:** nízké.

### REDU-008 — Kalendářový month-grid duplikován: `DatePickerField` vs `InlineDatePicker`
- **Priorita:** `P3` · **Umístění:** `DatePickerField.tsx:87-96` (CELL=36) vs `TimelineGrid.tsx:591-712` (CELL=30)
- **Ověření:** `NEOVĚŘENO` (sjednotitelnost API). · **Návrh:** extrahovat sdílený `MonthGrid` core do `src/components/MonthGrid.tsx`. · **Pracnost:** M · **Riziko:** střední.

### REDU-009 — `src/App.jsx` prázdný Vite/CRA relikt (0 bytů, 0 importů)
- **Priorita:** `P3` · **Umístění:** `src/App.jsx`
- **Ověření:** `OVĚŘENO` (0 bytů). · **Návrh:** smazat (+ SQLite relikty `dev.db`, `vojta-export.sql`, `export-to-mysql.*` — viz [DEP-005]). · **Pracnost:** S · **Riziko:** nízké.

### REDU-010 — Prisma model `ExpeditionZavoz` nepoužitý (0 referencí v kódu)
- **Priorita:** `P3` · **Umístění:** `prisma/schema.prisma:130`
- **Popis:** 0 referencí v `src/` (ověřeno). DB má 1 řádek (sonda). Aktuální expedice běží přes `Block.expedition*` + `ExpeditionManualItem`.
- **Ověření:** `OVĚŘENO` kód; `NEOVĚŘENO` prod data. · **Návrh:** pokud prod tabulka prázdná/nepoužívaná → drop migrací; jinak označit deprecated. · **Pracnost:** S (kód)/M (migrace + ověření prod) · **Riziko:** střední (schema/DB — záloha dle prod-backup-first).

### REDU-011 — `BlockEdit.tsx` (1413 ř., 43× useState) — štěpitelný po doménových sekcích
- **Priorita:** `P3` · **Umístění:** data 131-142, materiál 144-150, pantone/barvy/lak 153-165
- **Návrh:** Vyjmout sub-formuláře `src/components/block-edit/{DataStatusFields,MaterialFields,PantoneFields}.tsx`, nebo `useReducer`. · **Pracnost:** M-L · **Riziko:** střední.

### REDU-012 — Prázdný adresář `src/app/api/events-test/` (zbytek debug scaffoldingu)
- **Priorita:** `P3` · **Umístění:** `src/app/api/events-test/` (bez route.ts)
- **Ověření:** `OVĚŘENO`. · **Návrh:** smazat prázdný adresář. · **Pracnost:** S · **Riziko:** nízké.

---

# QUAL — Kvalita kódu (3 nálezy)

### QUAL-001 — Expedition route obchází `AppError` standard — 11× `throw new Error("PREFIX")` jako control-flow
- **Priorita:** `P1`
- **Kategorie:** error-handling
- **Umístění:** `src/app/api/blocks/[id]/expedition/route.ts:45,46,67,103,106,127,132,142,147,174,199` + catch 73-84, 207-228
- **Popis:** Handler používá zakázaný string-prefix pattern (`throw new Error("NOT_FOUND")`, `"INVALID_TYPE"`, …) a v catch mapuje `error.message === "..."` na HTTP status. CLAUDE.md tento vzor explicitně zakazuje. Route neimportuje `AppError`. Je to jediná route s tímto vzorem takto plošně (+1 ojedinělý `RESERVATION_NOT_AVAILABLE` v `blocks/route.ts:303`).
- **Důkaz:**
```ts
if (!currentBlock) throw new Error("NOT_FOUND");
} catch (error) { if (error.message === "NOT_FOUND") return NextResponse.json({...}, { status: 404 }); }
```
- **Dopad:** Nekonzistence se standardem; křehké error routing (string equality); produkčně nasazený `/expedice` modul.
- **Ověření:** `OVĚŘENO`. [V: **KOREKCE** — 11×, ne 12×. Ironicky tentýž soubor přitom správně zapisuje `auditLog.create` (dodržuje jeden standard, ignoruje druhý).]
- **Návrh opravy:** Nahradit `throw new Error("PREFIX")` za `throw new AppError(code, message)` a catch přepsat na `isAppError` větev (vzor `me/preferences`).
- **Pracnost:** M · **Riziko regrese:** střední (mění error-mapping produkční route — projít všechny stavy publish/unpublish/reorder) · **Závislosti:** [ARCH-004].

### QUAL-002 — `console.error` místo `logger` v `getSession` (jediné porušení standardu na serveru)
- **Priorita:** `P2`
- **Kategorie:** error-handling / logging-standard
- **Umístění:** `src/lib/auth.ts:81`
- **Popis:** `getSession` v catch loguje selhání JWT verifikace přes `console.error`, přestože CLAUDE.md nařizuje `logger`. Jediný `console.*` v serverovém kódu (ověřeno grepem). Spouští se při každém neplatném/expirovaném tokenu → nestrukturovaný log noise v produkci. Logovaný `error` je jose verifikační chyba — **neobsahuje token/secret**.
- **Důkaz:**
```ts
// auth.ts:81
console.error("Session verification failed", error);
```
- **Dopad:** Ztráta strukturovaného logu; expirace tokenu (běžný stav) generuje `error`-level šum.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO — jediný console.* v serverových cestách; obsahuje jose error, ne secret.]
- **Návrh opravy:** `logger.warn("[auth] session verification failed", { reason: (error as Error).message })` — warn, ne error (expirace není chyba serveru); jen zpráva, ne celý objekt.
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** —

### QUAL-003 — Jediný `TODO` v `src/` (dokumentární, ne bug)
- **Priorita:** `P3` · **Umístění:** `src/lib/scheduleSlotFinder.ts:31`
- **Popis:** `TODO(Plán 4)` popisuje vědomý stálý stav (duration-based finder pro preview/ne-ZAKAZKA). Není bug. Jediný TODO/FIXME/HACK/XXX v celém `src/`.
- **Ověření:** `OVĚŘENO`. · **Návrh:** přeformulovat na trvalý komentář (odstranit `TODO(`). · **Pracnost:** S · **Riziko:** nízké.

---

# OBS — Observabilita a provoz (7 nálezů)

> Pozitivně ověřeno: `console.*` v API = 0 (kromě [QUAL-002]); žádný leak `error.message`/stack do produkce; heslo/token/celé tělo/IP se NElogují; SSE per-connection stripuje poznámky.

### OBS-001 — Chybí health-check / readiness endpoint a jakákoli metrika
- **Priorita:** `P1`
- **Kategorie:** missing-health
- **Umístění:** `src/app/api/` (žádný `health`/`ready`/`status`/`metrics`)
- **Popis:** `find src/app/api -type d | grep -iE health|ready|status|metric|ping` = prázdné. App běží pod PM2, ale nemá endpoint ověřující živost procesu ani dostupnost DB → nelze externí monitoring, readiness probe, ani post-deploy smoke test.
- **Důkaz:** endpoint neexistuje (find prázdný).
- **Dopad:** Nulová automatizovaná viditelnost stavu; výpadek/DB odpojení se zjistí až stížností.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO.]
- **Návrh opravy:** `GET /api/health` (liveness `{ok:true,ts}`) + `GET /api/health/ready` (readiness `prisma.$queryRaw\`SELECT 1\``, na chybu 503). Bez auth gate (nebo interní token).
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** —

### OBS-002 — Auditní stopa nepokrývá bezpečnostní události (login/logout/změny uživatelů a rolí)
- **Priorita:** `P1`
- **Kategorie:** audit-gap
- **Umístění:** `auth/login/route.ts`, `auth/logout/route.ts`, `admin/users/route.ts`, `admin/users/[id]/route.ts`
- **Popis:** `AuditLog.create` je jen v `blocks*` + `machine-week-shifts`. Přihlášení (úspěch/selhání), odhlášení a mutace uživatelů (vytvoření, změna role, reset hesla) **nemají success-path audit ani `logger.info`**. Login fail vrací jen 401 bez logu.
- **Důkaz:** `grep auditLog src/app/api/auth` = 0; login/logout bez logu.
- **Dopad:** Bez trvalého záznamu přihlášení a změn oprávnění není forenzní stopa; nelze vyšetřit incident ani doložit, kdo změnil roli/heslo. GDPR/bezpečnost.
- **Ověření:** `OVĚŘENO`. [V: **KOREKCE** — „NIKAM se nelogují" je příliš silné: `admin/users` mají `logger.error` v CATCH větvích (error-path). Přesná kritika: **chybí success-path audit** bezpečnostních událostí; login/logout genuinely bez logu.]
- **Návrh opravy:** Zapisovat `AuditLog` (nebo strukturovaný `logger.info`) pro login success/fail (s username, bez hesla), logout a všechny `admin/users` mutace (`USER_CREATE`/`ROLE_CHANGE`/`PASSWORD_RESET`). U mutací uživatelů do stejné `$transaction`.
- **Pracnost:** M · **Riziko regrese:** nízké · **Závislosti:** [ARCH-005].

### OBS-003 — PM2 config bez restart policy, log rotace a `max_memory_restart`
- **Priorita:** `P2`
- **Kategorie:** missing-health
- **Umístění:** `ecosystem.config.cjs:11-27`
- **Popis:** PM2 app blok má jen `name/cwd/script/args/env`. Chybí `autorestart`, `max_memory_restart` i log rotace. Logger v produkci píše JSON na stdout → PM2 akumuluje `~/.pm2/logs/*.log` bez limitu → neomezený růst (zaplnění disku). Bez `max_memory_restart` memory leak (SSE `connections` mapa) neshodí proces.
- **Důkaz:** config nezmiňuje autorestart/rotaci.
- **Dopad:** Provoz — neomezený růst logů, žádný safety-net restart.
- **Ověření:** `NEOVĚŘENO` (globální `pm2-logrotate` na serveru?) — potvrdit.
- **Návrh opravy:** Doplnit `autorestart: true`, `max_memory_restart: "512M"`, explicitní `error_file`/`out_file`, nainstalovat + nakonfigurovat `pm2-logrotate`.
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** —

### OBS-004 — Žádný globální error boundary ani `unhandledRejection`/`uncaughtException` handler
- **Priorita:** `P2`
- **Kategorie:** error-leak
- **Umístění:** `src/app/` (chybí `global-error.tsx`/`error.tsx`), `src/instrumentation.ts` (chybí)
- **Popis:** Žádný App Router error boundary ani `process.on(...)`. Neodchycené async rejection / chyba v render stromu jde defaultní cestou Nextu, nezaloguje se přes `logger`; neodchycený `unhandledRejection` může shodit proces bez strukturovaného záznamu.
- **Důkaz:** `find src -iname error.tsx -o -iname global-error.tsx` + `grep unhandledRejection src` = prázdné.
- **Dopad:** Chyby mimo API handlery nejdou přes logger; uživatel vidí neupravenou chybovou stránku.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO.]
- **Návrh opravy:** `src/app/global-error.tsx` (lokalizovaná stránka + `logger.error`) + `src/instrumentation.ts` s `process.on("unhandledRejection"/"uncaughtException")` → `logger.error` (Next 16 podporuje `instrumentation` hook).
- **Pracnost:** M · **Riziko regrese:** nízké · **Závislosti:** —

### OBS-005 — `username` v provozních lozích bez retenční politiky (GDPR)
- **Priorita:** `P3` · **Umístění:** `shift-assignments/route.ts:95`, `printers/route.ts:42`, `printers/[id]/route.ts:32,60`, `shift-assignments/[id]/route.ts:19`
- **Popis:** `logger.info(..., { by: user.username })` zapisuje osobní údaj do trvalého logu; logger nemaskuje. Legitimní účel (accountability), ale bez retence/rotace ([OBS-003]) přežívá neomezeně. (Heslo/token/body/IP se nelogují.)
- **Ověření:** `OVĚŘENO`. · **Návrh:** definovat retenci přes rotaci; zvážit `user.id` místo username; zdokumentovat v GDPR evidenci. · **Pracnost:** S · **Riziko:** nízké · **Závislosti:** [OBS-003], [SEC-016].

### OBS-006 — SSE `enqueue` chyby se tiše polykají bez logu
- **Priorita:** `P3` · **Umístění:** `src/app/api/events/route.ts:157-159, 180-182`
- **Popis:** `try { controller.enqueue(...) } catch { if (cleanup) cleanup() }` — prázdný catch. Pro odpojený klient korektní, ale jiný problém (serializace, backpressure) je neviditelný.
- **Ověření:** `OVĚŘENO`. · **Návrh:** `logger.warn("[sse] enqueue failed, closing", { userId })` (rozlišit „client gone" od jiných chyb). · **Pracnost:** S · **Riziko:** nízké.

### OBS-007 — `logger` nemaskuje citlivá pole (žádný redaction denylist — preventivní)
- **Priorita:** `P3` · **Umístění:** `src/lib/logger.ts:12-15`
- **Popis:** `serializeArg` rozbalí jen `Error`; jiný objekt jde do logu 1:1. Žádný redaction filtr (`password`/`token`/`secret`). Dnes žádné citlivé volání (ověřeno), ale budoucí `logger.error("...", userObject)` s `passwordHash` by hash tiše zapsal.
- **Ověření:** `OVĚŘENO`. · **Návrh:** rekurzivní redaction denylistu klíčů → `"[redacted]"`. · **Pracnost:** S · **Riziko:** nízké.

---

# TEST — Testy (9 nálezů)

> Suite reálně **366/366 zelená** (1,25 s, ověřeno během). 28 souborů testuje čisté `src/lib` funkce; serverové testy mockují jen Prismu a pouští reálnou logiku (správný vzor, ne false-positive). **Kritická mezera: celá auth/authz vrstva netestovaná.** Chybějící test = P1 RIZIKO (ne P0 blocker — není živý defekt; překalibrováno z původního P0 od TEST agenta).

### TEST-001 — `auth.ts` (JWT sign/verify, `parseJwtPayload`, `getCookieOptions`) bez jediného testu
- **Priorita:** `P1`
- **Kategorie:** missing-critical
- **Umístění:** `src/lib/auth.ts:23,42,51,74`
- **Popis:** Celá session vrstva netestovaná. `parseJwtPayload` je čistá funkce (hází na neplatné role/id/username) — testovatelná okamžitě. `getCookieOptions` má bezpečnostně kritickou větev (`ALLOW_HTTP_SESSION` throw). Jediná bariéra mezi padělaným JWT a session objektem.
- **Ověření:** `OVĚŘENO` (chybí v seznamu test souborů). [V: POTVRZENO.]
- **Návrh opravy:** `src/lib/auth.test.ts`: round-trip `createSessionToken`→verify→`parseJwtPayload` per role; `parseJwtPayload` hází na neznámé roli/chybějícím id/ne-stringovém username; `getCookieOptions` throw když production+ALLOW_HTTP_SESSION. (`getSession`/`createSession` závisí na `next/headers` → integrační.)
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** —

### TEST-002 — Role field-filter v `blocks/[id]` PUT netestován + inline (nutný refaktor pro testovatelnost)
- **Priorita:** `P1`
- **Kategorie:** missing-critical / untestable
- **Umístění:** `src/app/api/blocks/[id]/route.ts:83-123`
- **Popis:** Klíčové místo authz zápisu (per role se staví `allowed` objekt polí; DTP=datová, MTZ=materiálová, ADMIN/PLANOVAT=vše; `printMinutes` se čte z `allowed`, ne z body — bezpečnostní fix etapy 8). Logika je **inline v handleru**, ne v čisté funkci → netestovatelná bez celého stacku. Přidání pole do `Block` a zapomenutí v allowlistu nezachytí žádný test.
- **Důkaz:** inline `if (["ADMIN","PLANOVAT"].includes(role)) allowed = body; else if (role === "DTP") allowed = {...}`.
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO — inline, bez testu; kontrast s testovaným `blockNotePermissions.ts`.]
- **Návrh opravy:** Refaktorovat allowlist do čisté funkce `src/lib/filterEditableFields(role, body)` a pokrýt testem (DTP body s machine/type → propadne; MTZ → jen materiál; bypass flagy vždy vymazané; `printMinutes` u DTP/MTZ neprojde).
- **Pracnost:** M · **Riziko regrese:** střední (produkční mutační cesta) · **Závislosti:** [ARCH-007], [TEST-009].

### TEST-003 — 43 route handlerů (authz, IDOR, validace vstupu) — nula integračních testů
- **Priorita:** `P1`
- **Kategorie:** missing-critical
- **Umístění:** celý `src/app/api/**/route.ts`
- **Popis:** Middleware gate-uje jen podmnožinu cest, většinu authz vynucuje každý handler sám (~163 inline role-checků). Žádný route test to neověřuje. Middleware bypass CVE v next@16.1.6 ([DEP-001]) tuto vrstvu dělá o to důležitější.
- **Ověření:** `OVĚŘENO` (žádný `route.test.ts`). [V: POTVRZENO.]
- **Návrh opravy:** Integrační testy (handler jde volat přímo jako `POST(req)` s `mock.module` na `@/lib/auth` `getSession` + Prisma). Prioritně: `blocks/[id]` PUT per role, `admin/users` (jen ADMIN), `reservations/[id]/attachments/[attachmentId]` IDOR (cizí reservationId → 403/404), `blocks/[id]/notes`.
- **Pracnost:** L · **Riziko regrese:** nízké (jen přidání testů) · **Závislosti:** [TEST-009] (extrakce authz do lib usnadní).

### TEST-004 — Login flow (rate limit, user-enumeration, form/JSON parsing) bez testu
- **Priorita:** `P1`
- **Kategorie:** missing-critical
- **Umístění:** `src/app/api/auth/login/route.ts:8-66`
- **Popis:** Netriviální větvení (form-urlencoded vs JSON, prázdné údaje → 400, rate limit → 429, špatné údaje → 401) + short-circuit `!user || bcrypt.compare` (user-enumeration timing oracle). Nic netestováno.
- **Ověření:** `OVĚŘENO`.
- **Návrh opravy:** Integrační test s `mock.module` na prisma+auth: chybějící údaje→400; neexistující user→401; 11. pokus→429+`Retry-After`; form i JSON cesta.
- **Pracnost:** M · **Riziko regrese:** nízké · **Závislosti:** [TEST-005].

### TEST-005 — Rate limiter (`rateLimiter.ts`) — čistá funkce, snadno testovatelná, přesto bez testu
- **Priorita:** `P2`
- **Kategorie:** missing-critical
- **Umístění:** `src/lib/rateLimiter.ts:17,33`
- **Popis:** Token-bucket je bezpečnostní kontrola (login, week-shifts, reflow) a čistá logika, přesto bez testu. Off-by-one v limitu / špatný reset okna rozbije brute-force obranu bez záchytu CI. **Ironie: bezpečnostní kód bez testu, zatímco méně kritický `blockNotePermissions.ts` testovaný JE.**
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO.]
- **Návrh opravy:** `src/lib/rateLimiter.test.ts`: N-tý povolen, (N+1) zamítnut s `retryAfterSeconds>0`, reset po `windowMs`, dva `key`/`name` nezávislé; `getClientIp` bere první z XFF, fallback x-real-ip, pak "unknown".
- **Pracnost:** S · **Riziko regrese:** nízké · **Závislosti:** —

### TEST-006 — Middleware role gating netestován
- **Priorita:** `P2` · **Umístění:** `src/middleware.ts:13-84`
- **Popis:** Middleware dělá podstatnou část authz (redirecty, 403 pro dashboard/reservations) bez testu. Edge runtime brání přímému unit testu.
- **Ověření:** `NEOVĚŘENO` (zda lze `NextRequest` sestrojit v node:test). · **Návrh:** pokud lze — tabulkový test (role × path → redirect/403/next); pokud ne — vytáhnout čisté jádro `decideAccess(role, pathname)` do lib a otestovat to. · **Pracnost:** M · **Riziko:** střední.

### TEST-007 — Serializační vrstva (`*Serialization.ts`) bez testů (timezone riziko)
- **Priorita:** `P2` · **Umístění:** `blockSerialization.ts`, `reservationSerialization.ts`, `companyDaySerialization.ts`, `blockNoteSerialization.ts`
- **Popis:** `parseNullableCivilDateForDb` (civilní datum → UTC) je datová hranice DB↔klient; MEMORY.md varuje před timezone bugy. Bez testu (na rozdíl od testovaného `dateUtils.ts`).
- **Ověření:** `OVĚŘENO`. · **Návrh:** `blockSerialization.test.ts`: `parseNullableCivilDateForDb` pro null/""/`"2026-07-06"` → `00:00:00.000Z` téhož dne (žádný TZ posun), nevalidní → null. · **Pracnost:** M · **Riziko:** nízké.

### TEST-008 — `workingTime.ts` (start-snap helpery) bez přímého testu
- **Priorita:** `P3` · **Umístění:** `src/lib/workingTime.ts`
- **Popis:** Duration-based snap pro ne-ZAKAZKA/preview bez vlastního testu (nástupce `printTime*` testovaný bohatě).
- **Ověření:** `NEOVĚŘENO` (zda nepřímo přes `scheduleValidation.test.ts`). · **Návrh:** `workingTime.test.ts` s hraničními snapy (mimo směnu, přes půlnoc, skupinový delta). · **Pracnost:** S · **Riziko:** nízké.

### TEST-009 — Systémová bariéra: authz je inline v handlerech, ne v čistých funkcích (root cause netestovatelnosti)
- **Priorita:** `P1` (root cause)
- **Kategorie:** untestable
- **Umístění:** napříč `src/app/api/**/route.ts`; kontrast `src/lib/blockNotePermissions.ts`
- **Popis:** Jediná authz logika vytažená do čisté funkce je `blockNotePermissions.ts` — a je jako jediná dobře pokrytá (12 testů). Zbytek authz (field-filter, per-route gate, admin omezení) žije inline provázaný s `next/server`/Prisma/`next/headers` → jednotkově netestovatelný. **Vzor hodný následování: co je v lib, je otestované.**
- **Ověření:** `OVĚŘENO`. [V: POTVRZENO.]
- **Návrh opravy:** Systematicky vytáhnout authz rozhodnutí do čistých helperů v `src/lib` (`filterEditableFields`, `canAccessRoute`, `canManageUsers`) — každý s tabulkovým testem po vzoru `blockNotePermissions.test.ts`. Odemkne [TEST-002]/[TEST-003] za S-M pracnost.
- **Pracnost:** M · **Riziko regrese:** střední (refaktor produkčních cest — po částech s existující suite jako pojistkou) · **Závislosti:** [ARCH-008], [TEST-002], [TEST-003].

---

## Souhrn počtů

| Kategorie | P0 | P1 | P2 | P3 | Σ |
|---|---|---|---|---|---|
| SEC | 0 (2 podmíněné) | 1 (přísný: 5) | 6 | 10 | 17 |
| DEP | 0 | 2 | 2 | 1 | 5 |
| STAB | 0 | 1 | 3 | 3 | 7 |
| PERF | 0 | 0 (růst: 3) | 3 (růst více) | 4 | 10 |
| ARCH | 0 | 3 | 4 | 2 | 9 |
| REDU | 0 | 0 | 6 | 6 | 12 |
| QUAL | 0 | 1 | 1 | 1 | 3 |
| OBS | 0 | 2 | 2 | 3 | 7 |
| TEST | 0 | 5 | 3 | 1 | 9 |
| **Σ** | **0** | **15** | **30** | **31** | **79** |

*P0 = 0 potvrzených; 2 podmíněné deploymentem/prod DB ([SEC-001], [SEC-008]). Přísný standard zvyšuje část SEC P2→P1 (viz dvojí severity).*
