# Shipment Risk Module — Day 1 + Day 2

**Module path:** `src/app/modules/shipment-risk/`  
**API base:** `POST|GET /api/v1/risk/`  
**Day-1 migration:** `prisma/migrations/20261114000000_add_shipment_risk_assessment/`

---

## Overview

The Shipment Risk module identifies shipments that may be experiencing operational delays or abnormal inactivity. It produces a scored, explainable risk assessment per shipment on demand, persists each result for historical tracking, and exposes three REST endpoints for operational use.

The Day 1 implementation is deterministic and rule-based — no machine learning, no LLM. The engine takes a snapshot of a shipment's operational state and applies a fixed set of weighted rules to produce a score from 0 to 100.

---

## Files

| File | Purpose |
|---|---|
| `risk.engine.ts` | Pure scoring function — no DB, no side effects. All business logic lives here. |
| `risk.service.ts` | Fetches the DB snapshot, calls the engine, persists the result, writes an audit log. Day 2 adds `getRiskOverview` and `listRiskAssessments`. |
| `risk.schema.ts` | Zod schemas for path params, history query, and the Day-2 list/filter query (`riskListQuerySchema`). |
| `risk.controller.ts` | Five thin Express handlers — reads params, calls service, responds. |
| `risk.routes.ts` | Mounts all five endpoints with `authenticate`, `authorize`, and `validateRequest`. |
| `MODULE_DOCS.md` | This file. |

---

## Database Changes

### New Prisma schema file: `prisma/schema/risk.prisma`

#### New enums

| Enum | Values |
|---|---|
| `RiskLevel` | `LOW`, `MEDIUM`, `HIGH` |
| `RiskAssessmentStatus` | `ASSESSED`, `INSUFFICIENT_DATA` |
| `RiskFactorCode` | `STATUS_INACTIVE_WARNING`, `STATUS_INACTIVE_CRITICAL`, `FAILED_DELIVERY_ATTEMPT_1`, `FAILED_DELIVERY_ATTEMPT_2`, `FAILED_DELIVERY_ATTEMPT_MAX`, `COURIER_NOT_ACCEPTED`, `MULTIPLE_HUB_TRANSFERS` |

#### New model: `ShipmentRiskAssessment`

| Field | Type | Notes |
|---|---|---|
| `id` | `String` (cuid) | PK |
| `shipmentId` | `String` | FK → `Shipment.id` |
| `riskScore` | `Int` | 0–100, clamped |
| `riskLevel` | `RiskLevel` | Derived from score |
| `assessmentStatus` | `RiskAssessmentStatus` | `ASSESSED` or `INSUFFICIENT_DATA` |
| `factors` | `Json` | Array of `{code, score, evidence}` objects |
| `shipmentStatus` | `ShipmentStatus` | Snapshot of status at assessment time |
| `lastEventAt` | `DateTime?` | Timestamp of the last tracking event at assessment time |
| `assessedAt` | `DateTime` | Auto-set to `now()` on insert |

Indexes: `shipmentId`, `(shipmentId, assessedAt DESC)`, `riskLevel`, `assessedAt DESC`.

#### Modified: `prisma/schema/shipment.prisma`
Added relation field `riskAssessments ShipmentRiskAssessment[]`.

#### Modified: `prisma/schema/enums.prisma`
Added `RISK_ASSESSMENT_CREATED` to the `AuditAction` enum.

---

## API Endpoints

### `POST /api/v1/risk/shipments/:shipmentId/assess`

Triggers a fresh assessment for the given shipment and persists it.

**Auth:** `OPERATIONS_MANAGER`, `HUB_MANAGER`, `ADMIN`  
**Params:** `shipmentId` (cuid)  
**Returns:** The new `ShipmentRiskAssessment` row (HTTP 201)

```json
{
  "success": true,
  "message": "Risk assessment completed.",
  "data": {
    "id": "clz...",
    "shipmentId": "clz...",
    "riskScore": 55,
    "riskLevel": "MEDIUM",
    "assessmentStatus": "ASSESSED",
    "factors": [
      {
        "code": "STATUS_INACTIVE_CRITICAL",
        "score": 35,
        "evidence": "Shipment has been in DELIVERY_FAILED for 60.0h, exceeding the 48h threshold by 12.0h."
      },
      {
        "code": "FAILED_DELIVERY_ATTEMPT_1",
        "score": 20,
        "evidence": "1 failed delivery attempt recorded."
      }
    ],
    "shipmentStatus": "DELIVERY_FAILED",
    "lastEventAt": "2026-11-12T08:00:00.000Z",
    "assessedAt": "2026-11-14T12:00:00.000Z"
  }
}
```

