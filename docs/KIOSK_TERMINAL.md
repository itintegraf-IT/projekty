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

## 2. Terminál (Michal)

V configu autostartu nahradit adresu Logiky adresou launcheru a doplnit `pntid`
daného stroje:

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

## Ověření po nasazení

- [ ] `COOKIE_SECURE=false` je v produkčním ENV a aplikace byla restartovaná
- [ ] `http://planovani.integraf.cz/vyroba-terminal.html?pntid=25` naběhne (lišta + dvě tlačítka)
- [ ] **Sběr dat** ukáže panel Logiky odpovídající `pntid`
- [ ] **Plánování** → přihlašovací obrazovka → po přihlášení **zůstane přihlášeno**
- [ ] V konzoli prohlížeče **nejsou** hlášky `Blocked a frame …`
- [ ] Přepnutí tam a zpět **nezruší** rozdělaný stav v Logice
- [ ] Po rebootu terminálu je plán stále přihlášený
- [ ] Tlačítko **Obnovit** přenačte jen právě zobrazenou aplikaci

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
