# Expediční plán — Design dokument

Datum: 2026-04-11  
Autor: Vojta Tokán (brainstorming s Claude Code)  
Status: Schváleno — připraveno k implementaci

---

## Přehled

Expediční plán je nový modul v aplikaci Integraf Výrobní plán. Řeší problém ručního přepisování zakázek z plánu tisku do separátního Excelu pro potřeby expedičního plánovače. Namísto toho se zakázky s vyplněným datem expedice automaticky zobrazí v novém pohledu `/expedice`, kde expedičnímu plánovač doplní jen expedici-specifické údaje.

### Problém dnes
Expediční plánovač přepisuje čísla zakázek a popisy z plánu tisku do jiného Excelu. Jakákoliv změna data expedice v plánu tisku se do Excelu propaguje ručně — dochází k desynchronizaci.

### Řešení
Jeden zdroj pravdy: `deadlineExpedice` na Block modelu. Expediční plán čte přímo z databáze, zobrazuje zakázky seřazené podle data expedice, a umožňuje doplnit expedici-specifická pole (`expediceNote`, `doprava`). Přesunutí zakázky drag & dropem v expedičním plánu aktualizuje `deadlineExpedice` — změna je okamžitě viditelná i v plánu tisku.

---

## Přístupová práva

| Role | Zobrazení | Editace (expediceNote, doprava) | Drag & drop | Závozy (add/edit/delete) |
|------|-----------|----------------------------------|-------------|--------------------------|
| ADMIN | ✅ | ✅ | ✅ | ✅ |
| PLANOVAT | ✅ | ✅ | ✅ | ✅ |
| DTP | ✅ | ❌ | ❌ | ❌ |
| MTZ | ✅ | ❌ | ❌ | ❌ |
| OBCHODNIK | ✅ | ❌ | ❌ | ❌ |
| TISKAR | ✅ | ❌ | ❌ | ❌ |
| VIEWER | ✅ | ❌ | ❌ | ❌ |

---

## Databázový model

### Změny v Block modelu

Přidána dvě nová volitelná pole:

```prisma
expediceNote  String?   // tučná poznámka specifická pro expedici (zobrazena na kartě tučně)
doprava       String?   // destinace / dopravní pokyn, volný text (např. "na mailing", "na SHV")
```

Migrace: `npx prisma migrate dev --name add_expedice_fields`

### Nový model ExpeditionZavoz

Interní závozy a návozy — záznamy bez vazby na výrobní blok:

```prisma
model ExpeditionZavoz {
  id           Int      @id @default(autoincrement())
  date         DateTime // datum závozu (uloženo jako UTC midnight, zobrazuje se jako civilní den)
  orderNumber  String?  // číslo zakázky nebo identifikátor závozu (volně zadané)
  description  String?  // popis závozu (firma, produkt, množství)
  expediceNote String?  // tučná poznámka
  doprava      String?  // destinace, volný text
  createdAt    DateTime @default(now())
  updatedAt    DateTime @default(now()) @updatedAt

  @@index([date])
}
```

Migrace: zahrnuta ve stejné migraci jako Block pole.

---

## Architektura

### Přístup: data přímo na Block + samostatná tabulka pro závozy

- Expediční pohled čte **Block záznamy kde `deadlineExpedice IS NOT NULL`** — žádná duplikace dat
- `orderNumber` a `description` se berou přímo z Blocku — expediční plánovač nic nepřepisuje
- `expediceNote` a `doprava` jsou nová pole přímo na Blocku — žádná synchronizace
- Závozy jsou v samostatné tabulce `ExpeditionZavoz` — nemají výrobní blok, jsou ručně zadané
- Drag & drop bloku → `PUT /api/blocks/[id]` s novým `deadlineExpedice` → viditelné i v plánu tisku

---

## UI — Rozvržení

### Navigace

Nové tlačítko v headeru `PlannerPage.tsx`, viditelné pro **všechny role**:

```
[Správa]  [Rezervace]  [Expedice ●]
```

Barva: `#FFE600` (CTA žlutá, konzistentní s design systémem).

### Timeline layout — Varianta A (kompaktní)

Vertikální osa = dny (stejný princip jako hlavní planner, ale bez hodinových slotů).

```
┌──────────────────────────────────────────────────────┐
│  PO          [█] 17521  Colognia – Leaflet – 4 000 ks │
│  14          │    4 000 ks DLE ROZDĚLOVNÍKU    [na mailing] │
│              ─────────────────────────────────────────│
│              [█] 17470  Rokrodruck – Mapa – 1 000 ks  │
│                   —                             [—]   │
├──────────────────────────────────────────────────────┤
│  ÚT          [█] 17532/1  mBank – Kartičky – Retail  │
│  15          │    Retail 2 000 ks + Business 1 150 ks │
│              ─────────────────────────────────────────│
│  🟢 ZÁVOZ   [█] 17513  ASTRATEX – vložka SKY        │
│                   15 000 ks                  [na SHV] │
└──────────────────────────────────────────────────────┘
```

**Karta zakázky** (modrá):
- Levý barevný pruh (modrý `#3b82f6`)
- Číslo zakázky (tučné, bílé)
- Popis (šedý, zkrácený)
- `expediceNote` — tučná, žlutá (`#f59e0b`), prázdná = `—`
- `doprava` — badge vpravo, volný text

**Karta závozu** (zelená):
- Levý barevný pruh (zelený `#10b981`)
- Badge `ZÁVOZ` (zelený)
- Stejná pole jako zakázka

### Editace

**Zakázka** — klik na kartu → inline editace přímo na kartě:
- Pole `expediceNote` (textarea)
- Pole `doprava` (text input)
- Datum expedice se **nemění** editací — pouze drag & dropem
- Tlačítka Uložit / Zrušit

**Závoz** — klik na kartu → modal `ZavozEditor`:
- Pole: datum, číslo zakázky, popis, expediceNote, doprava
- Tlačítka Uložit / Smazat / Zrušit

### Drag & drop

- Přetažení karty (zakázka nebo závoz) na jiný den → okamžitý optimistický update + API call
- Cílový den se vizuálně zvýrazní při přetahování (drop zone highlight)
- Drag & drop pouze pro ADMIN a PLANOVAT — ostatní role karty přetáhnout nemohou

---

## Soubory a routes

### Nové soubory

```
src/app/expedice/
  page.tsx                          -- Server Component, auth check, načtení dat
  _components/
    ExpedicePage.tsx                -- hlavní Client Component, stav, drag & drop
    ExpediceTimeline.tsx            -- timeline grid (dny + karty)
    ExpediceCard.tsx                -- kompaktní karta (zakázka i závoz)
    ZavozEditor.tsx                 -- modal pro add/edit závozu

src/app/api/expedice/
  route.ts                          -- GET: bloky s deadlineExpedice + závozy
  zavoz/
    route.ts                        -- POST: nový závoz
    [id]/route.ts                   -- PUT: update závozu, DELETE: smazání
```

### Změny v existujících souborech

| Soubor | Změna |
|--------|-------|
| `prisma/schema.prisma` | +2 pole na Block, nový model ExpeditionZavoz |
| `src/app/_components/PlannerPage.tsx` | +tlačítko Expedice v headeru |
| `src/app/api/blocks/[id]/route.ts` | Přidat `expediceNote` a `doprava` do allowlistu PUT pouze pro ADMIN/PLANOVAT |
| `src/middleware.ts` | Přidat `/expedice` do povolených routes pro všechny role |

---

## API

### GET /api/expedice

Vrátí sloučené a seřazené záznamy po dnech.

