# Kioskový terminál u strojů — nastavení

Launcher s lištou a dvěma tlačítky (**Sběr dat** = Logica, **Plánování** = výrobní plán)
pro terminály u tiskových strojů. Obě aplikace zůstávají načtené, přepínání jen
přepne, která je vidět (rozdělaná práce v Logice se neztratí).

- Soubor: `public/vyroba-terminal.html` — statický, **servíruje ho aplikace plánu**
- Terminály: Raspberry Pi / Raspbian, autostart prohlížeče ve fullscreenu, adresa z configu
- **Zvolené nasazení: čisté HTTP bez certifikátu** (firemní LAN) → viz §1

## Dvě pravidla, bez kterých přihlášení nefunguje

Ověřeno na produkci 27. 7. 2026 — launcher nasazený ručně jako statický soubor na
`http://192.168.10.210/rozcestnik/` **nešel přihlásit do plánu**. Příznak byl
zrádný: přihlášení se **nedokončilo a nenapsalo žádnou chybu** (formulář hlásí
jen odmítnuté heslo, ne chybějící cookie). Příčiny byly dvě:

### Pravidlo 1: launcher musí být na STEJNÉ adrese jako plán

Session cookie má `SameSite=lax` → do rámu s **cizím originem** ji prohlížeč
neposílá (Safari nejtvrději). V konzoli se to projeví jako
`Blocked a frame with origin … from accessing a frame with origin …`.

Proto je launcher v `public/` aplikace a plán vkládá **relativní** adresou `/`.
**Nekopírovat soubor ručně jinam na server** — tím se to rozbije.

✅ `http://planovani.integraf.cz/vyroba-terminal.html` · ❌ `http://192.168.10.210/rozcestnik/vyroba-terminal.html`

### Pravidlo 2: na HTTP musí být `COOKIE_SECURE=false`

Cookie s příznakem `Secure` prohlížeč po HTTP **zahodí**. Dřív se `secure`
derivovalo z `NODE_ENV`, takže na HTTP nasazení bylo přihlášení strukturálně
rozbité (audit **SEC-001**). Nově se odvozuje z reálného protokolu a dá se
explicitně přebít — logika v `src/lib/cookieSecurity.ts`, testy tamtéž.

> ⚠️ **Bezpečnostní ústupek:** bez `Secure` jde session cookie po síti
> v plaintextu — kdo odposlouchává LAN, může ji ukradnout a vydávat se za
> přihlášeného uživatele. Vědomě přijato pro uzavřenou firemní síť bez přístupu
> zvenčí. Pokud by se appka někdy vystavila mimo LAN, tohle **musí** zmizet.

## 1. Server — produkční ENV

Do produkčního prostředí (env aplikace, viz `ecosystem.config.cjs` / deploy)
přidat:

```bash
COOKIE_SECURE=false
```

Bez toho se na HTTP nikdo nepřihlásí. Hodnoty: `false` = nikdy `Secure`
(HTTP nasazení), `true` = vždy `Secure` (HTTPS), **nenastaveno** = odvodí se
z hlavičky `X-Forwarded-Proto` od nginx, jinak z `NODE_ENV`.

Starý přepínač `ALLOW_HTTP_SESSION` byl odstraněn — nahrazen `COOKIE_SECURE`.

### Past: kdo dřív chodil přes HTTPS, neprihlásí se — dokud nesmaže cookie

Ověřeno 27. 7. 2026. Prohlížeč, který má z dřívějška uloženou cookie
`integraf-session` s příznakem `Secure` (nastavenou přes HTTPS), se po přechodu
na HTTP **nepřihlásí**, a to trvale:

- starou cookie po HTTP **neposílá** (je `Secure`),
- novou, nezabezpečenou, **odmítne uložit** — prohlížeče nedovolí přepsat
  `Secure` cookie z nezabezpečeného spojení („Leave Secure Cookies Alone",
  RFC 6265bis).

