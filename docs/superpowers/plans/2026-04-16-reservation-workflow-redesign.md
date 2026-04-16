# Reservation Workflow Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the reservation workflow so that the planner confirms/counter-proposes a deadline AFTER scheduling a block on the timeline, and make both date fields optional (at least one required).

**Architecture:** Extend the existing Reservation model with new fields and states (CONFIRMED, COUNTER_PROPOSED, WITHDRAWN). Add 4 new PATCH actions to the reservations API. Add a reservation section to BlockDetail for planner actions. Extend ReservationDetail with counter-proposal UI for the sales rep (OBCHODNIK).

**Tech Stack:** Prisma 5 + MySQL, Next.js API routes, React components (inline styles matching existing patterns)

**IMPORTANT:** Do NOT push to git or create worktrees. All work stays local.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `prisma/schema.prisma` | Modify | Nullable dates + 11 new fields on Reservation |
| `src/lib/reservationSerialization.ts` | Modify | Serialize new DateTime fields |
| `src/app/api/reservations/route.ts` | Modify | POST validation (at-least-one-date), GET bucket mapping |
| `src/app/api/reservations/[id]/route.ts` | Modify | 4 new actions + extend reject + OBCHODNIK permission |
| `src/app/rezervace/_components/RezervacePage.tsx` | Modify | Reservation interface + bucket mapping |
| `src/app/rezervace/_components/ReservationForm.tsx` | Modify | Optional dates with at-least-one validation |
| `src/app/rezervace/_components/ReservationDetail.tsx` | Modify | Counter-proposal UI + CONFIRMED/WITHDRAWN display |
| `src/components/BlockDetail.tsx` | Modify | New reservation section with confirm/counter-propose actions |
| `src/components/InboxPanel.tsx` | Modify | Render new notification types |

---

### Task 1: Prisma Schema Migration

**Files:**
- Modify: `prisma/schema.prisma:236-265`

- [ ] **Step 1: Update Reservation model in schema**

In `prisma/schema.prisma`, change the `Reservation` model. Replace the two `DateTime` fields and add 11 new fields after `scheduledAt`:

```prisma
model Reservation {
  id                      Int                     @id @default(autoincrement())
  code                    String                  @unique @default("")
  status                  String
  companyName             String
  erpOfferNumber          String
  requestedExpeditionDate DateTime?
  requestedDataDate       DateTime?
  requestText             String?                 @db.Text
  requestedByUserId       Int
  requestedByUsername     String
  plannerUserId           Int?
  plannerUsername          String?
  plannerDecisionReason   String?                 @db.Text
  planningPayload         Json?
  preparedAt              DateTime?
  scheduledBlockId        Int?
  scheduledMachine        String?
  scheduledStartTime      DateTime?
  scheduledEndTime        DateTime?
  scheduledAt             DateTime?
  confirmedAt                    DateTime?
  confirmedByUserId              Int?
  confirmedByUsername            String?
  counterProposedExpeditionDate  DateTime?
  counterProposedDataDate        DateTime?
  counterProposedReason          String?          @db.Text
  counterProposedAt              DateTime?
  counterProposedByUserId        Int?
  counterProposedByUsername      String?
  withdrawnAt                    DateTime?
  withdrawnReason                String?
  createdAt               DateTime                @default(now())
  updatedAt               DateTime                @default(now())
  blocks                  Block[]
  attachments             ReservationAttachment[]

  @@index([erpOfferNumber])
  @@index([requestedByUserId, status, createdAt])
  @@index([status, createdAt])
}
```

Key changes:
- `requestedExpeditionDate DateTime` → `DateTime?`
- `requestedDataDate DateTime` → `DateTime?`
- 11 new nullable fields added between `scheduledAt` and `createdAt`

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
npx prisma migrate dev --name reservation-workflow-redesign
```

Expected: Migration created, Prisma Client regenerated. Existing rows keep their date values (nullable migration is safe — no data loss).

- [ ] **Step 3: Verify Prisma Client types**

Run:
```bash
npx prisma generate
```

Expected: No errors.

---

### Task 2: Update Serialization Layer

**Files:**
- Modify: `src/lib/reservationSerialization.ts`

- [ ] **Step 1: Update ReservationLike type and serializer**

Replace the entire file content:

```typescript
import { normalizeCivilDateInput } from "@/lib/dateUtils";

type ReservationLike = {
  requestedExpeditionDate: Date | null;
  requestedDataDate: Date | null;
  preparedAt: Date | null;
  scheduledStartTime: Date | null;
  scheduledEndTime: Date | null;
  scheduledAt: Date | null;
  confirmedAt: Date | null;
  counterProposedExpeditionDate: Date | null;
  counterProposedDataDate: Date | null;
  counterProposedAt: Date | null;
  withdrawnAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  attachments?: Array<{ createdAt: Date } & Record<string, unknown>>;
  [key: string]: unknown;
};