### `GET /api/v1/risk/shipments/:shipmentId/latest`

Returns the most recent assessment. Returns `null` in `data` if no assessment has been run yet.

**Auth:** `COURIER`, `HUB_MANAGER`, `OPERATIONS_MANAGER`, `ADMIN`  
**Returns:** `ShipmentRiskAssessment | null` (HTTP 200)

### `GET /api/v1/risk/shipments/:shipmentId/history`

Paginated list of all assessments for a shipment, newest first.

**Auth:** `OPERATIONS_MANAGER`, `ADMIN`  
**Query:** `page` (default 1), `limit` (default 10, max 50)  
**Returns:** Array of `ShipmentRiskAssessment` with pagination meta (HTTP 200)

---

## Risk Algorithm

### Scoring overview

The engine (`assessShipmentRisk`) evaluates four independent factor categories and sums the contributions. Within each category, only the worst-case factor fires (no double-counting). The total is clamped to `[0, 100]`.

### Score → risk level mapping

| Score range | Risk level |
|---|---|
| 0–39 | `LOW` |
| 40–69 | `MEDIUM` |
| 70–100 | `HIGH` |

### Factor categories and weights

#### Category 1: Status inactivity

Compares `now - lastEventAt` against a per-status threshold. The `lastEventAt` comes from the most recent `ShipmentTrackingEvent.createdAt` — the append-only event log whose timestamps represent actual operational events.

| Factor code | Trigger | Score |
|---|---|---|
| `STATUS_INACTIVE_WARNING` | Elapsed time is 50–100% of threshold | +15 |
| `STATUS_INACTIVE_CRITICAL` | Elapsed time exceeds threshold | +35 |

**Per-status thresholds:**

| Status | Threshold | Basis |
|---|---|---|
| `CREATED` | 48h | Customer needs to pay and request pickup |
| `PICKUP_REQUESTED` | 24h | Courier should be assigned within a business day |
| `ASSIGNED` | 12h | Courier should pick up same/next day |
| `PICKED_UP` | 24h | Should arrive at hub within a day of pickup |
| `AT_ORIGIN_HUB` | 24h | Hub should dispatch transfer within a day |
| `IN_TRANSIT` | 72h | Standard inter-hub transit time |
| `AT_DESTINATION_HUB` | 12h | Delivery courier should be assigned quickly |
| `OUT_FOR_DELIVERY` | 24h | Delivery attempt should happen same day |
| `DELIVERY_FAILED` | 48h | Retry or return decision within 2 days |
| `RETURN_INITIATED` | 48h | Return assignment should be made quickly |
| `RETURNING` | 72h | Return transit time |
| `DELIVERED`, `CANCELLED`, `RETURNED` | Not scored (terminal) | — |

#### Category 2: Failed delivery attempts

Uses `Shipment.deliveryAttemptCount` (the authoritative counter, maintained by `recordDelivery` and `recordDeliveryFailed`). Worst-case wins within this category.

| Factor code | Trigger | Score |
|---|---|---|
| `FAILED_DELIVERY_ATTEMPT_1` | `deliveryAttemptCount == 1` | +20 |
| `FAILED_DELIVERY_ATTEMPT_2` | `deliveryAttemptCount == 2` | +40 |
| `FAILED_DELIVERY_ATTEMPT_MAX` | `deliveryAttemptCount >= MAX_DELIVERY_ATTEMPTS` | +50 |

#### Category 3: Courier not accepted

Applies when the shipment has an active `CourierAssignment` with `acceptedAt = null` for more than 4 hours. Only fires in `ASSIGNED`, `OUT_FOR_DELIVERY`, or `RETURNING` statuses.

| Factor code | Trigger | Score |
|---|---|---|
| `COURIER_NOT_ACCEPTED` | Active assignment unaccepted for > 4h | +15 |

#### Category 4: Multiple hub transfers

A flat signal that fires when a shipment has accumulated more than 2 hub transfers, suggesting routing problems.

| Factor code | Trigger | Score |
|---|---|---|
| `MULTIPLE_HUB_TRANSFERS` | `hubTransferCount > 2` | +10 |

### Guard conditions

- **Terminal statuses** (`DELIVERED`, `CANCELLED`, `RETURNED`): return `score=0`, `riskLevel=LOW`, `factors=[]` immediately. No risk signal is ever raised for completed shipments.
- **No tracking events** (`lastEventAt = null`): return `assessmentStatus=INSUFFICIENT_DATA`, `score=0`, `factors=[]`. Callers can distinguish genuine low risk from missing data.