Server přitom přihlášení potvrdí (200 OK), takže **se nezobrazí žádná chyba** —
uživatele to jen vrátí na login. Nezaměnit s odmítnutým heslem (to hlásí
červeně „Nesprávné přihlašovací údaje").

**Řešení:** jednorázově smazat cookie `integraf-session` pro doménu
`planovani.integraf.cz` (nebo ověřit v anonymním okně, kde žádná není).

**Kioskových terminálů se to netýká** — mají čistý profil prohlížeče.

## 2. Terminál (Michal)

V configu autostartu nahradit adresu Logiky adresou launcheru a doplnit `pntid`
daného stroje.

### Které `pntid` patří kterému stroji

Ověřeno 3. 8. 2026 přímo z Logiky (název stroje vyčten z HTML panelu):

| Stroj | `pntid` | Adresa launcheru | `PUGroupId` v Logice |
| --- | --- | --- | --- |
| **XL 105** | `2` | `…/vyroba-terminal.html?pntid=2` | 3 |
| **XL 106** | `25` | `…/vyroba-terminal.html?pntid=25` | 32 |

Adresy obou strojů se liší **jen tímhle číslem** — stejný host, stejná stránka.
Launcher je proto jeden soubor pro oba terminály; `pntid` bez parametru padá na
výchozích `25`, tedy XL 106.

```bash
chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-session-crashed-bubble \
  --user-data-dir=/home/pi/.config/kiosk-profile \
  "http://planovani.integraf.cz/vyroba-terminal.html?pntid=25"
```

| Přepínač | Důvod |
| --- | --- |
| `--kiosk` | fullscreen bez lišty prohlížeče |
| `--user-data-dir=…` | perzistentní profil → zapamatované přihlášení přežije restart |
| `--noerrdialogs`, `--disable-session-crashed-bubble` | žádné dialogy přes obrazovku po nečekaném vypnutí |

Na HTTP **není potřeba** `--allow-running-insecure-content` ani řešit certifikát —
launcher i Logica jedou po HTTP, mixed content nevzniká.

## 3. První přihlášení do plánu

Kiosk nemá OS účet — přihlášení řeší až plán uvnitř rámu:

1. Terminál naběhne na launcher, aktivní je **Sběr dat** (Logica).
2. Přepnout na **Plánování** → v rámu se objeví přihlašovací obrazovka plánu.
3. Přihlásit **tiskařským účtem daného stroje** (role `TISKAR`, nastavený
   `assignedMachine`). Tyto účty musí existovat — zakládají se v `/admin`.
4. Zaškrtnout zapamatování hesla, pokud to prohlížeč nabídne.

Session tiskařských účtů drží **365 dní** (ostatní role 7 dní), takže se to znovu
neřeší. Nastavení je v `src/app/api/auth/login/route.ts`.

**Proč tak dlouho:** tahle varianta se přihlašuje ručně heslem a nemá žádný
automatický re-bootstrap — po expiraci by se u stroje objevil přihlašovací
formulář, ke kterému obsluha nezná heslo. Riziko delší platnosti cookie je
vědomý ústupek k rozhodnutí „HTTP jen uvnitř VPN" (viz `DEPLOY_WORKFLOW.md`);
od Fáze 4 auditu jde session kdykoli okamžitě zneplatnit — stačí v `/admin`
změnit heslo nebo stroj daného účtu (`tokenVersion`). Alternativní varianta
`/api/auth/kiosk` má session 30 dní, protože se umí obnovit sama svým klíčem.

## Ověření po nasazení

- [ ] `COOKIE_SECURE=false` je v produkčním ENV a aplikace byla restartovaná
- [ ] `http://planovani.integraf.cz/vyroba-terminal.html?pntid=25` naběhne (lišta + dvě tlačítka)
- [ ] **Sběr dat** ukáže panel Logiky odpovídající `pntid`
- [ ] **Plánování** → přihlašovací obrazovka → po přihlášení **zůstane přihlášeno**
- [ ] V konzoli prohlížeče **nejsou** hlášky `Blocked a frame …`
- [ ] Přepnutí tam a zpět **nezruší** rozdělaný stav v Logice
- [ ] Po rebootu terminálu je plán stále přihlášený
- [ ] Tlačítko **Obnovit** přenačte jen právě zobrazenou aplikaci

## ⚠️ Past: launcher po HTTPS dnes Sběr dat nenačte

Ověřeno 3. 8. 2026. Launcher se chová podle protokolu, na kterém běží: po **HTTP**
sahá na Logicu napřímo (`http://192.168.10.214:81/…`), po **HTTPS** na proxy
`/logica/` na vlastním serveru. Ta proxy ale **na produkci nastavená není**:

```
https://planovani.integraf.cz/logica/machinepanelhand.aspx?pntid=2
  → 307, přesměrování na /login
```

Ten 307 znamená, že nginx žádné `location /logica/` nemá, požadavek propadl do
Next.js aplikace a auth middleware ho odmítl. Prakticky: **terminál nasměrovaný na
`https://` adresu launcheru ukáže místo Sběru dat prázdný rám** — bez srozumitelné
chybové hlášky.

Dnes to nevadí, protože nasazení je vědomě po HTTP (viz §1) a tam launcher jde na
Logicu napřímo. Ale **v configu terminálů musí být `http://`**. Kdo by to chtěl
narovnat natrvalo, přidá do nginx vhostu `location /logica/` podle sekce níž —
je to pět minut práce a HTTPS varianta pak funguje taky.

## Kdyby se někdy přešlo na HTTPS

Pak je potřeba navíc:

1. `COOKIE_SECURE=true` (nebo nechat nenastavené a zajistit, že nginx posílá
   `X-Forwarded-Proto: https`).
2. **Certifikát na správné jméno.** Dnešní je self-signed a vystavený na
   `CN=appintegraf.integraf.cz` → varování v prohlížeči, na kiosku blokující
   (v rámu nejde odklepnout).
3. **Logicu protunelovat přes nginx**, protože HTTPS stránka nevloží HTTP rám
   (mixed content). Launcher to řeší sám — na HTTPS sahá na `/logica/…`, na HTTP
   na Logicu napřímo. Do vhostu přidat:

```nginx
location /logica/ {
    proxy_pass         http://192.168.10.214:81/;
    proxy_set_header   Host 192.168.10.214:81;
    proxy_redirect     http://192.168.10.214:81/ /logica/;
    proxy_http_version 1.1;
}
```

Ověřeno, že to půjde: Logica odkazuje na svoje soubory **relativně**
(`Images/…`, `Include/MachinePanelUtils.js`) a nemá v HTML ani JS absolutní
odkazy na `192.168.10.214:81`. Posílá ale **302 s absolutní adresou**, proto
`proxy_redirect`.

## Poznámky

- `pntid` je jediné, co se mezi terminály liší — jeden soubor obsluhuje všechny stroje.
- Launcher je v `src/middleware.ts` záměrně vyjmutý z auth gate, aby lišta naběhla
  i bez session; chráněný obsah řeší až vnořený plán.
- Alternativní „robustní" varianta (route `/kiosk` s přihlášením bez hesla přes
  `/api/auth/kiosk`) je hotová — viz
  `docs/superpowers/specs/2026-07-26-terminal-kiosk-design.md`. Vyžaduje per-machine
  účty v ENV `KIOSK_DEVICES`. Tento statický launcher je jednodušší varianta.
