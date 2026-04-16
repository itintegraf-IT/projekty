# Reservation Workflow Redesign

Datum: 16. 4. 2026
Status: Design schválen

## Kontext a motivace

Současný rezervační workflow (SUBMITTED → ACCEPTED → QUEUE_READY → SCHEDULED) vyžaduje, aby plánovač nejdřív potvrdil termín (accept) a teprve pak plánoval zakázku na timeline. V praxi je to naopak — plánovač potřebuje zakázku **nejdřív naplánovat** (hodit na timeline), aby viděl návaznosti (knihárna, DOMPRC, kooperace plánované mimo systém), a teprve pak může říct obchodníkovi, jestli termín stíhá nebo navrhne jiný.

Zároveň obchodník často nezná oba termíny (expedice i data) — typicky zná jen jeden. Současný formulář vyžaduje oba.

## Nový stavový tok

```
SUBMITTED → ACCEPTED → QUEUE_READY → SCHEDULED
    │           │           │             │
    └→REJECTED  └→REJECTED  └→REJECTED    ├→ CONFIRMED
                                          ├→ COUNTER_PROPOSED → CONFIRMED (obchodník souhlasí)
                                          │                   → WITHDRAWN (obchodník nesouhlasí)
                                          └→ REJECTED
```

### Význam stavů

| Stav | Význam |
|------|--------|
| SUBMITTED | Obchodník odeslal žádost |
| ACCEPTED | Plánovač viděl, bere na vědomí, bude plánovat |
| QUEUE_READY | Připraveno do fronty, čeká na zaplánování na timeline |
| SCHEDULED | Naplánováno na timeline, čeká na potvrzení termínu |
| CONFIRMED | Plánovač potvrdil, že termín stíhá |
| COUNTER_PROPOSED | Plánovač navrhl jiný termín, čeká na reakci obchodníka |
| WITHDRAWN | Obchodník odmítl protinávrh, rezervace uzavřena |
| REJECTED | Plánovač zamítl (z jakéhokoliv stavu před CONFIRMED) |

## Datový model

### Úpravy existujících polí v modelu Reservation

```
requestedExpeditionDate  DateTime  →  DateTime?   (nullable)
requestedDataDate        DateTime  →  DateTime?   (nullable)
```

Validace: alespoň jedno musí být vyplněné (API úroveň, ne DB constraint).

### Nová pole v modelu Reservation

| Pole | Typ | Účel |
|------|-----|------|
| `confirmedAt` | `DateTime?` | Kdy plánovač potvrdil termín |
| `confirmedByUserId` | `Int?` | Kdo potvrdil |
| `confirmedByUsername` | `String?` | Username potvrzujícího |
| `counterProposedExpeditionDate` | `DateTime?` | Navržený nový termín expedice |
| `counterProposedDataDate` | `DateTime?` | Navržený nový termín dat |
| `counterProposedReason` | `String? @db.Text` | Důvod protinávrhu |
| `counterProposedAt` | `DateTime?` | Kdy byl protinávrh odeslán |
| `counterProposedByUserId` | `Int?` | Kdo navrhl |
| `counterProposedByUsername` | `String?` | Username navrhovatele |
| `withdrawnAt` | `DateTime?` | Kdy obchodník odmítl protinávrh |
| `withdrawnReason` | `String?` | Důvod odmítnutí (volitelný) |

## API akce

### Nové akce na PATCH /api/reservations/[id]

| Akce | Přechod | Kdo | Payload | Popis |
|------|---------|-----|---------|-------|
| `confirm` | SCHEDULED → CONFIRMED | ADMIN, PLANOVAT | `{}` | Zapíše confirmed pole. Notifikace obchodníkovi. |
| `counter-propose` | SCHEDULED → COUNTER_PROPOSED | ADMIN, PLANOVAT | `{ counterExpeditionDate?, counterDataDate?, reason }` | Alespoň jedno datum povinné. Zapíše counter pole. Notifikace obchodníkovi. |
| `accept-counter` | COUNTER_PROPOSED → CONFIRMED | OBCHODNIK (vlastník) | `{}` | Přepíše requested* hodnotami z protinávrhu. Zapíše confirmedAt. Notifikace plánovači. |
| `reject-counter` | COUNTER_PROPOSED → WITHDRAWN | OBCHODNIK (vlastník) | `{ reason? }` | Zapíše withdrawn pole. Notifikace plánovači. |

### Úpravy existujících akcí

