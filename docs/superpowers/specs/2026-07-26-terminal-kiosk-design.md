# Design: Terminálový kiosk launcher (přepínač Plán ↔ Logica)

**Datum:** 2026-07-26
**Autor:** Vojta + Claude (brainstorm)
**Stav:** Návrh k odsouhlasení
**Souvislosti:** paměť `project_terminal_kiosk.md`, `reference_prod_urls.md`

---

## 1. Kontext a problém

Terminály u tiskových strojů běží aplikaci **Logica** (sběr výrobních dat od italského dodavatele) na `http://192.168.10.214:81/machinepanelhand.aspx?pntid=<id_panelu>`. Terminály jsou v prohlížeči bez lišty (kiosk), takže se operátoři **nemají jak přepnout do našeho výrobního plánu** (`https://planovani.integraf.cz`) a zpět.

Cílem je jednoduchý **launcher**: nahoře pevná lišta se dvěma tlačítky („Plánování" / „Sběr dat"), pod ní na celou plochu buď plán, nebo Logica. Přepínání jedním klepnutím, **obě aplikace zůstávají živé na pozadí** (operátor neztratí rozdělaný formulář v Logice).

### Ověřené předpoklady (VPN test 2026-07-26)
- ✅ **Logica jde vložit do `<iframe>`** — neposílá blokující `X-Frame-Options` ani CSP `frame-ancestors`.
- ✅ **Náš plán jde vložit do `<iframe>`** — je same-origin s kiosk stránkou.
- ⚠️ **Mixed content:** plán je HTTPS, Logica HTTP. HTTPS stránka nesmí vložit HTTP iframe → **Logicu musíme servírovat přes HTTPS reverzní proxy** (viz §4.3).

---

## 2. Cíle a ne-cíle

### Cíle
1. Route `/kiosk` v existující Next.js appce (ne solo projekt) s lištou a dvěma přepínatelnými plochami.
2. Obě aplikace živé na pozadí (přepínání = jen změna viditelnosti, ne reload).
3. Logica dostupná přes HTTPS same-origin (vyřeší mixed content i framování naráz).
4. Terminál se po zapnutí sám přihlásí jako „svůj" tiskařský účet (bez psaní hesla operátorem).
5. Fullscreen bez lišty prohlížeče (Chrome `--kiosk`, autostart).

### Ne-cíle (YAGNI — teď neřešíme)
- **Automatické párování odkliku „hotovo" z Logiky do plánu** podle čísla zakázky. To je budoucí vize (§11), ne součást tohoto kroku.
- Obousměrná datová integrace s Logicou (API, DB).
- Dotyková gesta / vlastní klávesnice nad rámec toho, co appky umí samy.
- Konfigurační obrazovka pro operátora. Nastavení je centrální (server/env).

---

## 3. Přehled architektury

```
┌─ Terminál u stroje: Chrome --kiosk, fullscreen ─────────────┐
│  URL: https://planovani.integraf.cz/kiosk                   │
│                                                             │
│  ┌─ KioskShell (naše komponenta) ────────────────────────┐ │
│  │  [ IG ]  ( Plánování | Sběr dat )     stroj · hodiny   │ │  ← lišta
│  ├───────────────────────────────────────────────────────┤ │
│  │  <iframe src="/?embed=1">        (plán, same-origin)   │ │  ← obě
│  │  <iframe src="https://logica.integraf.cz/...">        │ │    živé,
│  │                                   (Logica přes proxy)  │ │    toggle
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
        │                                    │
        │ same-origin, sdílená session       │ HTTPS reverzní proxy
        ▼                                    ▼
  Next.js app (plán)                  Apache/nginx vhost
  planovani.integraf.cz      logica.integraf.cz → http://192.168.10.214:81
```

Tři stavební kameny: **(A)** route + shell komponenta, **(B)** reverzní proxy na Logicu, **(C)** kioskové auto-přihlášení. Plus **(D)** konfigurace Chromu na terminálu.