export function serializeReservation<T extends ReservationLike>(reservation: T) {
  return {
    ...reservation,
    requestedExpeditionDate: reservation.requestedExpeditionDate
      ? normalizeCivilDateInput(reservation.requestedExpeditionDate)
      : null,
    requestedDataDate: reservation.requestedDataDate
      ? normalizeCivilDateInput(reservation.requestedDataDate)
      : null,
    preparedAt: reservation.preparedAt?.toISOString() ?? null,
    scheduledStartTime: reservation.scheduledStartTime?.toISOString() ?? null,
    scheduledEndTime: reservation.scheduledEndTime?.toISOString() ?? null,
    scheduledAt: reservation.scheduledAt?.toISOString() ?? null,
    confirmedAt: reservation.confirmedAt?.toISOString() ?? null,
    counterProposedExpeditionDate: reservation.counterProposedExpeditionDate
      ? normalizeCivilDateInput(reservation.counterProposedExpeditionDate)
      : null,
    counterProposedDataDate: reservation.counterProposedDataDate
      ? normalizeCivilDateInput(reservation.counterProposedDataDate)
      : null,
    counterProposedAt: reservation.counterProposedAt?.toISOString() ?? null,
    withdrawnAt: reservation.withdrawnAt?.toISOString() ?? null,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
    attachments: reservation.attachments?.map((attachment) => ({
      ...attachment,
      createdAt: attachment.createdAt.toISOString(),
    })),
  };
}
```

- [ ] **Step 2: Verify build compiles**

Run:
```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors related to reservation serialization.

---

### Task 3: API — POST Validation + GET Bucket Mapping

**Files:**
- Modify: `src/app/api/reservations/route.ts:84-120` (POST) and `:26-37` (GET)

- [ ] **Step 1: Update POST validation — at-least-one-date**

In `src/app/api/reservations/route.ts`, find the POST handler validation block (around line 93-110). Change the validation from requiring both dates to requiring at least one:

Replace:
```typescript
    if (!companyName || !erpOfferNumber || !requestedExpeditionDate || !requestedDataDate) {
      return NextResponse.json(
        { error: "Chybí povinná pole: companyName, erpOfferNumber, requestedExpeditionDate, requestedDataDate" },
        { status: 400 }
      );
    }

    // Validace datumů — odmítnout nevalidní hodnoty před zápisem do DB
    const expDate = parseCivilDateInput(requestedExpeditionDate);
    const dataDate = parseCivilDateInput(requestedDataDate);
    if (!expDate) {
      return NextResponse.json({ error: "Neplatný formát requestedExpeditionDate" }, { status: 400 });
    }
    if (!dataDate) {
      return NextResponse.json({ error: "Neplatný formát requestedDataDate" }, { status: 400 });
    }
```

With:
```typescript
    if (!companyName || !erpOfferNumber) {
      return NextResponse.json(
        { error: "Chybí povinná pole: companyName, erpOfferNumber" },
        { status: 400 }
      );
    }
    if (!requestedExpeditionDate && !requestedDataDate) {
      return NextResponse.json(
        { error: "Vyplňte alespoň jeden termín (expedice nebo dat)" },
        { status: 400 }
      );
    }

    // Validace datumů — odmítnout nevalidní hodnoty před zápisem do DB
    const expDate = requestedExpeditionDate ? parseCivilDateInput(requestedExpeditionDate) : null;
    const dataDate = requestedDataDate ? parseCivilDateInput(requestedDataDate) : null;
    if (requestedExpeditionDate && !expDate) {
      return NextResponse.json({ error: "Neplatný formát requestedExpeditionDate" }, { status: 400 });
    }
    if (requestedDataDate && !dataDate) {
      return NextResponse.json({ error: "Neplatný formát requestedDataDate" }, { status: 400 });
    }
```

- [ ] **Step 2: Update the `prisma.reservation.create` data block**

In the same POST handler, find the `create` call (around line 114-125). The `requestedExpeditionDate` and `requestedDataDate` fields now pass nullable values. Update:

Replace:
```typescript
          requestedExpeditionDate: expDate,
```
With:
```typescript
          requestedExpeditionDate: expDate ?? undefined,
```

And similarly:
Replace:
```typescript
          requestedDataDate: dataDate,
```
With:
```typescript
          requestedDataDate: dataDate ?? undefined,
```

(Using `undefined` so Prisma omits the field when null, leaving it as the DB default `NULL`.)

- [ ] **Step 3: Update GET bucket mapping**

In `src/app/api/reservations/route.ts`, find the bucket status filter logic (around line 26-37). Update to include new states:

Replace:
```typescript
    if (session.role === "OBCHODNIK") {
      // OBCHODNIK: active = vlastní SUBMITTED+ACCEPTED+QUEUE_READY; archive = SCHEDULED+REJECTED
      if (bucket === "active")  statusFilter = ["SUBMITTED", "ACCEPTED", "QUEUE_READY"];
      else if (bucket === "archive") statusFilter = ["SCHEDULED", "REJECTED"];
      // bucket "new" → žádný filtr (OBCHODNIK nemá záložku Nové)
    } else {
      // ADMIN, PLANOVAT: new=SUBMITTED; active=ACCEPTED+QUEUE_READY; archive=SCHEDULED+REJECTED
      if (bucket === "new")         statusFilter = ["SUBMITTED"];
      else if (bucket === "active") statusFilter = ["ACCEPTED", "QUEUE_READY"];
      else if (bucket === "archive") statusFilter = ["SCHEDULED", "REJECTED"];
    }
```