- `reject` — rozšířit o stavy SCHEDULED a COUNTER_PROPOSED (dnes: SUBMITTED/ACCEPTED/QUEUE_READY, nově i SCHEDULED a COUNTER_PROPOSED)
- `accept` a `prepare` — beze změny

### Úprava POST /api/reservations (vytvoření)

Validace se mění z `!exp || !data` na `!exp && !data` (stačí jeden termín).

### Nové typy notifikací

| Typ | Příjemce | Text |
|-----|----------|------|
| `RESERVATION_CONFIRMED` | obchodník (vlastník) | Vaše rezervace {code} byla potvrzena |
| `RESERVATION_COUNTER_PROPOSED` | obchodník (vlastník) | K rezervaci {code} byl navržen jiný termín |
| `RESERVATION_COUNTER_ACCEPTED` | plánovač | Obchodník souhlasil s protinávrhem pro {code} |
| `RESERVATION_WITHDRAWN` | plánovač | Obchodník odmítl protinávrh pro {code} |

## UI změny

### BlockDetail — nová sekce pro bloky z rezervace

Zobrazí se jen u bloků s `reservationId`. Obsahuje:
- Info o rezervaci (kód, termín expedice/dat, obchodník, stav)
- Při stavu SCHEDULED: tlačítka **Potvrdit termín** / **Navrhnout jiný**
- Po kliknutí na "Navrhnout jiný": inline formulář (nový termín expedice, volitelně termín dat, důvod) s tlačítky Odeslat / Zrušit
- Při stavu CONFIRMED: zelený badge "Potvrzeno"
- Při stavu COUNTER_PROPOSED: žlutý badge "Čeká na obchodníka"

### ReservationDetail — protinávrh pro obchodníka

Při stavu COUNTER_PROPOSED obchodník vidí:
- Původní termín přeškrtnutý
- Box s protinávrhem (nový termín, důvod, kdo navrhl, kdy)
- Tlačítka **Souhlasím s novým termínem** / **Nesouhlasím**
- Při nesouhlasu: volitelné pole pro důvod
- Info text: "Při nesouhlasu bude rezervace uzavřena"

### ReservationForm — volitelné termíny

- Odstranit `required` z obou date fieldů
- Přidat validaci "alespoň jeden termín" na frontend i API
- Info text pod termíny: "Vyplňte alespoň jeden termín (expedice nebo dat)"

### RezervacePage — bucket mapping

| Bucket | ADMIN/PLANOVAT | OBCHODNIK |
|--------|---------------|-----------|
| Nové | SUBMITTED | — |
| Aktivní | ACCEPTED, QUEUE_READY, SCHEDULED, COUNTER_PROPOSED | SUBMITTED, ACCEPTED, QUEUE_READY, SCHEDULED, COUNTER_PROPOSED |
| Archiv | CONFIRMED, REJECTED, WITHDRAWN | CONFIRMED, REJECTED, WITHDRAWN |

## Dopad na existující kód

### Soubory ke změně

| Soubor | Změna |
|--------|-------|
| `prisma/schema.prisma` | Nullable termíny + nová pole |
| `src/app/api/reservations/route.ts` | POST validace, GET bucket mapping |
| `src/app/api/reservations/[id]/route.ts` | 4 nové akce, rozšíření reject |
| `src/app/rezervace/_components/ReservationForm.tsx` | Volitelné termíny |
| `src/app/rezervace/_components/ReservationDetail.tsx` | Protinávrh box + akce |
| `src/app/rezervace/_components/RezervacePage.tsx` | Bucket mapping |
| `src/components/BlockDetail.tsx` | Nová sekce Rezervace |
| `src/components/InboxPanel.tsx` | Nové typy notifikací |

### Co se NEMĚNÍ

- Timeline/drag & drop logika
- PlannerPage.tsx
- Auth/middleware (role zůstávají)
- Existující akce accept, prepare (fungují jako dnes)
- BlockEdit.tsx (editace bloku se nemění)

## Rozhodnutí z brainstormu

| Otázka | Rozhodnutí | Důvod |
|--------|-----------|-------|
| Povinné termíny | Stačí jeden | Obchodník často zná jen expedici nebo jen data |
| Kde plánovač potvrzuje | V detailu bloku na timeline | Zero přepínání kontextu, nejrychlejší workflow |
| Protinávrh termínu | Ruční (datum + důvod) | Tisk není finální operace, reálný termín závisí na navazujících krocích mimo systém |
| Odmítnutí protinávrhu | WITHDRAWN, nová rezervace | Čistý tok bez smyček |
| Reakce obchodníka | Notifikace + akce v detailu rezervace | Auditní stopa, plánovač nemusí ručně překlikávat |
