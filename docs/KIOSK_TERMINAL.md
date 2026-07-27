# Kioskový terminál u strojů — nastavení

Launcher s lištou a dvěma tlačítky (**Sběr dat** = Logica, **Plánování** = výrobní plán)
pro terminály u tiskových strojů. Obě aplikace zůstávají načtené, přepínání jen
přepne, která je vidět (rozdělaná práce v Logice se neztratí).

- Soubor: `public/vyroba-terminal.html` (statický, servíruje ho appka plánu)
- Adresa: `https://planovani.integraf.cz/vyroba-terminal.html?pntid=<číslo_panelu>`
- Terminály: Raspberry Pi / Raspbian, autostart prohlížeče ve fullscreenu, adresa z configu

## Nastavení terminálu (Michal)

V configu autostartu nahradit dosavadní adresu Logiky adresou launcheru a doplnit
`pntid` daného stroje — např. pro panel 25:

```
https://planovani.integraf.cz/vyroba-terminal.html?pntid=25
```

Prohlížeč spouštět s těmito přepínači:

```bash
chromium-browser \
  --kiosk \
  --allow-running-insecure-content \
  --noerrdialogs \
  --disable-session-crashed-bubble \
  --user-data-dir=/home/pi/.config/kiosk-profile \
  "https://planovani.integraf.cz/vyroba-terminal.html?pntid=25"
```

Proč které:

| Přepínač | Důvod |
| --- | --- |
| `--kiosk` | fullscreen bez lišty prohlížeče |
| `--allow-running-insecure-content` | **povinné** — launcher jede přes HTTPS, Logica přes HTTP (`:81`). Bez toho prohlížeč Logicu v rámu zablokuje jako „mixed content". Bezpečné na uzamčeném kiosku ve firemní LAN. |
| `--user-data-dir=…` | perzistentní profil → zapamatované přihlášení do plánu přežije restart |
| `--noerrdialogs`, `--disable-session-crashed-bubble` | žádné dialogy přes obrazovku po nečekaném vypnutí |

## První přihlášení do plánu

Kiosk nemá OS účet — přihlášení řeší až plán uvnitř rámu:

1. Terminál naběhne na launcher, aktivní je **Sběr dat** (Logica).
2. Přepnout na **Plánování** → v rámu se objeví přihlašovací obrazovka plánu.
3. Přihlásit tiskařským účtem daného stroje (role `TISKAR`, `assignedMachine`).
4. Zaškrtnout zapamatování hesla v prohlížeči, pokud to nabídne.

Session tiskařských účtů drží **365 dní** (ostatní role 7 dní), takže se to
znovu neřeší. Nastavení je v `src/app/api/auth/login/route.ts`.

## Ověření po nasazení

- [ ] `https://planovani.integraf.cz/vyroba-terminal.html?pntid=25` naběhne (lišta + dvě tlačítka)
- [ ] **Sběr dat** ukáže panel Logiky odpovídající `pntid`
- [ ] **Plánování** ukáže plán (po přihlášení), tiskař vidí svůj stroj
- [ ] Přepnutí tam a zpět **nezruší** rozdělaný stav v Logice
- [ ] Po rebootu terminálu je plán stále přihlášený
- [ ] Tlačítko **Obnovit** přenačte jen právě zobrazenou aplikaci

## Poznámky

- `pntid` je jediné, co se mezi terminály liší — jeden soubor obsluhuje všechny stroje.
- Adresa Logiky je v souboru v konstantě `LOGICA_BASE`.
- Launcher je v middleware (`src/middleware.ts`) záměrně vyjmutý z auth gate,
  aby lišta naběhla i bez session; chráněný obsah řeší až vnořený plán.
- Alternativní „robustní" varianta (route `/kiosk` s automatickým přihlášením bez
  hesla přes `/api/auth/kiosk`) je také hotová — viz
  `docs/superpowers/specs/2026-07-26-terminal-kiosk-design.md`. Vyžaduje ale
  per-machine účty v ENV `KIOSK_DEVICES`. Tento statický launcher je jednodušší
  varianta pro rozjezd.
