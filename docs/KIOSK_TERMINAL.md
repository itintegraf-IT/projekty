# Kioskový terminál u strojů — nastavení

Launcher s lištou a dvěma tlačítky (**Sběr dat** = Logica, **Plánování** = výrobní plán)
pro terminály u tiskových strojů. Obě aplikace zůstávají načtené, přepínání jen
přepne, která je vidět (rozdělaná práce v Logice se neztratí).

- Soubor: `public/vyroba-terminal.html` — statický, **servíruje ho aplikace plánu**
- Adresa: `https://planovani.integraf.cz/vyroba-terminal.html?pntid=<číslo_panelu>`
- Terminály: Raspberry Pi / Raspbian, autostart prohlížeče ve fullscreenu, adresa z configu

## KRITICKÉ: launcher musí běžet na stejném originu jako plán, přes HTTPS

Tohle není kosmetika, je to podmínka funkčnosti. Ověřeno na produkci 27. 7. 2026 —
launcher nasazený zvlášť na `http://192.168.10.210/rozcestnik/` **nešel přihlásit
do plánu**, přesně z těchto dvou důvodů:

1. **Session cookie má příznak `Secure`** (v produkci vždy, viz `getCookieOptions`
   v `src/lib/auth.ts`) → prohlížeč ji **po HTTP zahodí**. Přihlášení vrátí OK,
   ale cookie nikde → plán pošle uživatele zpět na login, a to **bez chybové
   hlášky** (formulář hlásí jen odmítnuté heslo, ne chybějící cookie).
2. **Cookie má `SameSite=lax`** → do rámu s **cizím originem** ji prohlížeč
   neposílá (Safari blokuje cizí cookies nejtvrději). V konzoli se to projeví
   jako `Blocked a frame with origin … from accessing a frame with origin …`.

Proto: **jeden origin (`https://planovani.integraf.cz`) pro launcher i plán.**
Launcher je kvůli tomu v `public/` aplikace a plán vkládá **relativní** adresou
`/` — nikdy absolutní URL. Nekopírovat soubor ručně jinam na server.

## 1. Server (Michal) — nginx proxy na Logicu

Launcher poběží na HTTPS, Logica jede na HTTP (`192.168.10.214:81`). Přímé vložení
by prohlížeč zablokoval jako *mixed content*, proto Logica jde přes proxy na
stejném originu. Do vhostu `planovani.integraf.cz` přidat:

```nginx
location /logica/ {
    proxy_pass         http://192.168.10.214:81/;
    proxy_set_header   Host 192.168.10.214:81;
    proxy_redirect     http://192.168.10.214:81/ /logica/;
    proxy_http_version 1.1;
}
```

Proč které řádky:

| Řádek | Důvod |
| --- | --- |
| `proxy_pass` | přepošle `/logica/...` na Logicu. Lomítko na konci je důležité (odřízne prefix). |
| `proxy_set_header Host` | Logica generuje přesměrování podle Host hlavičky, kterou vidí |
| `proxy_redirect` | Logica posílá **302 s absolutní adresou** `http://192.168.10.214:81/...` (ověřeno) — bez tohoto by prohlížeč vyskočil z proxy zpátky na HTTP |

`location /logica/` má delší prefix než `location /`, takže má v nginx přednost
a k Next.js aplikaci se ten požadavek nedostane.

**Proč to funguje:** Logica odkazuje na svoje soubory **relativně**
(`Images/…`, `Include/MachinePanelUtils.js`) a nemá v HTML ani JS žádné absolutní
odkazy na `192.168.10.214:81` (ověřeno 27. 7. 2026). Pod podadresou se proto
nerozbije.

## 2. Certifikát

`https://planovani.integraf.cz` má dnes **self-signed certifikát vystavený na jiné
jméno** (`CN=appintegraf.integraf.cz`), takže prohlížeč hlásí varování. Na kiosku
je to problém — varování v rámu nejde odklepnout. Řešení, od nejlepšího:

1. Vystavit certifikát se správným jménem (`planovani.integraf.cz`) a dát ho do
   důvěryhodných na terminálech — řeší to i pro běžné uživatele.
2. Naimportovat stávající certifikát do úložiště prohlížeče na Raspberry.
3. Nouzově: spouštět kioskový prohlížeč s `--ignore-certificate-errors`.

## 3. Terminál (Michal)

V configu autostartu nahradit adresu Logiky adresou launcheru a doplnit `pntid`
daného stroje:

```bash
chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-session-crashed-bubble \
  --user-data-dir=/home/pi/.config/kiosk-profile \
  "https://planovani.integraf.cz/vyroba-terminal.html?pntid=25"
```

| Přepínač | Důvod |
| --- | --- |
| `--kiosk` | fullscreen bez lišty prohlížeče |
| `--user-data-dir=…` | perzistentní profil → zapamatované přihlášení do plánu přežije restart |
| `--noerrdialogs`, `--disable-session-crashed-bubble` | žádné dialogy přes obrazovku po nečekaném vypnutí |

`--allow-running-insecure-content` **není potřeba**, pokud je nastavená nginx
proxy z kroku 1. (Bez proxy by potřeba byl.)

## 4. První přihlášení do plánu

Kiosk nemá OS účet — přihlášení řeší až plán uvnitř rámu:

1. Terminál naběhne na launcher, aktivní je **Sběr dat** (Logica).
2. Přepnout na **Plánování** → v rámu se objeví přihlašovací obrazovka plánu.
3. Přihlásit **tiskařským účtem daného stroje** (role `TISKAR`, nastavený
   `assignedMachine`). Tyto účty musí existovat — zakládají se v `/admin`.
4. Zaškrtnout zapamatování hesla, pokud to prohlížeč nabídne.

Session tiskařských účtů drží **365 dní** (ostatní role 7 dní), takže se to znovu
neřeší. Nastavení je v `src/app/api/auth/login/route.ts`.

## Ověření po nasazení

- [ ] `https://planovani.integraf.cz/vyroba-terminal.html?pntid=25` naběhne (lišta + dvě tlačítka)
- [ ] **Sběr dat** ukáže panel Logiky odpovídající `pntid` (jde přes `/logica/`)
- [ ] **Plánování** → přihlašovací obrazovka → po přihlášení **zůstane přihlášeno**
- [ ] V konzoli prohlížeče **nejsou** hlášky `Blocked a frame …` ani mixed-content
- [ ] Přepnutí tam a zpět **nezruší** rozdělaný stav v Logice
- [ ] Po rebootu terminálu je plán stále přihlášený
- [ ] Tlačítko **Obnovit** přenačte jen právě zobrazenou aplikaci

## Poznámky

- `pntid` je jediné, co se mezi terminály liší — jeden soubor obsluhuje všechny stroje.
- Logica se v launcheru bere přes `/logica/…`, když stránka běží na HTTPS; při
  lokálním testu (HTTP nebo otevřený soubor) se jde na `192.168.10.214:81` napřímo.
- Launcher je v `src/middleware.ts` záměrně vyjmutý z auth gate, aby lišta naběhla
  i bez session; chráněný obsah řeší až vnořený plán.
- Alternativní „robustní" varianta (route `/kiosk` s přihlášením bez hesla přes
  `/api/auth/kiosk`) je hotová — viz
  `docs/superpowers/specs/2026-07-26-terminal-kiosk-design.md`. Vyžaduje per-machine
  účty v ENV `KIOSK_DEVICES`. Tento statický launcher je jednodušší varianta.
