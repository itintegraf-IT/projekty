# Připomínky plánovače (srpen 2026) — design

Datum: 2026-08-04 · Stav: implementováno (etapy 1–5), body 5 a 6 odloženy
Navazuje na: `2026-07-09-planovac-4-body-design.md` (první série připomínek téhož plánovače)

## Kontext

Lukáš Lukeš poslal devět připomínek k modulu Výrobní plán. Sedm mělo jednoznačné
zadání, dvě byly formulované nejednoznačně a Lukáš sám nabídl osobní dovysvětlení
— ty Vojta z dávky vyřadil.

Průzkum kódu proběhl šesti agenty. Dvě zjištění změnila zadání oproti tomu, jak
připomínky zněly — jsou popsaná níž u příslušných bodů.

## Rozhodnutí

| Bod | Rozhodnutí | Kdo/proč |
| --- | --- | --- |
| 1 · Zvýraznění specifikace | Varianta B (plná amber plocha, tmavý text) | Vojta, z vizuálních návrhů v artifactu |
| 1 · Práh výšky | Snížit co nejníž (48 px = hranice MODE_FULL) | Vojta chtěl 44 px; 44–47 px je MODE_COMPACT = jednořádkový layout, kam se pás nevejde |
| 9 · Termín 14:00 | Posunout všechny tři prahy | Vojta — doslova to, co Lukáš napsal |
| 9 · Expedice | Badge „PO DEADLINE" do stejné logiky | Vojta doplnil po prvním kole |
| 7 · Překlopení rezervace | Potvrzovací dialog, ne automatika | Vojta |
| 8 · Rozsah undo | Vložení + drop z fronty + hromadné uložení | Vojta; split a reflow vědomě mimo |
| 5, 6 | Odloženo | Vojta se doptá Lukáše; podklady v artifactu |

## Zjištění, která změnila zadání

### Bod 7 — bloky rezervace nesdílí `reservationId`

Připomínka mluví o „záznamech se stejným číslem rezervace". Ukázalo se, že to je
doslova jediné, co je spojuje:

- `Ctrl+C/V` kopie `reservationId` záměrně neposílá (`blockPayload.ts:19-20`),
- split tail ho nekopíruje (`api/blocks/[id]/split/route.ts:105`),
- druhý drop téže rezervace z fronty server odmítne 409 (`api/blocks/route.ts:151-156`).

Klíčem je tedy `orderNumber`, do kterého server při dropu vynutil kód rezervace
(`R{id}`). Protože `Block.orderNumber` nemá unique ani index a Job Builder formát
čísla nevaliduje, je nutný filtr `type === "REZERVACE"` — jinak by se do
překlopení připletla ručně nazvaná zakázka „R123".

Vedlejší zjištění: `type` a `orderNumber` jsou v `SPLIT_SHARED_FIELDS`, takže
u split skupiny server překlopení propaguje sám. Klient takového sourozence
detekuje a přeskočí místo zbytečného PUT.

### Bod 8 — tažení myší undo neztrácí

Připomínka popisuje „posun jedné zakázky, která posune 20 dalších". Průzkum
ukázal, že **tahle cesta funguje správně** — `handleBlockUpdate` počítá
`shiftedOld` z `blocksRef` před aplikací odpovědi a zapisuje je do undo záznamu.

Skutečné díry byly jinde: vložení (Ctrl+V), skupinové vložení, drop z fronty
(všechny tři zapisovaly jen vytvořený blok) a hromadné uložení (nezapisovalo
vůbec nic). Server staré pozice odsunutých bloků v odpovědi nevrací — zná je jen
pro AuditLog — takže si je klient musí vzít z vlastního stavu.

## Návrhové volby

**Pás specifikace v tiskařském režimu zůstává na prahu 80 px.** Karta má
`overflow: hidden` a pás se v DOM kreslí před tlačítkem Hotovo; na 52px kartě by
ho vytlačil pod ořez. To je přesně regrese zachycená 3. 8. 2026. Tiskaři pod
80 px zbývá značka „S", plánovač dostane pás.

**Sourozenci při překlopení dostávají minimální payload.** Anchor jde plným
payloadem z formuláře, sourozenci jen `orderNumber`/`type`/`blockVariant`. Plný
payload by jim přepsal vlastní popis, termíny a štítky hodnotami anchoru — což je
přesně to, co u dvojice OBÁLKA/VNITŘKY nesmí nastat.

**`buildMultiEditCommand` neposílá `expectedUpdatedAt`.** Serverová propagace
sdílených polí do split sourozenců bumpne `updatedAt` dalších cílů, takže druhý
PUT by spadl na vlastní 409. Souběh místo toho hlídá guard nad živým stavem,
který proběhne **celý před prvním zápisem** — částečně provedené undo je horší
než žádné.

**Pořadí operací v `buildCreateCommand`.** Undo maže vytvořený blok před návratem
sousedů, redo naopak sousedy nejdřív odsune a teprve pak POSTne. POST má overlap
guard, takže opačné pořadí by redo shodilo.

**Žádný nový API endpoint.** Překlopení jde stávající PUT cestou pro každý blok —
tatáž validace, chain push i audit. Write-path surface zůstává beze změny.

## Mimo rozsah (vědomě)

- Undo pro split a reflow — nejcitlivější serverové cesty, vlastní etapa.
- Předexistující past: smazání překlopeného bloku zamítne navázanou rezervaci
  a pošle obchodníkovi notifikaci; DELETE se řídí jen `reservationId` bez ohledu
  na typ (`api/blocks/[id]/route.ts:727-758`). Po hromadném překlopení
  viditelnější, ale není to důsledek této dávky.
- Body 5 a 6 — čekají na dovysvětlení od Lukáše.

## Otevřené otázky pro Lukáše

1. **Odlišení dnů a směn** — ztrácí se v tom, *kde končí den*, nebo *jakou směnu
   vidí*? Pásy směn existují (odpolední +5 %, noční +11 % overlay), dělicí čára
   dne je 1 px, střídavý tón dnů byl v 7/2026 odstraněn jako mrtvý kód.
2. **OBÁLKA/VNITŘKY jako jedna volba** — které dvě kliknutí přesně šetří?
   Nejpravděpodobněji jde o rozdělenou zakázku, kde by druhá část dostala opačný
   štítek automaticky.