**Response:**
```json
{
  "days": [
    {
      "date": "2026-04-14",
      "items": [
        {
          "type": "block",
          "id": 123,
          "orderNumber": "17521",
          "description": "Colognia – Leaflet – 4 000 ks",
          "expediceNote": "4 000 ks DLE ROZDĚLOVNÍKU",
          "doprava": "na mailing",
          "deadlineExpedice": "2026-04-14",
          "machine": "XL_105"
        },
        {
          "type": "zavoz",
          "id": 5,
          "orderNumber": "17513",
          "description": "ASTRATEX – vložka SKY",
          "expediceNote": "15 000 ks",
          "doprava": "na SHV",
          "date": "2026-04-14"
        }
      ]
    }
  ]
}
```

### PUT /api/blocks/[id]

Existující route — přidána podpora pro `expediceNote`, `doprava`, `deadlineExpedice`.  
Role filter: tato tři pole edituje pouze ADMIN/PLANOVAT (z expedičního plánu).

### POST /api/expedice/zavoz

Body: `{ date, orderNumber?, description?, expediceNote?, doprava? }`  
Auth: ADMIN/PLANOVAT only.

### PUT /api/expedice/zavoz/[id]

Body: stejná pole jako POST (všechna volitelná).  
Používá se pro inline editaci i drag & drop (změna `date`).  
Auth: ADMIN/PLANOVAT only.

### DELETE /api/expedice/zavoz/[id]

Auth: ADMIN/PLANOVAT only.

---

## Rozdělení do etap

### Etapa A — Základ: databáze + read-only pohled
**Rozsah:**
- DB migrace (Block: +expediceNote, +doprava; nová tabulka ExpeditionZavoz)
- Server Component `src/app/expedice/page.tsx`
- `GET /api/expedice`
- `ExpedicePage.tsx` + `ExpediceTimeline.tsx` + `ExpediceCard.tsx` (read-only)
- Tlačítko Expedice v headeru PlannerPage
- Middleware: `/expedice` povoleno pro všechny role

**Výsledek:** Expediční plánovač vidí co expeduje kdy — přestane přepisovat do Excelu.

---

### Etapa B — Editace + závozy
**Rozsah:**
- Inline editace karty zakázky (`expediceNote`, `doprava`) — volání `PUT /api/blocks/[id]`
- `ZavozEditor.tsx` modal
- `POST /api/expedice/zavoz` + `PUT /api/expedice/zavoz/[id]` + `DELETE /api/expedice/zavoz/[id]`
- Závozy zobrazeny v timeline (zelené karty)

**Výsledek:** Plná editace obsahu, závozy v systému.

---

### Etapa C — Drag & drop
**Rozsah:**
- Drag & drop zakázky → `PUT /api/blocks/[id]` s novým `deadlineExpedice`
- Drag & drop závozu → `PUT /api/expedice/zavoz/[id]` s novým `date`
- Drop zone highlight při přetahování
- Pouze pro ADMIN/PLANOVAT

**Výsledek:** Rychlé přeplánování bez klikání — klíčové pro každodenní práci expedičního plánovače.

---

## Technické poznámky

- **Datum ukládání**: stejný pattern jako `MachineScheduleException.date` — `new Date(datePart + "T00:00:00.000Z")`, nikdy `getFullYear()/getMonth()/getDate()` na serveru
- **Prague timezone**: zobrazení dat přes `utcToPragueDateStr()` z `src/lib/dateUtils.ts`
- **Design systém**: Apple standard — font `-apple-system`, spacing 4px grid, border max 1px, animace max 150ms ease-out
- **Drag & drop implementace**: nativní HTML5 Drag & Drop API (stejný přístup jako v hlavním planneru), snap na celý den
- **Audit log**: změny `expediceNote`, `doprava`, `deadlineExpedice` z expedičního plánu se logují do AuditLog (existující mechanismus)
- **Middleware**: `/expedice` přidat do whitelist pro role, kde dnes chybí (DTP, MTZ, TISKAR, VIEWER)