---

## 4. Komponenty

### 4.1 Route `/kiosk` — `src/app/kiosk/page.tsx`

Server komponenta. Zodpovědnost: ověřit session (middleware to už dělá — bez cookie redirect na `/login`), zjistit jméno stroje z `session.assignedMachine`, předat ho do `KioskShell`. Nic víc — žádná data z DB, žádné bloky. Lehká.

- **Co dělá:** načte session, vyrenderuje `<KioskShell machine={session.assignedMachine} logicaUrl={...} />`.
- **Závislosti:** `getSession()` (`src/lib/auth.ts`), `KioskShell`.
- **Middleware:** `/kiosk` není `/admin` ani `/rezervace`, takže **TISKAR i ostatní role projdou beze změny middleware**. Ověřeno v `src/middleware.ts`.

Logica URL (`logica.integraf.cz` + `pntid` daného stroje) přijde přes ENV / mapu stroj→pntid — viz §4.3 a Otevřené otázky.

### 4.2 `KioskShell` — `src/components/kiosk/KioskShell.tsx` (client)

Samostatná komponenta (dle konvence CLAUDE.md — nové standalone komponenty jako named export do `src/components/`, ne inline do velkých souborů).

- **Stav:** `activeView: "plan" | "data"` (default `"plan"`).
- **Render:** pevná lišta (logo, dvě tlačítka jako `role="tablist"`, jmenovka stroje, hodiny) + `<div class="viewport">` se **dvěma trvale mountovanými `<iframe>`**; přepíná se jen `visibility/opacity`, iframy se **nikdy neodmountují ani nemění `src`** → obě appky zůstanou živé.
- **Design:** výhradně přes CSS tokeny z `globals.css` (`--bg`, `--surface`, `--brand`, …), z-index přes `zLayers.ts`, žádné hex literály (konvence projektu). Vizuál dle schváleného náhledu (Artifact 🌐/🖥️).
- **Přístupnost:** tlačítka `aria-selected`, viditelný `:focus-visible` ring, jen levé tlačítko myši (`if (e.button !== 0) return;`).
- **Závislosti:** žádná data-vrstva; jen props (machine, planUrl, logicaUrl).

**Plán v iframu:** `src="/?embed=1"`. Volitelný parametr `?embed=1` skryje vlastní hlavičku plánu (aby nebyly dvě lišty nad sebou). MVP může jet i bez `embed` (plán se svou hlavičkou uvnitř) — `embed` je zpřesnění UX, ne blocker.

### 4.3 Reverzní proxy na Logicu

**Proč:** (1) mixed content — HTTPS stránka nevloží HTTP iframe; (2) čistá same-origin/HTTPS adresa pro iframe. Logica je celá cizí ASP.NET aplikace, kterou neovládáme.

**Doporučená varianta — subdoména na server-level (Apache vhost u Michala):**
```apache
# logica.integraf.cz  →  http://192.168.10.214:81
<VirtualHost *:443>
    ServerName logica.integraf.cz
    SSLEngine on
    # ... cert ...
    ProxyPreserveHost Off
    ProxyPass        / http://192.168.10.214:81/
    ProxyPassReverse / http://192.168.10.214:81/
    # jistota, kdyby Logica někdy začala posílat X-Frame-Options:
    Header always unset X-Frame-Options
    Header always unset Content-Security-Policy
</VirtualHost>
```
Iframe pak míří na `https://logica.integraf.cz/machinepanelhand.aspx?pntid=<id>`.