---

## Engine Design Properties

- **Deterministic**: the same `RiskEngineInput` always produces the same `RiskEngineOutput`. The `assessedAt` timestamp is injected by the service so the engine has no internal `Date.now()` calls.
- **Pure function**: `assessShipmentRisk` has no imports from `lib/prisma`, no side effects, and no I/O. It can be unit-tested without mocking anything.
- **Independent of HTTP**: the engine knows nothing about Express, requests, or responses.
- **Explainable**: every factor includes a human-readable `evidence` string describing the specific condition that triggered it.
- **Safe with incomplete data**: missing or null fields (no assignment, no hub transfers) are handled with null-checks; the engine never throws on valid operational states.

---

## Running Tests

```bash
# Run all tests (risk engine tests are in src/tests/unit/risk.engine.test.ts)
npm test

# Run only the risk engine tests
npm test -- --reporter=verbose risk.engine

# Type-check the whole codebase
npm run type-check

# Validate the Prisma schema
npx prisma validate --schema=./prisma/schema
```

---

## Applying the Migration

```bash
# Development
npm run db:migrate

# Production (non-destructive — purely additive)
npm run db:migrate:prod
```

The migration adds three new enum types (`RiskLevel`, `RiskAssessmentStatus`, `RiskFactorCode`), one new table (`shipment_risk_assessments`), and one new enum value (`RISK_ASSESSMENT_CREATED` on `AuditAction`). No existing tables, columns, or indexes are modified.

---

## Known Limitations

1. **No expected delivery date**: the `Shipment` model has no ETA or deadline field. Inactivity thresholds are a proxy for delay detection, not a precise milestone comparison. Per-status thresholds assume typical operational cadence, not a customer-promised delivery window.

2. **No business-hours adjustment**: thresholds are calendar-hours. A shipment sitting at a hub over a weekend will accumulate inactivity time despite no one being available to act on it. Business-hours awareness requires a configuration layer not present in Day 1.

3. **No per-hub thresholds**: all hubs use the same global thresholds. A hub with known slower processing cannot be tuned independently without adding a hub-level configuration model.

4. **Assessment is on-demand only**: there is no background job triggering periodic re-assessment. Stale assessments are possible if the last assessment was run long before the current moment.

5. **`deliveryAttemptCount` is the counter of record**: the engine uses `Shipment.deliveryAttemptCount` rather than counting `DeliveryAttempt` rows directly. These are kept in sync by the existing courier service but are technically independent. If they diverged due to a bug in another module, the risk score would use the counter on the `Shipment` row.

---

## Future Extension Points

### Day 2: Operational Risk Dashboard

- Add `GET /api/v1/risk/high-risk` — paginated list of all shipments whose latest assessment is `HIGH` or `MEDIUM`. The `@@index([riskLevel])` on `ShipmentRiskAssessment` supports this efficiently.
- Surface the `factors` JSON in a dashboard UI alongside the standard shipment list.
- The `shipmentStatus` snapshot field means historical assessments remain interpretable after the shipment progresses.

### Day 3: AI Shipment Investigator

- `assessShipmentRisk` returns structured `RiskFactor[]` with machine-readable `code` values. An LLM investigator can consume these codes plus the `evidence` strings to generate a natural-language investigation report without re-running the scoring logic.
- The `ShipmentRiskAssessment` history (multiple rows per shipment, ordered by `assessedAt`) gives the AI context about how risk evolved over time — was this shipment always HIGH, or did it escalate?
- The engine's `RiskEngineInput` type is a clean, documented interface that an AI orchestration layer can populate from any data source (DB, cache, event stream) without touching the scoring logic.

### Future: Predictive scoring

- As `ShipmentRiskAssessment` rows accumulate, historical patterns become available: which factor combinations most reliably predict eventual delay? Which hub consistently triggers `STATUS_INACTIVE_CRITICAL`?
- The `factors` Json field stores enough structured data for statistical analysis without schema changes.
- An ETA field on `Shipment` (a natural Day 2 addition once business rules for delivery promises are defined) would unlock the `OVERDUE_MILESTONE` factor class, making the inactivity proxy unnecessary.

---

## Day 2 Additions

### New API Endpoints

#### `GET /api/v1/risk/overview`

Returns aggregate risk counts scoped to the caller's role. Cached 2 minutes server-side (matching `getSystemStats` TTL).