With:
```typescript
    if (session.role === "OBCHODNIK") {
      // OBCHODNIK: active = vlastní aktivní; archive = uzavřené
      if (bucket === "active")  statusFilter = ["SUBMITTED", "ACCEPTED", "QUEUE_READY", "SCHEDULED", "COUNTER_PROPOSED"];
      else if (bucket === "archive") statusFilter = ["CONFIRMED", "REJECTED", "WITHDRAWN"];
    } else {
      // ADMIN, PLANOVAT: new=SUBMITTED; active=rozpracované; archive=uzavřené
      if (bucket === "new")         statusFilter = ["SUBMITTED"];
      else if (bucket === "active") statusFilter = ["ACCEPTED", "QUEUE_READY", "SCHEDULED", "COUNTER_PROPOSED"];
      else if (bucket === "archive") statusFilter = ["CONFIRMED", "REJECTED", "WITHDRAWN"];
    }
```

- [ ] **Step 4: Verify build**

Run:
```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

---

### Task 4: API — New PATCH Actions + Extended Reject

**Files:**
- Modify: `src/app/api/reservations/[id]/route.ts:54-194`

- [ ] **Step 1: Allow OBCHODNIK to call PATCH for counter-response actions**

The current PATCH handler blocks all non-planner roles at line 69. We need to allow OBCHODNIK for `accept-counter` and `reject-counter`. Replace:

```typescript
    // Jen PLANOVAT/ADMIN smí provádět stavové přechody
    if (!PLANNER_ROLES.includes(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
```

With:
```typescript
    // Role check — většinu akcí smí jen PLANOVAT/ADMIN, protinávrh-odpověď smí i OBCHODNIK
    const isPlanner = PLANNER_ROLES.includes(session.role);
    const isObchodnik = session.role === "OBCHODNIK";
    if (!isPlanner && !isObchodnik) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
```

- [ ] **Step 2: Extend reject action to include SCHEDULED and COUNTER_PROPOSED**

Find the reject handler (around line 96). Replace:

```typescript
    if (action === "reject") {
      if (!["SUBMITTED", "ACCEPTED", "QUEUE_READY"].includes(reservation.status)) {
```

With:

```typescript
    if (action === "reject") {
      if (!isPlanner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!["SUBMITTED", "ACCEPTED", "QUEUE_READY", "SCHEDULED", "COUNTER_PROPOSED"].includes(reservation.status)) {
```

- [ ] **Step 3: Add planner guard to existing accept, prepare, notify actions**

Since we now allow OBCHODNIK into the PATCH handler, add a planner check to each existing action that should remain planner-only. For each of the `accept`, `prepare`, and `notify` blocks, add at the start:

For `accept` (after `if (action === "accept") {`):
```typescript
      if (!isPlanner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
```

For `prepare` (after `if (action === "prepare") {`):
```typescript
      if (!isPlanner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
```

For `notify` (after `if (action === "notify") {`):
```typescript
      if (!isPlanner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
```

- [ ] **Step 4: Add `confirm` action**

Before the final `return NextResponse.json({ error: ... })` line (around line 189), add:

```typescript
    // ── confirm: SCHEDULED → CONFIRMED ────────────────────────────────────────
    if (action === "confirm") {
      if (!isPlanner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (reservation.status !== "SCHEDULED") {
        return NextResponse.json(
          { error: `Nelze potvrdit rezervaci ve stavu ${reservation.status}` },
          { status: 409 }
        );
      }
      const updated = await prisma.$transaction(async (tx) => {
        const r = await tx.reservation.update({
          where: { id },
          data: {
            status: "CONFIRMED",
            confirmedAt: new Date(),
            confirmedByUserId: session.id,
            confirmedByUsername: session.username,
          },
        });
        await tx.notification.create({
          data: {
            type: "RESERVATION_CONFIRMED",
            message: `Vaše rezervace ${r.code} (${r.companyName}) byla potvrzena`,
            reservationId: id,
            targetUserId: r.requestedByUserId,
            createdByUserId: session.id,
            createdByUsername: session.username,
          },
        });
        return r;
      });
      return NextResponse.json(serializeReservation(updated));
    }
```

- [ ] **Step 5: Add `counter-propose` action**

Add after the `confirm` block:

```typescript
    // ── counter-propose: SCHEDULED → COUNTER_PROPOSED ─────────────────────────
    if (action === "counter-propose") {
      if (!isPlanner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (reservation.status !== "SCHEDULED") {
        return NextResponse.json(
          { error: `Nelze navrhnout jiný termín pro rezervaci ve stavu ${reservation.status}` },
          { status: 409 }
        );
      }
      const { counterExpeditionDate, counterDataDate, reason } = body;
      if (!counterExpeditionDate && !counterDataDate) {
        return NextResponse.json({ error: "Vyplňte alespoň jeden navrhovaný termín" }, { status: 400 });
      }
      const reason_ = reason ? String(reason).trim() : "";
      if (!reason_) {
        return NextResponse.json({ error: "Důvod protinávrhu je povinný" }, { status: 400 });
      }
      const cpExpDate = counterExpeditionDate ? parseCivilDateInput(counterExpeditionDate) : null;
      const cpDataDate = counterDataDate ? parseCivilDateInput(counterDataDate) : null;
      if (counterExpeditionDate && !cpExpDate) {
        return NextResponse.json({ error: "Neplatný formát counterExpeditionDate" }, { status: 400 });
      }
      if (counterDataDate && !cpDataDate) {
        return NextResponse.json({ error: "Neplatný formát counterDataDate" }, { status: 400 });
      }
      const updated = await prisma.$transaction(async (tx) => {
        const r = await tx.reservation.update({
          where: { id },
          data: {
            status: "COUNTER_PROPOSED",
            counterProposedExpeditionDate: cpExpDate,
            counterProposedDataDate: cpDataDate,
            counterProposedReason: reason_,
            counterProposedAt: new Date(),
            counterProposedByUserId: session.id,
            counterProposedByUsername: session.username,
          },
        });
        await tx.notification.create({
          data: {
            type: "RESERVATION_COUNTER_PROPOSED",
            message: `K rezervaci ${r.code} (${r.companyName}) byl navržen jiný termín`,
            reservationId: id,
            targetUserId: r.requestedByUserId,
            createdByUserId: session.id,
            createdByUsername: session.username,
          },
        });
        return r;
      });
      return NextResponse.json(serializeReservation(updated));
    }
```

- [ ] **Step 6: Add `accept-counter` action**

Add after the `counter-propose` block:

```typescript
    // ── accept-counter: COUNTER_PROPOSED → CONFIRMED (obchodník souhlasí) ────
    if (action === "accept-counter") {
      if (!isObchodnik) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (reservation.status !== "COUNTER_PROPOSED") {
        return NextResponse.json(
          { error: `Nelze potvrdit protinávrh pro rezervaci ve stavu ${reservation.status}` },
          { status: 409 }
        );
      }
      // Jen vlastník rezervace
      if (reservation.requestedByUserId !== session.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const updated = await prisma.$transaction(async (tx) => {
        const r = await tx.reservation.update({
          where: { id },
          data: {
            status: "CONFIRMED",
            // Přepsat požadované termíny hodnotami z protinávrhu
            requestedExpeditionDate: reservation.counterProposedExpeditionDate ?? reservation.requestedExpeditionDate,
            requestedDataDate: reservation.counterProposedDataDate ?? reservation.requestedDataDate,
            confirmedAt: new Date(),
            confirmedByUserId: reservation.counterProposedByUserId,
            confirmedByUsername: reservation.counterProposedByUsername,
          },
        });
        // Notifikace plánovači (kdo navrhl protinávrh)
        if (reservation.counterProposedByUserId) {
          await tx.notification.create({
            data: {
              type: "RESERVATION_COUNTER_ACCEPTED",
              message: `Obchodník souhlasil s protinávrhem pro ${r.code} (${r.companyName})`,
              reservationId: id,
              targetUserId: reservation.counterProposedByUserId,
              createdByUserId: session.id,
              createdByUsername: session.username,
            },
          });
        }
        return r;
      });
      return NextResponse.json(serializeReservation(updated));
    }
```

- [ ] **Step 7: Add `reject-counter` action**

Add after the `accept-counter` block:

```typescript
    // ── reject-counter: COUNTER_PROPOSED → WITHDRAWN (obchodník nesouhlasí) ──
    if (action === "reject-counter") {
      if (!isObchodnik) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (reservation.status !== "COUNTER_PROPOSED") {
        return NextResponse.json(
          { error: `Nelze odmítnout protinávrh pro rezervaci ve stavu ${reservation.status}` },
          { status: 409 }
        );
      }
      // Jen vlastník rezervace
      if (reservation.requestedByUserId !== session.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const withdrawnReason = body.reason ? String(body.reason).trim() : null;
      const updated = await prisma.$transaction(async (tx) => {
        const r = await tx.reservation.update({
          where: { id },
          data: {
            status: "WITHDRAWN",
            withdrawnAt: new Date(),
            withdrawnReason: withdrawnReason,
          },
        });
        // Notifikace plánovači
        if (reservation.counterProposedByUserId) {
          await tx.notification.create({
            data: {
              type: "RESERVATION_WITHDRAWN",
              message: `Obchodník odmítl protinávrh pro ${r.code} (${r.companyName})${withdrawnReason ? `: ${withdrawnReason}` : ""}`,
              reservationId: id,
              targetUserId: reservation.counterProposedByUserId,
              createdByUserId: session.id,
              createdByUsername: session.username,
            },
          });
        }
        return r;
      });
      return NextResponse.json(serializeReservation(updated));
    }
```

- [ ] **Step 8: Add parseCivilDateInput import**

At the top of `src/app/api/reservations/[id]/route.ts`, add the import (needed for counter-propose date parsing):

```typescript
import { parseCivilDateForDb } from "@/lib/dateUtils";
```

And add the helper function after the constants:

```typescript
function parseCivilDateInput(value: unknown): Date | null {
  return parseCivilDateForDb(value);
}
```

- [ ] **Step 9: Verify build**

Run:
```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

---

### Task 5: Frontend — Reservation Interface + Bucket Mapping

**Files:**
- Modify: `src/app/rezervace/_components/RezervacePage.tsx:11-35` (interface) and `:77-80` (tabToBucket is unchanged — buckets map to API)

- [ ] **Step 1: Extend Reservation interface**

In `src/app/rezervace/_components/RezervacePage.tsx`, add new fields to the `Reservation` interface (after `scheduledAt`):

```typescript
export interface Reservation {
  id: number;
  code: string;
  status: string;
  companyName: string;
  erpOfferNumber: string;
  requestedExpeditionDate: string | null;
  requestedDataDate: string | null;
  requestText: string | null;
  requestedByUserId: number;
  requestedByUsername: string;
  plannerUserId: number | null;
  plannerUsername: string | null;
  plannerDecisionReason: string | null;
  planningPayload: Record<string, unknown> | null;
  preparedAt: string | null;
  scheduledBlockId: number | null;
  scheduledMachine: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  scheduledAt: string | null;
  confirmedAt: string | null;
  confirmedByUserId: number | null;
  confirmedByUsername: string | null;
  counterProposedExpeditionDate: string | null;
  counterProposedDataDate: string | null;
  counterProposedReason: string | null;
  counterProposedAt: string | null;
  counterProposedByUserId: number | null;
  counterProposedByUsername: string | null;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: ReservationAttachment[];
}
```

Key changes: `requestedExpeditionDate` and `requestedDataDate` are now `string | null`. 11 new nullable fields added.

- [ ] **Step 2: Verify build**

Run:
```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: TypeScript errors in `ReservationDetail.tsx` and `ReservationForm.tsx` where these fields are used as non-null — these will be fixed in Tasks 6 and 7.

---

### Task 6: Frontend — ReservationForm (Optional Dates)

**Files:**
- Modify: `src/app/rezervace/_components/ReservationForm.tsx:29-34,68-71,193-216`

- [ ] **Step 1: Update submit validation**

In `ReservationForm.tsx`, find the `handleSubmit` validation (around line 70):

Replace:
```typescript
    if (!companyName || !erpOfferNumber || !requestedExpeditionDate || !requestedDataDate) {
      setError("Vyplňte všechna povinná pole");
      return;
    }
```

With:
```typescript
    if (!companyName || !erpOfferNumber) {
      setError("Vyplňte název firmy a nabídku Cicero");
      return;
    }
    if (!requestedExpeditionDate && !requestedDataDate) {
      setError("Vyplňte alespoň jeden termín (expedice nebo dat)");
      return;
    }
```

- [ ] **Step 2: Update request body to omit empty dates**

In the same `handleSubmit`, find the fetch body (around line 80-85). The body currently sends both dates. Update to only send non-empty ones:

Find the JSON body object being sent to `/api/reservations` and ensure it sends:
```typescript
        body: JSON.stringify({
          companyName,
          erpOfferNumber,
          requestedExpeditionDate: requestedExpeditionDate || undefined,
          requestedDataDate: requestedDataDate || undefined,
          requestText: requestText || undefined,
        }),
```

- [ ] **Step 3: Remove `required` attribute from date fields**

In the form JSX (around line 193-216), the date labels currently show `*`. Remove the asterisks and add an info text. Replace:

```typescript
        <div>
          <label style={labelStyle}>Požadovaný termín expedice *</label>
```

With:
```typescript
        <div>
          <label style={labelStyle}>Požadovaný termín expedice</label>
```

And replace:
```typescript
        <div>
          <label style={labelStyle}>Požadovaný termín dat *</label>
```

With:
```typescript
        <div>
          <label style={labelStyle}>Požadovaný termín dat</label>
```

- [ ] **Step 4: Add info text below date fields**

After the closing `</div>` of the dates grid (after the `dataAfterExpedition` warning), add:

```tsx
      {!requestedExpeditionDate && !requestedDataDate && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 0" }}>
          Vyplňte alespoň jeden termín (expedice nebo dat).
        </div>
      )}
```

- [ ] **Step 5: Verify build**

Run:
```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors for ReservationForm.

---

### Task 7: Frontend — ReservationDetail (Counter-Proposal UI)

**Files:**
- Modify: `src/app/rezervace/_components/ReservationDetail.tsx`

- [ ] **Step 1: Add state for counter-proposal rejection**

At the top of the `ReservationDetail` component (around line 50-53), add new state:

```typescript
  const [showWithdrawInput, setShowWithdrawInput] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
```

- [ ] **Step 2: Update date display for nullable fields**

In the detail section (around line 114-115), update to handle null dates:

Replace:
```typescript
        {fieldRow("Termín expedice", fmtDate(r.requestedExpeditionDate))}
        {fieldRow("Termín dat", fmtDate(r.requestedDataDate))}
```

With:
```typescript
        {r.requestedExpeditionDate && fieldRow("Termín expedice", fmtDate(r.requestedExpeditionDate))}
        {r.requestedDataDate && fieldRow("Termín dat", fmtDate(r.requestedDataDate))}
```

- [ ] **Step 3: Add CONFIRMED display section**

After the `SCHEDULED` info block (around line 176), add:

```tsx
      {/* CONFIRMED info */}
      {r.status === "CONFIRMED" && (
        <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
          <span style={{ color: "#10b981", fontWeight: 600 }}>Potvrzeno</span>
          {r.confirmedAt && <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: 12 }}>{fmtDatetime(r.confirmedAt)}</span>}
          {r.confirmedByUsername && <span style={{ color: "var(--text-muted)", marginLeft: 4, fontSize: 12 }}>— {r.confirmedByUsername}</span>}
          {r.scheduledMachine && (
            <div style={{ marginTop: 6 }}>
              Stroj: <strong>{r.scheduledMachine.replace("_", " ")}</strong>,{" "}
              {fmtDatetime(r.scheduledStartTime)} – {fmtDatetime(r.scheduledEndTime)}
              {r.scheduledBlockId && (
                <a href={`/?highlight=${r.scheduledBlockId}`} style={{ marginLeft: 12, color: "#3b82f6", textDecoration: "none", fontSize: 12 }}>
                  → Zobrazit v plánovači
                </a>
              )}
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 4: Add COUNTER_PROPOSED display for obchodník**

After the CONFIRMED block, add the counter-proposal section:

```tsx
      {/* COUNTER_PROPOSED — obchodník vidí protinávrh */}
      {r.status === "COUNTER_PROPOSED" && (
        <div>
          {/* Protinávrh box */}
          <div style={{ padding: 14, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
              Protinávrh od plánovače
            </div>
            <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
              {r.counterProposedExpeditionDate && (
                <div>
                  <span style={{ color: "var(--text-muted)" }}>Nový termín expedice: </span>
                  <strong style={{ color: "#f59e0b", fontSize: 15 }}>{fmtDate(r.counterProposedExpeditionDate)}</strong>
                  {r.requestedExpeditionDate && (
                    <span style={{ marginLeft: 8, textDecoration: "line-through", color: "var(--text-muted)", fontSize: 12 }}>
                      (původně {fmtDate(r.requestedExpeditionDate)})
                    </span>
                  )}
                </div>
              )}
              {r.counterProposedDataDate && (
                <div>
                  <span style={{ color: "var(--text-muted)" }}>Nový termín dat: </span>
                  <strong style={{ color: "#f59e0b", fontSize: 15 }}>{fmtDate(r.counterProposedDataDate)}</strong>
                  {r.requestedDataDate && (
                    <span style={{ marginLeft: 8, textDecoration: "line-through", color: "var(--text-muted)", fontSize: 12 }}>
                      (původně {fmtDate(r.requestedDataDate)})
                    </span>
                  )}
                </div>
              )}
              {r.counterProposedReason && (
                <div><span style={{ color: "var(--text-muted)" }}>Důvod: </span>{r.counterProposedReason}</div>
              )}
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Navrhl: {r.counterProposedByUsername} · {fmtDatetime(r.counterProposedAt)}
              </div>
            </div>
          </div>

          {/* Akce pro obchodníka */}
          {!isPlanner && r.requestedByUserId === currentUser.id && (
            <div>
              {error && (
                <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, padding: "8px 12px", color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>
                  {error}
                </div>
              )}
              {!showWithdrawInput ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => doAction("accept-counter")}
                    disabled={submitting === "accept-counter"}
                    style={btnStyle("#10b981", submitting === "accept-counter")}
                  >
                    {submitting === "accept-counter" ? "Potvrzuji…" : "Souhlasím s novým termínem"}
                  </button>
                  <button
                    onClick={() => setShowWithdrawInput(true)}
                    style={btnStyle("#dc2626", false)}
                  >
                    Nesouhlasím
                  </button>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <textarea
                    value={withdrawReason}
                    onChange={(e) => setWithdrawReason(e.target.value)}
                    placeholder="Důvod nesouhlasu (volitelné)…"
                    rows={2}
                    style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => doAction("reject-counter", { reason: withdrawReason })}
                      disabled={submitting === "reject-counter"}
                      style={btnStyle("#dc2626", submitting === "reject-counter")}
                    >
                      {submitting === "reject-counter" ? "Odesílám…" : "Potvrdit nesouhlas"}
                    </button>
                    <button
                      onClick={() => { setShowWithdrawInput(false); setWithdrawReason(""); }}
                      style={{ ...btnStyle("var(--surface-2)", false), color: "var(--text-muted)" }}
                    >
                      Zrušit
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    Při nesouhlasu bude rezervace uzavřena. Pro nový požadavek založte novou rezervaci.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 5: Add WITHDRAWN display**

After the COUNTER_PROPOSED block:

```tsx
      {/* WITHDRAWN info */}
      {r.status === "WITHDRAWN" && (
        <div style={{ background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
          <span style={{ color: "#dc2626", fontWeight: 600 }}>Rezervace stažena</span>
          {r.withdrawnAt && <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: 12 }}>{fmtDatetime(r.withdrawnAt)}</span>}
          {r.withdrawnReason && <div style={{ marginTop: 4, color: "var(--text-muted)" }}>Důvod: {r.withdrawnReason}</div>}
        </div>
      )}
```

- [ ] **Step 6: Verify build**

Run:
```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

---

### Task 8: Frontend — BlockDetail Reservation Section

**Files:**
- Modify: `src/components/BlockDetail.tsx`

- [ ] **Step 1: Add state and types for reservation section**

At the top of the `BlockDetail` component (after existing `useState` calls, around line 68-69), add:

```typescript
  const [reservation, setReservation] = useState<{
    id: number;
    code: string;
    status: string;
    companyName: string;
    requestedExpeditionDate: string | null;
    requestedDataDate: string | null;
    requestedByUsername: string;
    counterProposedExpeditionDate: string | null;
    counterProposedByUsername: string | null;
  } | null>(null);
  const [resLoading, setResLoading] = useState(false);
  const [resAction, setResAction] = useState<string | null>(null);
  const [resError, setResError] = useState<string | null>(null);
  const [showCounterForm, setShowCounterForm] = useState(false);
  const [counterExpDate, setCounterExpDate] = useState("");
  const [counterDataDate, setCounterDataDate] = useState("");
  const [counterReason, setCounterReason] = useState("");
```

- [ ] **Step 2: Add useEffect to fetch reservation data**

After the existing `useEffect` for `blockHistory` (around line 77), add:

```typescript
  useEffect(() => {
    if (!block.reservationId) { setReservation(null); return; }
    setResLoading(true);
    fetch(`/api/reservations/${block.reservationId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setReservation(data))
      .catch(() => setReservation(null))
      .finally(() => setResLoading(false));
  }, [block.reservationId]);
```

- [ ] **Step 3: Add reservation action handler**

After the useEffect, add:

```typescript
  async function handleResAction(action: string, extra?: Record<string, unknown>) {
    if (!reservation) return;
    setResAction(action);
    setResError(null);
    try {
      const res = await fetch(`/api/reservations/${reservation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Chyba");
      }
      const updated = await res.json();
      setReservation(updated);
      setShowCounterForm(false);
      setCounterExpDate("");
      setCounterDataDate("");
      setCounterReason("");
    } catch (err: unknown) {
      setResError(err instanceof Error ? err.message : "Chyba");
    } finally {
      setResAction(null);
    }
  }
```

- [ ] **Step 4: Add reservation section JSX**

In the component JSX, after the "Termín" section (after `block.deadlineExpedice` block, around line 167) and before the "Expedice shortcut" section, add:

```tsx
        {/* Rezervace — zobrazit jen pokud blok má reservationId */}
        {block.reservationId && reservation && (
          <>
            <Separator className="my-1 bg-slate-800" />
            <div style={{ borderRadius: 8, border: "1px solid rgba(124,58,237,0.2)", background: "rgba(124,58,237,0.06)", padding: "10px 12px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#c084fc", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                Rezervace {reservation.code}
              </div>
              <div style={{ display: "grid", gap: 4, fontSize: 11, marginBottom: 10 }}>
                <div><span style={{ color: "var(--text-muted)", display: "inline-block", width: 100 }}>Firma:</span> <span style={{ color: "var(--text)" }}>{reservation.companyName}</span></div>
                {reservation.requestedExpeditionDate && (
                  <div><span style={{ color: "var(--text-muted)", display: "inline-block", width: 100 }}>Termín expedice:</span> <span style={{ color: "var(--text)", fontWeight: 600 }}>{formatDate(reservation.requestedExpeditionDate)}</span></div>
                )}
                {reservation.requestedDataDate && (
                  <div><span style={{ color: "var(--text-muted)", display: "inline-block", width: 100 }}>Termín dat:</span> <span style={{ color: "var(--text)", fontWeight: 600 }}>{formatDate(reservation.requestedDataDate)}</span></div>
                )}
                <div><span style={{ color: "var(--text-muted)", display: "inline-block", width: 100 }}>Obchodník:</span> {reservation.requestedByUsername}</div>
                <div>
                  <span style={{ color: "var(--text-muted)", display: "inline-block", width: 100 }}>Stav:</span>
                  {reservation.status === "SCHEDULED" && <span style={{ color: "#f59e0b", fontWeight: 600 }}>Naplánováno</span>}
                  {reservation.status === "CONFIRMED" && <span style={{ color: "#10b981", fontWeight: 600 }}>Potvrzeno</span>}
                  {reservation.status === "COUNTER_PROPOSED" && <span style={{ color: "#f59e0b", fontWeight: 600 }}>Čeká na obchodníka</span>}
                  {reservation.status === "REJECTED" && <span style={{ color: "#dc2626", fontWeight: 600 }}>Zamítnuto</span>}
                  {reservation.status === "WITHDRAWN" && <span style={{ color: "#dc2626", fontWeight: 600 }}>Staženo</span>}
                </div>
              </div>

              {resError && (
                <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 8, padding: "4px 8px", background: "rgba(239,68,68,0.08)", borderRadius: 6 }}>
                  {resError}
                </div>
              )}

              {/* Akce pro SCHEDULED */}
              {canEdit && reservation.status === "SCHEDULED" && !showCounterForm && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => handleResAction("confirm")}
                    disabled={resAction === "confirm"}
                    style={{ fontSize: 10, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "none", background: "#10b981", color: "#fff", cursor: resAction === "confirm" ? "not-allowed" : "pointer", opacity: resAction === "confirm" ? 0.6 : 1 }}
                  >
                    {resAction === "confirm" ? "Potvrzuji…" : "Potvrdit termín"}
                  </button>
                  <button
                    onClick={() => setShowCounterForm(true)}
                    style={{ fontSize: 10, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "none", background: "#f59e0b", color: "#fff", cursor: "pointer" }}
                  >
                    Navrhnout jiný
                  </button>
                </div>
              )}

              {/* Inline formulář protinávrhu */}
              {canEdit && reservation.status === "SCHEDULED" && showCounterForm && (
                <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>Nový termín expedice</div>
                    <input
                      type="date"
                      value={counterExpDate}
                      onChange={(e) => setCounterExpDate(e.target.value)}
                      style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 11, fontFamily: "inherit" }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>Nový termín dat <span style={{ color: "var(--text-muted)", fontSize: 9 }}>(volitelné)</span></div>
                    <input
                      type="date"
                      value={counterDataDate}
                      onChange={(e) => setCounterDataDate(e.target.value)}
                      style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 11, fontFamily: "inherit" }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>Důvod *</div>
                    <textarea
                      value={counterReason}
                      onChange={(e) => setCounterReason(e.target.value)}
                      placeholder="Kapacita knihárny obsazená do…"
                      rows={2}
                      style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 11, fontFamily: "inherit", resize: "vertical" }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => handleResAction("counter-propose", {
                        counterExpeditionDate: counterExpDate || undefined,
                        counterDataDate: counterDataDate || undefined,
                        reason: counterReason,
                      })}
                      disabled={(!counterExpDate && !counterDataDate) || !counterReason.trim() || resAction === "counter-propose"}
                      style={{
                        fontSize: 10, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "none",
                        background: (!counterExpDate && !counterDataDate) || !counterReason.trim() ? "var(--surface-3)" : "#f59e0b",
                        color: (!counterExpDate && !counterDataDate) || !counterReason.trim() ? "var(--text-muted)" : "#fff",
                        cursor: (!counterExpDate && !counterDataDate) || !counterReason.trim() ? "not-allowed" : "pointer",
                      }}
                    >
                      {resAction === "counter-propose" ? "Odesílám…" : "Odeslat protinávrh"}
                    </button>
                    <button
                      onClick={() => { setShowCounterForm(false); setCounterExpDate(""); setCounterDataDate(""); setCounterReason(""); }}
                      style={{ fontSize: 10, fontWeight: 600, padding: "5px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
                    >
                      Zrušit
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        {block.reservationId && resLoading && (
          <>
            <Separator className="my-1 bg-slate-800" />
            <div style={{ fontSize: 10, color: "var(--text-muted)", padding: 8 }}>Načítám rezervaci…</div>
          </>
        )}
```

- [ ] **Step 5: Verify build**

Run:
```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

---

### Task 9: Frontend — InboxPanel Notification Types

**Files:**
- Modify: `src/components/InboxPanel.tsx:49-67`

- [ ] **Step 1: Add notification type styling**

In `InboxPanel.tsx`, the `isReservationNotif` check (line 49) already handles non-BLOCK_NOTIFY types by showing the message text and a link to the reservation. The new notification types (`RESERVATION_CONFIRMED`, `RESERVATION_COUNTER_PROPOSED`, `RESERVATION_COUNTER_ACCEPTED`, `RESERVATION_WITHDRAWN`) will automatically work because:

1. They all have `type` set (so `isReservationNotif` is true)
2. They all have `message` set
3. They all have `reservationId` set

No code change is needed here — the existing rendering logic handles them. Verify by reading the component to confirm.

- [ ] **Step 2: Verify the component handles all types**

Run:
```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

---

### Task 10: Full Build + Smoke Test

- [ ] **Step 1: Run full TypeScript check**

Run:
```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Run existing test suite**

Run:
```bash
node --test --import tsx src/lib/dateUtils.test.ts && node --test --import tsx src/lib/errors.test.ts && node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```

Expected: 24/24 tests pass (existing tests should not break — changes are additive).

- [ ] **Step 3: Run full build**

Run:
```bash
npm run build
```

Expected: Build succeeds. May show existing ESLint warnings (not errors).

- [ ] **Step 4: Start dev server and verify**

Run:
```bash
npm run dev
```

Manual checks:
1. Open `/rezervace` as OBCHODNIK — confirm form allows submitting with just one date
2. Open `/rezervace` as ADMIN — verify bucket tabs show correct reservations
3. On planner timeline, click a block that has a reservation — verify the reservation section appears with Potvrdit/Navrhnout jiný buttons