**Proč subdoména a ne subpath (`planovani.integraf.cz/logica/`):** ASP.NET appky běžně používají root-absolutní cesty ke zdrojům (`/Scripts/...`, `/WebResource.axd`). Pod subpath by se rozbily; na vlastní subdoméně fungují bez úprav. Cena: nový DNS záznam + TLS cert (interní CA nebo Let's Encrypt) — Michalova strana, malá věc.

**Fallback — Next.js rewrite** (`next.config.ts`), kdyby subdoména nebyla po ruce:
```ts
async rewrites() {
  return [{ source: "/logica/:path*", destination: "http://192.168.10.214:81/:path*" }];
}
```
Rychlé a bez server-configu, ale **riziko rozbitých absolutních cest** Logiky. Bereme jen když subdoména nevyjde.

> **Rozhodnutí k potvrzení:** subdoména (doporučeno) vs. Next rewrite. Default: subdoména.

### 4.4 Kioskové auto-přihlášení

Terminál musí být trvale přihlášený jako **tiskařský účet svého stroje** (role `TISKAR`, `assignedMachine` = daný stroj — model už existuje), bez psaní hesla.

Současný stav (`src/lib/auth.ts`): JWT session, **napevno 7 dní**. To pro kiosk nestačí (za týden by spadl na login).

**Návrh — bootstrap endpoint `/api/auth/kiosk`:**
- Leží pod `/api/auth/*`, takže ho middleware pouští bez cookie.
- Vstup: per-terminál klíč, např. `GET /api/auth/kiosk?device=KBA106&key=<tajný_klíč>`.
- Ověří `key` proti mapě zařízení (ENV `KIOSK_DEVICES` nebo tabulka), najde odpovídající TISKAR účet, vytvoří **dlouhou session** (např. 365 dní) a nastaví cookie, pak redirect na `/kiosk`.
- Rozšíření auth: `createSessionToken(user, { ttlDays })` — přidat volitelný TTL parametr (dnes napevno `"7d"`), aby kiosk mohl 365 dní; ostatní volání zůstanou na 7 dnech beze změny.

Chrome na terminálu se pak spouští na `https://planovani.integraf.cz/api/auth/kiosk?device=<stroj>&key=<klíč>` (jen poprvé / při ztrátě session; jinak rovnou `/kiosk`).

**Jednodušší MVP fallback:** operátor/IT se na terminálu **jednou ručně přihlásí** tiskařským účtem a díky prodloužené session (bod výše) + perzistentnímu Chrome profilu vydrží přihlášení „natrvalo". Autostart pak jede rovnou na `/kiosk`. Míň kódu, ale vyžaduje jednorázový ruční login na každém terminálu.

> **Rozhodnutí k potvrzení:** bootstrap endpoint (hands-off autostart) vs. jednorázový ruční login. Obojí stojí na per-machine účtech, které nastaví Michal.

### 4.5 Konfigurace Chromu na terminálu (Michal)

- Spuštění: `chrome.exe --kiosk --app=https://planovani.integraf.cz/kiosk` (+ `--noerrdialogs --disable-pinch --overscroll-history-navigation=0`).
- Autostart: zástupce ve složce Po spuštění / naplánovaná úloha při přihlášení.
- Perzistentní profil (aby session přežila restart).

---

## 5. Datový tok

1. Terminál naběhne → Chrome kiosk → `/kiosk` (příp. přes `/api/auth/kiosk` pro první session).
2. Middleware ověří cookie; bez ní redirect na login (nebo bootstrap založí session).
3. `/kiosk/page.tsx` načte session, předá stroj do `KioskShell`.
4. Shell zamountuje **oba** iframy naráz:
   - plán `/?embed=1` — autentizace sdílenou cookie (same-origin),
   - Logica `https://logica.integraf.cz/...?pntid=<id>` — přes proxy.
5. Operátor klepe na tlačítka → mění se jen `activeView` → obě appky běží dál.

---

## 6. Chování přepínače a UX

- Default po startu: **Plánování** (ať operátor hned vidí kontext); k potvrzení — možná spíš „Sběr dat", pokud u stroje tráví víc času v Logice.
- Přepnutí = instant, žádný spinner (obě už běží).
- Lišta ukazuje **jméno stroje** (ze session) a hodiny — orientace operátora.
- Velká dotyková tlačítka (terminály můžou být dotykové — potvrdí Michal).

---

## 7. Ošetření chyb

- **Logica nedostupná** (`.214` down): iframe ukáže chybu prohlížeče. Zpřesnění: lehký „health ping" na proxy a vlastní hláška „Sběr dat je dočasně nedostupný" — volitelné, ne MVP.
- **Session vypršela / smazána:** middleware redirect na `/login`. Pro plně bezobslužný provoz to řeší dlouhá session (§4.4). Kdyby přesto spadl → operátor vidí login (přijatelný degradovaný stav), reload přes bootstrap ho vrátí.
- **Plán se nenačte v iframu:** ověřit, že app neposílá `X-Frame-Options: DENY` (aktuálně neposílá; middleware ho nenastavuje). Pokud přidáme bezpečnostní hlavičky jinde, kiosk cestu (`/kiosk`, `/`) nechat framovatelnou same-origin.

---

## 8. Bezpečnost

- Kiosk běží na **firemní LAN/VPN**, ne veřejně → nižší rizikový profil.
- `key` v bootstrap URL je sdílené tajemství per zařízení; drž ho v ENV/DB, ne v gitu. Rotovatelné.
- Session cookie zůstává `httpOnly`, `secure` (HTTPS), `sameSite=lax`.
- Proxy (`logica.integraf.cz`) zpřístupní Logicu přes HTTPS jen v rámci LAN — žádné nové veřejné vystavení.
- Tiskařský účet má roli `TISKAR` = read-only plán + odklik „hotovo"; kompromitace terminálu nedává víc než tiskař má.

---

## 9. Testování

- **Ověřovací spike (hotovo):** `~/Desktop/logica-iframe-test.html` — potvrdil framování Logiky i plánu.
- **Manuální na terminálu:** přepínání, perzistence stavu Logiky (počítadlo běží dál po přepnutí), autostart po rebootu, chování při výpadku sítě.
- **Auth:** bootstrap endpoint vytvoří správný účet dle `device`; dlouhá session; odmítnutí špatného `key`.
- **Regrese:** `createSessionToken` s novým volitelným TTL nesmí změnit chování stávajících 7denních session (unit test na obě větve).
- Build + lint + stávající test suite zelené.

---

## 10. Otevřené otázky (Michal — nejsou blokující, doplníme za běhu)

1. **Per-machine kioskové účty** — založit TISKAR účet pro každý stroj (`assignedMachine`), sdílet mapu stroj→účet.
2. **Mapa stroj → `pntid`** Logiky (test měl `pntid=25`) — který panel patří kterému stroji.
3. **Subdoména `logica.integraf.cz`** — DNS + Apache vhost + cert (nebo potvrdit fallback rewrite).
4. **Autostart & profil** na terminálech + počet terminálů + dotyk/klávesnice.
5. Bootstrap endpoint vs. ruční login (§4.4).

---

## 11. Mimo rozsah / budoucí vize

**Párování „hotovo" Logica → plán podle čísla zakázky** (`orderNumber` u nás vždy sedí): až tiskař v Logice nahlásí zakázku hotovou, propsalo by se to i do plánu (`printCompletedAt`). Vyžaduje čtení dat z Logiky (API/DB/export) — samostatný projekt, řeší se později. Tento kiosk je předstupeň: dá operátorům obě appky na dosah, aniž by cokoli integroval.

---

## 12. Předpoklady, které děláme (opravit, když nesedí)

- Plán je na `https://planovani.integraf.cz`, Logica na `http://192.168.10.214:81` (potvrzeno).
- Terminály: Windows + Chrome, spravuje Michal, lze nastavit `--kiosk` + autostart (potvrzeno rámcově, detaily čekají).
- Existuje/založí se TISKAR účet per stroj s `assignedMachine`.
- `pntid` v Logice je stabilní identifikátor panelu stroje.
- App nikde neposílá restriktivní `X-Frame-Options` na `/` a `/kiosk` (ověřeno v middleware; doověřit next.config při implementaci).