**Auth:** `OPERATIONS_MANAGER`, `HUB_MANAGER`, `ADMIN`  
**Hub scoping:** `HUB_MANAGER` sees only shipments whose `currentHubId` matches their hub. Enforced in the Prisma query, not at the route level.  
**Returns:** `RiskOverview` (HTTP 200)

```json
{
  "data": {
    "total": 42,
    "assessed": 38,
    "unassessed": 4,
    "high": 5,
    "medium": 11,
    "low": 22,
    "requiresAttention": 16
  }
}
```

---

#### `GET /api/v1/risk/shipments`

Paginated list of the latest risk assessment per shipment, with optional filters.

**Auth:** `OPERATIONS_MANAGER`, `HUB_MANAGER`, `ADMIN`

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `page` | number | Page number (default: 1) |
| `limit` | number | Per page (default: 20, max: 100) |
| `riskLevel` | `LOW\|MEDIUM\|HIGH` | Filter by risk level |
| `shipmentStatus` | `ShipmentStatus` | Filter by snapshot shipment status |
| `search` | string | Tracking number contains (case-insensitive) |
| `fromDate` | ISO date | Assessments from this date |
| `toDate` | ISO date | Assessments up to this date |

**Returns:** Paginated `ShipmentRiskAssessment[]`, each including `shipment.trackingNumber`.

---

### Changed: `assessmentSelect` now includes `shipment.trackingNumber`

All three Day-1 endpoints (`POST /assess`, `GET /latest`, `GET /history`) now return `shipment: { trackingNumber }` in the assessment object. This is an additive change — no field was removed or renamed.

---

### New: `risk.schema.ts` additions

- `riskListQuerySchema` — validates all filter/pagination params for `GET /risk/shipments`.
- `RiskListRole` type — `'OPERATIONS_MANAGER' | 'ADMIN' | 'HUB_MANAGER'`, exported for the service layer.

---

### Frontend integration

The Day-2 frontend is in `LogiFlow_Frontend/src/features/risk/`.

| File | Purpose |
|---|---|
| `api.ts` | `getRiskOverview`, `listRiskAssessments`, `assessShipment`, `getLatestAssessment` |
| `hooks.ts` | `useRiskOverview`, `useRiskAssessments`, `useLatestRiskAssessment`, `useAssessShipment` |
| `RiskDashboard.tsx` | Full dashboard: 5 overview cards, donut chart, filtered/paginated table |
| `RiskDetailsPanel.tsx` | Expandable row showing score, factors, evidence, re-assess button |
| `RiskFactorLabel.tsx` | Maps `RiskFactorCode` enum values to readable labels |

**Dashboard routes:**
- `/dashboard/operations/risk` — OPERATIONS_MANAGER
- `/dashboard/admin/risk` — ADMIN

Both routes render the same `<RiskDashboard canRefresh />` component. Neither role can access the other's route (dashboard auth guard + route-level `authorize()` on the backend).

**Navigation:** `ShieldAlert` icon added to both OPERATIONS_MANAGER and ADMIN sidebar nav.

**Shared component added:** `src/components/shared/RiskLevelBadge.tsx`

---

### Testing

Day-2 tests live in `src/tests/unit/risk.service.test.ts`.

```bash
npm test -- --reporter=verbose risk.service
```

Covers: cache hit, no shipments in scope, HIGH/MEDIUM/LOW binning, unassessed count, HUB_MANAGER scope (overview); pagination, all five filter params, hub scoping, empty results, tracking number in result, NotFoundError regression guard (list).

**Run counts at Day-2 completion:**  
`Test Files: 2 failed | 17 passed (19)` — the 2 failing files contain 4 pre-existing failures unrelated to this module.  
`Tests: 4 failed | 259 passed (263)` — 15 new tests added.

---

### Known Limitations (Day 2 additions)

6. **Overview accuracy window.** The 2-minute cache means the overview counts may lag newly triggered assessments by up to 2 minutes. This is an intentional trade-off matching the existing `getSystemStats` cache strategy.

7. **Overview aggregation cost.** The `getRiskOverview` function performs a `findMany` on all shipments in scope followed by a `groupBy` and N `findFirst` queries (one per assessed shipment). For large datasets this may be slow. A PostgreSQL `LATERAL JOIN` raw query would be more efficient; that optimization is a Day 3+ concern.

8. **Re-assess creates a new row.** Each `POST /assess` appends a new `ShipmentRiskAssessment` row rather than updating the existing one. This is deliberate (audit trail), but the list endpoint de-duplicates via `distinct: ['shipmentId']` ordering by `assessedAt DESC` to show only the latest per shipment.
